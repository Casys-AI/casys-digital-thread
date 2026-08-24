import type {
  EngineeringApprovedBriefBasis,
  EngineeringBasisRef,
  EngineeringDecisionProposalParameter,
  EngineeringGateClaim,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringProjectStartingPoint,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
  EngineeringWorkOwner,
} from "../../../../domain/project/engineering-project.ts";
import type { RegisteredRunPlanSealer } from "../../../../domain/project/resolved-run-plan-sealer.ts";
import type { ContentFingerprint } from "../../../../domain/thread/thread-snapshot.ts";
import type { ReconcileUncertainWriterOutcome } from "../../../../domain/record/reconcile-uncertain-writer-proposal.ts";
import type { CrossDomainImpactWorkItemClaimTransition } from "../../../../domain/impact/cross-domain-impact-decision.ts";

export interface EngineeringDecisionProposalInput {
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
}

export interface EngineeringProjectCommandInput {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  /** Client-provided audit metadata; never used as authoritative state time. */
  readonly issuedAt: string;
}

export interface ProposeDecisionCommand extends EngineeringProjectCommandInput {
  readonly decisionId: string;
  readonly proposal: EngineeringDecisionProposalInput;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
}

export interface DecideDecisionCommand extends EngineeringProjectCommandInput {
  readonly decisionId: string;
  readonly rationale: string;
  /** The exact proposal binding displayed to the human reviewer. */
  readonly inputFingerprint: ContentFingerprint;
}

export interface QueueRunCommand extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly workItemId: string;
  readonly summary: string;
  /** Historical V1 field. The current schema rejects it rather than queuing. */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  /** Exact execution anchor. Callers of the MCP tool never choose this. */
  readonly basis?: EngineeringBasisRef;
}

export interface RunCommand extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly summary: string;
}

export interface CompleteRunCommand extends RunCommand {
  readonly resultSnapshot: EngineeringThreadSnapshotRef;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
}

export interface FailRunCommand extends RunCommand {
  readonly code: string;
  readonly message: string;
}

/**
 * Human-only closeout for a queued run. It deliberately carries no synthetic
 * execution summary, timestamps or failure: the run never started.
 */
export interface CancelQueuedRunCommand extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly rationale: string;
}

/**
 * Human-only single-step command that completes the impact-decision run and
 * applies the already-proposed X07/X08 gate-claim statuses onto existing
 * claims. X07/X08 records workItemInvalidations and rerunProposals as `none`;
 * this command does not add, invalidate, or otherwise change work-item
 * lifecycle except completing this decision run.
 */
export interface AcceptCrossDomainImpactDecisionCommand
  extends EngineeringProjectCommandInput {
  readonly runId: string;
  readonly summary: string;
  readonly decisionId: string;
  readonly resultSnapshot: EngineeringThreadSnapshotRef;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly evaluationCapture: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly appliedGateClaims: readonly CrossDomainImpactWorkItemClaimTransition[];
  readonly limits: {
    readonly providerCalls: "none";
    readonly solverCalls: "none";
    readonly reruns: "none";
    readonly newWorkItems: "none";
  };
}

/**
 * Human-only single-step command that resolves write-uncertainty on a terminal
 * failed run and completes the reconciliation work item in one atomic write.
 *
 * WHY SINGLE-STEP — unlike evidence-producing runs (which go through claim →
 * publish → complete), the annotation run produces no ThreadSnapshot and no
 * provider call.  The entire reconciliation is a project-level state mutation
 * that a human actor executes directly.  The command is analogous to
 * `agent-run.cancel`: one atomic write, no intermediate "running" state.
 */
export interface ReconcileAnnotationRunCommand extends EngineeringProjectCommandInput {
  /** The id of the reconciliation run (for `record.reconcile-uncertain-writer@1`). */
  readonly reconciliationRunId: string;
  /** The id of the terminal failed run whose write-uncertainty is being resolved. */
  readonly failedRunId: string;
  /** Exact human-approved MRTR decision authorizing this annotation. */
  readonly decisionId: string;
  readonly outcome: ReconcileUncertainWriterOutcome;
  readonly providerInspectionAttestation: string;
}

/**
 * Close one failed work item only when an independently completed successor
 * already carries the exact replacement evidence. This is project-state
 * reconciliation, never a provider retry or a claim that the failed work
 * produced evidence.
 */
