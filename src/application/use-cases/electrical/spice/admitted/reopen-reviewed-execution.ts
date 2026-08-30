/**
 * Read-only reopen of one reviewed admitted SPICE execution.
 *
 * Revalidates human MRTR, admission scope, and sealed compilation source.
 * Profiles come from `profiles.initial()`. Source bytes come only from
 * `compile.seal-admission@3`. Callers never supply SPICE text.
 */

import { COMPILATION_ADMISSION_BINDING_NAME } from "../../../../../domain/compile/admission/compilation-admission-run-operation.ts";
import {
  type ResolvedOperationPlanV2,
  SPICE_ADMITTED_ISOLATED_RESOURCE_PROFILE,
} from "../../../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { IsolatedCodeExecutionRequest } from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../../domain/kernel/deterministic-json.ts";
import { deriveAdmittedSpiceExecutionRunId } from "../../../../../domain/electrical/spice/admitted/execution-evidence.ts";
import {
  parseSpiceAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  type SpiceAdmittedRunAdmission,
} from "../../../../../domain/electrical/spice/admitted/run-proposal.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";
import type { TechnicalCompilationAdmissionReader } from "../../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type {
  AdmittedSpiceExecutionProfile,
  AdmittedSpiceExecutionProfileCatalog,
} from "../../../../ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import {
  isolatedRequestFromAdmittedSource,
  ReopenAdmittedCompilationSource,
} from "../../../compile/admission/reopen-admitted-compilation-source.ts";
import { EngineeringProjectCommandError } from "../../../project/engineering-project-command-service.ts";
import { PrepareProjectAdmittedSpiceRunReview } from "./prepare-run-review.ts";

export interface ReviewedAdmittedSpiceAuthority {
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
  readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
  readonly admission: SpiceAdmittedRunAdmission;
}

export interface AdmittedExecutionRequest {
  readonly admission: SpiceAdmittedRunAdmission;
  readonly executionProfile: AdmittedSpiceExecutionProfile;
  readonly request: IsolatedCodeExecutionRequest;
}

/**
 * Cross-check the ROP2 action with the independently reopened sealed
 * admission and fixed profile. The ROP guard validates the queue/MRTR/Thread
 * chain; this language boundary additionally refuses an action that no longer
 * names the exact SPICE source, documentary resources, recovery policy, or
 * code-owned request identity that it is about to execute.
 */
export async function assertResolvedAdmittedSpiceExecutionPlan(input: {
  readonly plan: ResolvedOperationPlanV2;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly admission: SpiceAdmittedRunAdmission;
  readonly execution: AdmittedExecutionRequest;
}): Promise<void> {
  const action = input.plan.action;
  const expectedExecutionRunId = await deriveAdmittedSpiceExecutionRunId(
    input.project.project.id,
    input.run.id,
  );
  if (
    action.kind !== "admitted-spice-isolated-execution" ||
    action.executionRunId !== expectedExecutionRunId ||
    input.execution.request.runId !== expectedExecutionRunId ||
    input.plan.run.projectId !== input.project.project.id ||
    input.plan.run.runId !== input.run.id ||
    deterministicJson(input.plan.operationalCapability) !==
      deterministicJson(input.operationalCapability)
  ) {
    throw invalidTransition(
      "The resolved operation plan does not name this exact admitted SPICE execution run and operational capability.",
    );
  }
  if (
    action.executionProfile.id !==
      input.execution.executionProfile.executionProfile.id ||
    action.executionProfile.version !==
      input.execution.executionProfile.executionProfile.version ||
    !fingerprintsEqual(
      action.executionProfile.fingerprint,
      input.execution.executionProfile.profileFingerprint,
    ) ||
    !fingerprintsEqual(
      input.admission.execution.profile.fingerprint,
      input.execution.executionProfile.profileFingerprint,
    )
  ) {
    throw invalidTransition(
      "The resolved operation plan execution profile differs from the exact reopened admitted SPICE profile.",
    );
  }
  const source = input.admission.compilation.source;
  const admission = action.input.compilationAdmission;
  const planSources = input.plan.sources.filter((candidate) =>
    candidate.bindingName === admission.sourceBinding
  );
  const planSource = planSources[0];
  if (
    admission.sourceBinding !== COMPILATION_ADMISSION_BINDING_NAME ||
    admission.id !== input.admission.admissionArtifact.id ||
    !fingerprintsEqual(
      admission.fingerprint,
      input.admission.admissionArtifact.fingerprint,
    ) ||
    action.input.source.id !== source.id ||
    !fingerprintsEqual(
      action.input.source.sourceFingerprint,
      source.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      action.input.source.captureFingerprint,
      source.captureFingerprint,
    ) ||
    !fingerprintsEqual(
      action.input.source.analysisFingerprint,
      source.analysisFingerprint,
    ) ||
    planSources.length !== 1 || !planSource ||
    planSource.threadRef.id !== input.admission.admissionArtifact.id ||
    !fingerprintsEqual(
      planSource.artifact.fingerprint,
      input.admission.admissionArtifact.fingerprint,
    )
  ) {
    throw invalidTransition(
      "The resolved operation plan source binding differs from the exact admitted SPICE source.",
    );
  }
  const resources = input.plan.expectedProviderResources;
  const recovery = input.plan.recovery;
  if (
    resources.resourceProfile.id !== SPICE_ADMITTED_ISOLATED_RESOURCE_PROFILE.id ||
    resources.resourceProfile.version !==
      SPICE_ADMITTED_ISOLATED_RESOURCE_PROFILE.version ||
    !("receiptSchema" in resources) ||
    resources.receiptSchema !== "isolated-code-execution-receipt-record/1.0" ||
    resources.evidenceSchema !== "spice-admitted-execution-capture/1.0" ||
    recovery.policy !== "spice-admitted-generation-recovery@1.0" ||
    recovery.executionRunId !== expectedExecutionRunId ||
    recovery.mode !== "same-request-readback-no-blind-redispatch" ||
    recovery.ambiguousOutcome !== "quarantine-for-human-review" ||
    recovery.capturedOutcome !== "cas-only-recovery"
  ) {
    throw invalidTransition(
      "The resolved operation plan resources or recovery contract differs from admitted SPICE @1.",
    );
  }
}

