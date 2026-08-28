/**
 * Registered Thread materialization for the prescribed-kinematics vertical.
 *
 * The public MCP surface queues only an operation/run id. This executor
 * reopens the exact basis and MRTR decision, then reads and writes only the
 * vertical's immutable capture lanes. It deliberately has no provider/tool/
 * image/argument selection surface. L3 is absent unless composition supplies
 * the one qualified, server-owned observation runner.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type {
  ProjectPrescribedKinematicsCaseCaptureUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import type {
  RunPrescribedKinematicsObservationUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/run-prescribed-kinematics-observation.ts";
import type {
  SealPrescribedKinematicsMethodUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/seal-prescribed-kinematics-method.ts";
import type {
  EvaluatePrescribedKinematicsUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/evaluate-prescribed-kinematics.ts";
import type {
  DecidePrescribedKinematicsCloseoutUseCase,
} from "../../../application/ports/in/mechanics/prescribed-kinematics/decide-prescribed-kinematics-closeout.ts";
import type { RegisteredProjectRunExecutorCommand } from "../../../application/ports/in/project-run-executor.ts";
import type { ProjectRunExecutor } from "../../../application/ports/in/project-run-executor.ts";
import type { PrescribedKinematicsCaptureStore } from "../../../application/ports/out/mechanics/prescribed-kinematics-capture-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { prescribedKinematicsEvaluationCloseoutCandidates } from "../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import {
  DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
  VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
} from "../../../domain/mechanism/prescribed-kinematics/operations.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import { threadWriteBasisLeaseScope } from "../../shared/thread-write-basis-guard.ts";

type ExactOperation =
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION
  | typeof VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION
  | typeof VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION
  | typeof VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION
  | typeof DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
  | typeof DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;

export interface PrescribedKinematicsRunThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrescribedKinematicsRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: PrescribedKinematicsRunThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly caseReview: ProjectPrescribedKinematicsCaseCaptureUseCase;
  readonly captures: PrescribedKinematicsCaptureStore;
  /** Omit unless the fixed qualified Chrono execution composition exists. */
  readonly observe?: RunPrescribedKinematicsObservationUseCase;
  readonly sealMethod: SealPrescribedKinematicsMethodUseCase;
  readonly evaluate: EvaluatePrescribedKinematicsUseCase;
  readonly decideCloseout: DecidePrescribedKinematicsCloseoutUseCase;
}

export class PrescribedKinematicsRunExecutor implements ProjectRunExecutor {
  readonly #projects: PrescribedKinematicsRunExecutorDependencies["projects"];
  readonly #commands: PrescribedKinematicsRunExecutorDependencies["commands"];
  readonly #snapshots: PrescribedKinematicsRunThreadSnapshotStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #caseReview: ProjectPrescribedKinematicsCaseCaptureUseCase;
  readonly #captures: PrescribedKinematicsCaptureStore;
  readonly #observe?: RunPrescribedKinematicsObservationUseCase;
  readonly #sealMethod: SealPrescribedKinematicsMethodUseCase;
  readonly #evaluate: EvaluatePrescribedKinematicsUseCase;
  readonly #decideCloseout: DecidePrescribedKinematicsCloseoutUseCase;

