import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import type { RunDetail } from "../../domain/types.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  CM01_NOMINAL_MODELICA_MODEL,
  CM01_NOMINAL_MODELICA_SCENARIO,
  type Cm01NominalModelicaCapture,
  type Cm01NominalModelicaCaptureAdapter,
} from "../captures/cm01-nominal-modelica-capture.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import { FileCm01NominalModelicaAttemptStore } from "../wal/file-cm01-nominal-modelica-attempt-store.ts";
import { FileCaptureStore } from "../captures/file-capture-store.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import { createObservedModelicaRunExtension } from "../observed-modelica-thread-branch.ts";

/** This closed operation must never be rebound to a historical CM-01 subject. */
export const COFFEE_MACHINE_CM01_V3_PROJECT_ID = "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal;

export interface CoffeeMachineCm01V3ThermalRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3ThermalRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Closed server-owned capture; callers cannot select a tool or arguments. */
  readonly capture: Pick<Cm01NominalModelicaCaptureAdapter, "capture">;
  /** Durable intent/capture boundary around the non-idempotent provider run. */
  readonly attempts: FileCm01NominalModelicaAttemptStore;
  readonly captures: FileCaptureStore<"cm01-nominal-modelica">;
  readonly lease: EngineeringProjectRunLease;
  /** Presentation only; no live-journal failure can repeat the simulation. */
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface ThermalMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/**
 * Trusted executor for the reviewed, fixed CM-01 nominal thermal simulation.
 *
 * It accepts only one queued V3 operation over an exact thread snapshot and
 * owns all Modelica interaction through a closed capture adapter.  The agent
 * can neither inject provider payloads nor alter model/scenario parameters.
 */
/**
 * WHY THIS EXECUTOR DOES NOT USE executor-run-helpers.ts
 *
 * Three local helpers diverge structurally from the shared module:
 *
 * - `requireThreadBasis` — same logic as the shared `requireBasis` but carries
 *   the "CM-01 thermal run" prefix in its error message, which is part of this
 *   operation's public error contract as written in committed commandReceipts.
 *   Swapping to the generic message would silently change observable error text.
 *
 * - `requiredRunStart` — same divergence: the prefix "CM-01 thermal run" in the
 *   error message is intentional and contractual.
 *
 * - `stepCommandId` — returns `<commandId>:cm01-nominal-thermal:<step>`. These
 *   step IDs are embedded in immutable commandReceipts on disk; replacing this
 *   function with a shared one would break the assertCompleted check for any
 *   run whose receipts were already written.
 *
 * Do not refactor these helpers toward the shared module without a deliberate
 * migration plan that accounts for every persisted commandReceipt.
 */
