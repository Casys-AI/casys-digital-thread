import type {
  EngineeringDecision,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../../domain/cad/canonical/geometry-proposal.ts";
import {
  requireApprovedUncertainWriterReconciliationDecision,
  TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES,
} from "../../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import type {
  UncertainWriterLifecycleEligibility,
} from "../../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";
import {
  UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED,
} from "../../../../domain/record/uncertain-writer-lifecycle-eligibility.ts";
import {
  uncertainWriterBasisReleaseIds,
  uncertainWriterBasisReleaseText,
} from "../../../../domain/record/uncertain-writer-basis-release.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type { ReconcileAnnotationRunCommand } from "./engineering-project-commands.ts";
import {
  actor,
  findDecision,
  findRun,
  findWorkItem,
  invalidInput,
  invalidTransition,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
  transition,
} from "./engineering-project-transition-values.ts";

const ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES = TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES;

/** Shared eligibility rule for the annotation and later successor closeout. */
export function isEligibleUncertainWriterFailure(
  failureCode: string,
  operation: { readonly id: string; readonly version: string } | undefined,
  lifecycle: UncertainWriterLifecycleEligibility =
    UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED,
): boolean {
  return ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES.has(failureCode) ||
    (operation !== undefined &&
      `${operation.id}@${operation.version}` ===
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`) ||
    lifecycle.status === "qualified-uncertain-write";
}

export async function applyReconcileAnnotationRun(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: ReconcileAnnotationRunCommand,
  lifecycle: UncertainWriterLifecycleEligibility =
    UNCERTAIN_WRITER_LIFECYCLE_NOT_QUALIFIED,
): Promise<void> {
  nonEmpty(command.reconciliationRunId, "reconciliationRunId");
  nonEmpty(command.failedRunId, "failedRunId");
  nonEmpty(command.decisionId, "decisionId");
  nonEmpty(
    command.providerInspectionAttestation,
    "providerInspectionAttestation",
  );
  if (
    command.outcome !== "provider-did-not-write" &&
    command.outcome !== "write-effect-accepted"
  ) {
    invalidInput(
      'outcome must be "provider-did-not-write" or "write-effect-accepted".',
    );
  }
  if (command.reconciliationRunId === command.failedRunId) {
    invalidInput("A reconciliation run cannot target itself as the failed run.");
  }

  // Reconciliation run must be queued and unstarted.
  const reconciliationRun = findRun(draft, command.reconciliationRunId);
  if (!reconciliationRun) {
    notFound("reconciliation agent run", command.reconciliationRunId);
  }
  if (reconciliationRun.status !== "queued") {
    invalidTransition(
      `Reconciliation run ${reconciliationRun.id} must be queued; it is ${reconciliationRun.status}.`,
    );
  }
  if (
    reconciliationRun.startedAt || reconciliationRun.completedAt ||
    reconciliationRun.claimedAt || reconciliationRun.claimedBy ||
    reconciliationRun.waitingForDecisionIds || reconciliationRun.resultSnapshot ||
    reconciliationRun.failure || reconciliationRun.evidenceRefs.length !== 0
  ) {
    invalidTransition(
      `Queued reconciliation run ${reconciliationRun.id} has unexpected execution state.`,
    );
  }

  // Target run must be a terminal failed run with no existing reconciliation.
  const failedRun = findRun(draft, command.failedRunId);
  if (!failedRun) notFound("failed agent run", command.failedRunId);
  if (failedRun.status !== "failed" || !failedRun.failure) {
    invalidTransition(
      `Target run ${failedRun.id} must be a failed run with a structured failure.`,
    );
  }

  // Domain eligibility guard: only terminal-uncertain failures (or the geometry
  // write, which is conservatively terminal) may be reconciled.  This prevents
  // bypassing the executor-level gate via a direct domain call.
  const failedWorkItem = findWorkItem(draft, failedRun.workItemId);
  if (!failedWorkItem) {
    notFound("work item for failed run", failedRun.workItemId);
  }
  if (
    !isEligibleUncertainWriterFailure(
      failedRun.failure.code,
      failedWorkItem.operation,
      lifecycle,
    )
  ) {
    invalidTransition(
      `Target run ${failedRun.id} failure code "${failedRun.failure.code}" is not in ` +
        "ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES, is not the geometry write operation, " +
        "and is not a server-qualified uncertain writer. " +
        "Only terminal-uncertain failures are eligible for uncertain-writer reconciliation.",
    );
  }

  if (failedRun.uncertainWriterReconciliation !== undefined) {
    invalidTransition(
      `Target run ${failedRun.id} already has an uncertainWriterReconciliation; ` +
        "a run can be reconciled only once.",
    );
  }
  if (failedRun.evidenceRefs.length !== 0) {
    invalidTransition(
      `Target run ${failedRun.id} has evidence refs; uncertain writer reconciliation ` +
        "is not applicable to runs that produced evidence.",
    );
  }

  try {
    await requireApprovedUncertainWriterReconciliationDecision(
      draft,
      reconciliationRun,
      failedRun,
      {
        decisionId: command.decisionId,
        outcome: command.outcome,
        providerInspectionAttestation: command.providerInspectionAttestation,
      },
    );
  } catch (error) {
    invalidTransition(
      `The reconciliation command has no exact approved MRTR authority: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // The service owns provenance. Caller-supplied actors or timestamps can
  // never masquerade as the authoritative application event.
  failedRun.uncertainWriterReconciliation = {
    kind: "uncertain-writer-resolved",
    outcome: command.outcome,
    reconciledAt: appliedAt,
    reconciledBy: actor(origin),
    decisionId: command.decisionId,
    providerInspectionAttestation: command.providerInspectionAttestation,
  };

  // An accepted provider effect creates a server-owned blocker plus a
  // separate required decision. The decision is phase/blocker-linked but
  // deliberately not attached to the failed writer work item: doing so
  // would apply that writer operation's proposal grammar to this release.
  if (command.outcome === "write-effect-accepted") {
    const ids = uncertainWriterBasisReleaseIds(failedRun.id);
    const text = uncertainWriterBasisReleaseText(failedRun.id);
    if (draft.blockers.some((b) => b.id === ids.blockerId)) {
      invalidInput(`Blocker id ${ids.blockerId} already exists.`);
    }
    if (findDecision(draft, ids.decisionId)) {
      invalidInput(
        `Resolution decision id ${ids.decisionId} already exists.`,
      );
    }
    const resolutionDecision: Mutable<EngineeringDecision> = {
      id: ids.decisionId,
      phaseId: failedWorkItem.phaseId,
      title: text.decisionTitle,
      question: text.decisionQuestion,
      status: "required",
      requestedAt: appliedAt,
      inputEvidenceRefs: [],
      approvalIds: [],
    };
    draft.decisions.push(resolutionDecision);
    const phase = draft.phases.find((item) => item.id === failedWorkItem.phaseId)!;
    phase.requiredDecisionIds = [
      ...phase.requiredDecisionIds,
      resolutionDecision.id,
    ];
    draft.blockers.push({
      id: ids.blockerId,
      phaseId: failedWorkItem.phaseId,
      title: text.blockerTitle,
      description: text.blockerDescription,
      kind: "tool-failure",
      status: "open",
      openedAt: appliedAt,
      workItemIds: [failedWorkItem.id],
      decisionIds: [resolutionDecision.id],
    });
    // Bidirectional cross-reference: the failed work item must know it has a blocker.
    failedWorkItem.blockerIds = [
      ...failedWorkItem.blockerIds,
      ids.blockerId,
    ];
  }

  // Recovery never reopens the original provider attempt.  Its failed run
  // remains the durable failure record, while the work item becomes terminal
  // so that the next attempt must be an append-only successor revision.
  failedWorkItem.status = "cancelled";

  // Complete the reconciliation run (annotation-only, no ThreadSnapshot).
  const summary = "Uncertain-writer reconciliation completed by human operator.";
  reconciliationRun.status = "completed";
  reconciliationRun.annotationOnly = true;
  reconciliationRun.completedAt = appliedAt;
  reconciliationRun.summary = summary;
  reconciliationRun.statusHistory ??= [];
  reconciliationRun.statusHistory.push(transition(
    { commandId: command.commandId, summary },
    origin,
    "completed",
    appliedAt,
  ));

  const workItem = findWorkItem(draft, reconciliationRun.workItemId)!;
  workItem.status = "completed";
  recomputeWorkReadiness(draft);
}