  constructor(dependencies: PrescribedKinematicsRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#lease = dependencies.lease;
    this.#caseReview = dependencies.caseReview;
    this.#captures = dependencies.captures;
    this.#observe = dependencies.observe;
    this.#sealMethod = dependencies.sealMethod;
    this.#evaluate = dependencies.evaluate;
    this.#decideCloseout = dependencies.decideCloseout;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await requiredProject(this.#projects, command.projectId);
    const run = requireRun(project, command.runId);
    const operation = exactOperation(project, run);
    if (isL5(operation) ? origin.kind !== "human" : origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        isL5(operation)
          ? "Prescribed-kinematics L5 can execute only with a human origin."
          : "Prescribed-kinematics L1-L4 can execute only with an agent origin.",
      );
    }
    if (operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION && !this.#observe) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The registered prescribed-kinematics L3 operation requires the server's qualified mechanics observation runtime.",
      );
    }
    if (run.status === "completed") return project;
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    try {
      let project = await requiredProject(this.#projects, command.projectId);
      let run = requireRun(project, command.runId);
      const operation = exactOperation(project, run);
      if (run.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: step(command.commandId, "claim"),
          summary: `Started ${operation.id}@${operation.version}.`,
        });
        claimed = true;
      } else if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "queued, running, or publishing");
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      const currentOperation = exactOperation(project, run);
      const basis = requireBasis(run);
      const base = await exactSnapshot(this.#snapshots, basis);
      const decision = await requiredHumanDecision(project, run, basis);
      const materialized = await this.#materialize({
        project,
        run,
        operation: currentOperation,
        basis,
        base,
        decision,
      });
      const successor = applyThreadSnapshotExtensionIfNew(base, {
        id: `prescribed-kinematics-${run.id}`,
        name: materialized.name,
        subjectId: base.subject.id,
        capturedAt: requiredStart(run),
        artifacts: [materialized.artifact],
        consumptions: materialized.inputArtifacts.map((artifact) => ({
          id: `prescribed-kinematics-consume-${run.id}-${artifact.id}`,
          artifactId: artifact.id,
          consumer: producer(currentOperation, run.id),
          observedFingerprint: artifact.fingerprint,
          verifiedAt: requiredStart(run),
          status: "verified" as const,
        })),
        observations: [],
        requirements: [],
        evaluations: [],
        violations: [],
        provenance: [],
        proposedActions: [],
      }, { appliedAt: requiredStart(run) }).snapshot;
      await this.#snapshots.save(successor);
      const reread = await this.#snapshots.getFresh(successor.id);
      if (!reread || JSON.stringify(reread) !== JSON.stringify(successor)) {
        throw new Error(
          "The prescribed-kinematics Thread successor was not exactly readable.",
        );
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: `Publishing ${currentOperation.id}@${currentOperation.version}.`,
        });
      }
      project = await requiredProject(this.#projects, command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completion(command, project.revision, successor, materialized.artifact),
        );
      }
      return await requiredProject(this.#projects, command.projectId);
    } catch (error) {
      if (claimed) {
        try {
          const project = await requiredProject(this.#projects, command.projectId);
          const run = requireRun(project, command.runId);
          if (run.status === "running") {
            await this.#commands.failRun(origin, {
              ...command,
              commandId: step(command.commandId, "fail"),
              expectedRevision: project.revision,
              summary: "Prescribed-kinematics execution did not materialize evidence.",
              code: "prescribed-kinematics-execution-failed",
              message: error instanceof Error
                ? error.message.slice(0, 400)
                : "Unknown prescribed-kinematics execution error.",
            });
          }
        } catch {
          // Preserve the original evidence/authority error.
        }
      }
      throw error;
    }
  }

  async #materialize(input: {
    project: EngineeringProjectSnapshot;
    run: EngineeringAgentRun;
    operation: ExactOperation;
    basis: EngineeringThreadSnapshotBasis;
    base: ThreadSnapshot;
    decision: EngineeringDecision;
  }): Promise<
    {
      readonly name: string;
      readonly artifact: ThreadArtifact;
      readonly inputArtifacts: readonly ThreadArtifact[];
    }
  > {
    const parameters = parameterMap(input.decision);
    if (input.operation === VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION) {
      const captured = await this.#caseReview.capture({
        projectId: input.project.project.id,
        workspaceRevision: positive(parameters, "workspaceRevision"),
        attachmentId: text(parameters, "attachmentId"),
        attachmentRevision: positive(parameters, "attachmentRevision"),
      });
      if (captured.status !== "resolved") {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          captured.diagnostic.message,
        );
      }
      const ref = await this.#captures.saveCase(captured.sealedCase);
      return output(
        input,
        "case",
        "Prescribed kinematics case",
        ref.fingerprint,
        ref.uri,
        [],
      );
    }
    const caseArtifact = inputArtifact(
      input.base,
      VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    );
    const sealedCase = await required(
      this.#captures.readCase(caseArtifact.fingerprint),
      "The exact prescribed-kinematics case capture is absent.",
    );
    if (input.operation === VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION) {
      const result = await this.#observe!.execute({
        projectId: input.project.project.id,
        agentRunId: input.run.id,
        requestId: `prescribed-kinematics-${input.run.id}`,
        startedAt: requiredStart(input.run),
        planFingerprint: await sha256Fingerprint({
          runId: input.run.id,
          operation: input.operation,
          basis: input.basis,
        }),
        bindingFingerprint: await sha256Fingerprint({
          operation: input.operation,
          case: sealedCase.fingerprint,
        }),
        sealedCase,
      });
      if (result.status !== "recorded") {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          result.status === "rejected"
            ? `Chrono rejected the request before dispatch: ${result.code}.`
            : `Chrono outcome remains recoverable/quarantined: ${result.reason}.`,
        );
      }
      const ref = await this.#captures.saveObservation({
        schemaVersion: "prescribed-kinematics-observation-capture/2.0",
        observation: result.observation,
        request: result.request,
        receipt: result.receipt,
        notEvaluated: result.notEvaluated,
        lowering: result.lowering,
      }, sealedCase);
      return output(
        input,
        "observation",
        "Prescribed kinematics observation",
        ref.fingerprint,
        ref.uri,
        [caseArtifact],
      );
    }
    const observationArtifact = inputArtifact(
      input.base,
      VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    );
    const observationCapture = await required(
      this.#captures.readObservation(observationArtifact.fingerprint, sealedCase),
      "The exact prescribed-kinematics observation capture is absent.",
    );
    if (input.operation === VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION) {
      const resourceRef = methodResource(parameters);
      const method = await this.#sealMethod.execute({
        sealedCase,
        observation: observationCapture.observation,
        resourceRef,
        signedResourceFingerprint: resourceRef.fingerprint,
      });
      const ref = await this.#captures.saveMethod(method);
      return output(
        input,
        "method",
        "Prescribed kinematics method",
        ref.fingerprint,
        ref.uri,
        [caseArtifact, observationArtifact],
      );
    }
    const methodArtifact = inputArtifact(
      input.base,
      VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    );
    const method = await required(
      this.#captures.readMethod(methodArtifact.fingerprint),
      "The exact prescribed-kinematics method capture is absent.",
    );
    if (input.operation === VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION) {
      const evaluation = await this.#evaluate.execute({
        sealedCase,
        observation: observationCapture.observation,
        method,
      });
      const ref = await this.#captures.saveEvaluation(evaluation);
      return output(
        input,
        "evaluation",
        "Prescribed kinematics evaluation",
        ref.fingerprint,
        ref.uri,
        [caseArtifact, observationArtifact, methodArtifact],
      );
    }
    const evaluationArtifact = inputArtifact(
      input.base,
      VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    );
    const evaluation = await required(
      this.#captures.readEvaluation(evaluationArtifact.fingerprint),
      "The exact prescribed-kinematics evaluation capture is absent.",
    );
    const consequence =
      input.operation === DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION
        ? "accept"
        : "reject";
    const candidate = (await prescribedKinematicsEvaluationCloseoutCandidates({
      evaluation,
      sealedCase,
      observation: observationCapture.observation,
      method,
    })).find((entry) => entry.consequence === consequence);
    if (!candidate) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "L5 accept is unavailable unless the exact L4 verdict is pass.",
      );
    }
    const closeout = await this.#decideCloseout.execute({
      origin: "human",
      projectId: input.project.project.id,
      subjectId: input.base.subject.id,
      basis: input.basis,
      candidate,
      sealedCase,
      observation: observationCapture.observation,
      method,
    });
    const ref = await this.#captures.saveCloseout(closeout);
    return output(
      input,
      "closeout",
      `Prescribed kinematics ${consequence} closeout`,
      ref.fingerprint,
      ref.uri,
      [caseArtifact, observationArtifact, methodArtifact, evaluationArtifact],
    );
  }
}

