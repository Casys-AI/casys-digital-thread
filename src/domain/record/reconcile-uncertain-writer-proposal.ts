import type {
  EngineeringAgentRun,
  EngineeringDecisionProposalParameter,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../kernel/deterministic-json.ts";
import { SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE } from "../architecture/seed/syson-model-seed.ts";
import {
  VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
} from "../mechanism/prescribed-kinematics/operations.ts";

/** The reviewed MRTR operation that may annotate a terminal uncertain writer. */
export const RECONCILE_UNCERTAIN_WRITER_OPERATION = {
  id: "record.reconcile-uncertain-writer",
  version: "1",
} as const;

/** Failure codes whose provider write outcome must remain quarantined. */
export const TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES: ReadonlySet<string> = new Set([
  SYSON_MODEL_SEED_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  VERIFY_RUN_PRESCRIBED_KINEMATICS_PROVIDER_OUTCOME_UNKNOWN_FAILURE,
  "model-write-architecture-provider-outcome-unknown",
  "model-write-architecture-post-acknowledgement-quarantined",
  "model-write-architecture-quarantine-write-failed",
  "model-write-requirements-provider-outcome-unknown",
  "model-write-requirements-post-acknowledgement-quarantined",
  "model-write-requirements-quarantine-write-failed",
  "verify-run-fea-static-proof-provider-outcome-unknown",
  "verify-run-fea-static-proof-post-acknowledgement-quarantined",
  "verify-run-fea-static-proof-quarantine-write-failed",
  "simulate-modelica-scenario-outcome-unknown",
  "simulate-modelica-scenario-post-acknowledgement-quarantined",
]);

export type ReconcileUncertainWriterOutcome =
  | "provider-did-not-write"
  | "write-effect-accepted";

export interface ReconcileUncertainWriterProposal {
  readonly failedRunId: string;
  readonly failureCode: string;
  readonly basisSnapshotId: string;
  readonly outcome: ReconcileUncertainWriterOutcome;
  readonly providerInspectionAttestation: string;
}

export interface ApprovedUncertainWriterReconciliation {
  readonly decisionId: string;
  readonly decidedBy: string;
}

const REQUIRED_KEYS = [
  "reconcileAction",
  "reconcileOperation",
  "reconcileRunId",
  "reconcileFailureCode",
  "reconcileBasisSnapshotId",
  "reconcileOutcome",
  "reconcileAttestation",
] as const;

/**
 * Parse the complete reconciliation MRTR grammar once, before both proposal
 * recording and execution.  A Map is deliberately not used: it would make a
 * duplicate key silently select the final value and therefore change what the
 * human saw without changing the executor's apparent input.
 */
export function parseReconcileUncertainWriterProposal(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReconcileUncertainWriterProposal {
  const values = new Map<string, string>();
  for (const parameter of parameters) {
    if (!REQUIRED_KEYS.includes(parameter.key as typeof REQUIRED_KEYS[number])) {
      throw new Error(`Unknown reconciliation parameter "${parameter.key}".`);
    }
    if (values.has(parameter.key)) {
      throw new Error(`Reconciliation parameter "${parameter.key}" is duplicated.`);
    }
    if (typeof parameter.value !== "string" || !parameter.value.trim()) {
      throw new Error(
        `Reconciliation parameter "${parameter.key}" must be a non-empty string.`,
      );
    }
    if (parameter.unit !== undefined) {
      throw new Error(
        `Reconciliation parameter "${parameter.key}" cannot have a unit.`,
      );
    }
    values.set(parameter.key, parameter.value);
  }
  for (const key of REQUIRED_KEYS) {
    if (!values.has(key)) throw new Error(`Missing reconciliation parameter "${key}".`);
  }
  if (values.get("reconcileAction") !== "resolve-uncertain-writer") {
    throw new Error('reconcileAction must be "resolve-uncertain-writer".');
  }
  const operation =
    `${RECONCILE_UNCERTAIN_WRITER_OPERATION.id}@${RECONCILE_UNCERTAIN_WRITER_OPERATION.version}`;
  if (values.get("reconcileOperation") !== operation) {
    throw new Error(`reconcileOperation must be "${operation}".`);
  }
  const outcome = values.get("reconcileOutcome")!;
  if (outcome !== "provider-did-not-write" && outcome !== "write-effect-accepted") {
    throw new Error(
      'reconcileOutcome must be "provider-did-not-write" or "write-effect-accepted".',
    );
  }
  return {
    failedRunId: values.get("reconcileRunId")!,
    failureCode: values.get("reconcileFailureCode")!,
    basisSnapshotId: values.get("reconcileBasisSnapshotId")!,
    outcome,
    providerInspectionAttestation: values.get("reconcileAttestation")!,
  };
}

/**
 * Re-validate the persisted human MRTR ceremony before either reconciliation
 * outcome can release a Thread write basis. Shape-valid legacy annotations do
 * not carry authority on their own.
 */
export async function assertApprovedUncertainWriterReconciliation(
  project: EngineeringProjectSnapshot,
  failedRun: EngineeringAgentRun,
): Promise<void> {
  const basis = requireThreadBasis(failedRun);
  const reconciliation = failedRun.uncertainWriterReconciliation;
  if (
    failedRun.status !== "failed" || !failedRun.failure || !reconciliation ||
    reconciliation.reconciledBy.origin !== "human"
  ) {
    throw new Error("The failed run has no human uncertain-writer reconciliation.");
  }
  const reconciliationRuns = project.agentRuns.filter((run) => {
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    const phase = workItem
      ? project.phases.find((item) => item.id === workItem.phaseId)
      : undefined;
    return run.status === "completed" && run.annotationOnly === true &&
      workItem?.status === "completed" && workItem.owner === "human" &&
      workItem?.operation?.id === RECONCILE_UNCERTAIN_WRITER_OPERATION.id &&
      workItem.operation.version === RECONCILE_UNCERTAIN_WRITER_OPERATION.version &&
      workItem.decisionIds.includes(reconciliation.decisionId) &&
      phase?.workItemIds.includes(workItem.id) === true &&
      phase.requiredDecisionIds.includes(reconciliation.decisionId);
  });
  if (
    reconciliationRuns.length !== 1 ||
    reconciliationRuns[0]!.basis?.kind !== "thread-snapshot" ||
    !sameBasis(reconciliationRuns[0]!.basis, basis)
  ) {
    throw new Error(
      "The reconciliation is not linked to exactly one completed canonical annotation run.",
    );
  }
  const reconciliationRun = reconciliationRuns[0]!;
  await requireApprovedUncertainWriterReconciliationDecision(
    project,
    reconciliationRun,
    failedRun,
    {
      decisionId: reconciliation.decisionId,
      outcome: reconciliation.outcome,
      providerInspectionAttestation: reconciliation.providerInspectionAttestation,
    },
  );

  const completedTransitions = (reconciliationRun.statusHistory ?? []).filter((item) =>
    item.status === "completed" && sameActor(item.actor, reconciliation.reconciledBy)
  );
  if (
    reconciliationRun.summary !==
      "Uncertain-writer reconciliation completed by human operator." ||
    completedTransitions.length !== 1
  ) {
    throw new Error(
      "The reconciliation annotation is not sealed by its exact completed run transition.",
    );
  }
  const transition = completedTransitions[0]!;
  const annotationAt = Date.parse(reconciliation.reconciledAt);
  const authoritativeAt = Date.parse(transition.at);
  if (
    reconciliationRun.completedAt !== transition.at ||
    !Number.isFinite(annotationAt) || !Number.isFinite(authoritativeAt) ||
    annotationAt > authoritativeAt
  ) {
    throw new Error(
      "The reconciliation annotation is later than its authoritative transition.",
    );
  }
  const receipts = (project.commandReceipts ?? []).filter((receipt) =>
    receipt.commandId === transition.commandId &&
    receipt.type === "agent-run.reconcile-annotation" &&
    receipt.appliedAt === transition.at &&
    sameActor(receipt.actor, reconciliation.reconciledBy)
  );
  if (receipts.length !== 1) {
    throw new Error(
      "The reconciliation annotation has no exact immutable command receipt.",
    );
  }
  const receipt = receipts[0]!;
  const expectedRevision = receipt.resultingSnapshot.revision - 1;
  if (expectedRevision < 0) {
    throw new Error("The reconciliation receipt has no possible predecessor revision.");
  }
  const fingerprintEnvelope = {
    type: "agent-run.reconcile-annotation" as const,
    origin: {
      kind: receipt.actor.origin,
      actorId: receipt.actor.id,
    },
  };
  const commonCommand = {
    commandId: receipt.commandId,
    projectId: project.project.id,
    expectedRevision,
    issuedAt: receipt.issuedAt,
    reconciliationRunId: reconciliationRun.id,
    failedRunId: failedRun.id,
  };
  const currentRequestFingerprint = await sha256Fingerprint({
    ...fingerprintEnvelope,
    command: {
      ...commonCommand,
      decisionId: reconciliation.decisionId,
      outcome: reconciliation.outcome,
      providerInspectionAttestation: reconciliation.providerInspectionAttestation,
    },
  });
  const legacyRequestFingerprint = await sha256Fingerprint({
    ...fingerprintEnvelope,
    command: {
      ...commonCommand,
      reconciliation,
    },
  });
  const canonicalResultId =
    `${project.project.id}:project:r${receipt.resultingSnapshot.revision}:${
      receipt.requestFingerprint.digest.slice(0, 16)
    }`;
  const matchesCurrentRequest = fingerprintsEqual(
    receipt.requestFingerprint,
    currentRequestFingerprint,
  );
  const matchesLegacyRequest = fingerprintsEqual(
    receipt.requestFingerprint,
    legacyRequestFingerprint,
  );
  if (
    transition.summary !== reconciliationRun.summary ||
    receipt.resultingSnapshot.revision > project.revision ||
    receipt.resultingSnapshot.snapshotId !== canonicalResultId ||
    (!matchesCurrentRequest && !matchesLegacyRequest) ||
    (matchesCurrentRequest && reconciliation.reconciledAt !== transition.at)
  ) {
    throw new Error(
      "The reconciliation transition and receipt do not describe the persisted annotation run.",
    );
  }
}

/**
 * Validate the exact MRTR authority before the command service mutates state.
 * The approver and the later human executor are distinct audited roles; both
 * may be human without being the same person.
 */
export async function requireApprovedUncertainWriterReconciliationDecision(
  project: EngineeringProjectSnapshot,
  reconciliationRun: EngineeringAgentRun,
  failedRun: EngineeringAgentRun,
  expected: {
    readonly decisionId: string;
    readonly outcome: ReconcileUncertainWriterOutcome;
    readonly providerInspectionAttestation: string;
  },
): Promise<ApprovedUncertainWriterReconciliation> {
  const basis = requireThreadBasis(failedRun);
  const reconciliationBasis = requireThreadBasis(reconciliationRun);
  const workItem = project.workItems.find((item) =>
    item.id === reconciliationRun.workItemId
  );
  if (
    !sameBasis(reconciliationBasis, basis) || !workItem ||
    workItem.operation?.id !== RECONCILE_UNCERTAIN_WRITER_OPERATION.id ||
    workItem.operation.version !== RECONCILE_UNCERTAIN_WRITER_OPERATION.version ||
    !workItem.decisionIds.includes(expected.decisionId)
  ) {
    throw new Error(
      "The reconciliation run is not linked to the canonical operation and decision.",
    );
  }
  const decision = project.decisions.find((item) => item.id === expected.decisionId);
  if (
    !decision || decision.phaseId !== workItem.phaseId ||
    decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || !sameBasis(decision.baseSnapshot, basis)
  ) {
    throw new Error("The reconciliation decision is not approved on the exact basis.");
  }
  const proposal = parseReconcileUncertainWriterProposal(
    decision.proposal.parameters,
  );
  const expectedFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedFingerprint, decision.inputFingerprint)) {
    throw new Error(
      "The reconciliation decision fingerprint does not seal its proposal.",
    );
  }
  if (
    !failedRun.failure || proposal.failedRunId !== failedRun.id ||
    proposal.failureCode !== failedRun.failure.code ||
    proposal.basisSnapshotId !== basis.snapshotId ||
    proposal.outcome !== expected.outcome ||
    proposal.providerInspectionAttestation !==
      expected.providerInspectionAttestation
  ) {
    throw new Error(
      "The reconciliation proposal does not equal the requested run state.",
    );
  }
  const approvals = project.approvals.filter((approval) =>
    approval.decisionId === decision.id && approval.status === "approved" &&
    approval.decidedByOrigin === "human" && !!approval.decidedBy?.trim() &&
    decision.approvalIds.includes(approval.id) &&
    sameBasis(approval.baseSnapshot, basis) &&
    fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint) &&
    deterministicJson(approval.inputEvidenceRefs) ===
      deterministicJson(decision.inputEvidenceRefs)
  );
  if (approvals.length !== 1) {
    throw new Error(
      `The reconciliation requires exactly one matching human approval; found ${approvals.length}.`,
    );
  }
  return {
    decisionId: decision.id,
    decidedBy: approvals[0]!.decidedBy!,
  };
}

function requireThreadBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new Error("The reconciled run has no exact V3 ThreadSnapshot basis.");
  }
  return run.basis;
}

function sameBasis(
  value:
    | {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    }
    | undefined,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return value?.snapshotId === basis.snapshotId && value.revision === basis.revision &&
    value.subjectId === basis.subjectId;
}

function sameActor(
  left: { readonly id: string; readonly origin: string },
  right: { readonly id: string; readonly origin: string },
): boolean {
  return left.id === right.id && left.origin === right.origin;
}