export class CoffeeMachineCm01V3ThermalRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #capture: Pick<Cm01NominalModelicaCaptureAdapter, "capture">;
  readonly #attempts: FileCm01NominalModelicaAttemptStore;
  readonly #captures: FileCaptureStore<"cm01-nominal-modelica">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: CoffeeMachineCm01V3ThermalRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#capture = dependencies.capture;
    this.#attempts = dependencies.attempts;
    this.#captures = dependencies.captures;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ThermalRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 nominal thermal simulation.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireThermalRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ThermalRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let snapshotPersisted = false;
    let materialized: ThermalMaterialization | undefined;
    try {
      // Refuse any foreign operation before changing its lifecycle.
      const beforeClaim = await this.requiredProject(command.projectId);
      const beforeClaimRun = requireRun(beforeClaim, command.runId);
      requireThermalRunShape(beforeClaim, beforeClaimRun);
      await this.requiredExactBasis(beforeClaim, beforeClaimRun);

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 nominal thermal simulation.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireOwnedThermalRun(project, run, origin);
      if (run.status === "completed") {
        assertCompletedByThisExecution(project, command.commandId, command.runId);
        await this.reconcileLive(project.project.subjectId, command.runId);
        return project;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `CM-01 thermal run ${run.id} is ${run.status}; a human must review before a new run is queued.`,
        );
      }

      const base = await this.requiredExactBasis(project, run);
      const startedAt = requiredRunStart(run);
      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: run.id,
        baseRevision: base.revision,
        state: "running",
        recordedAt: startedAt,
        label: "Nominal thermal simulation running",
        summary:
          "Running the reviewed CM-01 heat-up scenario. Results remain simulation evidence, not a requirement verdict.",
      });

      const capture = await this.captureOnce(project, run, startedAt);
      capturePersisted = true;
      materialized = materializeThermalSnapshot(base, capture);
      await this.#snapshots.save(materialized.snapshot);
      snapshotPersisted = true;
      await this.assertExactPersistedSnapshot(materialized.snapshot);
      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: run.id,
        baseRevision: base.revision,
        state: "fresh",
        recordedAt: materialized.snapshot.generatedAt,
        label: "Nominal thermal evidence captured",
        summary:
          "OpenModelica evidence was read back and attached to the project thread. It has not been evaluated against a requirement.",
      });

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the read-back CM-01 nominal thermal evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedRunStatus(run, "publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: stepCommandId(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the read-back CM-01 nominal thermal evidence.",
          resultSnapshot: snapshotReference(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") {
        throw unexpectedRunStatus(run, "completed");
      }

      const completed = await this.requiredProject(command.projectId);
      assertCompletedByThisExecution(completed, command.commandId, command.runId);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      const presence = materialized
        ? await this.exactPersistedSnapshotPresence(materialized.snapshot)
        : "absent";
      snapshotPersisted ||= presence === "exact";
      if (!snapshotPersisted && !capturePersisted && claimed && presence === "absent") {
        await this.recordFailureIfOwned(origin, command);
      }
      if (snapshotPersisted) {
        const completed = await this.completedProjectForThisExecution(command);
        if (completed) {
          await this.reconcileLive(completed.project.subjectId, command.runId);
          return completed;
        }
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 thermal evidence is durable, but its project attachment did not finish. Retry this same command to resume without rerunning Modelica.",
        );
      }
      throw error;
    }
  }

  private async requiredExactBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireThreadBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The queued CM-01 thermal run basis does not belong to this project subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 thermal run is unavailable.",
      );
    }
    return snapshot;
  }

  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    dispatchedAt: string,
  ): Promise<Cm01NominalModelicaCapture> {
    const attempt = await this.#attempts.begin({
      projectId: project.project.id,
      runId: run.id,
      dispatchedAt,
    });
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error(
          "The completed CM-01 Modelica attempt has no readable content-addressed capture.",
        );
      }
      return parsePersistedCapture(text, attempt.captureFingerprint);
    }
    const capture = await this.#capture.capture();
    const text = deterministicJson(capture);
    const fingerprint = await sha256Fingerprint(capture);
    await this.#captures.save(fingerprint, text);
    await this.#attempts.complete({
      projectId: project.project.id,
      runId: run.id,
      completedAt: capture.evidence.completedAt,
      captureFingerprint: fingerprint,
    });
    return capture;
  }

  private async assertExactPersistedSnapshot(snapshot: ThreadSnapshot): Promise<void> {
    if ((await this.exactPersistedSnapshotPresence(snapshot)) !== "exact") {
      throw new Error(
        `Thermal ThreadSnapshot ${snapshot.id} was not durably readable after save.`,
      );
    }
  }

  private async exactPersistedSnapshotPresence(
    snapshot: ThreadSnapshot,
  ): Promise<"exact" | "absent" | "unknown"> {
    try {
      const persisted = await this.#snapshots.get(snapshot.id);
      if (!persisted) return "absent";
      return deterministicJson(persisted) === deterministicJson(snapshot)
        ? "exact"
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  private async recordFailureIfOwned(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ThermalRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || !project.commandReceipts?.some((receipt) =>
          receipt.commandId === stepCommandId(command.commandId, "claim")
        ) || !["running", "waiting-for-decision", "publishing"].includes(run.status) ||
        run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
      ) {
        return;
      }
      await this.#commands.failRun(origin, {
        ...command,
        commandId: stepCommandId(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 nominal thermal simulation stopped before durable evidence was published.",
        code: "cm01-thermal-not-published",
        message:
          "The reviewed nominal thermal simulation did not produce durable project evidence. No automatic retry was attempted.",
      });
      await this.recordLiveOnce({
        subjectId: project.project.subjectId,
        runId: command.runId,
        baseRevision: run.basis?.kind === "thread-snapshot" ? run.basis.revision : 0,
        state: "failed",
        recordedAt: safeNow(this.#now),
        label: "Nominal thermal simulation stopped",
        summary:
          "The simulation stopped before durable evidence was published. It was not automatically repeated.",
      });
    } catch {
      // Preserve the original execution error; this is only an audit attempt.
    }
  }

  private async recordLiveOnce(input: {
    subjectId: string;
    runId: string;
    baseRevision: number;
    state: "running" | "fresh" | "failed";
    recordedAt: string;
    label: string;
    summary: string;
  }): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.appendOnce({
        subjectId: input.subjectId,
        runId: input.runId,
        operationId: COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION.id,
        baseRevision: input.baseRevision,
        state: input.state,
        recordedAt: input.recordedAt,
        graph: {
          nodes: [{
            id: `${input.runId}:modelica-nominal-thermal`,
            ref: { kind: "artifact", id: `${input.runId}:modelica-nominal-thermal` },
            entityKind: "artifact",
            artifactKind: "simulation-model",
            activityRole: "milestone",
            label: input.label,
            system: "OpenModelica",
            freshness: input.state,
            summary: input.summary,
            recordedAt: input.recordedAt,
          }],
          edges: [],
        },
      });
    } catch {
      // The live feed is not evidence and cannot alter canonical execution.
    }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch {
      // The canonical result is already durable.
    }
  }

  private async completedProjectForThisExecution(
    command: CoffeeMachineCm01V3ThermalRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompletedByThisExecution(project, command.commandId, command.runId);
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

function materializeThermalSnapshot(
  base: ThreadSnapshot,
  capture: Cm01NominalModelicaCapture,
): ThermalMaterialization {
  const extension = createObservedModelicaRunExtension(
    base.subject.id,
    captureAsRunDetail(capture),
    { sourceLabel: "reviewed CM-01 nominal Modelica run" },
  );
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capture.evidence.completedAt,
  });
  // Thread artifact ids intentionally slug provider run ids; use the attested
  // producer identity rather than trying to rebuild that internal slug. Real
  // mcp-modelica run ids contain underscores, so matching a raw run id prefix
  // would turn an already durable capture into an unmaterializable state.
  const evidence = applied.snapshot.artifacts.filter((artifact) =>
    artifact.kind === "evidence" &&
    artifact.name === "Computed evidence" &&
    artifact.producer.serverId === "modelica" &&
    artifact.producer.tool === "modelica_simulate" &&
    artifact.producer.runId === capture.evidence.runId
  );
  if (evidence.length !== 1) {
    throw new Error("CM-01 thermal extension has no unique evidence artifact.");
  }
  return {
    snapshot: applied.snapshot,
    evidence: {
      snapshotId: applied.snapshot.id,
      snapshotRevision: applied.snapshot.revision,
      kind: "artifact",
      id: evidence[0]!.id,
    },
  };
}