function exactOperation(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): ExactOperation {
  const operation = project.workItems.find((item) => item.id === run.workItemId)
    ?.operation;
  const operations = [
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_CASE_OPERATION,
    VERIFY_RUN_PRESCRIBED_KINEMATICS_OPERATION,
    VERIFY_SEAL_PRESCRIBED_KINEMATICS_METHOD_OPERATION,
    VERIFY_EVALUATE_PRESCRIBED_KINEMATICS_OPERATION,
    DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
    DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION,
  ] as const;
  const exact = operations.find((candidate) =>
    candidate.id === operation?.id && candidate.version === operation.version
  );
  if (!exact) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor accepts only one exact prescribed-kinematics operation.",
    );
  }
  return exact;
}
function isL5(operation: ExactOperation): boolean {
  return operation === DECIDE_ACCEPT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION ||
    operation === DECIDE_REJECT_PRESCRIBED_KINEMATICS_EVALUATION_OPERATION;
}
async function requiredHumanDecision(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  basis: EngineeringThreadSnapshotBasis,
): Promise<EngineeringDecision> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const candidates = (work?.decisionIds ?? []).map((id) =>
    project.decisions.find((decision) => decision.id === id)
  ).filter((decision): decision is EngineeringDecision =>
    Boolean(
      decision?.proposal && decision.status === "approved" &&
        decision.baseSnapshot?.snapshotId === basis.snapshotId &&
        decision.baseSnapshot.revision === basis.revision &&
        decision.baseSnapshot.subjectId === basis.subjectId,
    )
  );
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prescribed-kinematics execution requires one exact approved human MRTR decision on its run basis.",
    );
  }
  const approvals = project.approvals.filter((approval) =>
    approval.decisionId === candidates[0]!.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human"
  );
  const decision = candidates[0]!;
  const approval = approvals[0];
  if (
    approvals.length !== 1 || !approval || !decision.inputFingerprint ||
    !approval.baseSnapshot || approval.baseSnapshot.snapshotId !== basis.snapshotId ||
    approval.baseSnapshot.revision !== basis.revision ||
    approval.baseSnapshot.subjectId !== basis.subjectId ||
    deterministicJson(approval.inputEvidenceRefs) !==
      deterministicJson(decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prescribed-kinematics execution requires one human MRTR approval bound to the exact project Thread basis and evidence.",
    );
  }
  const expectedFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal!.summary,
      parameters: decision.proposal!.parameters,
    },
  });
  if (!fingerprintsEqual(expectedFingerprint, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prescribed-kinematics MRTR fingerprint does not seal its exact basis, evidence, and parameters.",
    );
  }
  return decision;
}
async function exactSnapshot(
  store: PrescribedKinematicsRunThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The exact prescribed-kinematics Thread basis is unavailable.",
    );
  }
  return snapshot;
}
function inputArtifact(
  base: ThreadSnapshot,
  operation: ExactOperation,
): ThreadArtifact {
  const matches = base.artifacts.filter((artifact) =>
    artifact.producer.tool === `${operation.id}@${operation.version}`
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `The basis must contain exactly one ${operation.id}@${operation.version} artifact.`,
    );
  }
  return matches[0]!;
}
async function required<T>(value: Promise<T | undefined>, message: string): Promise<T> {
  const resolved = await value;
  if (!resolved) {
    throw new EngineeringProjectCommandError("invalid_transition", message);
  }
  return resolved;
}
function parameterMap(
  decision: EngineeringDecision,
): ReadonlyMap<string, string | number | boolean> {
  const values = decision.proposal!.parameters;
  const map = new Map(values.map((entry) => [entry.key, entry.value]));
  if (map.size !== values.length) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Prescribed-kinematics MRTR parameters contain duplicate keys.",
    );
  }
  return map;
}
function text(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): string {
  const value = values.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Prescribed-kinematics MRTR parameter ${key} is required.`,
    );
  }
  return value;
}
function positive(
  values: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = values.get(key);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Prescribed-kinematics MRTR parameter ${key} must be a positive integer.`,
    );
  }
  return value;
}
function methodResource(
  values: ReadonlyMap<string, string | number | boolean>,
): AgentResourceReference {
  const digest = text(values, "methodResourceSha256");
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "methodResourceSha256 must be a lowercase SHA-256 digest.",
    );
  }
  const representation = text(values, "methodResourceRepresentation");
  if (representation !== "text" && representation !== "blob") {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "methodResourceRepresentation must be text or blob.",
    );
  }
  return {
    schemaVersion: "agent-resource-capture/1.0",
    uri: text(values, "methodResourceUri"),
    name: text(values, "methodResourceName"),
    mimeType: text(values, "methodResourceMimeType"),
    representation,
    byteCount: positive(values, "methodResourceByteCount"),
    fingerprint: { algorithm: "sha256", digest },
  };
}
function producer(operation: ExactOperation, runId: string) {
  return {
    serverId: "digital-thread",
    tool: `${operation.id}@${operation.version}`,
    runId,
  } as const;
}
function output(
  input: { readonly run: EngineeringAgentRun; readonly operation: ExactOperation },
  lane: string,
  name: string,
  fingerprint: ContentFingerprint,
  uri: string,
  inputArtifacts: readonly ThreadArtifact[],
) {
  const artifact: ThreadArtifact = {
    id: `prescribed-kinematics-${lane}-${fingerprint.digest}`,
    name,
    kind: "evidence",
    version: "1",
    fingerprint,
    uri,
    mediaType: "application/json",
    producer: producer(input.operation, input.run.id),
    inputArtifactIds: inputArtifacts.map((artifact) => artifact.id),
    freshness: {
      status: "fresh",
      changedAt: requiredStart(input.run),
      invalidatedByChangeIds: [],
    },
  };
  return { name, artifact, inputArtifacts };
}
function completion(
  command: RegisteredProjectRunExecutorCommand,
  revision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
): CompleteRunCommand {
  return {
    ...command,
    commandId: step(command.commandId, "complete"),
    expectedRevision: revision,
    summary: "Captured prescribed-kinematics evidence.",
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}
function step(commandId: string, phase: string): string {
  return `${commandId}:prescribed-kinematics:${phase}`;
}
async function requiredProject(
  projects: Pick<EngineeringProjectRevisionStore, "get">,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const project = await projects.get(projectId);
  if (!project) {
    throw new EngineeringProjectCommandError(
      "project_not_found",
      `Project ${projectId} was not found.`,
    );
  }
  return project;
}
