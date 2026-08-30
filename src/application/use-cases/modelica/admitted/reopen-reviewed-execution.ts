/**
 * Read-only reopen of one reviewed admitted Modelica execution.
 *
 * Revalidates human MRTR, admission scope, and sealed compilation source.
 * Profiles come from `profiles.initial()`. Source bytes come only from
 * `compile.seal-admission@3`. Callers never supply Modelica text.
 */

import { COMPILATION_ADMISSION_BINDING_NAME } from "../../../../domain/compile/admission/compilation-admission-run-operation.ts";
import {
  MODELICA_ADMITTED_ISOLATED_RESOURCE_PROFILE,
  type ResolvedOperationPlanV2,
} from "../../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { IsolatedCodeExecutionRequest } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { deriveAdmittedModelicaExecutionRunId } from "../../../../domain/modelica/admitted/execution-evidence.ts";
import {
  type ModelicaAdmittedRunAdmission,
  parseModelicaAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
} from "../../../../domain/modelica/admitted/run-proposal.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  AdmittedModelicaExecutionProfile,
  AdmittedModelicaExecutionProfileCatalog,
} from "../../../ports/out/modelica/admitted-execution-profile-catalog.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "../../compile/admission/reopen-admitted-compilation-source.ts";
import { EngineeringProjectCommandError } from "../../project/engineering-project-command-service.ts";
import { PrepareProjectAdmittedModelicaRunReview } from "./prepare-run-review.ts";

export interface ReviewedAdmittedModelicaAuthority {
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  readonly admission: ModelicaAdmittedRunAdmission;
}

export interface AdmittedExecutionRequest {
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly executionProfile: AdmittedModelicaExecutionProfile;
  readonly request: IsolatedCodeExecutionRequest;
}

