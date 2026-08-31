import {
  type EngineeringAgentRun,
  type EngineeringAgentRunStatus,
  type EngineeringAgentRunUncertainWriterReconciliation,
  type EngineeringCancelledRunReceiptBinding,
  type EngineeringProjectCommandName,
  type EngineeringProjectSnapshot,
  type EngineeringQueuedRunReceiptBinding,
} from "../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/thread/thread-snapshot.ts";
import { TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES } from "../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import {
  closedUncertainWriterLifecycleQualifier,
  type UncertainWriterLifecycleQualifier,
} from "../../ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "../../ports/out/engineering-project-revision-store.ts";
import type { EngineeringProjectCommandOrigin } from "../../ports/in/engineering-project-command-origin.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandErrorCode,
} from "./commands/engineering-project-command-error.ts";
import {
  assertAllowed,
  ENGINEERING_PROJECT_COMMAND_POLICY,
} from "./commands/engineering-project-command-policy.ts";
import type {
  AbandonWorkItemsCommand,
  AcceptCrossDomainImpactDecisionCommand,
  AppendProjectChangeCommand,
  CancelQueuedRunCommand,
  CompleteRunCommand,
  DecideDecisionCommand,
  EngineeringDecisionProposalInput,
  EngineeringProjectCommandInput,
  EngineeringProjectCompletionEvidenceValidator,
  EngineeringProjectInitialCompletionEvidenceValidator,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  EngineeringProjectQueueEligibility,
  EngineeringProjectReconciliationOperationPolicy,
  EngineeringProjectReconciliationSnapshotValidator,
  FailRunCommand,
  PlannedEngineeringDecision,
  PlannedEngineeringProjectPhase,
  PlannedEngineeringWorkItem,
  ProposeDecisionCommand,
  PublishProjectPlanCommand,
  QueueRunCommand,
  ReconcileAnnotationRunCommand,
  ReconcileWorkItemWithSuccessorCommand,
  RunCommand,
} from "./commands/engineering-project-commands.ts";
import {
  applyAppendChange,
  applyPublishPlan,
  approvedBriefBasisForProject,
} from "./commands/project-planning-transitions.ts";
import {
  applyDecideDecision,
  applyProposeDecision,
} from "./commands/engineering-decision-transitions.ts";
import {
  applyCancelQueuedRun,
  applyClaimRun,
  applyCompleteRun,
  applyFailRun,
  applyOrdinaryRunTransition,
  applyQueueRun,
  hasCallerCancelledRunBinding,
  hasCallerQueuedRunBinding,
} from "./commands/engineering-run-transitions.ts";
import { applyReconcileAnnotationRun } from "./commands/reconcile-uncertain-writer-transition.ts";
import { applyAcceptCrossDomainImpactDecision } from "./commands/accept-cross-domain-impact-transition.ts";
import { applyReconcileWorkItemWithSuccessor } from "./commands/reconcile-successor-transition.ts";
import { applyAbandonWorkItems } from "./commands/abandon-work-items-transition.ts";
import {
  actor,
  invalidInput,
  invalidTransition,
  type Mutable,
  nonEmpty,
  stale,
} from "./commands/engineering-project-transition-values.ts";

export {
  approvedBriefBasisForProject,
  ENGINEERING_PROJECT_COMMAND_POLICY,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandErrorCode,
};
export type {
  AbandonWorkItemsCommand,
  AcceptCrossDomainImpactDecisionCommand,
  AppendProjectChangeCommand,
  CancelQueuedRunCommand,
  CompleteRunCommand,
  DecideDecisionCommand,
  EngineeringDecisionProposalInput,
  EngineeringProjectCommandInput,
  EngineeringProjectCompletionEvidenceValidator,
  EngineeringProjectInitialCompletionEvidenceValidator,
  EngineeringProjectPlanningDependencies,
  EngineeringProjectPlanOperationRegistry,
  EngineeringProjectQueueEligibility,
  EngineeringProjectReconciliationOperationPolicy,
  EngineeringProjectReconciliationSnapshotValidator,
  FailRunCommand,
  PlannedEngineeringDecision,
  PlannedEngineeringProjectPhase,
  PlannedEngineeringWorkItem,
  ProposeDecisionCommand,
  PublishProjectPlanCommand,
  QueueRunCommand,
  ReconcileAnnotationRunCommand,
  ReconcileWorkItemWithSuccessorCommand,
  RunCommand,
};

