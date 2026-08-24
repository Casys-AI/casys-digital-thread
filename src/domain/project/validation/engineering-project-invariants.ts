import type {
  EngineeringApproval,
  EngineeringBlocker,
  EngineeringDecision,
  EngineeringProjectPhase,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../engineering-project.ts";
import { collectEngineeringActivityLifecycleIssues } from "../engineering-activity.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue } from "./engineering-project-validation-issue.ts";
import { requireUnique } from "./engineering-project-invariant-values.ts";
import {
  allEvidenceRefs,
  executionBindings,
  operationThreadEntityRefs,
  snapshotKey,
} from "./engineering-project-reference-index.ts";
import { validateProjectFramingInvariants } from "./framing-brief-invariants.ts";
import {
  detectWorkCycles,
  validateGateClaimsAgainstCanonicalBrief,
  validatePhaseLocalInvariants,
  validatePhaseMembership,
  validatePlanChangeInvariants,
  validatePlanInvariants,
  validateWorkItemGraphInvariants,
  validateWorkItemReconciliationInvariant,
} from "./plan-work-invariants.ts";
import {
  validateCancelledRunReceiptBindings,
  validateCommandReceiptInvariant,
  validateQueuedRunReceiptBindings,
  validateRunInvariant,
  validateRunTransitionCommandUsage,
} from "./run-receipt-invariants.ts";
import {
  claimDecisionWorkItemScope,
  validateApprovalInvariant,
  validateBlockerInvariant,
  validateDecisionInvariant,
} from "./decision-blocker-invariants.ts";

/**
 * Shared readonly lookups for one snapshot. Built once after identity
 * uniqueness; it is not a mutable aggregate and does not emit issues.
 */
export interface EngineeringProjectInvariantIndex {
  readonly phaseById: ReadonlyMap<string, EngineeringProjectPhase>;
  readonly workById: ReadonlyMap<string, EngineeringWorkItem>;
  readonly decisionById: ReadonlyMap<string, EngineeringDecision>;
  readonly approvalById: ReadonlyMap<string, EngineeringApproval>;
  readonly blockerById: ReadonlyMap<string, EngineeringBlocker>;
  readonly annotationOnlyWorkItemIds: ReadonlySet<string>;
  readonly declaredSnapshots: ReadonlySet<string>;
}

/**
 * Graph invariants in the historical `validateInvariants` emission order.
 * Each named step is one existing rule block; nothing is added or reordered.
 */
export function validateEngineeringProjectInvariants(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  validateRevisionLineage(project, issues);

  requireUnique(
    project.threadSnapshots,
    (item) => item.snapshotId,
    "$.threadSnapshots",
    issues,
  );
  const createdByCommand = true;
  const expectedCommandReceiptCount = createdByCommand
    ? project.revision
    : Math.max(0, project.revision - 1);
  if ((project.commandReceipts?.length ?? 0) !== expectedCommandReceiptCount) {
    issue(
      issues,
      "incomplete_command_history",
      "$.commandReceipts",
      createdByCommand
        ? "must contain the project-start receipt and one receipt for every later command revision"
        : "must contain exactly one durable receipt for every command-created revision",
    );
  }
  requireUnique(
    project.threadSnapshots,
    (item) => `${item.subjectId}\u0000${item.revision}`,
    "$.threadSnapshots",
    issues,
  );
  requireUnique(project.phases, (item) => item.id, "$.phases", issues);
  requireUnique(project.workItems, (item) => item.id, "$.workItems", issues);
  collectEngineeringActivityLifecycleIssues(project.workItems).forEach(
    (lifecycleIssue) => {
      issue(
        issues,
        lifecycleIssue.code,
        lifecycleIssue.path,
        lifecycleIssue.message,
      );
    },
  );
  requireUnique(project.agentRuns, (item) => item.id, "$.agentRuns", issues);
  requireUnique(project.decisions, (item) => item.id, "$.decisions", issues);
  requireUnique(project.approvals, (item) => item.id, "$.approvals", issues);
  requireUnique(project.blockers, (item) => item.id, "$.blockers", issues);
  requireUnique(
    project.commandReceipts ?? [],
    (item) => item.commandId,
    "$.commandReceipts",
    issues,
  );

  if (!project.framing) {
    issue(
      issues,
      "missing_reference",
      "$.framing",
      "a current project owns its living brief from the first revision",
    );
  } else {
    validateProjectFramingInvariants(project, project.framing, issues);
  }
  if (
    project.revision === 1 && (
      project.threadSnapshots.length > 0 || project.phases.length > 0 ||
      project.workItems.length > 0 || project.agentRuns.length > 0 ||
      project.decisions.length > 0 || project.approvals.length > 0 ||
      project.blockers.length > 0 || project.plan !== undefined
    )
  ) {
    issue(
      issues,
      "project_start_scope",
      "$",
      "an initial project contains intent only and cannot fabricate planning or technical state",
    );
  }
  validatePlanInvariants(project, issues);
  validatePlanChangeInvariants(project, issues);
  validateThreadSnapshotSubjects(project, issues);
  validatePhaseLocalInvariants(project, issues);

  const invariantIndex = buildEngineeringProjectInvariantIndex(project);
  const workItemOwnerByDecisionId = new Map<string, string>();
  validateDeclaredThreadSnapshotReferences(project, invariantIndex, issues);
  validatePhaseMembership(
    project,
    invariantIndex.workById,
    invariantIndex.decisionById,
    issues,
  );
  validateWorkItemGraphInvariants(
    project,
    invariantIndex.phaseById,
    invariantIndex.workById,
    invariantIndex.decisionById,
    invariantIndex.blockerById,
    invariantIndex.annotationOnlyWorkItemIds,
    workItemOwnerByDecisionId,
    issues,
  );
  validateGateClaimsAgainstCanonicalBrief(project, issues);
  detectWorkCycles(project.workItems, issues);

  project.agentRuns.forEach((run, index) =>
    validateRunInvariant(run, index, invariantIndex.workById, project, issues)
  );
  validateRunTransitionCommandUsage(project, issues);
  project.workItems.forEach((item, index) =>
    validateWorkItemReconciliationInvariant(item, index, project, issues)
  );
  project.decisions.forEach((decision, index) =>
    validateDecisionInvariant(
      decision,
      index,
      invariantIndex.phaseById,
      invariantIndex.approvalById,
      project.decisions,
      issues,
    )
  );
  project.approvals.forEach((approval, index) =>
    validateApprovalInvariant(approval, index, invariantIndex.decisionById, issues)
  );
  project.blockers.forEach((blocker, index) => {
    blocker.decisionIds.forEach((decisionId) => {
      blocker.workItemIds.forEach((workItemId, workItemIndex) =>
        claimDecisionWorkItemScope(
          workItemOwnerByDecisionId,
          decisionId,
          workItemId,
          `$.blockers[${index}].workItemIds[${workItemIndex}]`,
          issues,
        )
      );
    });
    validateBlockerInvariant(
      blocker,
      index,
      invariantIndex.phaseById,
      invariantIndex.workById,
      invariantIndex.decisionById,
      issues,
    );
  });
  (project.commandReceipts ?? []).forEach((receipt, index) =>
    validateCommandReceiptInvariant(receipt, index, project, issues)
  );
  validateQueuedRunReceiptBindings(project, issues);
  validateCancelledRunReceiptBindings(project, issues);
}

export function buildEngineeringProjectInvariantIndex(
  project: EngineeringProjectSnapshot,
): EngineeringProjectInvariantIndex {
  /**
   * Work item IDs whose sole completed run is an annotation run (annotationOnly:
   * true).  Annotation runs produce no ThreadSnapshot evidence; the invariant
   * "a completed work item requires exact ThreadSnapshot evidence" is explicitly
   * exempted for these items because their work is project-level state change,
   * not thread-level artifact production.
   */
  const annotationOnlyWorkItemIds = new Set(
    project.agentRuns
      .filter((run) => run.status === "completed" && run.annotationOnly === true)
      .map((run) => run.workItemId),
  );
  return {
    phaseById: new Map(project.phases.map((item) => [item.id, item])),
    workById: new Map(project.workItems.map((item) => [item.id, item])),
    decisionById: new Map(project.decisions.map((item) => [item.id, item])),
    approvalById: new Map(project.approvals.map((item) => [item.id, item])),
    blockerById: new Map(project.blockers.map((item) => [item.id, item])),
    annotationOnlyWorkItemIds,
    declaredSnapshots: new Set(
      project.threadSnapshots.map((item) =>
        snapshotKey(item.snapshotId, item.revision)
      ),
    ),
  };
}

function validateRevisionLineage(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (project.revision === 1 && project.previous !== undefined) {
    issue(
      issues,
      "unexpected_previous",
      "$.previous",
      "revision 1 cannot have a previous snapshot",
    );
  } else if (project.revision > 1 && project.previous === undefined) {
    issue(issues, "missing_previous", "$.previous", "is required after revision 1");
  } else if (
    project.previous && project.previous.revision !== project.revision - 1
  ) {
    issue(
      issues,
      "invalid_revision",
      "$.previous.revision",
      "must be the immediately preceding revision",
    );
  }
}

function validateThreadSnapshotSubjects(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  project.threadSnapshots.forEach((reference, index) => {
    if (reference.subjectId !== project.project.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `$.threadSnapshots[${index}].subjectId`,
        "must match the project subjectId",
      );
    }
    if (reference.snapshotId.toLowerCase() === "latest") {
      issue(
        issues,
        "non_exact_reference",
        `$.threadSnapshots[${index}].snapshotId`,
        "cannot use a latest alias",
      );
    }
  });
}

