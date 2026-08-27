/**
 * Persistence-side successor check for an EngineeringProjectSnapshot.
 *
 * `validateEngineeringProjectSnapshot` accepts one revision in isolation.
 * This function compares two consecutive revisions so a structurally valid
 * successor cannot rewrite frozen identity, reclassify an initial phase as
 * change-created, or shrink append-only phase membership and evidence.
 *
 * Status, run lifecycle, decision/approval, gate-claim status, framing
 * (except captured intent), receipts, and newly appended entities stay legal.
 */

import type {
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "./engineering-project.ts";
import {
  EngineeringProjectValidationError,
  type EngineeringProjectValidationIssue,
} from "./engineering-project-validation.ts";
import { isEngineeringProjectPlanReplaceable } from "./engineering-project-plan-replaceability.ts";
import { projectBriefObjective } from "./project-brief.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";

export function validateEngineeringProjectExtension(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  const issues = collectEngineeringProjectExtensionIssues(previous, next);
  if (issues.length > 0) throw new EngineeringProjectValidationError(issues);
  return next;
}

export function collectEngineeringProjectExtensionIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
): EngineeringProjectValidationIssue[] {
  const issues: EngineeringProjectValidationIssue[] = [];
  if (next.schemaVersion !== previous.schemaVersion) {
    issue(
      issues,
      "identity_mutated",
      "$.schemaVersion",
      "cannot change across an engineering project extension",
    );
  }
  if (next.project.id !== previous.project.id) {
    issue(
      issues,
      "identity_mutated",
      "$.project.id",
      "cannot change across an engineering project extension",
    );
  }
  if (next.project.subjectId !== previous.project.subjectId) {
    issue(
      issues,
      "identity_mutated",
      "$.project.subjectId",
      "cannot change across an engineering project extension",
    );
  }
  if (next.project.name !== previous.project.name) {
    issue(
      issues,
      "identity_mutated",
      "$.project.name",
      "cannot change across an engineering project extension",
    );
  }
  if (
    !sameJson(next.project.objective, previous.project.objective) &&
    !isCanonicalBriefApprovalExtension(previous, next)
  ) {
    issue(
      issues,
      "identity_mutated",
      "$.project.objective",
      "cannot change across an engineering project extension",
    );
  }
  if (
    next.previous?.snapshotId !== previous.id ||
    next.previous?.revision !== previous.revision
  ) {
    issue(
      issues,
      "provenance_mismatch",
      "$.previous",
      "must name the exact predecessor snapshot",
    );
  }
  const planReplacement = isPlanPublishReplacement(previous, next);
  if (
    previous.plan !== undefined && !planReplacement &&
    !sameJson(next.plan, previous.plan)
  ) {
    issue(
      issues,
      "identity_mutated",
      "$.plan",
      "a published plan cannot be rewritten",
    );
  }
  if (
    previous.framing?.intent !== undefined &&
    deterministicJson(next.framing?.intent) !==
      deterministicJson(previous.framing.intent)
  ) {
    issue(
      issues,
      "identity_mutated",
      "$.framing.intent",
      "captured project intent cannot be rewritten",
    );
  }
  assertPrefix(
    issues,
    previous.commandReceipts ?? [],
    next.commandReceipts ?? [],
    "$.commandReceipts",
    "command_history_rewritten",
    "command receipts are append-only",
  );
  assertPrefix(
    issues,
    previous.threadSnapshots,
    next.threadSnapshots,
    "$.threadSnapshots",
    "provenance_mismatch",
    "declared thread snapshots are append-only",
  );
  assertPrefix(
    issues,
    previous.planChanges ?? [],
    next.planChanges ?? [],
    "$.planChanges",
    "plan_change_rewritten",
    "appended project changes are append-only",
  );
  assertPrefix(
    issues,
    previous.approvals,
    next.approvals,
    "$.approvals",
    "approval_history_rewritten",
    "approvals are append-only",
    (item) => item.id,
  );
  if (!planReplacement) {
    collectPhaseExtensionIssues(previous, next, issues);
    collectWorkExtensionIssues(previous, next, issues);
    collectDecisionExtensionIssues(previous, next, issues);
    collectPhaseReclassificationIssues(previous, next, issues);
    collectPlanChangeDeltaOwnershipIssues(previous, next, issues);
  }
  collectRunExtensionIssues(previous, next, issues);
  return issues;
}

function collectPhaseExtensionIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (next.phases.length < previous.phases.length) {
    issue(
      issues,
      "phase_removed",
      "$.phases",
      "existing phases cannot be removed",
    );
    return;
  }
  previous.phases.forEach((phase, index) => {
    const successor = next.phases[index];
    const path = `$.phases[${index}]`;
    if (!successor || successor.id !== phase.id) {
      issue(
        issues,
        "phase_removed",
        path,
        "existing phases must remain a prefix of the next revision",
      );
      return;
    }
    if (successor.order !== phase.order) {
      issue(
        issues,
        "phase_identity_mutated",
        `${path}.order`,
        "an existing phase cannot be reordered",
      );
    }
    if (successor.name !== phase.name) {
      issue(
        issues,
        "phase_identity_mutated",
        `${path}.name`,
        "an existing phase cannot be renamed",
      );
    }
    if (successor.description !== phase.description) {
      issue(
        issues,
        "phase_identity_mutated",
        `${path}.description`,
        "an existing phase description cannot be rewritten",
      );
    }
    assertStringPrefix(
      issues,
      phase.workItemIds,
      successor.workItemIds,
      `${path}.workItemIds`,
      "phase_membership_rewritten",
      "phase work-item membership is append-only",
    );
    assertStringPrefix(
      issues,
      phase.requiredDecisionIds,
      successor.requiredDecisionIds,
      `${path}.requiredDecisionIds`,
      "phase_membership_rewritten",
      "phase decision membership is append-only",
    );
    assertEvidencePrefix(
      issues,
      phase.evidenceRefs,
      successor.evidenceRefs,
      `${path}.evidenceRefs`,
    );
  });
}

function collectWorkExtensionIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const nextById = new Map(next.workItems.map((item) => [item.id, item]));
  for (const [index, work] of previous.workItems.entries()) {
    const successor = nextById.get(work.id);
    const path = `$.workItems[${index}]`;
    if (!successor) {
      issue(
        issues,
        "work_removed",
        path,
        "existing work items cannot be removed",
      );
      continue;
    }
    if (successor.activityId !== work.activityId) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.activityId`,
        "a work item cannot change activity identity",
      );
    }
    if (successor.predecessorRevisionId !== work.predecessorRevisionId) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.predecessorRevisionId`,
        "a work item cannot change its predecessor revision",
      );
    }
    if (successor.phaseId !== work.phaseId) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.phaseId`,
        "a work item cannot move to another phase",
      );
    }
    if (
      successor.title !== work.title ||
      successor.description !== work.description ||
      successor.kind !== work.kind ||
      successor.owner !== work.owner
    ) {
      issue(
        issues,
        "work_identity_mutated",
        path,
        "work title, description, kind and owner are frozen after creation",
      );
    }
    if (!sameJson(successor.operation, work.operation)) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.operation`,
        "a work item cannot change its reviewed operation",
      );
    }
    if (
      !sameJson(successor.dependsOnWorkItemIds, work.dependsOnWorkItemIds)
    ) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.dependsOnWorkItemIds`,
        "work dependencies are frozen after creation",
      );
    }
    if (!sameJson(successor.decisionIds, work.decisionIds)) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.decisionIds`,
        "work decision links are frozen after creation",
      );
    }
    assertStringPrefix(
      issues,
      work.blockerIds,
      successor.blockerIds,
      `${path}.blockerIds`,
      "work_identity_mutated",
      "work blocker links are append-only",
    );
    assertEvidencePrefix(
      issues,
      work.evidenceRefs,
      successor.evidenceRefs,
      `${path}.evidenceRefs`,
    );
    collectGateClaimExtensionIssues(work, successor, path, issues);
    if (
      isTerminalWorkStatus(work.status) && successor.status !== work.status
    ) {
      issue(
        issues,
        "work_terminal_reopened",
        `${path}.status`,
        "completed, cancelled or abandoned work cannot return to a nonterminal status",
      );
    }
    if (work.reconciliation !== undefined) {
      if (!sameJson(successor.reconciliation, work.reconciliation)) {
        issue(
          issues,
          "reconciliation_mutated",
          `${path}.reconciliation`,
          "a recorded work-item reconciliation cannot be rewritten or removed",
        );
      }
    }
  }
}

function collectGateClaimExtensionIssues(
  previous: EngineeringWorkItem,
  next: EngineeringWorkItem,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const previousClaims = previous.gateClaims ?? [];
  const nextClaims = next.gateClaims ?? [];
  if (nextClaims.length < previousClaims.length) {
    issue(
      issues,
      "work_identity_mutated",
      `${path}.gateClaims`,
      "declared gate claims cannot be removed",
    );
    return;
  }
  previousClaims.forEach((claim, index) => {
    const successor = nextClaims[index];
    if (
      !successor ||
      successor.gateItemId !== claim.gateItemId ||
      successor.role !== claim.role
    ) {
      issue(
        issues,
        "work_identity_mutated",
        `${path}.gateClaims[${index}]`,
        "declared gate-claim identity cannot be rewritten",
      );
    }
  });
}

function collectRunExtensionIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const nextById = new Map(next.agentRuns.map((run) => [run.id, run]));
  for (const [index, run] of previous.agentRuns.entries()) {
    const successor = nextById.get(run.id);
    const path = `$.agentRuns[${index}]`;
    if (!successor) {
      issue(
        issues,
        "run_removed",
        path,
        "existing agent runs cannot be removed",
      );
      continue;
    }
    if (successor.workItemId !== run.workItemId) {
      issue(
        issues,
        "run_identity_mutated",
        `${path}.workItemId`,
        "an agent run cannot change work-item identity",
      );
    }
    assertEvidencePrefix(
      issues,
      run.evidenceRefs,
      successor.evidenceRefs,
      `${path}.evidenceRefs`,
    );
    assertPrefix(
      issues,
      run.statusHistory ?? [],
      successor.statusHistory ?? [],
      `${path}.statusHistory`,
      "run_history_rewritten",
      "run status history is append-only",
    );
  }
}

function collectDecisionExtensionIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const nextById = new Map(next.decisions.map((item) => [item.id, item]));
  for (const [index, decision] of previous.decisions.entries()) {
    const successor = nextById.get(decision.id);
    const path = `$.decisions[${index}]`;
    if (!successor) {
      issue(
        issues,
        "decision_removed",
        path,
        "existing decisions cannot be removed",
      );
      continue;
    }
    if (
      successor.phaseId !== decision.phaseId ||
      successor.title !== decision.title ||
      successor.question !== decision.question
    ) {
      issue(
        issues,
        "decision_identity_mutated",
        path,
        "decision phase, title and question are frozen after creation",
      );
    }
    assertStringPrefix(
      issues,
      decision.approvalIds,
      successor.approvalIds,
      `${path}.approvalIds`,
      "decision_identity_mutated",
      "decision approvals are append-only",
    );
    assertEvidencePrefix(
      issues,
      decision.inputEvidenceRefs,
      successor.inputEvidenceRefs,
      `${path}.inputEvidenceRefs`,
    );
  }
}

function collectPhaseReclassificationIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const previousPhaseIds = new Set(previous.phases.map((phase) => phase.id));
  const previousCount = previous.planChanges?.length ?? 0;
  const appended = (next.planChanges ?? []).slice(previousCount);
  appended.forEach((change, offset) => {
    const path = `$.planChanges[${previousCount + offset}].phaseIds`;
    change.phaseIds.forEach((phaseId, phaseIndex) => {
      if (previousPhaseIds.has(phaseId)) {
        issue(
          issues,
          "phase_reclassified",
          `${path}[${phaseIndex}]`,
          "an existing phase cannot be reclassified as created by a later change",
        );
      }
    });
  });
}

function assertStringPrefix(
  issues: EngineeringProjectValidationIssue[],
  previous: readonly string[],
  next: readonly string[],
  path: string,
  code: string,
  message: string,
): void {
  if (
    next.length < previous.length || previous.some((id, index) => next[index] !== id)
  ) {
    issue(issues, code, path, message);
  }
}

function assertEvidencePrefix(
  issues: EngineeringProjectValidationIssue[],
  previous: readonly EngineeringThreadEntityRef[],
  next: readonly EngineeringThreadEntityRef[],
  path: string,
): void {
  assertPrefix(
    issues,
    previous,
    next,
    path,
    "evidence_rewritten",
    "evidence references are append-only",
    evidenceKey,
  );
}

function assertPrefix<T>(
  issues: EngineeringProjectValidationIssue[],
  previous: readonly T[],
  next: readonly T[],
  path: string,
  code: string,
  message: string,
  key: (item: T) => string = (item) => deterministicJson(item),
): void {
  if (
    next.length < previous.length ||
    previous.some((item, index) => key(item) !== key(next[index]!))
  ) {
    issue(issues, code, path, message);
  }
}

function evidenceKey(reference: EngineeringThreadEntityRef): string {
  return `${reference.snapshotId}@${reference.snapshotRevision}:${reference.kind}:${reference.id}`;
}

function sameJson(left: unknown, right: unknown): boolean {
  if (left === undefined && right === undefined) return true;
  if (left === undefined || right === undefined) return false;
  return deterministicJson(left) === deterministicJson(right);
}

