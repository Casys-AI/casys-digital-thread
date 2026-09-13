/** Shared MRTR gate for documentary clause-response records. */
import { EngineeringProjectCommandError } from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  type DocumentaryClauseResponseProposal,
  parseDocumentaryClauseResponseParameters,
  RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION,
} from "../../domain/record/documentary-clause-response.ts";
import { requireBasis } from "../shared/executor-run-helpers.ts";

export async function requireDocumentaryClauseResponseApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  readonly decision: EngineeringDecision & {
    readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
    readonly inputFingerprint: ContentFingerprint;
  };
  readonly proposal: DocumentaryClauseResponseProposal;
}> {
  const work = project.workItems.find((item) => item.id === run.workItemId);
  const basis = requireBasis(run);
  const bindings = work?.operation?.bindings ?? [];
  const approved = bindings.filter((binding) =>
    binding.name === "approvedBrief" && binding.source.kind === "approved-brief"
  );
  if (
    project.schemaVersion !== "4.0" || !work ||
    work.operation?.id !== RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.id ||
    work.operation.version !== RECORD_DOCUMENTARY_CLAUSE_RESPONSE_OPERATION.version ||
    approved.length !== 1 ||
    bindings.length !== 1 ||
    work.decisionIds.length !== 1
  ) {
    throw invalid(
      "Documentary clause-response requires the exact @1 operation, one approvedBrief binding, and one MRTR decision.",
    );
  }
  const decision = project.decisions.find((item) => item.id === work.decisionIds[0]);
  if (
    !decision || decision.status !== "approved" || !decision.proposal ||
    !decision.inputFingerprint || !sameBasis(decision.baseSnapshot, basis)
  ) {
    throw invalid(
      "Documentary clause-response requires one exact approved MRTR decision at its run basis.",
    );
  }
  if ((decision.inputEvidenceRefs ?? []).length !== 0) {
    throw invalid(
      "Documentary clause-response MRTR evidence is the signed parameters; extra Thread evidence refs are refused.",
    );
  }
  const approvals = project.approvals.filter((item) =>
    item.decisionId === decision.id && item.status === "approved"
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
    (approval.inputEvidenceRefs ?? []).length !== 0 ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalid(
      "Documentary clause-response requires exactly one human approval equal to its MRTR decision.",
    );
  }
  let proposal: DocumentaryClauseResponseProposal;
  try {
    proposal = parseDocumentaryClauseResponseParameters(decision.proposal.parameters);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Documentary clause-response parameters are invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
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
      "The clause-response decision fingerprint no longer seals its exact basis, evidence and proposal.",
    );
  }
  const expectedRun = await sha256Fingerprint({
    workItemId: work.id,
    basis,
    operation: {
      id: work.operation.id,
      version: work.operation.version,
      bindings: work.operation.bindings,
    },
    approvedDecisions: [{
      id: decision.id,
      inputFingerprint: decision.inputFingerprint,
    }],
  });
  if (!fingerprintsEqual(expectedRun, run.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The clause-response run fingerprint no longer seals its MRTR decision, bindings and basis.",
    );
  }
  return {
    decision: decision as EngineeringDecision & {
      readonly proposal: NonNullable<EngineeringDecision["proposal"]>;
      readonly inputFingerprint: ContentFingerprint;
    },
    proposal,
  };
}

function sameBasis(
  left: { snapshotId?: string; revision?: number; subjectId?: string } | undefined,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function invalid(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_input", message);
}