function validateDeclaredThreadSnapshotReferences(
  project: EngineeringProjectSnapshot,
  invariantIndex: EngineeringProjectInvariantIndex,
  issues: EngineeringProjectValidationIssue[],
): void {
  const declaredSnapshots = invariantIndex.declaredSnapshots;
  allEvidenceRefs(project).forEach(({ reference, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(reference.snapshotId, reference.snapshotRevision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  operationThreadEntityRefs(project).forEach(({ reference, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(reference.snapshotId, reference.snapshotRevision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  executionBindings(project).forEach(({ baseSnapshot, path }) => {
    if (
      !declaredSnapshots.has(
        snapshotKey(baseSnapshot.snapshotId, baseSnapshot.revision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        path,
        "references an undeclared ThreadSnapshot revision",
      );
    }
    if (baseSnapshot.subjectId !== project.project.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `${path}.subjectId`,
        "must match the project subjectId",
      );
    }
  });
  project.agentRuns.forEach((run, index) => {
    if (!run.resultSnapshot) return;
    if (
      !declaredSnapshots.has(
        snapshotKey(run.resultSnapshot.snapshotId, run.resultSnapshot.revision),
      )
    ) {
      issue(
        issues,
        "unknown_thread_snapshot",
        `$.agentRuns[${index}].resultSnapshot`,
        "references an undeclared ThreadSnapshot revision",
      );
    }
  });
  project.workItems.forEach((item, index) => {
    const reconciliation = item.reconciliation;
    if (!reconciliation) return;
    // successorSnapshot is absent for a direct reconciliation — skip the
    // cross-reference check for it when the field is undefined.
    const snapshotRefs: Array<
      [string, { snapshotId: string; revision: number }]
    > = [["successorRunSnapshot", reconciliation.successorRunSnapshot]];
    if (reconciliation.successorSnapshot !== undefined) {
      snapshotRefs.push(["successorSnapshot", reconciliation.successorSnapshot]);
    }
    for (const [name, reference] of snapshotRefs) {
      if (
        !declaredSnapshots.has(
          snapshotKey(reference.snapshotId, reference.revision),
        )
      ) {
        issue(
          issues,
          "unknown_thread_snapshot",
          `$.workItems[${index}].reconciliation.${name}`,
          "references an undeclared ThreadSnapshot revision",
        );
      }
    }
  });
}
