import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  compileCoffeeMachineCm01SemanticCadPlanR2,
} from "../../domain/cm01/coffee-machine-cm01-semantic-cad-plan.ts";
import {
  type CoffeeMachineCm01SemanticRecipeR2,
  parseCoffeeMachineCm01SemanticRecipeR2,
} from "../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  captureCm01SemanticCadExportR3,
  type Cm01SemanticCadR3Capture,
  parseCm01SemanticCadR3Capture,
} from "../captures/cm01-semantic-cad-capture-r3.ts";
import {
  Cm01SemanticCadOutcomeUnknownError,
  FileCm01SemanticCadAttemptStore,
} from "../wal/file-cm01-semantic-cad-attempt-store.ts";
import type { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID,
  cm01R2CadSupersedesLinks,
  requireCm01R2CadPredecessors,
} from "./cm01-r2-successor-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

/**
 * The @3 CAD operation: same path as @2 with additional per-part presentation
 * STLs.  The agent supplies only the queued run identity; the server owns the
 * recipe, tool sequence, and naming contract.
 */
export const COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30WithMeshStls;

export const COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_CAD_R3_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

export interface CoffeeMachineCm01V3CadR3RunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3CadR3RunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Reviewed R2 recipe; server parses it before constructing this executor. */
  readonly recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly build123d: McpToolClient;
  readonly attempts: FileCm01SemanticCadAttemptStore;
  readonly captures: FileCaptureStore<"cm01-semantic-cad-r3">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

export interface CadR3Materialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/**
 * Executes the reviewed CM-01 @3 CAD export: N+1 build123d calls that produce
 * the assembly STEP/glTF/STL and one presentation STL per recipe component.
 *
 * The WAL entry covers the entire N+1 sequence atomically: if any call fails
 * the "dispatched" marker prevents blind replay.
 */