export interface ReconcileWorkItemWithSuccessorCommand
  extends EngineeringProjectCommandInput {
  readonly failedWorkItemId: string;
  readonly failedRunId: string;
  readonly successorRunId: string;
  readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
  /**
   * Absent for a direct reconciliation where the successor run result is
   * already the project thread head and no separate closeout snapshot is
   * needed. When present the full closeout path is used instead.
   */
  readonly successorSnapshot?: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly rationale: string;
}

/**
 * Human-only governed abandonment for work items that never acquired a
 * provider run and their associated pending or required decisions.
 *
 * WHY HUMAN-ONLY — abandonment is an intentional, irreversible editorial act
 * on the project plan. An agent must never mark its own work items as
 * abandoned without explicit human oversight.
 *
 * Guards:
 *  - Each work item must be in `ready` (never queued) or `waiting-for-decision`
 *    (never queued) and must have no associated runs.
 *  - Each decision must be in `required` or `proposed` (not `approved`).
 *  - Evidence-carrying work items are ineligible: abandonment is only for
 *    noise, not for a run that already wrote to the thread.
 */
export interface AbandonWorkItemsCommand extends EngineeringProjectCommandInput {
  /** One or more work item IDs to abandon (minimum 1). */
  readonly workItemIds: readonly string[];
  /**
   * Decision IDs to abandon alongside the work items. May be empty, but every
   * id supplied must be in `required` or `proposed` status.
   */
  readonly decisionIds: readonly string[];
  readonly rationale: string;
}

export interface PublishProjectPlanCommand extends EngineeringProjectCommandInput {
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly phases: readonly PlannedEngineeringProjectPhase[];
  readonly workItems: readonly PlannedEngineeringWorkItem[];
  readonly requiredDecisions: readonly PlannedEngineeringDecision[];
}

/**
 * An additive, agent-authored change after the initial baseline exists.
 * Existing phases, work, decisions, runs and ThreadSnapshot references are
 * never replaced. New work may join a newly declared phase or append
 * membership onto an existing phase; that is an immutable extension, not a
 * rewrite of the earlier phase record.
 */
export interface AppendProjectChangeCommand extends EngineeringProjectCommandInput {
  /** Exact current project ThreadSnapshot that this bounded change extends. */
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
  readonly phases: readonly PlannedEngineeringProjectPhase[];
  readonly workItems: readonly PlannedEngineeringWorkItem[];
  readonly requiredDecisions: readonly PlannedEngineeringDecision[];
}

/** The agent declares only structure; the service derives membership and order. */
export interface PlannedEngineeringProjectPhase {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** A safe operation reference, not a provider/tool invocation. */
export interface PlannedEngineeringWorkItem {
  readonly id: string;
  readonly phaseId: string;
  readonly owner: EngineeringWorkOwner;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly operation: EngineeringOperationRef;
  /**
   * Names an existing or same-batch predecessor revision. Omit to start a
   * stable activity. Callers never supply activityId.
   */
  readonly predecessorRevisionId?: string;
  /** Optional because a work item may legitimately make no gate claim. */
  readonly gateClaims?: readonly EngineeringGateClaim[];
}

export interface PlannedEngineeringDecision {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly question: string;
}

/**
 * Narrow adapter over the code-owned operation registry. The plan service
 * cannot receive provider names, tool arguments or executable workflows.
 */
export interface EngineeringProjectPlanOperationRegistry {
  validate(
    input:
      | {
        readonly operation: EngineeringOperationRef;
        /** Plan publication validates only the reviewed descriptor and bindings. */
        readonly stage: "planning";
      }
      | {
        readonly operation: EngineeringOperationRef;
        /** Queueing must validate the exact durable basis a run will consume. */
        readonly stage: "queue";
        readonly basisKind: EngineeringBasisRef["kind"];
      },
  ): {
    readonly operation: {
      readonly id: string;
      readonly version: string;
      readonly startingPoint: EngineeringProjectStartingPoint;
      readonly title: string;
      readonly description: string;
      readonly workItemKind: EngineeringWorkItem["kind"];
      /** A queueable run requires a concrete trusted executor. */
      readonly execution: "trusted" | "planning-only";
      /** Requires a server-sealed resolved-operation-plan/2.0 before queue commit. */
      readonly resolvedOperationPlan?: "2.0";
      readonly decisionEvidenceScope?: "thread-entity-bindings";
      /**
       * When true, the operation must arrive via project_change_append, not the
       * initial plan. publishPlan enforces this at planning time so the agent
       * learns immediately, before any run has locked the plan against
       * republication.  See RegisteredEngineeringOperation.requiresAdditiveChange.
       */
      readonly requiresAdditiveChange?: true;
      readonly requiresDependsOnOperation?: {
        readonly id: string;
        readonly version: string;
      };
      /**
       * Reviewed human-lifecycle grant. Present only when the executor and
       * command service must keep the same human origin through claim,
       * progress, publish, complete, and fail.
       */
      readonly mustOrigin?: "human";
    };
    readonly bindings: readonly EngineeringOperationInputBinding[];
  };
}

/**
 * Optional policy gate for a concrete V3 run after its reviewed operation and
 * exact basis have already been accepted. The command service gives the gate
 * a validated, deeply frozen pre-mutation project snapshot: it can refuse the
 * queue transition, but cannot alter the candidate run or project state.
 */
export interface EngineeringProjectQueueEligibility {
  validate(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly workItem: EngineeringWorkItem;
    readonly operation: EngineeringOperationRef;
    readonly basis: EngineeringBasisRef;
  }): Promise<void>;
}