function captureAsRunDetail(capture: Cm01NominalModelicaCapture): RunDetail {
  const evidence = capture.evidence;
  return {
    id: `modelica:${evidence.runId}`,
    name: `${evidence.model.id} / ${evidence.scenario.id}`,
    subject: `Modelica ${evidence.model.version}`,
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    completedAt: evidence.completedAt,
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Read-back CM-01 nominal Modelica evidence.",
    stages: [],
    measurements: evidence.measurements.map((metric) => ({
      id: metric.id,
      label: metric.name,
      value: {
        value: metric.value,
        unit: metric.unit,
        display: `${metric.value} ${metric.unit}`,
      },
    })),
    provenance: [],
    warnings: [...capture.warnings],
    requirements: [],
    evidence: evidence.artifacts.map((artifact, index) => ({
      id: `modelica:${evidence.runId}:${artifact.kind}:${index}`,
      kind: artifact.kind,
      label: artifact.name,
      path: artifact.uri,
      sha256: artifact.fingerprint.digest,
      bytes: artifact.bytes,
    })),
    modelicaEvidence: {
      runId: evidence.runId,
      fingerprint: evidence.fingerprint.digest,
      model: {
        id: evidence.model.id,
        version: evidence.model.version,
        sha256: evidence.model.fingerprint.digest,
      },
      scenario: {
        id: evidence.scenario.id,
        sha256: evidence.scenario.fingerprint.digest,
      },
    },
  };
}

