import type {
  EngineeringAgentRun,
  EngineeringApprovedBriefBasis,
  EngineeringCancelledRunReceiptBinding,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../engineering-project.ts";
import {
  ENGINEERING_PROJECT_SCHEMA_VERSION,
  queuedRunCancellationSummary,
} from "../engineering-project.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue } from "./engineering-project-validation-issue.ts";
import { uniqueStrings } from "./engineering-project-value-validation.ts";
import {
  chronological,
  sameApprovedBriefBasis,
  sameOptionalResolvedPlanReference,
  uniqueEvidence,
} from "./engineering-project-invariant-values.ts";

function validateRunBasisInvariant(
  run: EngineeringAgentRun,
  index: number,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (project.schemaVersion !== ENGINEERING_PROJECT_SCHEMA_VERSION) return;
  const path = `$.agentRuns[${index}]`;
  const basis = run.basis;
  if (!basis) return;
  if (basis.kind === "approved-brief") {
    const plan = project.plan;
    if (
      !plan || plan.basis.kind !== "approved-brief" ||
      !sameApprovedBriefBasis(basis, plan.basis)
    ) {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.basis`,
        "an approved-brief run must use the exact published plan basis",
      );
    }
    const workItem = workById.get(run.workItemId);
    if (
      !workItem?.operation ||
      workItem.operation.id !== "baseline.from-approved-brief" ||
      workItem.operation.version !== "1"
    ) {
      issue(
        issues,
        "invalid_transition",
        `${path}.workItemId`,
        "an approved-brief basis is valid only for baseline.from-approved-brief@1",
      );
    }
    if (!run.resultSnapshot && project.threadSnapshots.length > 0) {
      issue(
        issues,
        "invalid_transition",
        `${path}.basis`,
        "an approved-brief run cannot remain active after its documentary ThreadSnapshot exists",
      );
    }
    return;
  }
}

export function validateRunInvariant(
  run: EngineeringAgentRun,
  index: number,
  workById: ReadonlyMap<string, EngineeringWorkItem>,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.agentRuns[${index}]`;
  const workItem = workById.get(run.workItemId);
  if (!workItem) {
    issue(
      issues,
      "missing_reference",
      `${path}.workItemId`,
      "does not reference a work item",
    );
  }
  validateResolvedOperationPlanRunInvariant(
    run,
    index,
    workItem,
    project,
    issues,
  );
  validateRunBasisInvariant(run, index, workById, project, issues);
  uniqueEvidence(run.evidenceRefs, `${path}.evidenceRefs`, issues);
  uniqueStrings(
    run.waitingForDecisionIds ?? [],
    `${path}.waitingForDecisionIds`,
    issues,
  );
  uniqueStrings(
    (run.statusHistory ?? []).map((transition) => transition.commandId),
    `${path}.statusHistory`,
    issues,
  );
  const active = ["running", "waiting-for-decision", "publishing"].includes(run.status);
  const executionTerminal = ["completed", "failed"].includes(run.status);
  if (run.status === "queued" && (run.startedAt || run.completedAt)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a queued run cannot have start or completion timestamps",
    );
  }
  if (
    run.status === "queued" &&
    (run.claimedAt || run.claimedBy || run.waitingForDecisionIds ||
      run.resultSnapshot || run.failure)
  ) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a queued run cannot have claim, waiting, result or failure fields",
    );
  }
  if (active && (!run.claimedAt || !run.claimedBy)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "an active run must have an agent claim",
    );
  }
  if (active && (!run.startedAt || run.completedAt)) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "an active run requires startedAt and no completedAt",
    );
  }
  if (executionTerminal && !run.completedAt) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a terminal run requires completedAt",
    );
  }
  /**
   * Annotation runs (agent-run.reconcile-annotation) go directly queued →
   * completed without a claim step, so they lack startedAt/claimedAt/claimedBy.
   * Evidence-producing runs (agent-run.complete) must still have startedAt.
   */
  if (executionTerminal && !run.annotationOnly && !run.startedAt) {
    issue(
      issues,
      "invalid_run_lifecycle",
      path,
      "a terminal non-annotation run requires startedAt",
    );
  }
  if (
    run.status === "completed" && !run.annotationOnly && run.evidenceRefs.length === 0
  ) {
    issue(
      issues,
      "missing_evidence",
      `${path}.evidenceRefs`,
      "a completed run requires exact ThreadSnapshot evidence",
    );
  }
  if (run.status === "completed" && !run.annotationOnly && !run.resultSnapshot) {
    issue(
      issues,
      "missing_evidence",
      `${path}.resultSnapshot`,
      "a completed run requires an exact result ThreadSnapshot",
    );
  }
  if (run.annotationOnly && run.status === "completed" && run.resultSnapshot) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.resultSnapshot`,
      "an annotation run must not have a result ThreadSnapshot",
    );
  }
  if (run.annotationOnly && run.status === "completed" && run.evidenceRefs.length > 0) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.evidenceRefs`,
      "an annotation run must not carry ThreadSnapshot evidence refs",
    );
  }
  if (
    run.status === "completed" && run.resultSnapshot &&
    run.evidenceRefs.some((reference) =>
      reference.snapshotId !== run.resultSnapshot?.snapshotId ||
      reference.snapshotRevision !== run.resultSnapshot?.revision
    )
  ) {
    issue(
      issues,
      "result_evidence_mismatch",
      `${path}.evidenceRefs`,
      "completed evidence must belong to the exact result ThreadSnapshot",
    );
  }
  if (run.status === "failed" && !run.failure) {
    issue(
      issues,
      "missing_failure",
      `${path}.failure`,
      "a failed run requires a structured failure",
    );
  }
  if (run.status !== "failed" && run.failure) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.failure`,
      "failure is only valid for a failed run",
    );
  }
  if (run.status === "cancelled") {
    if (!run.cancellation) {
      issue(
        issues,
        "missing_cancellation",
        `${path}.cancellation`,
        "a cancelled run requires an explicit human queued-run cancellation",
      );
    }
    if (run.cancellation?.cancelledBy.origin !== "human") {
      issue(
        issues,
        "cancellation_origin_forbidden",
        `${path}.cancellation.cancelledBy.origin`,
        "only a human origin can cancel an unclaimed queued run",
      );
    }
    if (
      run.startedAt || run.completedAt || run.claimedAt || run.claimedBy ||
      run.waitingForDecisionIds || run.resultSnapshot || run.failure ||
      run.evidenceRefs.length !== 0
    ) {
      issue(
        issues,
        "invalid_run_lifecycle",
        path,
        "a cancelled queued run cannot contain execution, result, failure or evidence fields",
      );
    }
    const history = run.statusHistory;
    const queuedTransition = history?.[0];
    const finalTransition = history?.at(-1);
    if (
      !history || history.length !== 2 || queuedTransition?.status !== "queued" ||
      Date.parse(queuedTransition.at) !== Date.parse(run.queuedAt) ||
      finalTransition?.status !== "cancelled" ||
      Date.parse(queuedTransition.at) > Date.parse(finalTransition.at)
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.statusHistory`,
        "a cancelled queued run must contain exactly its initial queued transition at queuedAt and its final cancelled transition",
      );
    }
    const queueReceipt = queuedTransition
      ? (project.commandReceipts ?? []).find((receipt) =>
        receipt.type === "agent-run.queue" &&
        receipt.commandId === queuedTransition.commandId
      )
      : undefined;
    if (
      !queuedTransition || !queueReceipt ||
      queueReceipt.actor.id !== queuedTransition.actor.id ||
      queueReceipt.actor.origin !== queuedTransition.actor.origin ||
      Date.parse(queueReceipt.appliedAt) !== Date.parse(run.queuedAt) ||
      Date.parse(queueReceipt.appliedAt) !== Date.parse(queuedTransition.at) ||
      (queueReceipt.queuedRun !== undefined &&
        !matchesQueuedRunReceiptBinding(run, queueReceipt))
    ) {
      issue(
        issues,
        "missing_queue_receipt",
        `${path}.statusHistory[0]`,
        "must be anchored by its exact agent-run.queue receipt at queuedAt",
      );
    }
    if (
      run.cancellation &&
      (!finalTransition || finalTransition.status !== "cancelled" ||
        Date.parse(finalTransition.at) !== Date.parse(run.cancellation.cancelledAt) ||
        finalTransition.actor.id !== run.cancellation.cancelledBy.id ||
        finalTransition.actor.origin !== run.cancellation.cancelledBy.origin)
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.cancellation`,
        "must exactly match the final cancelled status transition",
      );
    }
    const cancellationReceipt = run.cancellation && finalTransition
      ? (project.commandReceipts ?? []).find((receipt) =>
        receipt.type === "agent-run.cancel" &&
        receipt.commandId === finalTransition.commandId
      )
      : undefined;
    if (
      run.cancellation &&
      (!cancellationReceipt || cancellationReceipt.actor.origin !== "human" ||
        cancellationReceipt.actor.id !== run.cancellation.cancelledBy.id ||
        cancellationReceipt.actor.origin !== run.cancellation.cancelledBy.origin ||
        Date.parse(cancellationReceipt.appliedAt) !==
          Date.parse(run.cancellation.cancelledAt) ||
        Date.parse(cancellationReceipt.appliedAt) !== Date.parse(finalTransition!.at) ||
        !matchesCancelledRunReceiptBinding(run, cancellationReceipt.cancelledRun) ||
        !queueAndCancellationReceiptBindingsAgree(
          queueReceipt,
          cancellationReceipt,
        ))
    ) {
      issue(
        issues,
        "missing_cancellation_receipt",
        `${path}.cancellation`,
        "must be anchored by its exact human agent-run.cancel receipt",
      );
    }
    if (run.cancellation) {
      const expectedSummary = queuedRunCancellationSummary(
        run.cancellation.rationale,
      );
      if (run.summary !== expectedSummary) {
        issue(
          issues,
          "invalid_run_cancellation_summary",
          `${path}.summary`,
          "must be the server-derived queued-run cancellation summary",
        );
      }
      if (finalTransition?.summary !== expectedSummary) {
        issue(
          issues,
          "invalid_run_cancellation_summary",
          `${path}.statusHistory[1].summary`,
          "must be the server-derived queued-run cancellation summary",
        );
      }
    }
  } else if (run.cancellation) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.cancellation`,
      "cancellation is only valid for a cancelled queued run",
    );
  }
  if (
    run.status === "waiting-for-decision" &&
    (run.waitingForDecisionIds?.length ?? 0) === 0
  ) {
    issue(
      issues,
      "missing_decision",
      `${path}.waitingForDecisionIds`,
      "a waiting run must name at least one exact decision",
    );
  }
  if (run.status !== "waiting-for-decision" && run.waitingForDecisionIds) {
    issue(
      issues,
      "invalid_run_lifecycle",
      `${path}.waitingForDecisionIds`,
      "waiting decision ids are only valid while waiting",
    );
  }
  if (run.statusHistory) {
    if (
      run.statusHistory.length === 0 || run.statusHistory.at(-1)?.status !== run.status
    ) {
      issue(
        issues,
        "invalid_run_history",
        `${path}.statusHistory`,
        "must end with the current run status",
      );
    }
    run.statusHistory.forEach((transition, transitionIndex) => {
      if (
        transitionIndex > 0 &&
        Date.parse(transition.at) <
          Date.parse(run.statusHistory![transitionIndex - 1].at)
      ) {
        issue(
          issues,
          "invalid_chronology",
          `${path}.statusHistory[${transitionIndex}].at`,
          "cannot precede the previous transition",
        );
      }
    });
  }
  chronological(run.queuedAt, run.startedAt, `${path}.startedAt`, issues);
  chronological(run.startedAt, run.completedAt, `${path}.completedAt`, issues);
}

