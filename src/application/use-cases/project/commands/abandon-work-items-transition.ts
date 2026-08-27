import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type { AbandonWorkItemsCommand } from "./engineering-project-commands.ts";
import {
  findDecision,
  findWorkItem,
  invalidInput,
  invalidTransition,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
} from "./engineering-project-transition-values.ts";

export function applyAbandonWorkItems(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: AbandonWorkItemsCommand,
): void {
  if (!Array.isArray(command.workItemIds) || command.workItemIds.length === 0) {
    invalidInput("At least one workItemId is required.");
  }
  nonEmpty(command.rationale, "rationale");

  for (const workItemId of command.workItemIds) {
    if (typeof workItemId !== "string" || !workItemId.trim()) {
      invalidInput(`Invalid workItemId value: ${String(workItemId)}.`);
    }
    const work = findWorkItem(draft, workItemId);
    if (!work) notFound("work item", workItemId);
    if (work.status !== "ready" && work.status !== "waiting-for-decision") {
      invalidTransition(
        `Work item ${work.id} has status ${work.status}; only ready or waiting-for-decision items without runs can be abandoned.`,
      );
    }
    if (draft.agentRuns.some((run) => run.workItemId === work.id)) {
      invalidTransition(
        `Work item ${work.id} has an associated run and cannot be abandoned.`,
      );
    }
    if (work.evidenceRefs.length > 0) {
      invalidTransition(
        `Work item ${work.id} carries evidence refs and cannot be abandoned.`,
      );
    }
    work.status = "abandoned";
  }

  for (const decisionId of command.decisionIds ?? []) {
    if (typeof decisionId !== "string" || !decisionId.trim()) {
      invalidInput(`Invalid decisionId value: ${String(decisionId)}.`);
    }
    const decision = findDecision(draft, decisionId);
    if (!decision) notFound("decision", decisionId);
    if (decision.status !== "required" && decision.status !== "proposed") {
      invalidTransition(
        `Decision ${decision.id} has status ${decision.status}; only required or proposed decisions can be abandoned.`,
      );
    }
    // Revoke any pending approval to keep the approval ledger consistent.
    if (decision.status === "proposed") {
      const pendingApproval = [...decision.approvalIds].reverse().map((id) =>
        draft.approvals.find((approval) => approval.id === id)
      ).find((approval) => approval?.status === "pending");
      if (pendingApproval) {
        pendingApproval.status = "revoked";
        pendingApproval.decidedAt = appliedAt;
        pendingApproval.decidedBy = origin.actorId;
        pendingApproval.decidedByOrigin = origin.kind;
        pendingApproval.rationale = command.rationale;
      }
    }
    decision.status = "abandoned";
  }

  recomputeWorkReadiness(draft);
}