/**
 * Failure codes that indicate a terminal uncertain write — the provider
 * acknowledged a write but the executor crashed before the ThreadSnapshot was
 * published.  Only these codes (or the geometry write, which is conservatively
 * terminal regardless of code) are eligible for uncertain-writer reconciliation.
 *
 * WHY IN DOMAIN — dedicated codes are a domain invariant enforced by
 * `reconcileAnnotationRun`. A server-computed lifecycle qualification may
 * additionally admit a historical generic failure; callers cannot supply it.
 */
export const ELIGIBLE_UNCERTAIN_WRITE_FAILURE_CODES =
  TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES;

/**
 * Optional pre-claim hook for Thread writers. The command service never
 * selects a provider; composition injects the shared basis guard.
 */
export type EngineeringProjectThreadWriteClaimGuard = (
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
) => Promise<void>;

interface CancellationFingerprintInput extends EngineeringProjectCommandInput {
  readonly runId?: string;
  readonly rationale?: string;
}

type Clock = () => string;

/**
 * Trusted command boundary for immutable EngineeringProjectSnapshot revisions.
 * The transport supplies the authenticated origin; browser payloads cannot
 * acquire agent lifecycle authority by changing their JSON.
 */
export class EngineeringProjectCommandService {
  constructor(
    private readonly store: EngineeringProjectRevisionStore,
    private readonly evidenceValidator?: EngineeringProjectCompletionEvidenceValidator,
    private readonly now: Clock = () => new Date().toISOString(),
    private readonly planning?: EngineeringProjectPlanningDependencies,
    private readonly initialEvidenceValidator?:
      EngineeringProjectInitialCompletionEvidenceValidator,
    private readonly reconciliationSnapshotValidator?:
      EngineeringProjectReconciliationSnapshotValidator,
    private readonly reconciliationOperationPolicy?:
      EngineeringProjectReconciliationOperationPolicy,
    private readonly uncertainWriterLifecycle: UncertainWriterLifecycleQualifier =
      closedUncertainWriterLifecycleQualifier,
    private readonly threadWriteClaimGuard?: EngineeringProjectThreadWriteClaimGuard,
  ) {}