function appendedReceipts(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
): readonly EngineeringProjectCommandReceipt[] {
  return (next.commandReceipts ?? []).slice(previous.commandReceipts?.length ?? 0);
}

function isPlanPublishReplacement(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
): boolean {
  const appended = appendedReceipts(previous, next);
  return appended.length === 1 &&
    appended[0]?.type === "project.plan-publish" &&
    isEngineeringProjectPlanReplaceable(previous) &&
    isEngineeringProjectPlanReplaceable(next);
}

function isCanonicalBriefApprovalExtension(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
): boolean {
  const appended = appendedReceipts(previous, next);
  const receipt = appended[0];
  const proposal = previous.framing?.proposedBrief;
  const pending = previous.framing?.proposalReview;
  const currentBrief = next.framing?.currentBrief;
  const approval = next.framing?.currentBriefApproval;
  if (
    appended.length !== 1 || receipt?.type !== "project.brief-approve" ||
    !proposal || pending?.status !== "pending" || !currentBrief ||
    approval?.status !== "approved" ||
    next.framing?.proposedBrief !== undefined ||
    next.framing?.proposalReview !== undefined ||
    !sameJson(currentBrief, proposal)
  ) {
    return false;
  }
  if (
    approval.briefSnapshotId !== pending.briefSnapshotId ||
    approval.briefRevision !== pending.briefRevision ||
    !sameJson(approval.inputFingerprint, pending.inputFingerprint) ||
    approval.requestedAt !== pending.requestedAt
  ) {
    return false;
  }
  const objective = projectBriefObjective(currentBrief);
  if (
    next.project.objective.title !== objective ||
    next.project.objective.statement !== objective
  ) {
    return false;
  }
  const basis = receipt.approvedBriefBasis;
  return basis?.kind === "approved-brief" &&
    basis.projectId === next.project.id &&
    basis.projectSnapshotId === next.id &&
    basis.projectRevision === next.revision &&
    basis.briefId === currentBrief.briefId &&
    basis.briefSnapshotId === currentBrief.id &&
    basis.briefRevision === currentBrief.revision &&
    sameJson(basis.approvedBriefFingerprint, approval.inputFingerprint);
}

function collectPlanChangeDeltaOwnershipIssues(
  previous: EngineeringProjectSnapshot,
  next: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const previousCount = previous.planChanges?.length ?? 0;
  const appended = (next.planChanges ?? []).slice(previousCount);
  if (appended.length === 0) return;
  const ownedPhaseIds = new Set(appended.flatMap((change) => change.phaseIds));
  const ownedWorkIds = new Set(appended.flatMap((change) => change.workItemIds));
  const ownedDecisionIds = new Set(
    appended.flatMap((change) => change.decisionIds),
  );
  const addedPhaseIds = next.phases
    .map((phase) => phase.id)
    .filter((id) => previous.phases.every((phase) => phase.id !== id));
  const addedWorkIds = next.workItems
    .map((item) => item.id)
    .filter((id) => previous.workItems.every((item) => item.id !== id));
  const addedDecisionIds = next.decisions
    .map((item) => item.id)
    .filter((id) => previous.decisions.every((item) => item.id !== id));
  assertExactIdSet(
    issues,
    ownedPhaseIds,
    addedPhaseIds,
    "$.planChanges",
    "plan_change_delta_mismatch",
    "newly added phases must be exactly the phases owned by the appended change",
  );
  assertExactIdSet(
    issues,
    ownedWorkIds,
    addedWorkIds,
    "$.planChanges",
    "plan_change_delta_mismatch",
    "newly added work items must be exactly the work owned by the appended change",
  );
  assertExactIdSet(
    issues,
    ownedDecisionIds,
    addedDecisionIds,
    "$.planChanges",
    "plan_change_delta_mismatch",
    "newly added decisions must be exactly the decisions owned by the appended change",
  );
}

function assertExactIdSet(
  issues: EngineeringProjectValidationIssue[],
  owned: ReadonlySet<string>,
  added: readonly string[],
  path: string,
  code: string,
  message: string,
): void {
  if (
    owned.size !== added.length || added.some((id) => !owned.has(id))
  ) {
    issue(issues, code, path, message);
  }
}

function isTerminalWorkStatus(
  status: EngineeringWorkItem["status"],
): boolean {
  return status === "completed" || status === "cancelled" ||
    status === "abandoned";
}

function issue(
  issues: EngineeringProjectValidationIssue[],
  code: string,
  path: string,
  message: string,
): void {
  issues.push({ code, path, message });
}
