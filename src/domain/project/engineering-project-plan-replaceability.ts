/**
 * Whether an EngineeringProjectSnapshot may still receive a replacement
 * `project.plan-publish`. Command service and persistence share this predicate
 * so a replaceable plan cannot be rewritten after the first lock, and so a
 * structurally valid successor cannot invent a replacement the command would
 * refuse.
 */

import type { EngineeringProjectSnapshot } from "./engineering-project.ts";

export type EngineeringProjectPlanReplacementLock =
  | "missing_approved_brief"
  | "thread_evidence_exists"
  | "run_approval_or_blocker_exists"
  | "work_evidence_or_concrete_decision_exists";

export function engineeringProjectPlanReplacementLock(
  project: EngineeringProjectSnapshot,
): EngineeringProjectPlanReplacementLock | undefined {
  if (
    !project.framing?.currentBrief ||
    project.framing.currentBriefApproval?.status !== "approved"
  ) {
    return "missing_approved_brief";
  }
  if (project.threadSnapshots.length > 0) return "thread_evidence_exists";
  if (
    project.agentRuns.length > 0 || project.approvals.length > 0 ||
    project.blockers.length > 0
  ) {
    return "run_approval_or_blocker_exists";
  }
  if (
    project.workItems.some((item) =>
      item.status === "in-progress" || item.status === "completed" ||
      item.status === "cancelled" || item.evidenceRefs.length > 0
    ) ||
    project.phases.some((phase) => phase.evidenceRefs.length > 0) ||
    project.decisions.some((decision) => decision.status !== "required")
  ) {
    return "work_evidence_or_concrete_decision_exists";
  }
  return undefined;
}

export function isEngineeringProjectPlanReplaceable(
  project: EngineeringProjectSnapshot,
): boolean {
  return engineeringProjectPlanReplacementLock(project) === undefined;
}

export function engineeringProjectPlanReplacementLockMessage(
  lock: EngineeringProjectPlanReplacementLock,
): string {
  if (lock === "missing_approved_brief") {
    return "A project requires a current human-approved brief before planning.";
  }
  if (lock === "thread_evidence_exists") {
    return "A project plan cannot be replaced after technical evidence exists; publish a new reviewed change instead.";
  }
  if (lock === "run_approval_or_blocker_exists") {
    return "A project plan cannot be replaced after run, approval or blocker state exists.";
  }
  return "A project plan cannot be replaced after work, evidence or a concrete decision proposal exists.";
}
