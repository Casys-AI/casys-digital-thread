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
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import {
  CM01_ERPNEXT_BOM_CAPTURE_SCHEMA,
  type Cm01ErpNextBomCapture,
  type Cm01ErpNextBomCaptureAdapter,
} from "../cm01-erpnext-bom-capture.ts";
import { FileCaptureStore } from "../file-capture-store.ts";
import { FileCm01ErpNextBomRunCaptureStore } from "../file-cm01-erpnext-bom-run-capture-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom;
export const COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_ARTIFACT_ROLE = "erp-bom" as const;
const PROJECT_ID = "coffee-machine-cm01-v3";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";

export interface CoffeeMachineCm01V3ErpNextBomRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3ErpNextBomRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Closed, server-owned, read-only observation. No agent value reaches ERPNext. */
  readonly capture: Pick<Cm01ErpNextBomCaptureAdapter, "capture">;
  readonly captures: FileCaptureStore<"cm01-erpnext-bom">;
  readonly runCaptures: FileCm01ErpNextBomRunCaptureStore;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface Materialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/**
 * Trusted executor for exactly one reviewed external CM-01 BOM observation.
 *
 * ERPNext is only read through its fixed capture adapter. Captures are reduced
 * before persistence; a resume uses the already-hashed normalized bytes and
 * never asks the provider to reinterpret a prior observation.
 */