export class CoffeeMachineCm01V3CadR3RunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #recipe: CoffeeMachineCm01SemanticRecipeR2;
  readonly #build123d: McpToolClient;
  readonly #attempts: FileCm01SemanticCadAttemptStore;
  readonly #captures: FileCaptureStore<"cm01-semantic-cad-r3">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(deps: CoffeeMachineCm01V3CadR3RunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#recipe = parseCoffeeMachineCm01SemanticRecipeR2(deps.recipe);
    this.#build123d = deps.build123d;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#liveUpdates = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadR3RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 @3 CAD export.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireR3CadRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadR3RunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let snapshotPersisted = false;
    let materialized: CadR3Materialization | undefined;
    try {
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireR3CadRunShape(beforeClaim, beforeClaimRun);
      const basis = await this.requiredCorrectedBasis(beforeClaim, beforeClaimRun);

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 @3 semantic CAD export with part meshes.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedR3CadRun(project, run, origin);
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
        "CM-01 @3 CAD export running",
        "Compiling the R2 recipe and exporting assembly + per-part presentation STLs.",
      );

      const compiled = await compileCoffeeMachineCm01SemanticCadPlanR2(this.#recipe);
      const capture = await this.captureOnce(project, run, startedAt, compiled);
      capturePersisted = true;
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
          "CM-01 @3 CAD snapshot was not durably readable after save.",
        );
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        basis.revision,
        "fresh",
        materialized.snapshot.generatedAt,
        "CM-01 @3 CAD evidence captured",
        "Assembly STEP, glTF, STL and per-part presentation STLs were attached to the project thread.",
      );

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the CM-01 @3 CAD assembly and part-mesh evidence.",
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
            "Recorded the reviewed CM-01 @3 CAD plan, script, STEP and presentation mesh evidence.",
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
          "CM-01 @3 CAD evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (error instanceof Cm01SemanticCadOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 @3 CAD export outcome is unknown. An operator must inspect build123d before any reviewed recovery path.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 @3 CAD capture is durable but its snapshot was not published. Retry this exact command to resume without re-running providers.",
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
        "The CM-01 @3 CAD run basis belongs to another project subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 @3 CAD run is unavailable.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The exact CM-01 @3 CAD basis is invalid: ${message(error)}`,
      );
    }
    const correction = snapshot.artifacts.find((a) =>
      a.id === CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID &&
      a.freshness.status === "fresh"
    );
    if (!correction) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 @3 CAD run requires the fresh correction artifact in its basis.",
      );
    }
    const architecture = snapshot.artifacts.find((a) =>
      a.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
      a.kind === "sysml-model" && a.freshness.status === "fresh"
    );
    if (!architecture) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 @3 CAD run requires a fresh architecture-model artifact in its basis.",
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
          "The completed CM-01 @3 CAD attempt has no readable content-addressed capture.",
        );
      }
      const existing = await parseCm01SemanticCadR3Capture(JSON.parse(text));
      if (
        deterministicJson(existing.plan) !== deterministicJson(compiled.plan) ||
        existing.script !== compiled.script
      ) {
        throw new Error(
          "The persisted CM-01 @3 CAD capture does not match the reviewed semantic recipe.",
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
        operationId: COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:cm01-cad-r3`,
            ref: { kind: "artifact", id: `${runId}:cm01-cad-r3` },
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
    command: CoffeeMachineCm01V3CadR3RunExecutorCommand,
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
        summary: "CM-01 @3 CAD export stopped before durable evidence was published.",
        code: "cm01-semantic-cad-r3-not-published",
        message:
          "The reviewed CM-01 @3 CAD export did not produce durable project evidence. No automatic retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        run.basis?.kind === "thread-snapshot" ? run.basis.revision : 0,
        "failed",
        safeNow(this.#now),
        "CM-01 @3 CAD export stopped",
        "The export stopped before canonical evidence was published. It was not automatically repeated.",
      );
    } catch { /* preserve original failure */ }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3CadR3RunExecutorCommand,
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

/**
 * Pure, no-I/O materializer for the CM-01 @3 successor: plan + script + STEP
 * (same as @2) plus assembly STL mesh and one mesh per recipe component.
 *
 * Exported so the @4 executor can reuse the same snapshot extension without
 * duplicating the pure computation. The @3 runtime behaviour is unchanged.
 */
export function materializeCadR3Snapshot(
  base: ThreadSnapshot,
  runId: string,
  capture: Cm01SemanticCadR3Capture,
  captureUri: string,
): CadR3Materialization {
  const correction = requireFreshCorrection(base.artifacts);
  const architecture = requireFreshArchitecture(base.artifacts);
  const old = requireCm01R2CadPredecessors(base.artifacts);

  const step = capture.files.find((f) => f.format === "step");
  if (!step) throw new Error("CM-01 @3 CAD capture has no assembly STEP evidence.");
  const assemblyStl = capture.files.find((f) => f.format === "stl");
  if (!assemblyStl) {
    throw new Error("CM-01 @3 CAD capture has no assembly STL evidence.");
  }

  const prefix = `coffee-machine-cm01-v3-cad-r3-${capture.fingerprint.digest}`;
  const planId = `${prefix}-plan`;
  const scriptId = `${prefix}-script`;
  const stepId = `${prefix}-step`;
  const meshAssemblyId = `${prefix}-mesh-assembly`;

  const compiler: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "compile_coffee_machine_cm01_semantic_cad_plan_r2",
    runId,
  };
  const exporter: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };
  const freshness = fresh(capture.capturedAt);
  const planFingerprint = r2ArtifactFingerprint(capture.plan, "cad-plan");
  const scriptFingerprint = r2ArtifactFingerprint(capture.plan, "cad-script");

  // Assembly artifacts (same as @2) plus the assembly STL mesh.
  const artifacts: ThreadArtifact[] = [
    artifact(
      planId,
      "CM-01 30 mm DripTray semantic CAD plan",
      "document",
      planFingerprint,
      captureUri,
      "application/json",
      compiler,
      [architecture.id, correction.id],
      freshness,
    ),
    artifact(
      scriptId,
      "CM-01 30 mm DripTray deterministic build123d script",
      "script",
      scriptFingerprint,
      `${captureUri}#script`,
      "text/x-python",
      compiler,
      [planId],
      freshness,
    ),
    artifact(
      stepId,
      "CM-01 30 mm DripTray assembly STEP export",
      "step",
      step.fingerprint,
      `${captureUri}#${step.name}`,
      "model/step",
      exporter,
      [scriptId],
      freshness,
    ),
    artifact(
      meshAssemblyId,
      "CM-01 30 mm DripTray assembly presentation STL",
      "mesh",
      assemblyStl.fingerprint,
      `${captureUri}#${assemblyStl.name}`,
      "model/stl",
      exporter,
      [scriptId],
      freshness,
    ),
    // Per-component presentation STLs — one per recipe component, in order.
    ...capture.partMeshes.map((part) =>
      artifact(
        `${prefix}-mesh-${part.semanticKey}`,
        `CM-01 30 mm ${part.semanticKey} presentation STL`,
        "mesh",
        part.fingerprint,
        `${captureUri}#${part.name}`,
        "model/stl",
        exporter,
        [scriptId],
        freshness,
      )
    ),
  ];

  const consumptions: ThreadArtifactConsumption[] = [
    consumption(
      `${prefix}-consumes-architecture`,
      architecture.id,
      compiler,
      architecture.fingerprint,
      capture.capturedAt,
    ),
    consumption(
      `${prefix}-consumes-correction`,
      correction.id,
      compiler,
      correction.fingerprint,
      capture.capturedAt,
    ),
    consumption(
      `${prefix}-consumes-plan`,
      planId,
      compiler,
      planFingerprint,
      capture.capturedAt,
    ),
    consumption(
      `${prefix}-consumes-script`,
      scriptId,
      exporter,
      scriptFingerprint,
      capture.capturedAt,
    ),
  ];

  const applied = applyThreadSnapshotExtensionIfNew(base, {
    id: `${prefix}-extension`,
    name: "Capture the reviewed CM-01 @3 CAD successor with presentation meshes",
    subjectId: base.subject.id,
    capturedAt: capture.capturedAt,
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [
      link(
        `${prefix}-plan-from-architecture`,
        planId,
        architecture.id,
        "derived_from",
        "The R3 plan is compiled from the retained architecture basis.",
      ),
      link(
        `${prefix}-plan-from-correction`,
        planId,
        correction.id,
        "derived_from",
        "The plan is derived from the explicit 28 mm to 30 mm correction record.",
      ),
      link(
        `${prefix}-script-from-plan`,
        scriptId,
        planId,
        "derived_from",
        "The deterministic R3 script is rendered from the captured R3 plan.",
      ),
      link(
        `${prefix}-step-from-script`,
        stepId,
        scriptId,
        "derived_from",
        "build123d_export produced the assembly STEP from the deterministic R3 script.",
      ),
      link(
        `${prefix}-mesh-assembly-from-script`,
        meshAssemblyId,
        scriptId,
        "derived_from",
        "build123d_export produced the assembly presentation STL from the same deterministic R3 script.",
      ),
      ...capture.partMeshes.map((part) =>
        link(
          `${prefix}-mesh-${part.semanticKey}-from-script`,
          `${prefix}-mesh-${part.semanticKey}`,
          scriptId,
          "derived_from",
          `build123d_export produced the ${part.semanticKey} presentation STL from the server-rendered single-component script.`,
        )
      ),
      ...cm01R2CadSupersedesLinks({ planId, scriptId, stepId }, old),
      ...consumptions.map((item) =>
        link(
          `${item.id}-uses`,
          item.id,
          item.artifactId,
          "uses",
          "The operation attested the exact fingerprint it consumed.",
          "consumption",
        )
      ),
    ],
  }, { appliedAt: capture.capturedAt });

  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error(
      "CM-01 @3 CAD evidence did not produce exactly one successor snapshot.",
    );
  }
  return {
    snapshot: applied.snapshot,
    evidence: {
      snapshotId: applied.snapshot.id,
      snapshotRevision: applied.snapshot.revision,
      kind: "artifact",
      id: stepId,
    },
  };
}