export async function reopenAdmittedExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedSpiceExecutionProfileCatalog;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly admission: SpiceAdmittedRunAdmission;
}): Promise<AdmittedExecutionRequest> {
  const basis = requireThreadSnapshotBasis(input.run);
  const review = await new PrepareProjectAdmittedSpiceRunReview({
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
      "The reopened admitted SPICE review differs from the signed MRTR.",
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
      expectedTarget: "spice-circuit-source",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready SPICE compilation.",
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
      "The reopened SPICE source is not the signed admission.",
    );
  }
  const profile = await input.profiles.initial();
  const executionRunId = await deriveAdmittedSpiceExecutionRunId(
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
 * Reopen one already-dispatched execution from its WAL-sealed execution
 * profile. Terminal replay must never reinterpret a durable result through a
 * replacement catalog profile; source bytes are still reopened from the
 * sealed compilation admission.
 */
export async function reopenRecordedAdmittedSpiceExecutionRequest(input: {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly admission: SpiceAdmittedRunAdmission;
  readonly executionProfile: AdmittedSpiceExecutionProfile;
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
      expectedTarget: "spice-circuit-source",
    });
  } catch {
    throw invalidTransition(
      "The reopened admission is not a ready SPICE compilation.",
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
      "The reopened SPICE source is not the signed admission.",
    );
  }
  const executionRunId = await deriveAdmittedSpiceExecutionRunId(
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

export function requireAdmittedSpiceExecutionShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings[0];
  if (
    run.basis?.kind !== "thread-snapshot" ||
    run.baseSnapshot !== undefined || run.resolvedOperationPlan === undefined ||
    !workItem || operation?.id !== SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id ||
    operation.version !== SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version ||
    workItem.decisionIds.length !== 1 ||
    operation.bindings.length !== 1 ||
    binding?.name !== COMPILATION_ADMISSION_BINDING_NAME ||
    binding.source.kind !== "thread-entity" ||
    binding.source.reference.kind !== "artifact"
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to simulate.run-admitted-spice@1 with compilationAdmission.`,
    );
  }
}

export async function requireReviewedAdmittedSpiceAuthority(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<ReviewedAdmittedSpiceAuthority> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem || workItem.decisionIds.length !== 1) {
    throw invalidTransition(
      "The admitted SPICE work item must name exactly one decision.",
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
      "The admitted SPICE run requires one exact approved MRTR decision over one admission artifact.",
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
      "The admitted SPICE decision must have one matching human approval on the exact run basis and admission evidence.",
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
      "The admitted SPICE decision fingerprint no longer seals its exact basis, evidence, summary and parameters.",
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
      "The admitted SPICE run fingerprint no longer seals its sole MRTR decision, operation and basis.",
    );
  }
  let admission: SpiceAdmittedRunAdmission;
  try {
    admission = parseSpiceAdmittedRunAdmissionParameters(
      decision.proposal.parameters,
    );
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Admitted SPICE decision parameters failed exact closed-schema validation.",
    );
  }
  return { decision, approval, proposal: decision.proposal, admission };
}

export function assertAdmittedSpiceAdmissionScope(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  decision: EngineeringDecision,
  admission: SpiceAdmittedRunAdmission,
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
      "The admitted SPICE binding, MRTR evidence, and admission artifact disagree.",
    );
  }
}

export function assertSameReviewedAdmittedSpiceAuthority(
  expected: ReviewedAdmittedSpiceAuthority,
  actual: ReviewedAdmittedSpiceAuthority,
): void {
  if (deterministicJson(expected) !== deterministicJson(actual)) {
    throw invalidTransition(
      "The exact human-approved admitted SPICE authority changed during execution.",
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