  /**
   * Persist a bounded, agent-authored project path after an exact approved
   * project brief. This is planning only: it neither approves anything,
   * queues a run, calls a provider nor manufactures technical evidence.
   */
  publishPlan(
    origin: EngineeringProjectCommandOrigin,
    command: PublishProjectPlanCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.plan-publish",
      command,
      (draft, appliedAt) => {
        applyPublishPlan(draft, appliedAt, origin, command, this.planning);
      },
    );
  }

  /**
   * Append one bounded, registry-reviewed change to an already materialized
   * V3 project. This is deliberately not a plan replacement: the
   * initial plan and all execution history stay intact in the next immutable
   * project revision.
   */
  appendChange(
    origin: EngineeringProjectCommandOrigin,
    command: AppendProjectChangeCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.change-append",
      command,
      (draft, appliedAt) => {
        applyAppendChange(draft, appliedAt, origin, command, this.planning);
      },
    );
  }

  proposeDecision(
    origin: EngineeringProjectCommandOrigin,
    command: ProposeDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, "decision.propose", command, async (draft, appliedAt) => {
      await applyProposeDecision(draft, appliedAt, origin, command);
    });
  }

  approveDecision(
    origin: EngineeringProjectCommandOrigin,
    command: DecideDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decide(origin, "decision.approve", command, "approved");
  }

  rejectDecision(
    origin: EngineeringProjectCommandOrigin,
    command: DecideDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decide(origin, "decision.reject", command, "rejected");
  }

  queueRun(
    origin: EngineeringProjectCommandOrigin,
    command: QueueRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (hasCallerQueuedRunBinding(command)) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "queuedRun is server-stamped and cannot be supplied by a caller.",
        ),
      );
    }
    return this.apply(origin, "agent-run.queue", command, async (draft, appliedAt) => {
      await applyQueueRun(draft, appliedAt, origin, command, this.planning);
    });
  }

  claimRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.claim",
      command,
      ["queued"],
      "running",
      async (run, appliedAt, draft) => {
        await this.threadWriteClaimGuard?.(draft, run);
        applyClaimRun(run, appliedAt, origin);
      },
    );
  }

  progressRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.progress",
      command,
      ["running"],
      "running",
    );
  }

  publishRun(
    origin: EngineeringProjectCommandOrigin,
    command: RunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.publish",
      command,
      ["running"],
      "publishing",
    );
  }

  completeRun(
    origin: EngineeringProjectCommandOrigin,
    command: CompleteRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.complete",
      command,
      ["publishing"],
      "completed",
      async (run, appliedAt, draft) => {
        await applyCompleteRun(
          run,
          appliedAt,
          draft,
          command,
          this.evidenceValidator,
          this.initialEvidenceValidator,
        );
      },
    );
  }

  failRun(
    origin: EngineeringProjectCommandOrigin,
    command: FailRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.runTransition(
      origin,
      "agent-run.fail",
      command,
      ["running", "waiting-for-decision", "publishing"],
      "failed",
      (run, appliedAt, draft) => {
        applyFailRun(run, appliedAt, draft, command);
      },
    );
  }

  /**
   * Record an explicit human cancellation before a run is claimed. This is a
   * truthful administrative closeout, not a failed execution and never
   * manufactures an execution timestamp or agent authority.
   */
  cancelQueuedRun(
    origin: EngineeringProjectCommandOrigin,
    command: CancelQueuedRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (hasCallerCancelledRunBinding(command)) {
      return Promise.reject(
        new EngineeringProjectCommandError(
          "invalid_input",
          "cancelledRun is server-stamped and cannot be supplied by a caller.",
        ),
      );
    }
    return this.apply(origin, "agent-run.cancel", command, (draft, appliedAt) => {
      applyCancelQueuedRun(draft, appliedAt, origin, command);
    });
  }

  /**
   * Resolve the write-uncertainty on a terminal failed run and complete the
   * reconciliation work item atomically.
   *
   * WHY ONE STEP — no provider is called, no ThreadSnapshot is produced.  The
   * reconciliation run transitions directly queued → completed (annotationOnly:
   * true) in one atomic write, mirroring the simplicity of cancelQueuedRun.
   * The human executor has already validated the MRTR and inspected the
   * provider; the command service only enforces the domain state invariants.
   */
  reconcileAnnotationRun(
    origin: EngineeringProjectCommandOrigin,
    command: ReconcileAnnotationRunCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "agent-run.reconcile-annotation",
      command,
      async (draft, appliedAt) => {
        const lifecycle = await this.uncertainWriterLifecycle.qualify({
          project: draft,
          failedRunId: command.failedRunId,
        });
        await applyReconcileAnnotationRun(
          draft,
          appliedAt,
          origin,
          command,
          lifecycle,
        );
      },
    );
  }

  /**
   * Complete the human-only impact-decision run and apply the signed gate-claim
   * statuses onto existing work items in one project write. Other work-item
   * lifecycle is unchanged. No work item or rerun is added.
   */
  acceptCrossDomainImpactDecision(
    origin: EngineeringProjectCommandOrigin,
    command: AcceptCrossDomainImpactDecisionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "impact-decision.accept",
      command,
      async (draft, appliedAt) => {
        await applyAcceptCrossDomainImpactDecision(
          draft,
          appliedAt,
          origin,
          command,
          this.evidenceValidator,
        );
      },
    );
  }

  /**
   * Permanently close a failed work item behind a separately completed
   * successor. Both execution histories remain intact: the failed run stays
   * failed and the successor retains its own completed work item and evidence.
   */
  reconcileWorkItemWithSuccessor(
    origin: EngineeringProjectCommandOrigin,
    command: ReconcileWorkItemWithSuccessorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "work-item.reconcile-successor",
      command,
      async (draft, appliedAt) => {
        const lifecycle = await this.uncertainWriterLifecycle.qualify({
          project: draft,
          failedRunId: command.failedRunId,
        });
        await applyReconcileWorkItemWithSuccessor(
          draft,
          appliedAt,
          origin,
          command,
          this.reconciliationSnapshotValidator,
          this.reconciliationOperationPolicy,
          lifecycle,
        );
      },
    );
  }

  /**
   * Human-only governed abandonment for work items that never acquired a
   * provider run and their associated pending or required decisions.
   *
   * Every listed work item must be in `ready` or `waiting-for-decision` with
   * no associated agent runs and no evidence refs. Every listed decision must
   * be in `required` or `proposed`. The resulting snapshot marks each target
   * as `abandoned`, revoking any pending approval for an abandoned proposed
   * decision. History remains intact; active views derive the exclusion from
   * the status field.
   */
  abandonWorkItems(
    origin: EngineeringProjectCommandOrigin,
    command: AbandonWorkItemsCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "work-item.abandon",
      command,
      (draft, appliedAt) => {
        applyAbandonWorkItems(draft, appliedAt, origin, command);
      },
    );
  }

  private decide(
    origin: EngineeringProjectCommandOrigin,
    type: "decision.approve" | "decision.reject",
    command: DecideDecisionCommand,
    status: "approved" | "rejected",
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, type, command, (draft, appliedAt) => {
      applyDecideDecision(draft, appliedAt, origin, command, status);
    });
  }

  private runTransition(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandName,
    command: RunCommand,
    allowed: readonly EngineeringAgentRunStatus[],
    status: EngineeringAgentRunStatus,
    update: (
      run: Mutable<EngineeringAgentRun>,
      appliedAt: string,
      draft: Mutable<EngineeringProjectSnapshot>,
    ) => void | Promise<void> = () => {},
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, type, command, async (draft, appliedAt) => {
      await applyOrdinaryRunTransition(
        draft,
        appliedAt,
        origin,
        type,
        command,
        allowed,
        status,
        this.planning,
        update,
      );
    });
  }

  private async apply<T extends EngineeringProjectCommandInput>(
    origin: EngineeringProjectCommandOrigin,
    type: EngineeringProjectCommandName,
    command: T,
    update: (
      draft: Mutable<EngineeringProjectSnapshot>,
      appliedAt: string,
    ) => void | Promise<void>,
  ): Promise<EngineeringProjectSnapshot> {
    validateCommandContext(origin, command);
    assertAllowed(origin.kind, type);
    const issuedAt = normalizeIsoDateTime(command.issuedAt)!;
    const normalizedCommand = { ...command, issuedAt };
    const fingerprintCommand = type === "agent-run.cancel"
      ? cancellationFingerprintCommand(
        command,
        issuedAt,
      )
      : normalizedCommand;
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command: fingerprintCommand,
    });
    const current = await this.store.get(command.projectId);
    if (!current) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${command.projectId} does not exist.`,
      );
    }
    const replayFingerprints = await reconciliationReplayFingerprints(
      current,
      type,
      origin,
      normalizedCommand,
      requestFingerprint,
    );
    const replay = await this.replay(
      current,
      command.commandId,
      replayFingerprints,
    );
    if (replay) return replay;
    if (current.revision !== command.expectedRevision) {
      throw stale(command.projectId, command.expectedRevision, current.revision);
    }
    const appliedAt = normalizeIsoDateTime(this.now());
    if (
      !appliedAt ||
      Date.parse(appliedAt) < Date.parse(current.generatedAt)
    ) {
      invalidInput("The authoritative service clock is invalid or moved backwards.");
    }
    const draft = structuredClone(current) as Mutable<EngineeringProjectSnapshot>;
    await update(draft, appliedAt);
    const revision = current.revision + 1;
    const snapshotId = `${current.project.id}:project:r${revision}:${
      requestFingerprint.digest.slice(0, 16)
    }`;
    draft.id = snapshotId;
    draft.revision = revision;
    draft.previous = { snapshotId: current.id, revision: current.revision };
    draft.generatedAt = appliedAt;
    const queuedRun = type === "agent-run.queue"
      ? queuedRunReceiptBinding(draft, command.commandId)
      : undefined;
    const cancelledRun = type === "agent-run.cancel"
      ? cancelledRunReceiptBinding(draft, command.commandId)
      : undefined;
    draft.commandReceipts ??= [];
    draft.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: actor(origin),
      issuedAt,
      appliedAt,
      requestFingerprint,
      resultingSnapshot: { snapshotId, revision },
      ...(queuedRun ? { queuedRun } : {}),
      ...(cancelledRun ? { cancelledRun } : {}),
    });
    const next = validateEngineeringProjectSnapshot(draft);
    try {
      return await this.store.commit(next, current.revision);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      const winner = await this.store.get(command.projectId);
      if (winner) {
        const concurrentReplay = await this.replay(
          winner,
          command.commandId,
          await reconciliationReplayFingerprints(
            winner,
            type,
            origin,
            normalizedCommand,
            requestFingerprint,
          ),
        );
        if (concurrentReplay) return concurrentReplay;
        throw stale(command.projectId, command.expectedRevision, winner.revision);
      }
      throw error;
    }
  }

  private async replay(
    current: EngineeringProjectSnapshot,
    commandId: string,
    fingerprints: readonly ContentFingerprint[],
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const receipt = current.commandReceipts?.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (
      !fingerprints.some((fingerprint) =>
        fingerprintsEqual(receipt.requestFingerprint, fingerprint)
      )
    ) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} was already used for a different request.`,
      );
    }
    const result = await this.store.getRevision(
      current.project.id,
      receipt.resultingSnapshot.revision,
    );
    if (!result || result.id !== receipt.resultingSnapshot.snapshotId) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} has an invalid immutable result receipt.`,
      );
    }
    return result;
  }
}

/**
 * Preserve immutable replay across the server-stamped provenance upgrade.
 * Old commands carried the complete annotation, including an adapter clock;
 * only an already-persisted annotation may reconstruct that legacy fingerprint.
 */
async function reconciliationReplayFingerprints(
  current: EngineeringProjectSnapshot,
  type: EngineeringProjectCommandName,
  origin: EngineeringProjectCommandOrigin,
  command: EngineeringProjectCommandInput,
  currentFingerprint: ContentFingerprint,
): Promise<readonly ContentFingerprint[]> {
  if (type !== "agent-run.reconcile-annotation") return [currentFingerprint];
  const input = command as unknown as ReconcileAnnotationRunCommand;
  const annotation = current.agentRuns.find((run) => run.id === input.failedRunId)
    ?.uncertainWriterReconciliation;
  if (!annotation) return [currentFingerprint];
  if (
    input.decisionId !== annotation.decisionId ||
    input.outcome !== annotation.outcome ||
    input.providerInspectionAttestation !==
      annotation.providerInspectionAttestation
  ) {
    return [currentFingerprint];
  }
  const legacyFingerprint = await sha256Fingerprint({
    type,
    origin,
    command: {
      commandId: input.commandId,
      projectId: input.projectId,
      expectedRevision: input.expectedRevision,
      issuedAt: input.issuedAt,
      reconciliationRunId: input.reconciliationRunId,
      failedRunId: input.failedRunId,
      reconciliation: structuredClone(
        annotation,
      ) as EngineeringAgentRunUncertainWriterReconciliation,
    },
  });
  return [currentFingerprint, legacyFingerprint];
}

/** Keep server-stamped receipt fields outside the caller's idempotency payload. */
function cancellationFingerprintCommand(
  command: CancellationFingerprintInput,
  issuedAt: string,
): {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId?: string;
  readonly rationale?: string;
} {
  return {
    commandId: command.commandId,
    projectId: command.projectId,
    expectedRevision: command.expectedRevision,
    issuedAt,
    runId: command.runId,
    rationale: command.rationale,
  };
}

function queuedRunReceiptBinding(
  draft: EngineeringProjectSnapshot,
  queueCommandId: string,
): EngineeringQueuedRunReceiptBinding {
  const candidates = draft.agentRuns.filter((run) =>
    run.status === "queued" &&
    run.statusHistory?.[0]?.status === "queued" &&
    run.statusHistory?.[0]?.commandId === queueCommandId
  );
  if (candidates.length !== 1) {
    invalidTransition(
      "A queue receipt must resolve to exactly one server-queued agent run.",
    );
  }
  const run = candidates[0]!;
  return {
    runId: run.id,
    workItemId: run.workItemId,
    ...(run.resolvedOperationPlan
      ? { resolvedOperationPlan: structuredClone(run.resolvedOperationPlan) }
      : {}),
  };
}

function cancelledRunReceiptBinding(
  draft: EngineeringProjectSnapshot,
  cancellationCommandId: string,
): EngineeringCancelledRunReceiptBinding {
  const candidates = draft.agentRuns.filter((run) =>
    run.status === "cancelled" &&
    run.statusHistory?.at(-1)?.commandId === cancellationCommandId
  );
  if (candidates.length !== 1) {
    invalidTransition(
      "A cancellation receipt must resolve to exactly one server-cancelled agent run.",
    );
  }
  const run = candidates[0]!;
  const queuedTransition = run.statusHistory?.[0];
  if (!queuedTransition || queuedTransition.status !== "queued") {
    invalidTransition(
      `Cancelled agent run ${run.id} has no exact initial queued transition.`,
    );
  }
  return {
    runId: run.id,
    workItemId: run.workItemId,
    queuedCommandId: queuedTransition.commandId,
  };
}

function validateCommandContext(
  origin: EngineeringProjectCommandOrigin,
  command: EngineeringProjectCommandInput,
): void {
  nonEmpty(origin.actorId, "origin.actorId");
  nonEmpty(command.commandId, "commandId");
  nonEmpty(command.projectId, "projectId");
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision < 1) {
    invalidInput("expectedRevision must be a positive integer.");
  }
  if (!normalizeIsoDateTime(command.issuedAt)) {
    invalidInput("issuedAt must be an ISO datetime.");
  }
}

function normalizeIsoDateTime(value: string): string | undefined {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value)
  ) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}
