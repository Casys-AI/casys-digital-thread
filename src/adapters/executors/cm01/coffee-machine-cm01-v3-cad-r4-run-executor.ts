import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import {
  compileCoffeeMachineCm01SemanticCadPlanR2,
} from "../../../domain/cm01/coffee-machine-cm01-semantic-cad-plan.ts";
import {
  type CoffeeMachineCm01SemanticRecipeR2,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "../../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  captureCm01SemanticCadExportR3,
  type Cm01SemanticCadR3Capture,
  parseCm01SemanticCadR3Capture,
} from "../../captures/cm01-semantic-cad-capture-r3.ts";
import {
  Cm01SemanticCadOutcomeUnknownError,
  FileCm01SemanticCadAttemptStore,
} from "../../wal/file-cm01-semantic-cad-attempt-store.ts";
import type { FileCaptureStore } from "../../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../stores/live-thread-update-store.ts";
import {
  CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID,
} from "./cm01-r2-successor-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../executor-run-helpers.ts";
import {
  type CadR3Materialization,
  materializeCadR3Snapshot,
} from "./coffee-machine-cm01-v3-cad-r3-run-executor.ts";
import {
  HostAssetMaterializationError,
  type HostAssetMaterializer,
} from "../host-asset-materializer.ts";

/**
 * The @4 CAD operation: identical evidence chain to @3 (N+1 build123d calls,
 * same cm01-semantic-cad-capture/3.0 schema) plus host-side materialization
 * of every presentation STL file.
 *
 * Observable difference from @3: new *.stl files appear under
 * `state/local/thread-assets/` on the host filesystem after the run.  That is
 * why this is a separate operation version rather than a patch to @3 — the
 * @3 published snapshots and evidence remain intact.
 */
export const COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30WithMeshStlsAndHostAssets;

export const COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_CAD_R4_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

export interface CoffeeMachineCm01V3CadR4RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3CadR4RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Reviewed R2 recipe; server parses it before constructing this executor. */
  readonly recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly build123d: McpToolClient;
  readonly attempts: FileCm01SemanticCadAttemptStore;
  /** Shares the cm01-semantic-cad-r3 capture store with the @3 executor. */
  readonly captures: FileCaptureStore<"cm01-semantic-cad-r3">;
  readonly lease: EngineeringProjectRunLease;
  /**
   * Host-side materializer for the presentation STL files.
   *
   * The production implementation (DockerVolumeAssetMaterializer) is an
   * explicit CLI boundary: it calls `docker compose cp` and requires the
   * Docker daemon and the compose project to be running.  A failing
   * materializer throws HostAssetMaterializationError which the executor
   * surfaces as stop-for-review — no automatic retry is attempted.
   */
  readonly assets: HostAssetMaterializer;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

/**
 * CM-01 @4 CAD run executor.
 *
 * Same N+1 build123d call sequence as @3.  Adds host-side materialization of
 * every presentation STL file (assembly + per-part) before publishing the
 * ThreadSnapshot.  If any materialization fails the snapshot is NOT published
 * and a stop-for-review error is returned.  The operator can inspect the Docker
 * build123d container state and retry the exact command — providers will not
 * run again because the attempt WAL entry already exists.
 */