export interface EngineeringProjectPlanningDependencies {
  readonly operations: EngineeringProjectPlanOperationRegistry;
  /**
   * Present only when the deployment can seal and reread registered recorded
   * plans. It is consulted exclusively for operations marked plan 2.0.
   */
  readonly runPlanSealer?: RegisteredRunPlanSealer;
  /**
   * Optional, code-owned admission gate for a particular reviewed V3 run.
   * It is deliberately evaluated before a run, work-item status or receipt is
   * mutated.
   */
  readonly queueEligibility?: EngineeringProjectQueueEligibility;
}

export interface EngineeringProjectCompletionEvidenceValidator {
  validate(
    baseSnapshot: EngineeringThreadSnapshotRef,
    resultSnapshot: EngineeringThreadSnapshotRef,
    evidenceRefs: readonly EngineeringThreadEntityRef[],
  ): Promise<void>;
}

/**
 * Dedicated trust boundary for the one initial result created from an approved
 * discovery. It intentionally receives no fabricated base ThreadSnapshot and
 * must not validate it as a descendant.
 */
export interface EngineeringProjectInitialCompletionEvidenceValidator {
  validateInitial(
    runId: string,
    basis: EngineeringApprovedBriefBasis,
    operation: EngineeringOperationRef,
    resultSnapshot: EngineeringThreadSnapshotRef,
    evidenceRefs: readonly EngineeringThreadEntityRef[],
  ): Promise<void>;
}

/**
 * Persistence-backed proof that a reconciliation closeout snapshot exists and
 * is the direct immutable child of the completed successor result.  The
 * project command service owns no ThreadSnapshot store, so adapters inject
 * this narrow validator instead of allowing a caller to name a phantom ref.
 */
export interface EngineeringProjectReconciliationSnapshotValidator {
  validate(
    successorRunSnapshot: EngineeringThreadSnapshotRef,
    successorSnapshot: EngineeringThreadSnapshotRef,
  ): Promise<void>;
  /**
   * Resolve both immutable records and prove that the current project head
   * descends from the completed successor result without writing a Thread.
   */
  validateCurrentHeadDescendsFrom(
    currentHead: EngineeringThreadSnapshotRef,
    ancestor: EngineeringThreadSnapshotRef,
  ): Promise<void>;
}

/**
 * Injected, code-owned authorization for a full-closeout transition whose
 * successor deliberately carries a different registered operation.
 *
 * The generic command service cannot infer that `repair.*` is a valid
 * replacement for a particular `verify.*`. A bounded caller must therefore
 * prove the exact transition and its closeout snapshot before it is persisted.
 */
export interface EngineeringProjectReconciliationOperationPolicy {
  authorize(input: {
    readonly failedWorkItemId: string;
    readonly failedOperation: EngineeringOperationRef;
    readonly successorWorkItemId: string;
    readonly successorOperation: EngineeringOperationRef | undefined;
    readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
    readonly successorSnapshot: EngineeringThreadSnapshotRef;
  }): Promise<void>;
}
