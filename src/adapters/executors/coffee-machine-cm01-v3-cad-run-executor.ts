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
  compileCoffeeMachineCm01SemanticCadPlan,
  type CompiledCoffeeMachineCm01SemanticCadPlan,
} from "../../domain/cm01/coffee-machine-cm01-semantic-cad-plan.ts";
import {
  type CoffeeMachineCm01SemanticRecipe,
  parseCoffeeMachineCm01SemanticRecipe,
} from "../../domain/cm01/coffee-machine-cm01-semantic-recipe.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  captureCm01SemanticCadExport,
  type Cm01SemanticCadCapture,
  parseCm01SemanticCadCapture,
} from "../captures/cm01-semantic-cad-capture.ts";
import {
  Cm01SemanticCadOutcomeUnknownError,
  FileCm01SemanticCadAttemptStore,
} from "../wal/file-cm01-semantic-cad-attempt-store.ts";
import { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_CAD_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad;
export const COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_CAD_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;

export interface CoffeeMachineCm01V3CadRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3CadRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** The server parses the reviewed recipe before constructing this executor. */
  readonly recipe: CoffeeMachineCm01SemanticRecipe;
  /** Fixed server-owned client; no tool name or argument reaches it from an agent. */
  readonly build123d: McpToolClient;
  readonly attempts: FileCm01SemanticCadAttemptStore;
  readonly captures: FileCaptureStore<"cm01-semantic-cad">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface CadMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/**
 * Executes exactly one reviewed CM-01 V3 CAD export.
 *
 * The agent supplies only the already-queued run identity.  This executor
 * reparses the semantic recipe, deterministically compiles it, captures one
 * fixed build123d export, and persists normalized, content-addressed evidence.
 */
export class CoffeeMachineCm01V3CadRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #recipe: CoffeeMachineCm01SemanticRecipe;
  readonly #build123d: McpToolClient;
  readonly #attempts: FileCm01SemanticCadAttemptStore;
  readonly #captures: FileCaptureStore<"cm01-semantic-cad">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: CoffeeMachineCm01V3CadRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#recipe = parseCoffeeMachineCm01SemanticRecipe(dependencies.recipe);
    this.#build123d = dependencies.build123d;
    this.#attempts = dependencies.attempts;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 CAD export.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireCadRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let snapshotPersisted = false;
    let materialized: CadMaterialization | undefined;
    try {
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireCadRunShape(beforeClaim, beforeClaimRun);
      await this.requiredArchitectureBasis(beforeClaim, beforeClaimRun);

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 semantic CAD export.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedCadRun(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const base = await this.requiredArchitectureBasis(project, run);
      const startedAt = requiredStart(run);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "running",
        startedAt,
        "CM-01 CAD export running",
        "Compiling the reviewed semantic recipe and exporting its fixed CAD evidence.",
      );

      const compiled = await compileCoffeeMachineCm01SemanticCadPlan(this.#recipe);
      const capture = await this.captureOnce(project, run, startedAt, compiled);
      capturePersisted = true;
      const captureStorageFingerprint = await sha256Fingerprint(capture);
      materialized = await materializeCadSnapshot(
        base,
        run.id,
        capture,
        this.#captures.uriFor(captureStorageFingerprint),
      );
      await this.#snapshots.save(materialized.snapshot);
      snapshotPersisted = true;
      await assertExactSnapshot(this.#snapshots, materialized.snapshot);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        materialized.snapshot.generatedAt,
        "CM-01 CAD evidence captured",
        "The normalized build123d export and exact content hashes were attached to the project thread.",
      );

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the normalized CM-01 CAD export evidence.",
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
          summary: "Recorded the reviewed CM-01 CAD plan, script and STEP evidence.",
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
          "CM-01 CAD evidence is durable but project attachment did not finish. Retry this exact command; build123d will not run again.",
        );
      }
      if (error instanceof Cm01SemanticCadOutcomeUnknownError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 CAD export outcome is unknown. An operator must inspect build123d before any reviewed recovery path.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 CAD capture is durable but its snapshot was not published. Retry this exact command to resume without a second export.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async requiredArchitectureBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 CAD run basis belongs to another project subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 CAD run is unavailable.",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The exact CM-01 CAD basis is invalid: ${message(error)}`,
      );
    }
    const architecture = snapshot.artifacts.find((artifact) =>
      artifact.id.startsWith("coffee-machine-cm01-v3-architecture-") &&
      artifact.kind === "sysml-model" && artifact.producer.serverId === "syson" &&
      artifact.producer.tool === "syson_element_insert_sysml"
    );
    if (!architecture) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 CAD run requires the exact V3 architecture-model artifact in its basis.",
      );
    }
    return snapshot;
  }

  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    dispatchedAt: string,
    compiled: CompiledCoffeeMachineCm01SemanticCadPlan,
  ): Promise<Cm01SemanticCadCapture> {
    const attempt = await this.#attempts.begin({
      projectId: project.project.id,
      runId: run.id,
      dispatchedAt,
    });
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error(
          "The completed CM-01 CAD attempt has no readable content-addressed capture.",
        );
      }
      const capture = await parseCm01SemanticCadCapture(JSON.parse(text));
      if (
        deterministicJson(capture.plan) !== deterministicJson(compiled.plan) ||
        capture.script !== compiled.script
      ) {
        throw new Error(
          "The persisted CM-01 CAD capture does not match the reviewed semantic recipe.",
        );
      }
      return capture;
    }
    const capture = await captureCm01SemanticCadExport(
      this.#build123d,
      compiled,
      () => this.#now(),
    );
    const text = deterministicJson(capture);
    /** Storage addresses the complete capture; capture.fingerprint addresses its unsigned evidence body. */
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
        operationId: COFFEE_MACHINE_CM01_V3_CAD_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:cm01-cad`,
            ref: { kind: "artifact", id: `${runId}:cm01-cad` },
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
    } catch { /* Presentation must never repeat or invalidate evidence. */ }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* optional projection */ }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3CadRunExecutorCommand,
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
        summary: "CM-01 CAD export stopped before durable evidence was published.",
        code: "cm01-semantic-cad-not-published",
        message:
          "The reviewed CM-01 CAD export did not produce durable project evidence. No automatic retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        run.basis?.kind === "thread-snapshot" ? run.basis.revision : 0,
        "failed",
        safeNow(this.#now),
        "CM-01 CAD export stopped",
        "The export stopped before canonical evidence was published. It was not automatically repeated.",
      );
    } catch { /* preserve original failure */ }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3CadRunExecutorCommand,
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

function materializeCadSnapshot(
  base: ThreadSnapshot,
  runId: string,
  capture: Cm01SemanticCadCapture,
  captureUri: string,
): CadMaterialization {
  const architecture = base.artifacts.find((artifact) =>
    artifact.id.startsWith("coffee-machine-cm01-v3-architecture-")
  );
  if (!architecture) {
    throw new Error("CM-01 CAD basis lost its required architecture-model artifact.");
  }
  const planFingerprint = artifactFingerprint(capture.plan, "cad-plan");
  const scriptFingerprint = artifactFingerprint(capture.plan, "cad-script");
  const step = capture.files.find((file) => file.format === "step");
  if (!step) throw new Error("CM-01 CAD capture has no STEP evidence.");
  const prefix = `coffee-machine-cm01-v3-cad-${capture.fingerprint.digest}`;
  const operation: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };
  const compiler: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "compile_coffee_machine_cm01_semantic_cad_plan",
    runId,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capture.capturedAt,
    invalidatedByChangeIds: [],
  };
  const planId = `${prefix}-plan`;
  const scriptId = `${prefix}-script`;
  const stepId = `${prefix}-step`;
  const artifacts: ThreadArtifact[] = [
    artifact(
      planId,
      "CM-01 semantic CAD plan",
      "document",
      planFingerprint,
      captureUri,
      "application/json",
      compiler,
      [architecture.id],
      freshness,
    ),
    artifact(
      scriptId,
      "CM-01 deterministic build123d script",
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
      "CM-01 STEP export",
      "step",
      step.fingerprint,
      `${captureUri}#${step.name}`,
      "model/step",
      operation,
      [scriptId],
      freshness,
    ),
  ];
  const consumption: ThreadArtifactConsumption[] = [
    {
      id: `${prefix}-consume-architecture`,
      artifactId: architecture.id,
      consumer: compiler,
      observedFingerprint: architecture.fingerprint,
      verifiedAt: capture.capturedAt,
      status: "verified",
    },
    {
      id: `${prefix}-consume-plan`,
      artifactId: planId,
      consumer: compiler,
      observedFingerprint: planFingerprint,
      verifiedAt: capture.capturedAt,
      status: "verified",
    },
    {
      id: `${prefix}-consume-script`,
      artifactId: scriptId,
      consumer: operation,
      observedFingerprint: scriptFingerprint,
      verifiedAt: capture.capturedAt,
      status: "verified",
    },
  ];
  const extension = {
    id: `${prefix}-extension`,
    name: "Capture the reviewed CM-01 semantic CAD export",
    subjectId: base.subject.id,
    capturedAt: capture.capturedAt,
    artifacts,
    consumptions: consumption,
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
        "The reviewed semantic CAD recipe was compiled only after the exact V3 architecture basis was read.",
      ),
      link(
        `${prefix}-script-from-plan`,
        scriptId,
        planId,
        "derived_from",
        "The deterministic build123d program was rendered from the captured semantic plan.",
      ),
      link(
        `${prefix}-step-from-script`,
        stepId,
        scriptId,
        "derived_from",
        "build123d_export produced the STEP file from the captured deterministic script.",
      ),
      ...consumption.map((item) =>
        link(
          `${item.id}-uses-${item.artifactId}`,
          item.id,
          item.artifactId,
          "uses",
          "The operation attested the exact fingerprint it consumed.",
          "consumption",
        )
      ),
    ],
  };
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capture.capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error(
      "CM-01 CAD evidence did not produce exactly one descendant snapshot.",
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

function artifactFingerprint(
  plan: Cm01SemanticCadCapture["plan"],
  role: "cad-plan" | "cad-script",
): ContentFingerprint {
  const artifact = plan.artifacts.find((candidate) => candidate.role === role);
  if (!artifact) throw new Error(`CM-01 semantic CAD plan is missing ${role}.`);
  return structuredClone(artifact.fingerprint);
}

function requireCadRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((candidate) =>
    candidate.id === run.workItemId
  );
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_CAD_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_CAD_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_CAD_OPERATION.id ||
    workItem.operation.version !== COFFEE_MACHINE_CM01_V3_CAD_OPERATION.version ||
    workItem.operation.bindings.length !== 1 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical CM-01 V3 CAD @1 operation.",
    );
  }
  return workItem;
}

function requireClaimedCadRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireCadRunShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 CAD run it claimed.",
    );
  }
  return workItem;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3CadRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 CAD run ${run.id} did not complete through this exact execution command.`,
    );
  }
}

async function assertExactSnapshot(
  store: ThreadSnapshotStore,
  expected: ThreadSnapshot,
): Promise<void> {
  if ((await persistedSnapshotPresence(store, expected)) !== "exact") {
    throw new Error(
      `CM-01 CAD ThreadSnapshot ${expected.id} was not durably readable after save.`,
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
  return `${commandId}:cm01-semantic-cad:${step}`;
}
function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