async function parsePersistedCapture(
  text: string,
  expectedFingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): Promise<Cm01NominalModelicaCapture> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The persisted CM-01 Modelica capture is not valid JSON.");
  }
  const actualFingerprint = await sha256Fingerprint(value);
  if (deterministicJson(actualFingerprint) !== deterministicJson(expectedFingerprint)) {
    throw new Error(
      "The persisted CM-01 Modelica capture does not match its attempt fingerprint.",
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The persisted CM-01 Modelica capture must be an object.");
  }
  const capture = value as Cm01NominalModelicaCapture;
  if (
    capture.schemaVersion !== "cm01-nominal-modelica-capture/1.0" ||
    capture.kind !== "cm01-nominal-modelica-capture" ||
    capture.producer?.serverId !== "modelica" ||
    capture.producer.simulation?.tool !== "modelica_simulate" ||
    capture.producer.readback?.tool !== "modelica_run_get" ||
    capture.producer.simulation.runId !== capture.producer.readback.runId ||
    capture.producer.simulation.runId !== capture.evidence?.runId ||
    capture.evidence?.model.id !== CM01_NOMINAL_MODELICA_MODEL.id ||
    capture.evidence.model.version !== CM01_NOMINAL_MODELICA_MODEL.version ||
    capture.evidence.model.fingerprint.digest !== CM01_NOMINAL_MODELICA_MODEL.sha256 ||
    capture.evidence.scenario.id !== CM01_NOMINAL_MODELICA_SCENARIO.id ||
    capture.evidence.scenario.fingerprint.digest !==
      CM01_NOMINAL_MODELICA_SCENARIO.sha256
  ) {
    throw new Error(
      "The persisted capture is not the closed CM-01 nominal Modelica contract.",
    );
  }
  // Reuse the branch parser as a strict evidence/artifact validation gate.
  captureAsRunDetail(capture);
  createObservedModelicaRunExtension(
    COFFEE_MACHINE_CM01_V3_SUBJECT_ID,
    captureAsRunDetail(capture),
  );
  return capture;
}

function requireRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): EngineeringAgentRun {
  const run = project.agentRuns.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  return run;
}

function requireThermalRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== COFFEE_MACHINE_CM01_V3_PROJECT_ID ||
    project.project.subjectId !== COFFEE_MACHINE_CM01_V3_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION.id ||
    workItem.operation.version !== COFFEE_MACHINE_CM01_V3_THERMAL_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 nominal thermal operation.",
    );
  }
  return workItem;
}

function requireOwnedThermalRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const workItem = requireThermalRunShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 thermal run it claimed.",
    );
  }
  return workItem;
}

function requireThreadBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 thermal run ${run.id} must have an exact ThreadSnapshot basis.`,
    );
  }
  return run.basis;
}

function requiredRunStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 thermal run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
}

function snapshotReference(snapshot: ThreadSnapshot): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function assertCompletedByThisExecution(
  project: EngineeringProjectSnapshot,
  commandId: string,
  runId: string,
): void {
  const run = requireRun(project, runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === stepCommandId(commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 thermal run ${runId} did not complete through this exact execution command.`,
    );
  }
}

function unexpectedRunStatus(
  run: EngineeringAgentRun,
  expected: "publishing" | "completed",
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `CM-01 thermal run ${run.id} is ${run.status}; expected ${expected} while resuming this exact execution command.`,
  );
}

function stepCommandId(commandId: string, step: string): string {
  return `${commandId}:cm01-nominal-thermal:${step}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
