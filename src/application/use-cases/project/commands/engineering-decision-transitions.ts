import type {
  EngineeringApproval,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import type {
  DecideDecisionCommand,
  EngineeringDecisionProposalInput,
  ProposeDecisionCommand,
} from "./engineering-project-commands.ts";
import {
  actor,
  assertDeclaredSnapshot,
  findDecision,
  invalidInput,
  invalidTransition,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
} from "./engineering-project-transition-values.ts";

export async function applyProposeDecision(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: ProposeDecisionCommand,
): Promise<void> {
  const decision = findDecision(draft, command.decisionId);
  if (!decision) notFound("decision", command.decisionId);
  if (decision.status !== "required" && decision.status !== "rejected") {
    invalidTransition(
      `Decision ${decision.id} cannot be proposed from ${decision.status}.`,
    );
  }
  assertDeclaredSnapshot(draft, command.baseSnapshot);
  validateProposalInput(command.proposal);
  const proposal = {
    summary: command.proposal.summary,
    parameters: [...structuredClone(command.proposal.parameters)],
    proposedAt: appliedAt,
    proposedBy: actor(origin),
  };
  const inputFingerprint = await sha256Fingerprint({
    baseSnapshot: command.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: command.proposal,
  });
  const approvalId = `approval:${decision.id}:${command.commandId}`;
  const approval: Mutable<EngineeringApproval> = {
    id: approvalId,
    decisionId: decision.id,
    status: "pending",
    requestedAt: appliedAt,
    baseSnapshot: structuredClone(command.baseSnapshot),
    inputFingerprint,
    inputEvidenceRefs: structuredClone(decision.inputEvidenceRefs),
  };
  draft.approvals.push(approval);
  decision.status = "proposed";
  decision.baseSnapshot = structuredClone(command.baseSnapshot);
  decision.inputFingerprint = inputFingerprint;
  decision.proposal = proposal;
  decision.approvalIds.push(approvalId);
  recomputeWorkReadiness(draft);
}

export function applyDecideDecision(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: DecideDecisionCommand,
  status: "approved" | "rejected",
): void {
  nonEmpty(command.rationale, "rationale");
  const decision = findDecision(draft, command.decisionId);
  if (!decision) notFound("decision", command.decisionId);
  if (decision.status !== "proposed" || !decision.inputFingerprint) {
    invalidTransition(`Decision ${decision.id} is not awaiting approval.`);
  }
  if (!fingerprintsEqual(decision.inputFingerprint, command.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "approval_scope_mismatch",
      `Decision ${decision.id} proposal fingerprint no longer matches the reviewed input.`,
    );
  }
  const approval = [...decision.approvalIds].reverse().map((id) =>
    draft.approvals.find((candidate) => candidate.id === id)
  ).find((candidate) => candidate?.status === "pending");
  if (!approval) {
    invalidTransition(`Decision ${decision.id} has no pending approval.`);
  }
  approval.status = status;
  approval.decidedAt = appliedAt;
  approval.decidedBy = origin.actorId;
  approval.decidedByOrigin = origin.kind;
  approval.rationale = command.rationale;
  decision.status = status;
  if (status === "approved") resolveSatisfiedBlockers(draft, appliedAt);
  recomputeWorkReadiness(draft);
}

function validateProposalInput(proposal: EngineeringDecisionProposalInput): void {
  nonEmpty(proposal.summary, "proposal.summary");
  if (proposal.parameters.length === 0) {
    invalidInput("proposal.parameters must contain at least one typed parameter.");
  }
  const keys = new Set<string>();
  for (const [index, parameter] of proposal.parameters.entries()) {
    nonEmpty(parameter.key, `proposal.parameters[${index}].key`);
    nonEmpty(parameter.label, `proposal.parameters[${index}].label`);
    if (keys.has(parameter.key)) {
      invalidInput(`Proposal parameter key ${parameter.key} is duplicated.`);
    }
    keys.add(parameter.key);
    if (typeof parameter.value === "string") {
      nonEmpty(parameter.value, `proposal.parameters[${index}].value`);
    } else if (
      typeof parameter.value !== "boolean" &&
      (typeof parameter.value !== "number" || !Number.isFinite(parameter.value))
    ) {
      invalidInput(`Proposal parameter ${parameter.key} has an invalid value.`);
    }
    if (parameter.unit !== undefined) {
      nonEmpty(parameter.unit, `proposal.parameters[${index}].unit`);
      if (typeof parameter.value !== "number") {
        invalidInput(
          `Proposal parameter ${parameter.key} can only use a unit when numeric.`,
        );
      }
    }
  }
}

function resolveSatisfiedBlockers(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
): void {
  for (const blocker of draft.blockers) {
    if (
      blocker.status === "open" && blocker.decisionIds.length > 0 &&
      blocker.decisionIds.every((id) => findDecision(draft, id)?.status === "approved")
    ) {
      blocker.status = "resolved";
      blocker.resolvedAt = appliedAt;
      blocker.resolution = `Resolved by approved decision${
        blocker.decisionIds.length === 1 ? "" : "s"
      }: ${blocker.decisionIds.join(", ")}.`;
    }
  }
}