export async function reopenAdmittedExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedModelicaExecutionProfileCatalog;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly admission: ModelicaAdmittedRunAdmission;
}): Promise<AdmittedExecutionRequest> {
  const basis = requireThreadSnapshotBasis(input.run);
  const review = await new PrepareProjectAdmittedModelicaRunReview({
    admissions: input.admissions,
    profiles: input.profiles,
  }).execute({
    projectId: input.project.project.id,
    basis,
    artifactId: input.admission.admissionArtifact.id,
    artifactFingerprint: input.admission.admissionArtifact.fingerprint,
  });
  if (deterministicJson(review.admission) !== deterministicJson(input.admission)) {
    throw invalidTransition(
      "The reopened admitted Modelica review differs from the signed MRTR.",
    );
  }
  let admitted;
  try {
    admitted = await new ReopenAdmittedCompilationSource({
      admissions: input.admissions,
    }).execute({
      projectId: input.project.project.id,
      basis,
      artifactId: input.admission.admissionArtifact.id,
      artifactFingerprint: input.admission.admissionArtifact.fingerprint,
      expectedTarget: "modelica-source-qualification",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready Modelica compilation.",
    );
  }
  if (
    !fingerprintsEqual(
      admitted.sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      admitted.documentFingerprint,
      input.admission.compilation.document.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reopened Modelica source is not the signed admission.",
    );
  }
  const profile = await input.profiles.initial();
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  const request = await isolatedRequestFromAdmittedSource({
    runId: executionRunId,
    sourceText: admitted.sourceText,
    sourceSha256: admitted.sourceFingerprint.digest,
    profile: profile.executionProfile,
    policy: profile.isolationPolicy,
    outputs: profile.outputManifest,
    maximumSourceBytes: profile.maximumSourceBytes,
  });
  return {
    admission: review.admission,
    executionProfile: profile,
    request,
  };
}

/**
 * Reopen a previously dispatched execution from the exact profile sealed in
 * its durable attempt. A terminal replay must not reinterpret recorded
 * evidence through the current catalog profile after a catalog rollover.
 */
export async function reopenRecordedAdmittedModelicaExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly executionProfile: AdmittedModelicaExecutionProfile;
}): Promise<AdmittedExecutionRequest> {
  const basis = requireThreadSnapshotBasis(input.run);
  let admitted;
  try {
    admitted = await new ReopenAdmittedCompilationSource({
      admissions: input.admissions,
    }).execute({
      projectId: input.project.project.id,
      basis,
      artifactId: input.admission.admissionArtifact.id,
      artifactFingerprint: input.admission.admissionArtifact.fingerprint,
      expectedTarget: "modelica-source-qualification",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready Modelica compilation.",
    );
  }
  if (
    !fingerprintsEqual(
      admitted.sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      admitted.documentFingerprint,
      input.admission.compilation.document.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The reopened Modelica source is not the signed admission.",
    );
  }
  const executionRunId = await deriveAdmittedModelicaExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  const request = await isolatedRequestFromAdmittedSource({
    runId: executionRunId,
    sourceText: admitted.sourceText,
    sourceSha256: admitted.sourceFingerprint.digest,
    profile: input.executionProfile.executionProfile,
    policy: input.executionProfile.isolationPolicy,
    outputs: input.executionProfile.outputManifest,
    maximumSourceBytes: input.executionProfile.maximumSourceBytes,
  });
  return {
    admission: input.admission,
    executionProfile: input.executionProfile,
    request,
  };
}

export function requireAdmittedModelicaExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.baseSnapshot !== undefined || run.resolvedOperationPlan === undefined ||
    !workItem || operation?.id !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id ||
    operation.version !== SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version ||
    workItem.decisionIds.length !== 1 ||
    operation.bindings.length !== 1 ||
    binding?.name !== COMPILATION_ADMISSION_BINDING_NAME ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to simulate.run-admitted-modelica@1 with compilationAdmission.`,
    );
  }
}

/**
 * The ROP parser validates the closed action grammar. This recrosses its
 * semantic Modelica action with the independently reopened MRTR/admission
 * bytes and server-owned profile before the executor can claim a WAL entry.
 */
export function assertResolvedAdmittedModelicaExecutionPlan(input: {
  readonly run: EngineeringAgentRun;
  readonly plan: ResolvedOperationPlanV2;
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly execution: AdmittedExecutionRequest;
}): void {
  const action = input.plan.action;
  if (
    action.kind !== "admitted-modelica-isolated-execution" ||
    action.executionRunId !== input.execution.request.runId ||
    action.input.compilationAdmission.id !== input.admission.admissionArtifact.id ||
    !fingerprintsEqual(
      action.input.compilationAdmission.fingerprint,
      input.admission.admissionArtifact.fingerprint,
    ) ||
    action.input.compilationAdmission.sourceBinding !==
      COMPILATION_ADMISSION_BINDING_NAME ||
    action.input.source.id !== input.admission.compilation.source.id ||
    !fingerprintsEqual(
      action.input.source.sourceFingerprint,
      input.admission.compilation.source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      action.input.source.captureFingerprint,
      input.admission.compilation.source.captureFingerprint,
    ) ||
    !fingerprintsEqual(
      action.input.source.analysisFingerprint,
      input.admission.compilation.source.analysisFingerprint,
    ) ||
    action.executionProfile.id !==
      input.execution.executionProfile.executionProfile.id ||
    action.executionProfile.version !==
      input.execution.executionProfile.executionProfile.version ||
    !fingerprintsEqual(
      action.executionProfile.fingerprint,
      input.execution.executionProfile.profileFingerprint,
    ) ||
    input.plan.expectedProviderResources.resourceProfile.id !==
      MODELICA_ADMITTED_ISOLATED_RESOURCE_PROFILE.id ||
    input.plan.expectedProviderResources.resourceProfile.version !==
      MODELICA_ADMITTED_ISOLATED_RESOURCE_PROFILE.version ||
    !("receiptSchema" in input.plan.expectedProviderResources) ||
    input.plan.expectedProviderResources.receiptSchema !==
      "isolated-code-execution-receipt-record/1.0" ||
    input.plan.expectedProviderResources.evidenceSchema !==
      "modelica-admitted-execution-capture/2.0" ||
    input.plan.recovery.policy !==
      "modelica-admitted-generation-recovery@1.0" ||
    !("executionRunId" in input.plan.recovery) ||
    input.plan.recovery.executionRunId !== action.executionRunId ||
    input.plan.operationalCapability.projectId !== input.plan.run.projectId ||
    input.plan.operationalCapability.operation.id !==
      SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id ||
    input.plan.operationalCapability.operation.version !==
      SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version ||
    input.plan.run.runId !== input.run.id
  ) {
    throw invalidTransition(
      "The resolved admitted Modelica execution plan does not match the exact reopened admission, source, profile, outputs, recovery, or operational capability.",
    );
  }
}

export async function requireReviewedAdmittedModelicaAuthority(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<ReviewedAdmittedModelicaAuthority> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem || workItem.decisionIds.length !== 1) {
    throw invalidTransition(
      "The admitted Modelica work item must name exactly one decision.",
    );
  }
  const decision = project.decisions.find((item) =>
    item.id === workItem.decisionIds[0]
  );
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || decision.inputEvidenceRefs.length !== 1 ||
    decision.inputEvidenceRefs[0]?.kind !== "artifact" ||
    decision.approvalIds.length !== 1
  ) {
    throw invalidTransition(
      "The admitted Modelica run requires one exact approved MRTR decision over one admission artifact.",
    );
  }
  const approvals = project.approvals.filter((item) => item.decisionId === decision.id);
  const approval = approvals[0];
  const basis = requireThreadSnapshotBasis(run);
  if (
    approvals.length !== 1 || !approval ||
    approval.id !== decision.approvalIds[0] ||
    approval.status !== "approved" ||
    approval.decidedByOrigin !== "human" ||
    typeof approval.decidedBy !== "string" || approval.decidedBy.trim() === "" ||
    typeof approval.decidedAt !== "string" ||
    Number.isNaN(Date.parse(approval.decidedAt)) ||
    !approval.inputFingerprint ||
    !sameSnapshotBasis(decision.baseSnapshot, basis) ||
    !sameSnapshotBasis(approval.baseSnapshot, basis) ||
    !evidenceRefsEqual(approval.inputEvidenceRefs, decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalidTransition(
      "The admitted Modelica decision must have one matching human approval on the exact run basis and admission evidence.",
    );
  }
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecisionFingerprint, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted Modelica decision fingerprint no longer seals its exact basis, evidence, summary and parameters.",
    );
  }
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The admitted Modelica run fingerprint no longer seals its sole MRTR decision, operation and basis.",
    );
  }
  let admission: ModelicaAdmittedRunAdmission;
  try {
    admission = parseModelicaAdmittedRunAdmissionParameters(
      decision.proposal.parameters,
    );
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Admitted Modelica decision parameters failed exact closed-schema validation.",
    );
  }
  return { decision, approval, proposal: decision.proposal, admission };
}

export function assertAdmittedModelicaAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: ModelicaAdmittedRunAdmission,
): void {
  const basis = requireThreadSnapshotBasis(run);
  const evidence = decision.inputEvidenceRefs[0];
  const workItem = project.workItems.find((item) => item.id === run.workItemId)!;
  const binding = workItem.operation!.bindings[0]!;
  if (
    decision.inputEvidenceRefs.length !== 1 || evidence?.kind !== "artifact" ||
    evidence.snapshotId !== basis.snapshotId ||
    evidence.snapshotRevision !== basis.revision ||
    evidence.id !== admission.admissionArtifact.id ||
    binding.source.kind !== "thread-entity" ||
    deterministicJson(binding.source.reference) !== deterministicJson(evidence)
  ) {
    throw invalidTransition(
      "The admitted Modelica binding, MRTR evidence, and admission artifact disagree.",
    );
  }
}

export function assertSameReviewedAdmittedModelicaAuthority(
  expected: ReviewedAdmittedModelicaAuthority,
  actual: ReviewedAdmittedModelicaAuthority,
): void {
  if (deterministicJson(expected) !== deterministicJson(actual)) {
    throw invalidTransition(
      "The exact human-approved admitted Modelica authority changed during execution.",
    );
  }
}

function requireThreadSnapshotBasis(
  run: EngineeringAgentRun,
): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Agent run ${run.id} must have an exact ThreadSnapshot basis.`,
    );
  }
  return run.basis;
}

function sameSnapshotBasis(
  candidate: EngineeringDecision["baseSnapshot"],
  expected: EngineeringThreadSnapshotBasis,
): boolean {
  return candidate?.snapshotId === expected.snapshotId &&
    candidate.revision === expected.revision &&
    candidate.subjectId === expected.subjectId;
}

function evidenceRefsEqual(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
