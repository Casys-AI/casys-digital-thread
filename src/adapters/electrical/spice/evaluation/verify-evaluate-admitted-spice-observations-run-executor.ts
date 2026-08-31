/**
 * Trusted executor for `verify.evaluate-admitted-spice-observations@1`.
 *
 * The comparator is a server-owned closed method over exact native ngspice L3
 * observations. SysON is never called. An L4 pass is not L5.
 */

import type { EngineeringProjectCommandOrigin } from "../../../../application/ports/in/engineering-project-command-origin.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../../application/ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvidenceReader } from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import type { AdmittedSpiceObservationEvaluationCaptureStore } from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evaluation-capture-store.ts";
import type { EngineeringProjectRevisionStore } from "../../../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  evaluateAdmittedSpiceObservations,
  fingerprintSpiceAdmittedObservationEvaluationMethod,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import {
  parseSpiceAdmittedObservationEvaluationParameters,
  type SpiceAdmittedObservationEvaluationAdmission,
  VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
} from "../../../../domain/electrical/observation-method-sheet.ts";
import { resolveAdmittedSpiceEvaluationLineage } from "../../../../domain/electrical/spice/evaluation/lineage.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../../shared/thread-write-basis-guard.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  validateElectricalObservationMethodSheetSealCapture,
} from "../../../../domain/electrical/observation-method-sheet-seal-capture.ts";
import type { ElectricalObservationMethodSheetSealCaptureStore } from "../../observation-method-sheet/verify-seal-electrical-observation-method-sheet-run-executor.ts";
import {
  canonicalSpiceAdmittedObservationEvaluationCaptureText,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
  type SpiceAdmittedObservationEvaluationCapture,
  validateSpiceAdmittedObservationEvaluationCapture,
} from "./admitted-spice-observation-evaluation-capture.ts";
import { buildAdmittedSpiceObservationEvaluationSuccessor } from "./admitted-spice-observation-evaluation-successor.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";

export { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION };

export interface EvaluationThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifyEvaluateAdmittedSpiceObservationsRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: EvaluationThreadSnapshotStore;
  readonly sheets: ElectricalObservationMethodSheetStore;
  readonly sheetCaptures: ElectricalObservationMethodSheetSealCaptureStore;
  readonly evidence: AdmittedSpiceObservationEvidenceReader;
  readonly captures: AdmittedSpiceObservationEvaluationCaptureStore;
  readonly lease: EngineeringProjectRunLease;
}

const CLAIM_SUMMARY = "Started the admitted SPICE observation evaluation." as const;
const PUBLISH_SUMMARY =
  "Publishing the admitted SPICE observation evaluation." as const;
const COMPLETE_SUMMARY = "Evaluated the exact admitted SPICE observations." as const;

