/** Shared, pure MRTR cliquet for documentary requirement/brief trace records. */
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  parseRequirementsBriefTraceParameters,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  type RequirementsBriefTraceProposal,
} from "../../domain/record/requirements-brief-trace.ts";
import { requireBasis } from "../shared/executor-run-helpers.ts";

export async function requireRequirementsBriefTraceApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision & {
    readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly proposal: RequirementsBriefTraceProposal;
}> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const basis = requireBasis(run);
  const bindings = work?.operation?.bindings ?? [];
  const approved = bindings.filter((b) =>
    b.name === "approvedBrief" && b.source.kind === "approved-brief"
  );
  const claimInputs = bindings.filter((b) =>
    b.name === "claimInput" && b.source.kind === "thread-entity"
  );
  if (
    project.schemaVersion !== "4.0" || !work ||
    work.operation?.id !== RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.id ||
    work.operation.version !== RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION.version ||
    approved.length !== 1 || claimInputs.length < 1 || claimInputs.length > 2 ||
    bindings.length !== approved.length + claimInputs.length ||
    work.decisionIds.length !== 1
  ) {
    throw invalid(
      "Requirements brief trace requires the exact @1 operation, one approvedBrief binding, one or two claimInput bindings, and one MRTR decision.",
    );
  }
  const decision = project.decisions.find((item) => item.id === work.decisionIds[0]);
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || !sameBasis(decision.baseSnapshot, basis)
  ) {
    throw invalid(
      "Requirements brief trace requires one exact approved MRTR decision at its run basis.",
    );
  }
  let proposal: RequirementsBriefTraceProposal;
  try {
    proposal = parseRequirementsBriefTraceParameters(decision.proposal.parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Requirements brief trace parameters are invalid: ${message(error)}`,
    );
  }
  const expectedEvidence = evidenceForProposal(basis, proposal);
  if (!sameRefs(decision.inputEvidenceRefs, expectedEvidence)) {
    throw invalid(
      "The trace MRTR input evidence must be exactly the requirements capture and optional predecessor at the run basis.",
    );
  }
  const claimInputRefs = claimInputs.map((binding) => {
    if (binding.source.kind !== "thread-entity") {
      throw invalid("A claimInput binding must name one exact Thread artifact.");
    }
    return binding.source.reference;
  });
  if (
    bindings.length !== 1 + expectedEvidence.length ||
    claimInputRefs.length !== expectedEvidence.length ||
    !sameRefs(claimInputRefs, expectedEvidence)
  ) {
    throw invalid(
      "The claimInput bindings must equal exactly the signed requirements capture and optional predecessor artifact evidence references.",
    );
  }
  // Count every current approval for this decision before considering receipt
  // linkage.  An orphan approved receipt is an ambiguity, not harmless history.
  const approvals = project.approvals.filter((approval) =>
    approval.decisionId === decision.id && approval.status === "approved"
  );
  const approval = approvals[0];
  if (
    approvals.length !== 1 || !approval ||
    !decision.approvalIds.includes(approval.id) ||
    approval.decidedByOrigin !== "human" ||
    typeof approval.decidedBy !== "string" || approval.decidedBy.trim().length === 0 ||
    typeof approval.decidedAt !== "string" ||
    Number.isNaN(Date.parse(approval.decidedAt)) ||
    !sameBasis(approval.baseSnapshot, basis) ||
    !sameRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalid(
      "Requirements brief trace requires exactly one human approval equal to its MRTR decision.",
    );
  }
  const expectedDecision = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecision, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The trace decision fingerprint no longer seals its exact basis, evidence and proposal.",
    );
  }
  const approvedDecisions = work.decisionIds.map((id) => {
    const item = project.decisions.find((candidate) => candidate.id === id);
    if (!item?.inputFingerprint || item.status !== "approved") {
      throw invalid(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: item.inputFingerprint };
  });
  const expectedRun = await sha256Fingerprint({
    workItemId: work.id,
    basis,
    operation: {
      id: work.operation.id,
      version: work.operation.version,
      bindings: work.operation.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(expectedRun, run.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The trace run fingerprint no longer seals its MRTR decision, bindings and basis.",
    );
  }
  return {
    decision: decision as EngineeringDecision & {
      proposal: NonNullable<EngineeringDecision["proposal"]>;
      inputFingerprint: ContentFingerprint;
    },
    proposal,
  };
}

function evidenceForProposal(
  basis: EngineeringThreadSnapshotBasis,
  proposal: RequirementsBriefTraceProposal,
): EngineeringThreadEntityRef[] {
  return [
    {
      snapshotId: basis.snapshotId,
      snapshotRevision: basis.revision,
      kind: "artifact",
      id: proposal.requirementsCapture.artifactId,
    },
    ...(proposal.predecessor
      ? [{
        snapshotId: basis.snapshotId,
        snapshotRevision: basis.revision,
        kind: "artifact" as const,
        id: proposal.predecessor.artifactId,
      }]
      : []),
  ];
}
function sameBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
}
function sameRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  const key = (ref: EngineeringThreadEntityRef) =>
    `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
  const a = left.map(key).sort();
  const b = right.map(key).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
function invalid(value: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", value);
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