function requireFreshCorrection(artifacts: readonly ThreadArtifact[]): ThreadArtifact {
  const found = artifacts.filter((a) =>
    a.id === CM01_DRIP_TRAY_HEIGHT_CORRECTION_ARTIFACT_ID &&
    a.freshness.status === "fresh"
  );
  if (found.length !== 1) {
    throw new Error(
      "CM-01 @3 CAD successor materialization requires the fresh correction record.",
    );
  }
  return found[0]!;
}

function requireFreshArchitecture(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifact {
  const found = artifacts.filter((a) =>
    a.kind === "sysml-model" &&
    a.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
    a.freshness.status === "fresh"
  );
  if (found.length !== 1) {
    throw new Error(
      "CM-01 @3 CAD materialization requires exactly one fresh V3 architecture artifact.",
    );
  }
  return found[0]!;
}

function artifact(
  id: string,
  name: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  producer: ThreadOperationRef,
  inputArtifactIds: string[],
  freshness: ThreadFreshness,
): ThreadArtifact {
  return {
    id,
    name,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness,
  };
}

function consumption(
  id: string,
  artifactId: string,
  consumer: ThreadOperationRef,
  observedFingerprint: ContentFingerprint,
  verifiedAt: string,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId,
    consumer,
    observedFingerprint,
    verifiedAt,
    status: "verified",
  };
}

function fresh(at: string): ThreadFreshness {
  return { status: "fresh", changedAt: at, invalidatedByChangeIds: [] };
}

function r2ArtifactFingerprint(
  plan: Cm01SemanticCadR3Capture["plan"],
  role: "cad-plan" | "cad-script",
): ContentFingerprint {
  const item = plan.artifacts.find((a) => a.role === role);
  if (!item) throw new Error(`CM-01 @3 CAD plan is missing ${role}.`);
  return structuredClone(item.fingerprint);
}

function link(
  id: string,
  fromId: string,
  toId: string,
  relation: "derived_from" | "uses",
  rationale: string,
  fromKind: "artifact" | "consumption" = "artifact",
) {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: "artifact" as const, id: toId },
    rationale,
  };
}

function requireR3CadRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((w) => w.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_CAD_R3_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_CAD_R3_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION.id ||
    workItem.operation.version !== COFFEE_MACHINE_CM01_V3_CAD_R3_OPERATION.version ||
    workItem.operation.bindings.length !== 2 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0].source.kind !== "approved-brief" ||
    workItem.operation.bindings[1]?.name !== "dripTrayHeightCorrection" ||
    workItem.operation.bindings[1].source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 CAD @3 operation.",
    );
  }
  return workItem;
}

function requireClaimedR3CadRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireR3CadRunShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 @3 CAD run it claimed.",
    );
  }
  return workItem;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3CadR3RunExecutorCommand,
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
      `CM-01 @3 CAD run ${run.id} did not complete through this exact execution command.`,
    );
  }
}

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
  return `${commandId}:cm01-semantic-cad-r3:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