export class CoffeeMachineCm01V3CadR4RunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly #build123d: McpToolClient;
  readonly #attempts: FileCm01SemanticCadAttemptStore;
  readonly #captures: FileCaptureStore<"cm01-semantic-cad-r3">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #assets: HostAssetMaterializer;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(deps: CoffeeMachineCm01V3CadR4RunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#recipe = parseCoffeeMachineCm01SemanticRecipeR2(deps.recipe);
    this.#build123d = deps.build123d;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#assets = deps.assets;
    this.#liveUpdates = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadR4RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 @4 CAD export.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireR4CadRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadR4RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let assetsMaterialized = false;
    let snapshotPersisted = false;
    let materialized: CadR3Materialization | undefined;
    try {
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireR4CadRunShape(beforeClaim, beforeClaimRun);
      const basis = await this.requiredCorrectedBasis(beforeClaim, beforeClaimRun);

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary:
          "Started the reviewed CM-01 @4 semantic CAD export with part meshes and host asset materialization.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedR4CadRun(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const startedAt = requiredStart(run);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        basis.revision,
        "running",
        startedAt,
        "CM-01 @4 CAD export running",
        "Compiling the R2 recipe and exporting assembly + per-part presentation STLs.",
      );

      const compiled = await compileCoffeeMachineCm01SemanticCadPlanR2(this.#recipe);
      const capture = await this.captureOnce(project, run, startedAt, compiled);
      capturePersisted = true;

      // Materialize every presentation STL to the host thread-assets directory
      // and verify each file's SHA-256 fail-closed before publishing the snapshot.
      // If any file fails the run stops for operator review; the capture WAL
      // entry already exists so retrying skips providers and re-tries assets only.
      await materializeStlAssets(capture, this.#assets);
      assetsMaterialized = true;

      const captureStorageFingerprint = await sha256Fingerprint(capture);
      materialized = materializeCadR3Snapshot(
        basis,
        run.id,
        capture,
        this.#captures.uriFor(captureStorageFingerprint),
      );
      await this.#snapshots.save(materialized.snapshot);
      snapshotPersisted = true;
      if (
        (await persistedSnapshotPresence(this.#snapshots, materialized.snapshot)) !==
          "exact"
      ) {
        throw new Error(
          "CM-01 @4 CAD snapshot was not durably readable after save.",
        );
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        basis.revision,
        "fresh",
        materialized.snapshot.generatedAt,
        "CM-01 @4 CAD evidence captured",
        "Assembly STEP, glTF, STL and per-part presentation STLs were verified on the host and attached to the project thread.",
      );

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the CM-01 @4 CAD assembly, part-mesh evidence and host-materialized assets.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the reviewed CM-01 @4 CAD plan, script, STEP, presentation mesh evidence and host assets.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      const presence = materialized
        ? await persistedSnapshotPresence(this.#snapshots, materialized.snapshot)
        : "absent";
      snapshotPersisted ||= presence === "exact";
      if (snapshotPersisted) {
        const completed = await this.completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 @4 CAD evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (error instanceof Cm01SemanticCadOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 @4 CAD export outcome is unknown. An operator must inspect build123d before any reviewed recovery path.",
        );
      }
      if (error instanceof HostAssetMaterializationError) {
        // Capture is persisted; materialization was attempted but failed.
        // Retry the exact command after resolving the Docker state — providers
        // will not run again.
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `CM-01 @4 CAD asset materialization stopped for operator review (${error.code}). ` +
            "The capture is durable. Inspect the Docker build123d container state, " +
            "then retry this exact command to re-attempt materialization without re-running providers.",
        );
      }
      if (capturePersisted && !assetsMaterialized) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 @4 CAD capture is durable but host assets were not materialized. " +
            "Inspect the Docker build123d container state, then retry this exact command.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 @4 CAD capture is durable but its snapshot was not published. Retry this exact command to resume without re-running providers.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  /**
   * Require the basis with its fresh correction artifact and architecture
   * model. Neither value reaches build123d; they establish provenance only.
   */
  private async requiredCorrectedBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 @4 CAD run basis belongs to another project subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 @4 CAD run is unavailable.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The exact CM-01 @4 CAD basis is invalid: ${message(error)}`,
      );
    }
    const correction = snapshot.artifacts.find((a) =>
      a.id === CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID &&
      a.freshness.status === "fresh"
    );
    if (!correction) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 @4 CAD run requires the fresh correction artifact in its basis.",
      );
    }
    const architecture = snapshot.artifacts.find((a) =>
      a.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
      a.kind === "sysml-model" && a.freshness.status === "fresh"
    );
    if (!architecture) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 @4 CAD run requires a fresh architecture-model artifact in its basis.",
      );
    }
    return snapshot;
  }

  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    dispatchedAt: string,
    compiled: Awaited<ReturnType<typeof compileCoffeeMachineCm01SemanticCadPlanR2>>,
  ): Promise<Cm01SemanticCadR3Capture> {
    const attempt = await this.#attempts.begin({
      projectId: project.project.id,
      runId: run.id,
      dispatchedAt,
    });
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error(
          "The completed CM-01 @4 CAD attempt has no readable content-addressed capture.",
        );
      }
      const existing = await parseCm01SemanticCadR3Capture(JSON.parse(text));
      if (
        deterministicJson(existing.plan) !== deterministicJson(compiled.plan) ||
        existing.script !== compiled.script
      ) {
        throw new Error(
          "The persisted CM-01 @4 CAD capture does not match the reviewed semantic recipe.",
        );
      }
      return existing;
    }
    const capture = await captureCm01SemanticCadExportR3(
      this.#build123d,
      compiled,
      this.#now,
    );
    const text = deterministicJson(capture);
    const storageFingerprint = await sha256Fingerprint(capture);
    await this.#captures.save(storageFingerprint, text);
    await this.#attempts.complete({
      projectId: project.project.id,
      runId: run.id,
      completedAt: capture.capturedAt,
      captureFingerprint: storageFingerprint,
    });
    return capture;
  }

  private async recordLive(
    subjectId: string,
    runId: string,
    baseRevision: number,
    state: "running" | "fresh" | "failed",
    recordedAt: string,
    label: string,
    summary: string,
  ): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.appendOnce({
        subjectId,
        runId,
        operationId: COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:cm01-cad-r4`,
            ref: { kind: "artifact", id: `${runId}:cm01-cad-r4` },
            entityKind: "artifact",
            artifactKind: "cad-model",
            activityRole: "milestone",
            label,
            system: "build123d",
            freshness: state,
            summary,
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch { /* presentation is not evidence prerequisite */ }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* optional projection */ }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadR4RunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: "CM-01 @4 CAD export stopped before durable evidence was published.",
        code: "cm01-semantic-cad-r4-not-published",
        message:
          "The reviewed CM-01 @4 CAD export did not produce durable project evidence. No automatic retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        run.basis?.kind === "thread-snapshot" ? run.basis.revision : 0,
        "failed",
        safeNow(this.#now),
        "CM-01 @4 CAD export stopped",
        "The export stopped before canonical evidence was published. It was not automatically repeated.",
      );
    } catch { /* preserve original failure */ }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3CadR4RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

// ── Host-side STL materialization ────────────────────────────────────────────

/**
 * Materialize every presentation STL from the capture into the host asset
 * directory via the injected HostAssetMaterializer.
 *
 * Order: assembly STL first, then per-part STLs in component-declaration order.
 * Any HostAssetMaterializationError propagates immediately to the caller, which
 * translates it to stop-for-review; partial state is never silently accepted.
 */
async function materializeStlAssets(
  capture: Cm01SemanticCadR3Capture,
  materializer: HostAssetMaterializer,
): Promise<void> {
  const assemblyStl = capture.files.find((f) => f.format === "stl");
  if (!assemblyStl) {
    throw new Error(
      "CM-01 @4 CAD capture has no assembly STL entry to materialize.",
    );
  }
  await materializer.materialize(assemblyStl.name, assemblyStl.fingerprint.digest);
  for (const part of capture.partMeshes) {
    await materializer.materialize(part.name, part.fingerprint.digest);
  }
}

// ── Shape guards ─────────────────────────────────────────────────────────────

function requireR4CadRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((w) => w.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_CAD_R4_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_CAD_R4_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION.id ||
    workItem.operation.version !== COFFEE_MACHINE_CM01_V3_CAD_R4_OPERATION.version ||
    workItem.operation.bindings.length !== 2 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0].source.kind !== "approved-brief" ||
    workItem.operation.bindings[1]?.name !== "dripTrayHeightCorrection" ||
    workItem.operation.bindings[1].source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 CAD @4 operation.",
    );
  }
  return workItem;
}

function requireClaimedR4CadRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireR4CadRunShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 @4 CAD run it claimed.",
    );
  }
  return workItem;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3CadR4RunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((r) =>
      r.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 @4 CAD run ${run.id} did not complete through this exact execution command.`,
    );
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────

async function persistedSnapshotPresence(
  store: ThreadSnapshotStore,
  expected: ThreadSnapshot,
): Promise<"exact" | "absent" | "unknown"> {
  try {
    const observed = await store.get(expected.id);
    if (!observed) return "absent";
    return deterministicJson(observed) === deterministicJson(expected)
      ? "exact"
      : "unknown";
  } catch {
    return "unknown";
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:cm01-semantic-cad-r4:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
