/**
 * Trusted executor for `model.write-sensitivity-edges@1`.
 *
 * Re-reads the sensitivity-study capture, reconstructs edges with
 * server-fixed names, inserts renderSensitivityEdgeSetSysml into SysON,
 * and publishes the sensitivity-edges artifact. Agents never supply SysML.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  renderSensitivityEdgeSetSysml,
} from "../../../domain/sensitivity/edges/sensitivity-edge.ts";
import {
  sensitivityEdgesFromStudy,
  sensitivityPartDefName,
} from "../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  SENSITIVITY_EDGES_CAPTURE_SCHEMA,
  SENSITIVITY_EDGES_CAPTURE_URI_PREFIX,
  type SensitivityEdgesCapture,
  validateSensitivityEdgesCapture,
} from "./sensitivity-edges-capture.ts";
import {
  validateSensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  FileSensitivityEdgesAttemptStore,
} from "./file-sensitivity-edges-attempt-store.ts";
import { findArchitectureArtifact } from "../../architecture/renderer/model-write-architecture-run-executor.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

export { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION };
export { SENSITIVITY_EDGES_CAPTURE_URI_PREFIX };

export interface SensitivityEdgesThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface SensitivityEdgesSysonContext {
  readonly editingContextId: string;
  readonly parentElementId: string;
}

export interface ModelWriteSensitivityEdgesRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: SensitivityEdgesThreadSnapshotStore;
  readonly studyCaptures: Pick<FileCaptureStore<"sensitivity-study">, "read">;
  readonly edgeCaptures: Pick<
    FileCaptureStore<"sensitivity-edges">,
    "save" | "read" | "uriFor"
  >;
  readonly syson: McpToolClient;
  readonly resolveSysonContext: (
    snapshot: ThreadSnapshot,
  ) => Promise<SensitivityEdgesSysonContext>;
  readonly attempts: FileSensitivityEdgesAttemptStore;
  readonly lease: EngineeringProjectRunLease;
  /** Cold server-owned authorization recheck for the fixed SysON binding. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** Starts the sealed JIT group before run/WAL/SysON mutation. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
}

export class ModelWriteSensitivityEdgesRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: ModelWriteSensitivityEdgesRunExecutorDependencies["commands"];
  readonly #snapshots: SensitivityEdgesThreadSnapshotStore;
  readonly #studyCaptures:
    ModelWriteSensitivityEdgesRunExecutorDependencies["studyCaptures"];
  readonly #edgeCaptures:
    ModelWriteSensitivityEdgesRunExecutorDependencies["edgeCaptures"];
  readonly #syson: McpToolClient;
  readonly #resolveSysonContext:
    ModelWriteSensitivityEdgesRunExecutorDependencies["resolveSysonContext"];
  readonly #attempts: FileSensitivityEdgesAttemptStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;

  constructor(deps: ModelWriteSensitivityEdgesRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#studyCaptures = deps.studyCaptures;
    this.#edgeCaptures = deps.edgeCaptures;
    this.#syson = deps.syson;
    this.#resolveSysonContext = deps.resolveSysonContext;
    this.#attempts = deps.attempts;
    this.#lease = deps.lease;
    this.#capabilityRuntime = deps.capabilityRuntime;
    this.#capabilityRuntimeSession = deps.capabilityRuntimeSession;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the model-write-sensitivity-edges run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    await requireMrtrApproval(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      const preRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preRun);
      if (preRun.status === "completed") return preClaim;
      await assertThreadWriteBasisAvailable(preClaim, preRun);
      const operationalCapability = await this.#requireOperationalCapability(
        preClaim,
        preRun,
      );
      // JIT activation is deliberately pre-claim: a denied or unavailable
      // host must not alter the work item, run, WAL, or SysON state.
      capabilitySession = await beginConfiguredCapabilityRuntimeSession({
        session: this.#capabilityRuntimeSession!,
        project: preClaim,
        runId: command.runId,
        operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(command.projectId);
          const run = requireRun(fresh, command.runId);
          requireShape(fresh, run);
          return await this.#requireOperationalCapability(fresh, run);
        },
      });
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: `${command.commandId}:claim`,
        summary: "Started the sensitivity-edges SysON write.",
      });
      claimed = true;
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      if (!findArchitectureArtifact(basisSnapshot)) {
        throw invalidTransition(
          "No architecture artifact is present on the Thread basis.",
        );
      }
      const studyArtifact = requireBoundArtifact(
        project,
        run,
        basisSnapshot,
        "studyCapture",
      );
      const studyText = await this.#studyCaptures.read(studyArtifact.fingerprint);
      if (!studyText) {
        throw invalidTransition("The sensitivity-study capture is not readable.");
      }
      let parsedStudy: unknown;
      try {
        parsedStudy = JSON.parse(studyText);
      } catch {
        throw invalidTransition("The sensitivity-study capture is not valid JSON.");
      }
      let studyCapture;
      try {
        studyCapture = await validateSensitivityStudyResult(parsedStudy);
      } catch (error) {
        throw invalidTransition(
          error instanceof Error
            ? error.message
            : "The bound artifact is not a sensitivity-study capture.",
        );
      }
      const baseMetrics = new Map(
        studyCapture.measurements.base.map((item) => [item.metric, item]),
      );
      const steppedMetrics = new Map(
        studyCapture.measurements.stepped.map((item) => [item.metric, item]),
      );
      const edges = sensitivityEdgesFromStudy(
        studyCapture.studyCase,
        baseMetrics,
        steppedMetrics,
        { runId: studyCapture.trustedRunId, capturedAt: studyCapture.capturedAt },
      );
      const partDefName = sensitivityPartDefName(studyCapture.studyCase.id);
      const sysml = renderSensitivityEdgeSetSysml(partDefName, edges);
      const context = await this.#resolveSysonContext(basisSnapshot);
      const planDigest = (await sha256Fingerprint({
        sysml,
        parentElementId: context.parentElementId,
        editingContextId: context.editingContextId,
      })).digest;
      const wal = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
        dispatchedAt: requiredStart(run),
      });
      if (wal === "dispatch") {
        await this.#syson.callTool({
          name: "syson_element_insert_sysml",
          arguments: {
            editing_context_id: context.editingContextId,
            parent_id: context.parentElementId,
            sysml_text: sysml,
          },
        });
      }
      if (wal !== "completed") {
        // On "verify" the insert was already dispatched once: never re-insert
        // (that would duplicate the PartDef); re-extract and require the exact
        // attributes instead, failing labelled if they are not observable.
        const extracted = await this.#syson.callTool({
          name: "syson_constraint_extract",
          arguments: {
            editing_context_id: context.editingContextId,
            element_id: context.parentElementId,
          },
        });
        assertExtractedFeaturePaths(extracted.structuredContent, edges);
      }
      const capturedAt = requiredStart(run);
      const capture: SensitivityEdgesCapture = {
        schemaVersion: SENSITIVITY_EDGES_CAPTURE_SCHEMA,
        operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
        trustedRunId: run.id,
        studyCaptureId: studyArtifact.id,
        partDefName,
        sysml,
        edges,
        capturedAt,
      };
      // Fail-closed self-check before hashing: the persisted bytes must satisfy
      // the same exactRecord contract any future reader will re-validate with.
      validateSensitivityEdgesCapture(capture);
      const captureFingerprint = await sha256Fingerprint(capture);
      const captureText = deterministicJson(capture);
      await this.#edgeCaptures.save(captureFingerprint, captureText);
      if (await this.#edgeCaptures.read(captureFingerprint) !== captureText) {
        throw new Error(
          "Sensitivity-edges capture was not durably readable after save.",
        );
      }
      const successor = buildEdgesSuccessor({
        basisSnapshot,
        basis,
        run,
        studyArtifact,
        capture,
        captureFingerprint,
        captureUri: this.#edgeCaptures.uriFor(captureFingerprint),
      });
      await this.#snapshots.save(successor.snapshot);
      const readback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !readback ||
        deterministicJson(readback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Sensitivity-edges ThreadSnapshot was not durably readable after save.",
        );
      }
      await this.#attempts.complete({
        projectId: command.projectId,
        runId: run.id,
        snapshotId: successor.snapshot.id,
      });
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: `${command.commandId}:publish`,
          expectedRevision: project.revision,
          summary: "Publishing the sensitivity-edges artifact.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: `${command.commandId}:complete`,
          expectedRevision: project.revision,
          summary: "Inserted server-rendered sensitivity edges into SysON.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact",
            id: successor.artifact.id,
          }],
        });
      }
      const completed = await this.#requiredProject(command.projectId);
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return completed;
    } catch (error) {
      if (claimed) {
        await this.#recordFailure(origin, command, error);
      }
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: {
          kind: "release-if-terminal",
          run: await this.#currentRun(command.projectId, command.runId),
        },
      });
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ) {
    requireShape(project, run);
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    if (!workItem) {
      throw invalidTransition("Sensitivity-edges work item is not present.");
    }
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.#capabilityRuntime,
        session: this.#capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Sensitivity-edges SysON write requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Sensitivity-edges SysON write requires the sealed model.author-system@1 operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw invalidTransition(error.message);
      }
      throw error;
    }
  }

  async #currentRun(projectId: string, runId: string) {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
    }
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
    error: unknown,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (run.status !== "running" && run.status !== "publishing") return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: `${command.commandId}:fail`,
        expectedRevision: project.revision,
        summary:
          "Sensitivity-edges SysON write stopped before Thread publication completed.",
        code: error instanceof EngineeringProjectCommandError
          ? error.code
          : "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Preserve the original execution failure.
    }
  }
}

function assertExtractedFeaturePaths(
  structuredContent: unknown,
  edges: ReturnType<typeof sensitivityEdgesFromStudy>,
): void {
  const text = deterministicJson(structuredContent ?? {});
  for (const edge of edges) {
    if (!text.includes(edge.driver.sysmlAttrName)) {
      throw invalidTransition(
        `Re-extraction does not include driver attribute ${edge.driver.sysmlAttrName}.`,
      );
    }
  }
}

function requireBoundArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  name: string,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) => item.name === name);
  if (binding?.source.kind !== "thread-entity") {
    throw invalidTransition(`Run is not bound to a Thread ${name} artifact.`);
  }
  const reference = binding.source.reference as EngineeringThreadEntityRef;
  const artifact = snapshot.artifacts.find((item) => item.id === reference.id);
  if (!artifact) {
    throw invalidTransition(
      `Bound ${name} artifact is absent from the execution basis.`,
    );
  }
  return artifact;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings.find((item) => item.name === "studyCapture");
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id ||
    operation.version !== MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version ||
    binding?.source.kind !== "thread-entity"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to model.write-sensitivity-edges@1.`,
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      "Work item not found.",
    );
  }
  const basis = requireBasis(run);
  const candidates = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human"
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "No exact human-approved sensitivity-edges MRTR decision is bound to this run basis.",
    );
  }
  return candidates[0]!;
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return snapshot;
}

function buildEdgesSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly studyArtifact: ThreadArtifact;
  readonly capture: SensitivityEdgesCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const artifactId = `sensitivity-edges-${input.captureFingerprint.digest}`;
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id}@${MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: input.capture.partDefName,
    kind: "sysml-model",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.studyArtifact.id],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const consumptionId = `consume-${input.studyArtifact.id}-by-${artifactId}`;
  const extension: ThreadSnapshotExtension = {
    id: `model-write-sensitivity-edges-${input.run.id}`,
    name: "Author the reviewed sensitivity edges",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [artifact],
    consumptions: [{
      id: consumptionId,
      artifactId: input.studyArtifact.id,
      consumer: operationRef,
      observedFingerprint: input.studyArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `derived-from-${input.studyArtifact.id}-by-${artifactId}`,
      relation: "derived_from",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "artifact", id: input.studyArtifact.id },
      rationale: "The edges artifact is derived from the sensitivity-study capture.",
    }, {
      id: `uses-${consumptionId}`,
      relation: "uses",
      from: { kind: "consumption", id: consumptionId },
      to: { kind: "artifact", id: input.studyArtifact.id },
      rationale:
        "The executor re-read the sensitivity-study capture before rendering SysML.",
    }],
    proposedActions: [],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact sensitivity-edges artifact is already present.",
    );
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}

function sameSnapshotBasis(
  left: { readonly snapshotId: string; readonly revision: number } | undefined,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === right.snapshotId && left.revision === right.revision;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