/**
 * Resolved-operation-plan/2.0 is a closed persisted contract, not a marker
 * that can be dropped from a stored snapshot. The exact plan-bearing operation
 * identities require the server-stamped run and queue-receipt references;
 * every other operation, including immutable @1 history, must remain planless.
 */
function validateResolvedOperationPlanRunInvariant(
  run: EngineeringAgentRun,
  index: number,
  workItem: EngineeringWorkItem | undefined,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.agentRuns[${index}]`;
  const requiresPlan = isResolvedOperationPlanV2Operation(workItem?.operation);
  const queueCommandId = run.statusHistory?.[0]?.commandId;
  const queueReceipt = queueCommandId
    ? project.commandReceipts?.find((receipt) =>
      receipt.type === "agent-run.queue" && receipt.commandId === queueCommandId
    )
    : undefined;
  const receiptPlan = queueReceipt?.queuedRun?.resolvedOperationPlan;

  if (!requiresPlan) {
    if (run.resolvedOperationPlan !== undefined) {
      issue(
        issues,
        "unexpected_resolved_operation_plan",
        `${path}.resolvedOperationPlan`,
        "is allowed only for a closed plan-bearing operation identity",
      );
    }
    if (receiptPlan !== undefined) {
      issue(
        issues,
        "unexpected_resolved_operation_plan",
        "$.commandReceipts",
        "a queue receipt may carry a resolved operation plan only for a closed plan-bearing run",
      );
    }
    return;
  }

  if (!run.resolvedOperationPlan) {
    issue(
      issues,
      "missing_resolved_operation_plan",
      `${path}.resolvedOperationPlan`,
      "is required for a closed plan-bearing operation",
    );
  } else if (run.resolvedOperationPlan.planId !== run.id) {
    issue(
      issues,
      "invalid_resolved_operation_plan_identity",
      `${path}.resolvedOperationPlan.planId`,
      "must equal the exact persisted run id",
    );
  }
  if (!queueReceipt?.queuedRun) {
    issue(
      issues,
      "missing_resolved_operation_plan_receipt",
      `${path}.statusHistory[0]`,
      "a closed plan-bearing operation requires its exact queue receipt binding",
    );
    return;
  }
  if (
    !receiptPlan ||
    !sameOptionalResolvedPlanReference(run.resolvedOperationPlan, receiptPlan)
  ) {
    issue(
      issues,
      "invalid_resolved_operation_plan_receipt",
      `${path}.resolvedOperationPlan`,
      "must exactly match the server-stamped resolved operation plan on its queue receipt",
    );
  }
}

function isResolvedOperationPlanV2Operation(
  operation: EngineeringWorkItem["operation"],
): boolean {
  return (
    operation?.id === "verify.run-fea-static-proof" &&
    (operation.version === "2" || operation.version === "3")
  );
}

/**
 * A command receipt is globally unique, so one transition commandId must
 * belong to one agent run. This prevents copying an otherwise valid cancelled
 * history to a second work item and claiming the same queue/cancel receipts.
 * Older snapshots without transition history remain readable.
 */
export function validateRunTransitionCommandUsage(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const ownerByCommandId = new Map<string, { runId: string }>();
  project.agentRuns.forEach((run, runIndex) => {
    run.statusHistory?.forEach((transition, transitionIndex) => {
      const path =
        `$.agentRuns[${runIndex}].statusHistory[${transitionIndex}].commandId`;
      const owner = ownerByCommandId.get(transition.commandId);
      if (owner && owner.runId !== run.id) {
        issue(
          issues,
          "duplicate_run_transition_command",
          path,
          `commandId ${transition.commandId} is already bound to agent run ${owner.runId}`,
        );
        return;
      }
      if (!owner) ownerByCommandId.set(transition.commandId, { runId: run.id });
    });
  });
}

function matchesQueuedRunReceiptBinding(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
): boolean {
  const queuedTransition = run.statusHistory?.[0];
  const binding = receipt.queuedRun;
  return receipt.type === "agent-run.queue" && !!binding &&
    queuedTransition?.status === "queued" &&
    receipt.commandId === queuedTransition.commandId &&
    receipt.actor.id === queuedTransition.actor.id &&
    receipt.actor.origin === queuedTransition.actor.origin &&
    Date.parse(receipt.appliedAt) === Date.parse(queuedTransition.at) &&
    binding.runId === run.id &&
    binding.workItemId === run.workItemId &&
    sameOptionalResolvedPlanReference(
      run.resolvedOperationPlan,
      binding.resolvedOperationPlan,
    );
}

function queueAndCancellationReceiptBindingsAgree(
  queueReceipt: EngineeringProjectCommandReceipt | undefined,
  cancellationReceipt: EngineeringProjectCommandReceipt,
): boolean {
  const queuedRun = queueReceipt?.queuedRun;
  if (!queuedRun) return true;
  const cancelledRun = cancellationReceipt.cancelledRun;
  return queuedRun.runId === cancelledRun?.runId &&
    queuedRun.workItemId === cancelledRun.workItemId &&
    queueReceipt.commandId === cancelledRun.queuedCommandId;
}

/**
 * New queue receipts seal their queued run, while receipts created before the
 * binding was introduced remain valid legacy history. When the field exists,
 * it is a one-to-one, actor-and-time anchor for the initial queued transition.
 */
export function validateQueuedRunReceiptBindings(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const queueReceipts = (project.commandReceipts ?? []).map((receipt, index) => ({
    receipt,
    index,
  })).filter(({ receipt }) =>
    receipt.type === "agent-run.queue" && receipt.queuedRun !== undefined
  );

  queueReceipts.forEach(({ receipt, index }) => {
    const matches = project.agentRuns.filter((run) =>
      matchesQueuedRunReceiptBinding(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "invalid_queued_run_receipt_binding",
        `$.commandReceipts[${index}].queuedRun`,
        "must identify exactly one run and its initial queued transition",
      );
    }
  });
}

function matchesCancelledRunReceiptBinding(
  run: EngineeringAgentRun,
  binding: EngineeringCancelledRunReceiptBinding | undefined,
): boolean {
  const queuedTransition = run.statusHistory?.[0];
  return !!binding && queuedTransition?.status === "queued" &&
    binding.runId === run.id &&
    binding.workItemId === run.workItemId &&
    binding.queuedCommandId === queuedTransition.commandId;
}

function runMatchesCancellationReceipt(
  run: EngineeringAgentRun,
  receipt: EngineeringProjectCommandReceipt,
): boolean {
  return receipt.type === "agent-run.cancel" &&
    run.status === "cancelled" &&
    receipt.commandId === run.statusHistory?.at(-1)?.commandId &&
    matchesCancelledRunReceiptBinding(run, receipt.cancelledRun);
}

/**
 * A cancellation receipt is a one-to-one, server-stamped seal over its
 * cancelled run. It carries enough immutable identity to reject a copied
 * status history even when an older queue receipt has no such binding.
 */
export function validateCancelledRunReceiptBindings(
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const cancelledRuns = project.agentRuns.filter((run) => run.status === "cancelled");
  const cancellationReceipts = (project.commandReceipts ?? []).map((
    receipt,
    index,
  ) => ({ receipt, index })).filter(({ receipt }) =>
    receipt.type === "agent-run.cancel"
  );

  cancellationReceipts.forEach(({ receipt, index }) => {
    const matches = cancelledRuns.filter((run) =>
      runMatchesCancellationReceipt(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "invalid_cancellation_receipt_binding",
        `$.commandReceipts[${index}].cancelledRun`,
        "must identify exactly one cancelled run, work item and initial queued command",
      );
    }
  });

  project.agentRuns.forEach((run, index) => {
    if (run.status !== "cancelled") return;
    const matches = cancellationReceipts.filter(({ receipt }) =>
      runMatchesCancellationReceipt(run, receipt)
    );
    if (matches.length !== 1) {
      issue(
        issues,
        "missing_cancellation_receipt_binding",
        `$.agentRuns[${index}].cancellation`,
        "must be sealed by exactly one matching agent-run.cancel receipt binding",
      );
    }
  });
}

export function validateCommandReceiptInvariant(
  receipt: EngineeringProjectCommandReceipt,
  index: number,
  project: EngineeringProjectSnapshot,
  issues: EngineeringProjectValidationIssue[],
): void {
  const path = `$.commandReceipts[${index}]`;
  if (
    receipt.approvedBriefBasis !== undefined &&
    receipt.type !== "project.brief-approve"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.approvedBriefBasis`,
      "is permitted only on a project.brief-approve receipt",
    );
  }
  if (
    receipt.cancelledRun !== undefined &&
    receipt.type !== "agent-run.cancel"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.cancelledRun`,
      "is permitted only on an agent-run.cancel receipt",
    );
  }
  if (
    receipt.queuedRun !== undefined &&
    receipt.type !== "agent-run.queue"
  ) {
    issue(
      issues,
      "schema_version_mismatch",
      `${path}.queuedRun`,
      "is permitted only on an agent-run.queue receipt",
    );
  }
  if (
    receipt.type === "agent-run.cancel" &&
    receipt.cancelledRun === undefined
  ) {
    issue(
      issues,
      "missing_cancellation_receipt_binding",
      `${path}.cancelledRun`,
      "is required for every agent-run.cancel receipt",
    );
  }
  if (
    project.schemaVersion === ENGINEERING_PROJECT_SCHEMA_VERSION &&
    receipt.type === "project.brief-approve" &&
    receipt.approvedBriefBasis === undefined
  ) {
    issue(
      issues,
      "approval_scope_mismatch",
      `${path}.approvedBriefBasis`,
      "is required for every V3 human brief approval",
    );
  }
  if (receipt.approvedBriefBasis) {
    const basis = receipt.approvedBriefBasis;
    if (
      basis.projectId !== project.project.id ||
      basis.projectSnapshotId !== receipt.resultingSnapshot.snapshotId ||
      basis.projectRevision !== receipt.resultingSnapshot.revision
    ) {
      issue(
        issues,
        "approval_scope_mismatch",
        `${path}.approvedBriefBasis`,
        "must identify this project and the exact snapshot created by the approval receipt",
      );
    }
    const framing = project.framing;
    const brief = framing?.currentBrief;
    const approval = framing?.currentBriefApproval;
    if (
      brief && approval?.status === "approved" && approval.decidedAt &&
      Date.parse(approval.decidedAt) === Date.parse(receipt.appliedAt) &&
      approval.decidedBy?.id === receipt.actor.id &&
      approval.decidedBy.origin === receipt.actor.origin
    ) {
      const expected: EngineeringApprovedBriefBasis = {
        kind: "approved-brief",
        projectId: project.project.id,
        projectSnapshotId: receipt.resultingSnapshot.snapshotId,
        projectRevision: receipt.resultingSnapshot.revision,
        briefId: brief.briefId,
        briefSnapshotId: brief.id,
        briefRevision: brief.revision,
        approvedBriefFingerprint: approval.inputFingerprint,
      };
      if (!sameApprovedBriefBasis(basis, expected)) {
        issue(
          issues,
          "approval_scope_mismatch",
          `${path}.approvedBriefBasis`,
          "must exactly describe the canonical brief approved by this receipt",
        );
      }
    }
  }
  const firstCommandRevision = 1;
  if (
    receipt.resultingSnapshot.revision < firstCommandRevision ||
    receipt.resultingSnapshot.revision > project.revision
  ) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.revision`,
      "must address a command-created revision in this project history",
    );
  }
  if (
    receipt.resultingSnapshot.revision === project.revision &&
    receipt.resultingSnapshot.snapshotId !== project.id
  ) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.snapshotId`,
      "must match the current snapshot id for the current revision",
    );
  }
  if (receipt.resultingSnapshot.revision !== index + firstCommandRevision) {
    issue(
      issues,
      "invalid_revision",
      `${path}.resultingSnapshot.revision`,
      `must equal command revision ${index + firstCommandRevision}`,
    );
  }
  const isProjectStart = index === 0;
  if (isProjectStart && receipt.type !== "project.start") {
    issue(
      issues,
      "invalid_project_start_receipt",
      `${path}.type`,
      "the first V3 receipt must create the project from its reported intent",
    );
  }
  if (!isProjectStart && receipt.type === "project.start") {
    issue(
      issues,
      "invalid_project_start_receipt",
      `${path}.type`,
      "project.start is valid only for the first V3 revision",
    );
  }
  if (
    (receipt.type === "project.plan-publish" ||
      receipt.type === "project.change-append" ||
      receipt.type === "work-item.reconcile-successor" ||
      receipt.type === "project.question-propose" ||
      receipt.type === "project.brief-propose") &&
    receipt.actor.origin !== "agent"
  ) {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.actor.origin`,
      `${receipt.type} requires agent authority`,
    );
  }
  if (
    (receipt.type === "project.brief-approve" ||
      receipt.type === "project.brief-reject" ||
      receipt.type === "agent-run.cancel") &&
    receipt.actor.origin !== "human"
  ) {
    issue(
      issues,
      "command_authority_mismatch",
      `${path}.actor.origin`,
      `${receipt.type} requires human authority`,
    );
  }
  if (
    isProjectStart && project.revision === 1 &&
    Date.parse(receipt.appliedAt) !== Date.parse(project.generatedAt)
  ) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "must equal the initial project snapshot generation time",
    );
  }
  if (
    isProjectStart &&
    Date.parse(receipt.issuedAt) > Date.parse(receipt.appliedAt)
  ) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.issuedAt`,
      "cannot be later than the authoritative command application time",
    );
  }
  const previous = project.commandReceipts?.[index - 1];
  if (previous && Date.parse(receipt.appliedAt) < Date.parse(previous.appliedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "cannot precede the previous command application time",
    );
  }
  if (Date.parse(receipt.appliedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.appliedAt`,
      "cannot be later than the project snapshot generation time",
    );
  }
}