export class CoffeeMachineCm01V3ErpNextBomRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #capture: Pick<Cm01ErpNextBomCaptureAdapter, "capture">;
  readonly #captures: FileCaptureStore<"cm01-erpnext-bom">;
  readonly #runCaptures: FileCm01ErpNextBomRunCaptureStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(dependencies: CoffeeMachineCm01V3ErpNextBomRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#capture = dependencies.capture;
    this.#captures = dependencies.captures;
    this.#runCaptures = dependencies.runCaptures;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ErpNextBomRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can observe the reviewed CM-01 ERPNext BOM.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ErpNextBomRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let captureDurable = false;
    let snapshotDurable = false;
    let materialized: Materialization | undefined;
    try {
      const before = await this.requiredProject(command.projectId);
      const beforeRun = requireRun(before, command.runId);
      requireShape(before, beforeRun);
      await this.requiredBasis(before, beforeRun);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the reviewed, read-only CM-01 ERPNext BOM observation.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status === "failed" || run.status === "cancelled") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `CM-01 ERPNext BOM run ${run.id} is ${run.status}; queue a reviewed new run.`,
        );
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const base = await this.requiredBasis(project, run);
      await this.recordLive({
        subjectId: project.project.subjectId,
        runId: run.id,
        baseRevision: base.revision,
        state: "running",
        recordedAt: requiredStart(run),
        label: "ERP BOM observation running",
        summary:
          "Reading the reviewed external BOM. This is supply evidence, not an availability, cost, or release verdict.",
      });

      const capture = await this.captureOnce(project, run);
      captureDurable = true;
      materialized = await materialize(base, capture, this.#captures);
      await this.#snapshots.save(materialized.snapshot);
      snapshotDurable = true;
      await this.assertPersisted(materialized.snapshot);
      await this.recordLive({
        subjectId: project.project.subjectId,
        runId: run.id,
        baseRevision: base.revision,
        state: "fresh",
        recordedAt: capture.capturedAt,
        label: "ERP BOM evidence captured",
        summary:
          "The normalized ERPNext BOM evidence is attached to the project thread. No stock or manufacturing conclusion was inferred.",
      });

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the immutable CM-01 ERPNext BOM observation.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: step(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Recorded the immutable CM-01 ERPNext BOM observation.",
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
      if (
        materialized &&
        (await this.persistedPresence(materialized.snapshot)) === "exact"
      ) {
        snapshotDurable = true;
      }
      if (snapshotDurable) {
        const completed = await this.completedProject(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 ERPNext BOM evidence is durable, but its project attachment did not finish. Retry this same command to resume from the saved capture.",
        );
      }
      if (claimed && !captureDurable) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<Cm01ErpNextBomCapture> {
    const existing = await this.#runCaptures.read(project.project.id, run.id);
    if (existing) {
      const text = await this.#captures.read(existing.captureFingerprint);
      if (!text) {
        throw new Error(
          "CM-01 ERPNext BOM run capture is missing its immutable bytes.",
        );
      }
      return await parsePersistedCapture(text, existing.captureFingerprint);
    }
    const capture = await this.#capture.capture();
    const text = deterministicJson(capture);
    const fingerprint = await sha256Fingerprint(capture);
    await this.#captures.save(fingerprint, text);
    await this.#runCaptures.save({
      schemaVersion: "cm01-erpnext-bom-run-capture/1.0",
      projectId: project.project.id,
      runId: run.id,
      capturedAt: capture.capturedAt,
      captureFingerprint: fingerprint,
    });
    return parseCapture(capture);
  }

  private async requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The queued ERP BOM basis belongs to another subject.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot basis for this CM-01 ERP BOM run is unavailable.",
      );
    }
    return snapshot;
  }

  private async assertPersisted(snapshot: ThreadSnapshot): Promise<void> {
    if ((await this.persistedPresence(snapshot)) !== "exact") {
      throw new Error(
        `ERP BOM ThreadSnapshot ${snapshot.id} was not durably readable after save.`,
      );
    }
  }

  private async persistedPresence(
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

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3ErpNextBomRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId ||
        !["running", "publishing", "waiting-for-decision"].includes(run.status)
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 ERPNext BOM observation stopped before durable evidence was published.",
        code: "cm01-erpnext-bom-not-published",
        message:
          "The external BOM could not be captured into durable project evidence. No provider mutation occurred.",
      });
      await this.recordLive({
        subjectId: project.project.subjectId,
        runId: command.runId,
        baseRevision: requireBasis(run).revision,
        state: "failed",
        recordedAt: safeNow(this.#now),
        label: "ERP BOM observation stopped",
        summary:
          "The read-only ERPNext observation stopped before a durable evidence branch was published.",
      });
    } catch {
      // Preserve the original provider or persistence error.
    }
  }

  private async recordLive(
    input: {
      subjectId: string;
      runId: string;
      baseRevision: number;
      state: "running" | "fresh" | "failed";
      recordedAt: string;
      label: string;
      summary: string;
    },
  ): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.appendOnce({
        subjectId: input.subjectId,
        runId: input.runId,
        operationId: COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION.id,
        baseRevision: input.baseRevision,
        state: input.state,
        recordedAt: input.recordedAt,
        graph: {
          nodes: [{
            id: `${input.runId}:erp-bom`,
            ref: { kind: "artifact", id: `${input.runId}:erp-bom` },
            entityKind: "artifact",
            artifactKind: "bom",
            activityRole: "milestone",
            label: input.label,
            system: "ERPNext",
            freshness: input.state,
            summary: input.summary,
            recordedAt: input.recordedAt,
          }],
          edges: [],
        },
      });
    } catch {
      // Presentation state must never alter canonical capture execution.
    }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* canonical state is durable */ }
  }

  private async completedProject(
    command: CoffeeMachineCm01V3ErpNextBomRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      await this.reconcileLive(project.project.subjectId, command.runId);
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

async function materialize(
  base: ThreadSnapshot,
  capture: Cm01ErpNextBomCapture,
  store: FileCaptureStore<"cm01-erpnext-bom">,
): Promise<Materialization> {
  const extension = await extensionFor(base.subject.id, capture, store);
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capture.capturedAt,
  });
  const artifact = applied.snapshot.artifacts.find((item) =>
    item.id === extension.artifacts[0].id
  );
  if (!artifact) throw new Error("CM-01 ERPNext BOM extension has no BOM artifact.");
  return {
    snapshot: applied.snapshot,
    evidence: {
      snapshotId: applied.snapshot.id,
      snapshotRevision: applied.snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    },
  };
}

export function coffeeMachineCm01V3ErpNextBomGoldenArtifact(
  snapshot: ThreadSnapshot,
): {
  role: typeof COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_ARTIFACT_ROLE;
  kind: "bom";
  producer: { serverId: "erpnext"; tool: "erpnext_bom_get" };
} {
  const artifact = snapshot.artifacts.find((item) =>
    item.kind === "bom" && item.producer.serverId === "erpnext" &&
    item.producer.tool === "erpnext_bom_get"
  );
  if (!artifact) {
    throw new Error("CM-01 V3 snapshot has no ERPNext BOM evidence artifact.");
  }
  return {
    role: COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_ARTIFACT_ROLE,
    kind: "bom",
    producer: { serverId: "erpnext", tool: "erpnext_bom_get" },
  };
}

