import type {
  EngineeringApproval,
  EngineeringBlocker,
  EngineeringDecision,
  EngineeringProjectPhase,
  EngineeringWorkItem,
} from "../engineering-project.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue } from "./engineering-project-validation-issue.ts";
import { uniqueStrings } from "./engineering-project-value-validation.ts";
import {
  chronological,
  sameEvidenceSet,
  sameExecutionBinding,
  uniqueEvidence,
} from "./engineering-project-invariant-values.ts";

/**
 * Every decision that can release work has one exact work-item owner. Direct
 * decision links and blocker-mediated links share this same authority map.
 */
export function claimDecisionWorkItemScope(
  ownerByDecisionId: Map<string, string>,
  decisionId: string,
  workItemId: string,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const existingOwner = ownerByDecisionId.get(decisionId);
  if (existingOwner !== undefined && existingOwner !== workItemId) {
    issue(
      issues,
      "ambiguous_decision_scope",
      path,
      "must not let one decision release more than one work item",
    );
    return;
  }
  ownerByDecisionId.set(decisionId, workItemId);
}

export function validateDecisionInvariant(
  decision: EngineeringDecision,
  index: number,
  phaseById: ReadonlyMap<string, EngineeringProjectPhase>,
  approvalById: ReadonlyMap<string, EngineeringApproval>,
  decisions: readonly EngineeringDecision[],
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.decisions[${index}]`;
  if (!phaseById.has(decision.phaseId)) {
    issue(issues, "missing_reference", `${path}.phaseId`, "does not reference a phase");
  }
  uniqueEvidence(decision.inputEvidenceRefs, `${path}.inputEvidenceRefs`, issues);
  uniqueStrings(decision.approvalIds, `${path}.approvalIds`, issues);
  const approvals = decision.approvalIds.map((id, approvalIndex) => {
    const approval = approvalById.get(id);
    if (!approval || approval.decisionId !== decision.id) {
      issue(
        issues,
        "missing_reference",
        `${path}.approvalIds[${approvalIndex}]`,
        "must reference an approval for this decision",
      );
    }
    return approval;
  }).filter((item): item is EngineeringApproval => item !== undefined);
  const currentApproval = approvals.at(-1);

  if (decision.status === "required" && approvals.length > 0) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.approvalIds`,
      "a required decision cannot already have approvals",
    );
  }
  if (
    decision.status === "required" &&
    (decision.proposal || decision.baseSnapshot || decision.inputFingerprint)
  ) {
    issue(
      issues,
      "decision_proposal_contradiction",
      path,
      "a required decision cannot already carry a concrete proposal binding",
    );
  }
  if (
    decision.status !== "required" &&
    decision.status !== "abandoned" &&
    !decision.proposal
  ) {
    issue(
      issues,
      "missing_proposal",
      `${path}.proposal`,
      "a proposed, decided or superseded decision requires its concrete proposal",
    );
  }
  if (decision.proposal) {
    uniqueStrings(
      decision.proposal.parameters.map((parameter) => parameter.key),
      `${path}.proposal.parameters`,
      issues,
    );
  }
  if (
    decision.status === "proposed" &&
    currentApproval?.status !== "pending"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "a proposed decision requires a pending approval",
    );
  }
  if (
    decision.status === "approved" &&
    currentApproval?.status !== "approved"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "an approved decision requires an approved approval",
    );
  }
  if (
    decision.status === "rejected" &&
    currentApproval?.status !== "rejected"
  ) {
    issue(
      issues,
      "decision_approval_contradiction",
      `${path}.status`,
      "a rejected decision requires a rejected approval",
    );
  }
  if (
    decision.status === "superseded" &&
    !decisions.some((candidate) =>
      candidate.supersedesDecisionId === decision.id ||
      decision.supersededByDecisionId === candidate.id
    )
  ) {
    issue(
      issues,
      "missing_superseding_decision",
      `${path}.status`,
      "no decision supersedes this decision",
    );
  }
  if (decision.supersedesDecisionId === decision.id) {
    issue(
      issues,
      "self_reference",
      `${path}.supersedesDecisionId`,
      "cannot reference itself",
    );
  }
  if (decision.supersededByDecisionId === decision.id) {
    issue(
      issues,
      "self_reference",
      `${path}.supersededByDecisionId`,
      "cannot reference itself",
    );
  }
  if (decision.supersededByDecisionId !== undefined) {
    const successor = decisions.find((candidate) =>
      candidate.id === decision.supersededByDecisionId
    );
    if (!successor || successor.status !== "approved") {
      issue(
        issues,
        "missing_superseding_decision",
        `${path}.supersededByDecisionId`,
        "must reference an approved successor decision",
      );
    }
  }
}