export class VerifyEvaluateAdmittedSpiceObservationsRunExecutor {
  constructor(
    private readonly dependencies:
      VerifyEvaluateAdmittedSpiceObservationsRunExecutorDependencies,
  ) {}

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute an admitted SPICE observation evaluation.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const approval = await requireMrtrApproval(project, run);
    const admission = parseAdmission(approval.proposal.parameters);
    return await this.dependencies.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, admission),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
    admission: SpiceAdmittedObservationEvaluationAdmission,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let publicationStarted = false;
    try {
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      publicationStarted = run.status === "publishing";
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
      await assertAdmissionScope(
        admission,
        command.projectId,
        basis,
        basisSnapshot,
        this.dependencies.sheets,
        this.dependencies.sheetCaptures,
      );

      const firstClaim = run.status === "queued";
      if (firstClaim) {
        await this.dependencies.commands.claimRun(origin, claimCommand(command));
        claimed = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        await this.#replayClaim(origin, command);
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") return project;
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      const currentAdmission = parseAdmission(currentApproval.proposal.parameters);
      if (deterministicJson(currentAdmission) !== deterministicJson(admission)) {
        throw invalidTransition(
          "The human-reviewed admitted SPICE observation evaluation parameters changed after the run was claimed.",
        );
      }
      if (run.status === "publishing") {
        return await this.#resumePublishing(
          origin,
          command,
          currentAdmission,
          basisSnapshot,
          run,
        );
      }

      const dispatch = await this.#evaluate(currentAdmission, basisSnapshot, run);
      const captureText = canonicalSpiceAdmittedObservationEvaluationCaptureText(
        dispatch.capture,
      );
      const captureFingerprint = await sha256Fingerprint(dispatch.capture);
      await this.dependencies.captures.save(captureFingerprint, captureText);
      const readback = await this.dependencies.captures.read(captureFingerprint);
      if (readback === undefined || readback !== captureText) {
        throw invalidTransition(
          "The admitted SPICE observation evaluation capture was not durably readable after save.",
        );
      }
      const successor = buildAdmittedSpiceObservationEvaluationSuccessor({
        basisSnapshot,
        basis,
        run,
        capture: dispatch.capture,
        captureFingerprint,
        sheet: dispatch.sheet,
        methodSheetFingerprint: dispatch.sheetFingerprint,
        evaluation: dispatch.evaluation,
        lineage: dispatch.lineage,
      });
      await this.dependencies.snapshots.save(successor.snapshot);
      publicationStarted = true;
      project = await this.#requiredProject(command.projectId);
      await this.#publishExact(origin, project, command);
      project = await this.#requiredProject(command.projectId);
      await this.#completeExact(origin, project, command, successor);
      return await this.#requiredProject(command.projectId);
    } catch (error) {
      if (claimed && !publicationStarted) {
        try {
          const failed = await this.#requiredProject(command.projectId);
          const failedRun = requireRun(failed, command.runId);
          if (failedRun.status === "running") {
            await this.dependencies.commands.failRun(origin, {
              ...command,
              commandId: commandStep(command.commandId, "fail"),
              expectedRevision: failed.revision,
              summary:
                "Admitted SPICE observation evaluation stopped before Thread publication.",
              code: "verify-evaluate-admitted-spice-observations-not-published",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } catch {
          // Preserve the original failure.
        }
      }
      throw error;
    }
  }

  async #evaluate(
    admission: SpiceAdmittedObservationEvaluationAdmission,
    snapshot: ThreadSnapshot,
    run: EngineeringAgentRun,
  ) {
    const sheet = await this.dependencies.sheets.read(admission.sheet.fingerprint);
    if (!sheet) {
      throw invalidTransition(
        "The exact electrical observation method sheet is unavailable.",
      );
    }
    const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(sheet);
    if (!fingerprintsEqual(sheetFingerprint, admission.sheet.fingerprint)) {
      throw invalidTransition(
        "The reopened electrical observation method sheet does not match the signed fingerprint.",
      );
    }
    const lineage = await resolveExactEvaluationLineage(
      snapshot,
      sheet,
      admission,
      this.dependencies.sheetCaptures,
    );
    const evidence = await this.dependencies.evidence.read(
      admission.result.fingerprint,
    );
    if (!evidence) {
      throw invalidTransition("The exact admitted SPICE result is unavailable.");
    }
    const evaluation = await evaluateAdmittedSpiceObservations(
      sheet,
      evidence.observables,
    );
    const methodFingerprint = await fingerprintSpiceAdmittedObservationEvaluationMethod(
      evaluation.method,
    );
    if (!fingerprintsEqual(methodFingerprint, admission.methodFingerprint)) {
      throw invalidTransition(
        "The derived evaluation method fingerprint does not match the signed admission.",
      );
    }
    const capture: SpiceAdmittedObservationEvaluationCapture = {
      schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
      kind: "spice-admitted-observation-evaluation",
      operation: {
        id: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id,
        version: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version,
      },
      overall: evaluation.overall,
      evaluations: evaluation.evaluations,
      limitations: SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
    };
    return {
      capture: validateSpiceAdmittedObservationEvaluationCapture(capture),
      sheet,
      sheetFingerprint,
      evaluation,
      lineage,
      run,
    };
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

  async #resumePublishing(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
    admission: SpiceAdmittedObservationEvaluationAdmission,
    basisSnapshot: ThreadSnapshot,
    run: EngineeringAgentRun,
  ): Promise<EngineeringProjectSnapshot> {
    const dispatch = await this.#evaluate(admission, basisSnapshot, run);
    const captureText = canonicalSpiceAdmittedObservationEvaluationCaptureText(
      dispatch.capture,
    );
    const captureFingerprint = await sha256Fingerprint(dispatch.capture);
    const readback = await this.dependencies.captures.read(captureFingerprint);
    if (readback === undefined || readback !== captureText) {
      throw invalidTransition(
        "The publishing admitted SPICE observation evaluation capture is unavailable for successor reconstruction.",
      );
    }
    const successor = buildAdmittedSpiceObservationEvaluationSuccessor({
      basisSnapshot,
      basis: requireBasis(run),
      run,
      capture: dispatch.capture,
      captureFingerprint,
      sheet: dispatch.sheet,
      methodSheetFingerprint: dispatch.sheetFingerprint,
      evaluation: dispatch.evaluation,
      lineage: dispatch.lineage,
    });
    await this.#assertSavedSuccessor(successor.snapshot);
    let project = await this.#requiredProject(command.projectId);
    await this.#publishExact(origin, project, command);
    project = await this.#requiredProject(command.projectId);
    await this.#completeExact(origin, project, command, successor);
    return await this.#requiredProject(command.projectId);
  }

  async #replayClaim(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
  ): Promise<void> {
    const project = await this.#requiredProject(command.projectId);
    const receipt = exactCommandReceipt(
      project,
      commandStep(command.commandId, "claim"),
      "agent-run.claim",
      origin,
    );
    const exactClaim = claimCommand(
      command,
      receipt.resultingSnapshot.revision - 1,
      receipt.issuedAt,
    );
    const claimedRun = requireRun(project, command.runId);
    if (
      claimedRun.claimedAt !== receipt.appliedAt ||
      claimedRun.startedAt !== receipt.appliedAt
    ) {
      throw invalidTransition(
        "The admitted SPICE observation evaluation claim receipt does not seal the run's exact claimed/start timeline.",
      );
    }
    await this.dependencies.commands.claimRun(origin, exactClaim);
  }

  async #publishExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "publishing" || run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, "publish"),
        "agent-run.publish",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
    } else if (run.status !== "running") {
      throw unexpectedStatus(run, "running, publishing, or completed");
    }
    await this.dependencies.commands.publishRun(origin, {
      ...command,
      commandId: commandStep(command.commandId, "publish"),
      expectedRevision,
      issuedAt,
      summary: PUBLISH_SUMMARY,
    });
  }

  async #completeExact(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
    successor: { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact },
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    let expectedRevision = project.revision;
    let issuedAt = command.issuedAt;
    if (run.status === "completed") {
      const receipt = exactCommandReceipt(
        project,
        commandStep(command.commandId, "complete"),
        "agent-run.complete",
        origin,
      );
      expectedRevision = receipt.resultingSnapshot.revision - 1;
      issuedAt = receipt.issuedAt;
    }
    await this.dependencies.commands.completeRun(
      origin,
      completionCommand(
        command,
        expectedRevision,
        successor.snapshot,
        successor.artifact,
        issuedAt,
      ),
    );
  }

  async #assertSavedSuccessor(snapshot: ThreadSnapshot): Promise<void> {
    const readback = await this.dependencies.snapshots.getFresh(snapshot.id);
    if (!readback || deterministicJson(readback) !== deterministicJson(snapshot)) {
      throw invalidTransition(
        "The admitted SPICE observation evaluation ThreadSnapshot was not durably readable.",
      );
    }
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id ||
    operation.version !==
      VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version ||
    operation.bindings.length !== 1 ||
    operation.bindings[0]?.name !== "approvedBrief" ||
    operation.bindings[0].source.kind !== "approved-brief"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to ${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id}@${VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version} with the sole approvedBrief binding.`,
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "This executor may continue only the exact admitted SPICE observation evaluation it claimed.",
    );
  }
}

async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
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
      approval.decidedByOrigin === "human" &&
      typeof approval.decidedBy === "string" &&
      approval.decidedBy.trim().length > 0 &&
      typeof approval.decidedAt === "string" &&
      !Number.isNaN(Date.parse(approval.decidedAt)) &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      candidates.length === 0
        ? "No exact human-approved admitted SPICE observation evaluation decision is bound to this run basis."
        : "Ambiguous admitted SPICE observation evaluation MRTR: exactly one human-approved decision is required.",
    );
  }
  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(expectedDecisionFingerprint, selected.decision.inputFingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted SPICE observation evaluation decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (!decision?.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted SPICE observation evaluation run fingerprint no longer seals its exact MRTR decision, operation, and basis.",
    );
  }
  return selected;
}

function parseAdmission(
  parameters: NonNullable<EngineeringDecision["proposal"]>["parameters"],
): SpiceAdmittedObservationEvaluationAdmission {
  try {
    return parseSpiceAdmittedObservationEvaluationParameters(parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Admitted SPICE observation evaluation parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function assertAdmissionScope(
  admission: SpiceAdmittedObservationEvaluationAdmission,
  projectId: string,
  basis: ReturnType<typeof requireBasis>,
  snapshot: ThreadSnapshot,
  sheets: ElectricalObservationMethodSheetStore,
  sheetCaptures: ElectricalObservationMethodSheetSealCaptureStore,
): Promise<void> {
  if (admission.projectId !== projectId) {
    throw invalidTransition(
      "The signed admitted SPICE observation evaluation belongs to another project.",
    );
  }
  if (
    admission.subjectId !== basis.subjectId ||
    admission.basis.snapshotId !== basis.snapshotId ||
    admission.basis.revision !== basis.revision ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The signed admitted SPICE observation evaluation basis is not the exact run Thread revision and subject.",
    );
  }
  const snapshotFingerprint = await sha256Fingerprint(snapshot);
  if (!fingerprintsEqual(snapshotFingerprint, admission.basis.fingerprint)) {
    throw invalidTransition(
      "The Thread basis fingerprint no longer matches the signed admission.",
    );
  }
  const sheet = await sheets.read(admission.sheet.fingerprint);
  if (!sheet) {
    throw invalidTransition(
      "The exact electrical observation method sheet is unavailable.",
    );
  }
  await resolveExactEvaluationLineage(
    snapshot,
    sheet,
    admission,
    sheetCaptures,
  );
}

async function resolveExactEvaluationLineage(
  snapshot: ThreadSnapshot,
  sheet: ElectricalObservationMethodSheet,
  admission: SpiceAdmittedObservationEvaluationAdmission,
  sheetCaptures: ElectricalObservationMethodSheetSealCaptureStore,
) {
  const lineage = resolveAdmittedSpiceEvaluationLineage(snapshot, sheet, {
    captureFingerprint: admission.capture.fingerprint,
    evidenceFingerprint: admission.evidence.fingerprint,
    resultFingerprint: admission.result.fingerprint,
  });
  const expectedUri =
    `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${lineage.methodSheet.fingerprint.digest}`;
  if (lineage.methodSheet.uri !== expectedUri) {
    throw invalidTransition(
      "The sealed electrical observation method-sheet URI is not canonical.",
    );
  }
  const stored = await sheetCaptures.read(lineage.methodSheet.fingerprint);
  if (stored === undefined) {
    throw invalidTransition(
      "The exact sealed electrical observation method-sheet capture is unavailable.",
    );
  }
  let seal;
  try {
    seal = validateElectricalObservationMethodSheetSealCapture(JSON.parse(stored));
  } catch {
    throw invalidTransition(
      "The reopened electrical observation method-sheet capture is invalid.",
    );
  }
  const sealFingerprint = await sha256Fingerprint(seal);
  if (
    stored !== deterministicJson(seal) ||
    !fingerprintsEqual(sealFingerprint, lineage.methodSheet.fingerprint) ||
    seal.sheet.id !== sheet.id ||
    !fingerprintsEqual(seal.sheet.fingerprint, admission.sheet.fingerprint)
  ) {
    throw invalidTransition(
      "The sealed electrical observation method sheet does not recross the signed sheet identity.",
    );
  }
  return lineage;
}

async function exactBasisSnapshot(
  snapshots: EvaluationThreadSnapshotStore,
  basis: ReturnType<typeof requireBasis>,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact Thread basis snapshot is not available for the admitted SPICE observation evaluation.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function claimCommand(
  command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
  expectedRevision?: number,
  issuedAt?: string,
) {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
    ...(issuedAt === undefined ? {} : { issuedAt }),
    summary: CLAIM_SUMMARY,
  };
}

function completionCommand(
  command: VerifyEvaluateAdmittedSpiceObservationsRunExecutorCommand,
  expectedRevision: number,
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  issuedAt?: string,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    ...(issuedAt === undefined ? {} : { issuedAt }),
    summary: COMPLETE_SUMMARY,
    resultSnapshot: snapshotRef(snapshot),
    evidenceRefs: [{
      snapshotId: snapshot.id,
      snapshotRevision: snapshot.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

function exactCommandReceipt(
  project: EngineeringProjectSnapshot,
  commandId: string,
  type: EngineeringProjectCommandReceipt["type"],
  origin: EngineeringProjectCommandOrigin,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === commandId && receipt.type === type
    ) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt ||
    receipt.actor.id !== origin.actorId || receipt.actor.origin !== origin.kind
  ) {
    throw invalidTransition(
      `The admitted SPICE observation evaluation has no exact ${type} receipt.`,
    );
  }
  return receipt;
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:verify-evaluate-admitted-spice-observations:${step}`;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: ReturnType<typeof requireBasis>,
): boolean {
  return !!value && "snapshotId" in value &&
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