async function extensionFor(
  subjectId: string,
  capture: Cm01ErpNextBomCapture,
  store: FileCaptureStore<"cm01-erpnext-bom">,
): Promise<ThreadSnapshotExtension> {
  const valid = parseCapture(capture);
  const fingerprint = valid.artifact.fingerprint;
  const captureFingerprint = await sha256Fingerprint(valid);
  const suffix = fingerprint.digest.slice(0, 12);
  const operation: ThreadOperationRef = {
    serverId: "erpnext",
    tool: "erpnext_bom_get",
    runId: `capture-${suffix}`,
  };
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: valid.capturedAt,
    invalidatedByChangeIds: [],
  };
  const artifact: ThreadArtifact = {
    id: `erpnext-bom-${suffix}`,
    name: `ERPNext BOM ${valid.artifact.identity.bomName}`,
    kind: "bom",
    version: suffix,
    fingerprint,
    uri: store.uriFor(captureFingerprint),
    producer: operation,
    inputArtifactIds: [],
    freshness,
  };
  const quantityId = `erpnext-bom-quantity-${suffix}`;
  const componentsId = `erpnext-bom-components-${suffix}`;
  return {
    id: `erpnext-bom-${suffix}`,
    name: "Attach reviewed ERPNext BOM evidence",
    subjectId,
    capturedAt: valid.capturedAt,
    bindingProofs: [{
      provider: "erpnext",
      kind: "bom",
      id: valid.artifact.identity.bomName,
    }],
    artifacts: [artifact],
    consumptions: [],
    observations: [
      {
        id: quantityId,
        name: "BOM quantity per finished good",
        metric: "bom_quantity_per_finished_good",
        quantity: valid.artifact.quantity,
        source: { operation, artifactIds: [artifact.id], capturedAt: valid.capturedAt },
        freshness,
      },
      {
        id: componentsId,
        name: "BOM component count",
        metric: "bom_component_count",
        quantity: { value: valid.artifact.componentCount, unit: "1" },
        source: { operation, artifactIds: [artifact.id], capturedAt: valid.capturedAt },
        freshness,
      },
    ],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `link-${quantityId}-${artifact.id}`,
        relation: "derived_from",
        from: { kind: "observation", id: quantityId },
        to: { kind: "artifact", id: artifact.id },
        rationale:
          "The captured normalized BOM attests the declared finished-good quantity.",
      },
      {
        id: `link-${componentsId}-${artifact.id}`,
        relation: "derived_from",
        from: { kind: "observation", id: componentsId },
        to: { kind: "artifact", id: artifact.id },
        rationale: "The captured normalized BOM attests only its component-row count.",
      },
    ],
    proposedActions: [],
  };
}

async function parsePersistedCapture(
  text: string,
  expected: ContentFingerprint,
): Promise<Cm01ErpNextBomCapture> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The persisted CM-01 ERPNext BOM capture is not valid JSON.");
  }
  const actual = await sha256Fingerprint(value);
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new Error(
      "The persisted CM-01 ERPNext BOM capture does not match its run fingerprint.",
    );
  }
  return parseCapture(value);
}

function parseCapture(value: unknown): Cm01ErpNextBomCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CM-01 ERPNext BOM capture must be an object.");
  }
  const capture = value as Cm01ErpNextBomCapture;
  const artifact = capture.artifact;
  if (
    capture.schemaVersion !== CM01_ERPNEXT_BOM_CAPTURE_SCHEMA ||
    capture.kind !== "cm01-erpnext-bom-capture" ||
    Number.isNaN(Date.parse(capture.capturedAt)) || !artifact ||
    artifact.role !== "erp-bom" || artifact.kind !== "bom" ||
    artifact.producer?.serverId !== "erpnext" ||
    artifact.producer.tool !== "erpnext_bom_get" ||
    artifact.fingerprint?.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(artifact.fingerprint.digest) ||
    !artifact.identity?.bomName?.trim() || !artifact.identity.itemCode?.trim() ||
    !artifact.identity.itemName?.trim() ||
    !Number.isFinite(artifact.quantity?.value) || artifact.quantity.value <= 0 ||
    !artifact.quantity.unit?.trim() ||
    !Number.isSafeInteger(artifact.componentCount) || artifact.componentCount < 1
  ) {
    throw new Error(
      "The persisted capture is not the closed CM-01 ERPNext BOM contract.",
    );
  }
  return capture;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const item = project.workItems.find((candidate) => candidate.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" || project.project.id !== PROJECT_ID ||
    project.project.subjectId !== SUBJECT_ID || run.basis?.kind !== "thread-snapshot" ||
    !item?.operation ||
    item.operation.id !== COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION.id ||
    item.operation.version !== COFFEE_MACHINE_CM01_V3_ERPNEXT_BOM_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 ERPNext BOM operation.",
    );
  }
  return item;
}
function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const item = requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 ERPNext BOM run it claimed.",
    );
  }
  return item;
}
function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3ErpNextBomRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 ERPNext BOM run ${run.id} did not complete through this exact execution command.`,
    );
  }
}
function step(commandId: string, name: string): string {
  return `${commandId}:cm01-erpnext-bom:${name}`;
}
function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}
