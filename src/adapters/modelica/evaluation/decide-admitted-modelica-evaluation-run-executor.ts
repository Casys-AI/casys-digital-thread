/**
 * Human-only executor for L5 closeout of one L4 admitted Modelica evaluation.
 *
 * It reopens the exact L4 capture and thermal method sheet, recrosses the
 * signed Thread basis, and writes a documentary closeout. It never calls
 * SysON or OMC. An L4 `pass` is never implicit L5.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { AdmittedObservationEvaluationCaptureStore } from "../../../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";
import type { ThermalMethodSheetStore } from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type AdmittedObservationEvaluationCloseoutAdmission,
  type AdmittedObservationEvaluationCloseoutOperation,
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  parseAdmittedObservationEvaluationCloseoutParameters,
} from "../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../domain/modelica/thermal-method-sheet.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
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
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
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
import {
  ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX,
  validateAdmittedObservationEvaluationCapture,
} from "./admitted-observation-evaluation-capture.ts";
import {
  ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX,
  ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
  type AdmittedObservationEvaluationCloseoutCapture,
  canonicalAdmittedObservationEvaluationCloseoutCaptureText,
  validateAdmittedObservationEvaluationCloseoutCapture,
} from "./admitted-observation-evaluation-closeout-capture.ts";

export {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
};

export interface CloseoutThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AdmittedObservationEvaluationCloseoutCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface DecideAdmittedModelicaEvaluationRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface DecideAdmittedModelicaEvaluationRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: CloseoutThreadSnapshotStore;
  readonly sheets: ThermalMethodSheetStore;
  readonly evaluationCaptures: AdmittedObservationEvaluationCaptureStore;
  readonly closeoutCaptures: AdmittedObservationEvaluationCloseoutCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

export class DecideAdmittedModelicaEvaluationRunExecutor {
  constructor(
    private readonly dependencies:
      DecideAdmittedModelicaEvaluationRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedModelicaEvaluationRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "human") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only a human operator can execute an admitted Modelica evaluation closeout. " +
          "An L4 pass is not L5.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    const operation = requireShape(project, run);
    const approval = requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters, operation);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, approval.decision, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DecideAdmittedModelicaEvaluationRunExecutorCommand,
    approvedDecision: EngineeringDecision,
    admission: AdmittedObservationEvaluationCloseoutAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      const operation = requireShape(project, run);
      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(
        this.dependencies.snapshots,
        basis,
      );
      await assertThreadSnapshotLineageIntact(
        basisSnapshot,
        this.dependencies.snapshots,
      );
      await recrossAdmission(
        command,
        admission,
        basis,
        basisSnapshot,
        this.dependencies.sheets,
        this.dependencies.evaluationCaptures,
      );

      if (run.status === "queued") {
        await this.dependencies.commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, operation, "claim"),
          summary: closeoutSummary(admission.consequence, "started"),
        });
        claimed = true;
      } else {
        throw unexpectedStatus(run, "queued");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      const sealedAt = requiredStart(run);
      const capture = validateAdmittedObservationEvaluationCloseoutCapture({
        schemaVersion: admission.schemaVersion,
        kind: "modelica-admitted-observation-evaluation-closeout",
        operation,
        trustedRunId: run.id,
        decisionId: approvedDecision.id,
        sealedAt,
        admission,
        evaluationCapture: {
          id: admission.capture.id,
          fingerprint: admission.capture.fingerprint,
          uri:
            `${ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${admission.capture.fingerprint.digest}`,
        },
        sheet: admission.sheet,
        limits: ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_LIMITS,
      });
      const captureText = canonicalAdmittedObservationEvaluationCloseoutCaptureText(
        capture,
      );
      const captureFingerprint = await sha256Fingerprint(capture);
      await this.dependencies.closeoutCaptures.save(
        captureFingerprint,
        captureText,
      );
      const readback = await this.dependencies.closeoutCaptures.read(
        captureFingerprint,
      );
      if (readback === undefined || readback !== captureText) {
        throw new Error(
          "Admitted observation evaluation closeout capture was not durably readable after save.",
        );
      }

      const successor = buildSuccessor({
        basisSnapshot,
        basis,
        run,
        operation,
        capture,
        captureFingerprint,
      });
      await this.dependencies.snapshots.save(successor.snapshot);

      project = await this.#requiredProject(command.projectId);
      await this.dependencies.commands.publishRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, operation, "publish"),
        expectedRevision: project.revision,
        summary: closeoutSummary(admission.consequence, "publishing"),
      });
      project = await this.#requiredProject(command.projectId);
      await this.dependencies.commands.completeRun(
        origin,
        completionCommand(
          command,
          operation,
          project.revision,
          successor.snapshot,
          successor.artifact,
          admission.consequence,
        ),
      );
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      if (claimed) {
        try {
          const failed = await this.#requiredProject(command.projectId);
          const failedRun = requireRun(failed, command.runId);
          const failedWork = failed.workItems.find((item) =>
            item.id === failedRun.workItemId
          );
          const operation = closeoutOperationOf(failedWork?.operation) ??
            DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION;
          await this.dependencies.commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, operation, "fail"),
            expectedRevision: failed.revision,
            summary:
              "Admitted Modelica evaluation closeout stopped before Thread publication.",
            code: `${operation.id.replaceAll(".", "-")}-not-published`,
            message: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.dependencies.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

async function recrossAdmission(
  command: DecideAdmittedModelicaEvaluationRunExecutorCommand,
  admission: AdmittedObservationEvaluationCloseoutAdmission,
  basis: ReturnType<typeof requireBasis>,
  basisSnapshot: ThreadSnapshot,
  sheets: ThermalMethodSheetStore,
  evaluationCaptures: AdmittedObservationEvaluationCaptureStore,
): Promise<void> {
  if (admission.projectId !== command.projectId) {
    throw invalidTransition(
      "The closeout project does not match the signed admission.",
    );
  }
  if (
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision
  ) {
    throw invalidTransition(
      "The closeout Thread basis does not match the signed admission.",
    );
  }
  const basisFingerprint = await sha256Fingerprint(basisSnapshot);
  if (!fingerprintsEqual(basisFingerprint, admission.basis.fingerprint)) {
    throw invalidTransition(
      "The closeout Thread basis is stale relative to the signed admission.",
    );
  }
  const sheet = await sheets.read(admission.sheet.fingerprint);
  if (!sheet) {
    throw invalidTransition("The exact thermal method sheet is unavailable.");
  }
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
  if (
    sheet.id !== admission.sheet.id ||
    !fingerprintsEqual(sheetFingerprint, admission.sheet.fingerprint)
  ) {
    throw invalidTransition(
      "The reopened thermal method sheet does not match the signed admission.",
    );
  }
  const stored = await evaluationCaptures.read(admission.capture.fingerprint);
  if (stored === undefined) {
    throw invalidTransition(
      "The exact L4 admitted observation evaluation capture is unavailable.",
    );
  }
  let l4Capture;
  try {
    l4Capture = validateAdmittedObservationEvaluationCapture(JSON.parse(stored));
  } catch {
    throw invalidTransition(
      "The named capture is not an L4 admitted observation evaluation capture.",
    );
  }
  const l4Fingerprint = await sha256Fingerprint(l4Capture);
  if (!fingerprintsEqual(l4Fingerprint, admission.capture.fingerprint)) {
    throw invalidTransition(
      "The reopened L4 evaluation capture fingerprint does not match the signed admission.",
    );
  }
  const artifact = basisSnapshot.artifacts.find((item) =>
    item.id === admission.capture.id
  );
  if (!artifact) {
    throw invalidTransition(
      "The named L4 evaluation capture is stale: it is absent from the exact Thread basis.",
    );
  }
  if (
    !fingerprintsEqual(artifact.fingerprint, admission.capture.fingerprint) ||
    artifact.producer.tool !==
      "verify.evaluate-admitted-modelica-observations@1"
  ) {
    throw invalidTransition(
      "The named Thread artifact is not the exact L4 admitted observation evaluation.",
    );
  }
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: ReturnType<typeof requireBasis>;
  readonly run: EngineeringAgentRun;
  readonly operation: AdmittedObservationEvaluationCloseoutOperation;
  readonly capture: AdmittedObservationEvaluationCloseoutCapture;
  readonly captureFingerprint: ContentFingerprint;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifactId =
    `modelica-admitted-observation-evaluation-closeout-${input.captureFingerprint.digest}`;
  const l4ArtifactId = input.capture.admission.capture.id;
  const operationRef = {
    serverId: "digital-thread",
    tool: `${input.operation.id}@${input.operation.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: input.capture.admission.consequence === "accept"
      ? "Accepted admitted Modelica evaluation closeout"
      : "Rejected admitted Modelica evaluation closeout",
    kind: "document",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri:
      `${ADMITTED_OBSERVATION_EVALUATION_CLOSEOUT_CAPTURE_URI_PREFIX}sha256/${input.captureFingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const actionId = `l5-closeout-${input.run.id}`;
  const extension: ThreadSnapshotExtension = {
    id: `${input.operation.id.replaceAll(".", "-")}-${input.run.id}`,
    name: input.capture.admission.consequence === "accept"
      ? "Accept admitted Modelica evaluation"
      : "Reject admitted Modelica evaluation",
    subjectId: input.basis.subjectId,
    capturedAt: sealedAt,
    artifacts: [artifact],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `traces-closeout-${artifact.id}`,
      relation: "traces_to",
      from: { kind: "artifact", id: artifact.id },
      to: { kind: "artifact", id: l4ArtifactId },
      rationale:
        "The human L5 closeout names the exact L4 evaluation capture. It is not an engine replay.",
    }],
    proposedActions: [{
      id: actionId,
      name: extensionName(input.capture.admission.consequence),
      kind: "review",
      readiness: "ready",
      rationale:
        "Human L5 closeout of the exact L4 evaluation capture. No OMC or SysON call. An L4 pass is not L5.",
      targets: [
        { kind: "artifact", id: l4ArtifactId },
        { kind: "artifact", id: artifact.id },
      ],
      addressesViolationIds: [],
      dependsOnActionIds: [],
    }],
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    extension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact admitted Modelica evaluation closeout is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function extensionName(
  consequence: AdmittedObservationEvaluationCloseoutAdmission["consequence"],
): string {
  return consequence === "accept"
    ? "Accept admitted Modelica evaluation"
    : "Reject admitted Modelica evaluation";
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): AdmittedObservationEvaluationCloseoutOperation {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = closeoutOperationOf(workItem?.operation);
  if (
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem || !operation ||
    workItem.operation?.bindings.length !== 1 ||
    workItem.operation.bindings[0]?.name !== "approvedBrief" ||
    workItem.operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to a human L5 admitted Modelica evaluation closeout with the sole approvedBrief binding.`,
    );
  }
  return operation;
}

function closeoutOperationOf(
  operation: { readonly id: string; readonly version: string } | undefined,
): AdmittedObservationEvaluationCloseoutOperation | undefined {
  if (
    operation?.id === DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.id &&
    operation.version ===
      DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION.version
  ) {
    return DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION;
  }
  if (
    operation?.id === DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.id &&
    operation.version ===
      DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION.version
  ) {
    return DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION;
  }
  return undefined;
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) throw invalidTransition(`Work item for run ${run.id} is absent.`);
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || !decision.inputFingerprint) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id && approval.status === "approved" &&
      decision.approvalIds.includes(approval.id) &&
      approval.decidedByOrigin === "human"
    );
    if (
      approvals.length === 1 &&
      decision.baseSnapshot?.snapshotId === basis.snapshotId
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      "No exact human-approved admitted Modelica evaluation closeout is bound to this run.",
    );
  }
  return candidates[0]!;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
  operation: AdmittedObservationEvaluationCloseoutOperation,
): AdmittedObservationEvaluationCloseoutAdmission {
  try {
    return parseAdmittedObservationEvaluationCloseoutParameters(
      parameters,
      operation,
    );
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Admitted Modelica evaluation closeout parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function exactBasisSnapshot(
  snapshots: CloseoutThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the evaluation closeout.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function completionCommand(
  command: DecideAdmittedModelicaEvaluationRunExecutorCommand,
  operation: AdmittedObservationEvaluationCloseoutOperation,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  consequence: AdmittedObservationEvaluationCloseoutAdmission["consequence"],
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, operation, "complete"),
    expectedRevision,
    summary: closeoutSummary(consequence, "completed"),
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function closeoutSummary(
  consequence: AdmittedObservationEvaluationCloseoutAdmission["consequence"],
  phase: "started" | "publishing" | "completed",
): string {
  const verb = consequence === "accept" ? "accept" : "reject";
  if (phase === "started") {
    return `Started the human ${verb} closeout of the admitted Modelica evaluation.`;
  }
  if (phase === "publishing") {
    return `Publishing the human ${verb} closeout of the admitted Modelica evaluation.`;
  }
  return `Recorded the human ${verb} closeout of the exact admitted Modelica evaluation.`;
}

function commandStep(
  commandId: string,
  operation: AdmittedObservationEvaluationCloseoutOperation,
  step: string,
): string {
  return `${commandId}:${operation.id}:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