export function validateApprovalInvariant(
  approval: EngineeringApproval,
  index: number,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.approvals[${index}]`;
  const decision = decisionById.get(approval.decisionId);
  if (!decision || !decision.approvalIds.includes(approval.id)) {
    issue(
      issues,
      "missing_reference",
      `${path}.decisionId`,
      "must reference a reciprocal decision",
    );
    return;
  }
  uniqueEvidence(approval.inputEvidenceRefs, `${path}.inputEvidenceRefs`, issues);
  const isCurrentApproval = decision.approvalIds.at(-1) === approval.id;
  if (isCurrentApproval) {
    if (!sameEvidenceSet(approval.inputEvidenceRefs, decision.inputEvidenceRefs)) {
      issue(
        issues,
        "approval_input_mismatch",
        `${path}.inputEvidenceRefs`,
        "the current approval must exactly match the decision evidence inputs",
      );
    }
    if (!sameExecutionBinding(approval, decision)) {
      issue(
        issues,
        "approval_input_mismatch",
        path,
        "the current approval binding must exactly match the decision",
      );
    }
  } else if (approval.status === "pending") {
    issue(
      issues,
      "stale_pending_approval",
      `${path}.status`,
      "a historical approval cannot remain pending after a newer proposal",
    );
  }
  if (approval.status === "pending") {
    if (
      approval.decidedAt || approval.decidedBy || approval.rationale ||
      approval.decidedByOrigin
    ) {
      issue(
        issues,
        "approval_lifecycle_contradiction",
        path,
        "a pending approval cannot have decision fields",
      );
    }
  } else if (
    !approval.decidedAt || !approval.decidedBy || !approval.rationale ||
    !approval.decidedByOrigin
  ) {
    issue(
      issues,
      "approval_lifecycle_contradiction",
      path,
      "a decided approval requires decidedAt, decidedBy and rationale",
    );
  }
  if (approval.decidedByOrigin && approval.decidedByOrigin !== "human") {
    issue(
      issues,
      "approval_origin_forbidden",
      `${path}.decidedByOrigin`,
      "only a human origin can approve or reject a decision",
    );
  }
  chronological(approval.requestedAt, approval.decidedAt, `${path}.decidedAt`, issues);
}

export function validateBlockerInvariant(
  blocker: EngineeringBlocker,
  index: number,
  phaseById: ReadonlyMap<string, EngineeringProjectPhase>,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  decisionById: ReadonlyMap<string, EngineeringDecision>,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.blockers[${index}]`;
  if (!phaseById.has(blocker.phaseId)) {
    issue(issues, "missing_reference", `${path}.phaseId`, "does not reference a phase");
  }
  uniqueStrings(blocker.workItemIds, `${path}.workItemIds`, issues);
  uniqueStrings(blocker.decisionIds, `${path}.decisionIds`, issues);
  if (blocker.workItemIds.length === 0) {
    issue(
      issues,
      "unscoped_blocker",
      `${path}.workItemIds`,
      "must block at least one work item",
    );
  }
  blocker.workItemIds.forEach((id, workIndex) => {
    const item = workById.get(id);
    if (
      !item || item.phaseId !== blocker.phaseId || !item.blockerIds.includes(blocker.id)
    ) {
      issue(
        issues,
        "missing_reference",
        `${path}.workItemIds[${workIndex}]`,
        "must reference a reciprocal work item in the same phase",
      );
    }
  });
  blocker.decisionIds.forEach((id, decisionIndex) => {
    const decision = decisionById.get(id);
    if (!decision || decision.phaseId !== blocker.phaseId) {
      issue(
        issues,
        "missing_reference",
        `${path}.decisionIds[${decisionIndex}]`,
        "must reference a decision in the same phase",
      );
    }
  });
  if (blocker.status === "open" && (blocker.resolvedAt || blocker.resolution)) {
    issue(
      issues,
      "blocker_lifecycle_contradiction",
      path,
      "an open blocker cannot have resolution fields",
    );
  }
  if (blocker.status === "resolved" && (!blocker.resolvedAt || !blocker.resolution)) {
    issue(
      issues,
      "blocker_lifecycle_contradiction",
      path,
      "a resolved blocker requires resolvedAt and resolution",
    );
  }
  chronological(blocker.openedAt, blocker.resolvedAt, `${path}.resolvedAt`, issues);
}
