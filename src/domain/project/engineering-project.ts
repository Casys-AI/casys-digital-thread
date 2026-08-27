import type {
  ContentFingerprint,
  ThreadEntityKind,
} from "../thread/thread-snapshot.ts";
import type { IsoDateTime } from "../kernel/primitives.ts";
import type { EngineeringProjectFraming } from "./project-brief.ts";
import type { ResolvedOperationPlanRef } from "../compile/rop/resolved-operation-plan-v2.ts";

/**
 * Immutable, transport-independent intent and execution state for one
 * engineering project. Technical evidence remains owned by ThreadSnapshot and
 * is only addressed here through exact snapshot/entity references.
 */

/**
 * Current project aggregate format. A project exists from first intent, owns
 * its living brief, and records an explicit activity/revision/attempt
 * lifecycle. Older local snapshots are not a creation or load route.
 */
export const ENGINEERING_PROJECT_SCHEMA_VERSION = "4.0" as const;
export type EngineeringProjectSchemaVersion = typeof ENGINEERING_PROJECT_SCHEMA_VERSION;

export interface EngineeringProjectPreviousSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
}

export interface EngineeringProjectObjective {
  readonly title: string;
  readonly statement: string;
}

export interface EngineeringProjectIdentity {
  readonly id: string;
  readonly name: string;
  readonly subjectId: string;
  readonly objective: EngineeringProjectObjective;
}

export type EngineeringCommandOriginKind = "human" | "agent";

export type EngineeringProjectCommandName =
  | "project.start"
  | "project.question-propose"
  | "project.answer-record"
  | "project.brief-propose"
  | "project.brief-approve"
  | "project.brief-reject"
  | "project.plan-publish"
  | "project.change-append"
  | "work-item.reconcile-successor"
  | "work-item.abandon"
  | "decision.propose"
  | "decision.approve"
  | "decision.reject"
  | "agent-run.queue"
  | "agent-run.claim"
  | "agent-run.progress"
  | "agent-run.publish"
  | "agent-run.complete"
  | "agent-run.fail"
  | "agent-run.cancel"
  | "agent-run.reconcile-annotation"
  | "impact-decision.accept";

export interface EngineeringCommandActor {
  readonly id: string;
  readonly origin: EngineeringCommandOriginKind;
}

export interface EngineeringDecisionProposalParameter {
  readonly key: string;
  readonly label: string;
  readonly value: string | number | boolean;
  readonly unit?: string;
}

/** Concrete, reviewed decision input. Audit fields are stamped by the service. */
export interface EngineeringDecisionProposal {
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
  readonly proposedAt: IsoDateTime;
  readonly proposedBy: EngineeringCommandActor;
}

/** An exact revision of a ThreadSnapshot; `latest` aliases are forbidden. */
export interface EngineeringThreadSnapshotRef {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

/** An entity inside one exact ThreadSnapshot revision. */
export interface EngineeringThreadEntityRef {
  readonly snapshotId: string;
  readonly snapshotRevision: number;
  readonly kind: ThreadEntityKind;
  readonly id: string;
}

/** How the project entered the engineering journey before any ThreadSnapshot exists. */
export type EngineeringProjectStartingPoint =
  | "idea-or-spec"
  | "existing-cad"
  | "existing-product";

/**
 * Exact planning basis for the first bounded operation. This is deliberately
 * distinct from an execution run's technical snapshot anchor.
 */
/** Exact human-approved brief within one immutable V3 project revision. */
export interface EngineeringApprovedBriefBasis {
  readonly kind: "approved-brief";
  readonly projectId: string;
  readonly projectSnapshotId: string;
  readonly projectRevision: number;
  readonly briefId: string;
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly approvedBriefFingerprint: ContentFingerprint;
}

/** Exact ThreadSnapshot state used after the first documentary baseline. */
export interface EngineeringThreadSnapshotBasis extends EngineeringThreadSnapshotRef {
  readonly kind: "thread-snapshot";
}

/**
 * An execution anchor, never a `latest` alias.
 *
 * `approved-brief` is valid only for the one reviewed first-baseline
 * operation. A result created from it is a documentary pre-technical
 * baseline, not a descendant of a fabricated ThreadSnapshot or a claim of
 * engineering proof. All later V3 runs use the `thread-snapshot` arm and
 * retain the normal descendant invariant.
 */
export type EngineeringBasisRef =
  | EngineeringApprovedBriefBasis
  | EngineeringThreadSnapshotBasis;

/**
 * A reviewed source slot for an operation. Provider endpoints, tool names,
 * paths, scripts and raw tool outputs are intentionally not representable.
 */
export type EngineeringOperationInputBinding =
  | {
    readonly name: string;
    readonly source: { readonly kind: "approved-brief" };
  }
  | {
    readonly name: string;
    readonly source: {
      readonly kind: "project-answer";
      readonly answerId: string;
    };
  }
  | {
    readonly name: string;
    readonly source: {
      readonly kind: "decision-parameter";
      readonly decisionId: string;
      readonly key: string;
    };
  }
  | {
    readonly name: string;
    readonly source: {
      readonly kind: "thread-entity";
      readonly reference: EngineeringThreadEntityRef;
    };
  };

/** A versioned, server-registered operation reference; never an executable tool call. */
export interface EngineeringOperationRef {
  readonly id: string;
  readonly version: string;
  readonly bindings: readonly EngineeringOperationInputBinding[];
}

/**
 * Agent-published planning metadata names the exact approved living brief.
 */
export interface EngineeringProjectPlan {
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly basis: EngineeringApprovedBriefBasis;
  readonly publishedAt: IsoDateTime;
  readonly publishedBy: EngineeringCommandActor;
}

/**
 * One additive, reviewed change to a materialized project path. The command
 * records the exact ThreadSnapshot it extended; it never restates or replaces
 * the original plan, previous changes, execution runs or technical evidence.
 */
export interface EngineeringProjectChange {
  readonly id: string;
  /** Exact idempotency/audit command that created this append-only change. */
  readonly commandId: string;
  /**
   * Exact human-approved canonical brief that authorized this V3 change.
   */
  readonly approvedBriefBasis?: EngineeringApprovedBriefBasis;
  readonly baseSnapshot: EngineeringThreadSnapshotRef;
  readonly phaseIds: readonly string[];
  readonly workItemIds: readonly string[];
  readonly decisionIds: readonly string[];
  readonly publishedAt: IsoDateTime;
  readonly publishedBy: EngineeringCommandActor;
}

export interface EngineeringProjectPhase {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly description: string;
  readonly workItemIds: readonly string[];
  readonly requiredDecisionIds: readonly string[];
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
}

export type EngineeringWorkItemKind =
  | "define"
  | "architect"
  | "design"
  | "simulate"
  | "verify"
  | "industrialize"
  | "review";

export type EngineeringWorkItemStatus =
  | "planned"
  | "ready"
  | "in-progress"
  | "waiting-for-decision"
  | "completed"
  | "cancelled"
  /**
   * Human-governed terminal closeout for a work item that never acquired a
   * provider run. Append-only: the work item remains in history but is excluded
   * from active views. Only allowed from `ready` (no run) or
   * `waiting-for-decision` (no run). Cannot be set on a work item that ever
   * held a run or produced evidence.
   */
  | "abandoned";

export type EngineeringWorkOwner = "human" | "agent" | "shared";

/**
 * A terminal closeout for work that did not itself produce evidence.
 *
 * This deliberately names both the failed attempt and the independently
 * completed successor. It prevents a recovered successor from being
 * misreported as a successful execution of the failed work item.
 */
export interface EngineeringWorkItemRunSuccessorReconciliation {
  readonly kind: "superseded-by-successor";
  readonly reconciledAt: IsoDateTime;
  readonly reconciledBy: EngineeringCommandActor;
  readonly failedRunId: string;
  readonly successorRunId: string;
  /** Exact ThreadSnapshot published by the completed successor run. */
  readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
  /**
   * Provider-free successor snapshot that records the closeout relation. It
   * descends from successorRunSnapshot and is the current project thread head.
   *
   * Absent for a direct reconciliation where the successor run result is already
   * the project thread head and no separate closeout snapshot is needed (e.g.,
   * a seed work item whose executor rejects it and whose successor completes
   * with the same result as the project head). Both forms record the successor
   * through `successorEvidenceRefs`. Phase completion still requires evidence
   * owned by that phase.
   */
  readonly successorSnapshot?: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly rationale: string;
}

export type EngineeringWorkItemSuccessorReconciliation =
  EngineeringWorkItemRunSuccessorReconciliation;

/** How a work item relates to one reviewed gate in the canonical brief. */
export type EngineeringGateClaimRole = "contributes-to" | "satisfies";

/**
 * State of the work-to-gate link, deliberately separate from artifact
 * freshness. This foundation records it but does not calculate transitions.
 */
export type EngineeringGateClaimStatus =
  | "current"
  | "impact-unresolved"
  | "invalidated"
  | "carried-forward";

export interface EngineeringGateClaim {
  /** Stable ID of a success-criterion or verification-activity in the canonical brief. */
  readonly gateItemId: string;
  readonly role: EngineeringGateClaimRole;
  readonly status: EngineeringGateClaimStatus;
}

export interface EngineeringWorkItem {
  readonly id: string;
  /**
   * Stable activity identity. Server-stamped from the root revision id;
   * successors inherit it from the named predecessor. Callers never choose it.
   */
  readonly activityId: string;
  /**
   * Existing predecessor revision (work-item id) in the same activity.
   * Absent on the root revision that starts the activity.
   */
  readonly predecessorRevisionId?: string;
  readonly phaseId: string;
  readonly title: string;
  readonly description: string;
  readonly kind: EngineeringWorkItemKind;
  /**
   * Present for agent-published work. Earlier immutable project revisions may
   * predate operation declarations; they are never treated as executable by
   * the new planning path.
   */
  readonly operation?: EngineeringOperationRef;
  /**
   * Declarative coverage of canonical brief gates. Unlike operation bindings,
   * these are not evidence inputs and must never imply technical consumption.
   */
  readonly gateClaims?: readonly EngineeringGateClaim[];
  readonly status: EngineeringWorkItemStatus;
  readonly owner: EngineeringWorkOwner;
  readonly dependsOnWorkItemIds: readonly string[];
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly decisionIds: readonly string[];
  readonly blockerIds: readonly string[];
  /**
   * Present only when cancelled work was truthfully closed by a separately
   * completed successor; it is not evidence produced by this work item.
   */
  readonly reconciliation?: EngineeringWorkItemSuccessorReconciliation;
}

export type EngineeringAgentRunStatus =
  | "queued"
  | "running"
  | "waiting-for-decision"
  | "publishing"
  | "completed"
  | "failed"
  | "cancelled";

export interface EngineeringAgentRun {
  readonly id: string;
  readonly workItemId: string;
  readonly status: EngineeringAgentRunStatus;
  readonly summary: string;
  readonly queuedAt: IsoDateTime;
  readonly startedAt?: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly claimedAt?: IsoDateTime;
  readonly claimedBy?: EngineeringCommandActor;
  /** Exact execution anchor. A `latest` alias is never accepted. */
  readonly basis?: EngineeringBasisRef;
  /**
   * Historical V1 field. The current schema rejects it rather than treating it
   * as an execution basis.
   */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  readonly inputFingerprint?: ContentFingerprint;
  /**
   * Server-stamped CAS reference for a registered resolved-operation-plan/2.0.
   * Historical and @1 runs deliberately omit it; no caller can provide it.
   */
  readonly resolvedOperationPlan?: ResolvedOperationPlanRef;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly waitingForDecisionIds?: readonly string[];
  readonly resultSnapshot?: EngineeringThreadSnapshotRef;
  readonly failure?: EngineeringAgentRunFailure;
  /**
   * Present only when a human cancelled a run before any agent claim or
   * execution. This is intentionally distinct from a failed execution.
   */
  readonly cancellation?: EngineeringAgentRunCancellation;
  /**
   * Present only on a terminal-uncertain failed run that a human operator has
   * explicitly resolved after inspecting the provider.  The run remains
   * `failed`; a did-not-write annotation can release the basis, while an
   * accepted write remains blocked until its separate human release decision
   * resolves.  See EngineeringAgentRunUncertainWriterReconciliation.
   */
  readonly uncertainWriterReconciliation?:
    EngineeringAgentRunUncertainWriterReconciliation;
  /**
   * Present only on runs completed by `agent-run.reconcile-annotation`.
   * Annotation runs produce no ThreadSnapshot and no evidence refs; they only
   * modify project-level state.  This field lets the validator exempt them from
   * the standard evidence requirements that apply to evidence-producing runs.
   */
  readonly annotationOnly?: true;
  readonly statusHistory?: readonly EngineeringAgentRunTransition[];
}

export interface EngineeringAgentRunFailure {
  readonly code: string;
  readonly message: string;
}

/**
 * Human-only annotation that resolves the write-uncertainty on a terminal
 * failed provider run.  The run remains `failed` and its `failure.code` is
 * immutable, but the thread-write basis guard reads this annotation to decide
 * whether the lock may be lifted for a subsequent run from the same basis.
 *
 * WHY THIS EXISTS — an executor may crash after the provider has acknowledged a
 * write but before the ThreadSnapshot is published.  The failure code enters
 * TERMINAL_UNCERTAIN_WRITE_FAILURE_CODES (reconciliation domain contract), making the basis
 * permanently unavailable from the server side.  A human operator who inspects
 * the provider and determines the side-effect is known can seal this annotation
 * to unblock the basis.  The trust model is identical to every MRTR mechanism:
 * the attestation is documented, not technically verified.
 */
export interface EngineeringAgentRunUncertainWriterReconciliation {
  readonly kind: "uncertain-writer-resolved";
  /**
   * What the operator determined about the provider outcome:
   *  - "provider-did-not-write": no durable write occurred; the basis is clean
   *    for a new run without any further constraint.
   *  - "write-effect-accepted": the provider produced output that was not
   *    captured in the thread snapshot.  A blocker is opened on the project to
   *    force a conscious decision before a new run can be queued.
   */
  readonly outcome: "provider-did-not-write" | "write-effect-accepted";
  readonly reconciledAt: IsoDateTime;
  readonly reconciledBy: EngineeringCommandActor;
  /** Exact id of the human-approved MRTR decision that sealed this act. */
  readonly decisionId: string;
  /**
   * Free-text attestation documenting what the operator observed at the
   * provider.  Required and non-empty to make the inspection explicit in the
   * audit trail.  The system cannot verify that the inspection was genuine.
   */
  readonly providerInspectionAttestation: string;
}

/** Exact human closeout for a queued run that never started. */
export interface EngineeringAgentRunCancellation {
  readonly rationale: string;
  readonly cancelledAt: IsoDateTime;
  readonly cancelledBy: EngineeringCommandActor;
}

/** Server-derived audit wording for a queued run that never started. */
export function queuedRunCancellationSummary(rationale: string): string {
  return `Cancelled before agent claim: ${rationale}`;
}

export interface EngineeringAgentRunTransition {
  readonly commandId: string;
  readonly status: EngineeringAgentRunStatus;
  readonly at: IsoDateTime;
  readonly actor: EngineeringCommandActor;
  readonly summary: string;
}

export type EngineeringDecisionStatus =
  | "required"
  | "proposed"
  | "approved"
  | "rejected"
  | "superseded"
  /**
   * Human-governed terminal closeout for a decision that was never approved.
   * Append-only: the decision remains in history but is excluded from active
   * views and does not trigger `attention-required`. Only allowed from
   * `required` or `proposed`. An approved decision cannot be abandoned.
   */
  | "abandoned";

export interface EngineeringDecision {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly question: string;
  readonly status: EngineeringDecisionStatus;
  readonly requestedAt: IsoDateTime;
  /** Present once a concrete execution proposal is bound to exact inputs. */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  readonly inputFingerprint?: ContentFingerprint;
  /** Exact technical state against which this decision is made. */
  readonly inputEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly approvalIds: readonly string[];
  readonly supersedesDecisionId?: string;
  /**
   * Human-only inverse link for a legacy decision closed by an already-approved
   * successor whose historical proposal cannot be rewritten.
   */
  readonly supersededByDecisionId?: string;
  readonly proposal?: EngineeringDecisionProposal;
}

export type EngineeringApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revoked";

export interface EngineeringApproval {
  readonly id: string;
  readonly decisionId: string;
  readonly status: EngineeringApprovalStatus;
  readonly requestedAt: IsoDateTime;
  readonly decidedAt?: IsoDateTime;
  readonly decidedBy?: string;
  readonly rationale?: string;
  readonly decidedByOrigin?: EngineeringCommandOriginKind;
  /** Must equal the concrete decision scope being approved. */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  readonly inputFingerprint?: ContentFingerprint;
  /** Must match the decision inputs exactly; changed inputs need a new approval. */
  readonly inputEvidenceRefs: readonly EngineeringThreadEntityRef[];
}

export interface EngineeringProjectCommandReceipt {
  readonly commandId: string;
  readonly type: EngineeringProjectCommandName;
  readonly actor: EngineeringCommandActor;
  readonly issuedAt: IsoDateTime;
  /** Authoritative server-side application time. */
  readonly appliedAt: IsoDateTime;
  readonly requestFingerprint: ContentFingerprint;
  readonly resultingSnapshot: EngineeringProjectPreviousSnapshot;
  /**
   * Immutable authorization created by a V3 human brief approval. Historical
   * receipts pre-dating the living brief intentionally omit this field.
   */
  readonly approvedBriefBasis?: EngineeringApprovedBriefBasis;
  /**
   * Server-stamped target of a newly queued agent run. Older queue receipts
   * intentionally omit this field and remain readable as legacy history.
   */
  readonly queuedRun?: EngineeringQueuedRunReceiptBinding;
  /**
   * Server-stamped target of a human queued-run cancellation. Queue receipts
   * intentionally predate this binding and remain valid without it.
   */
  readonly cancelledRun?: EngineeringCancelledRunReceiptBinding;
}

/** Exact run identity sealed into a new agent-run.queue receipt by the service. */
export interface EngineeringQueuedRunReceiptBinding {
  readonly runId: string;
  readonly workItemId: string;
  /** Present exactly when its queued run carries a resolved operation plan. */
  readonly resolvedOperationPlan?: ResolvedOperationPlanRef;
}

/** Exact run identity sealed into an agent-run.cancel receipt by the service. */
export interface EngineeringCancelledRunReceiptBinding {
  readonly runId: string;
  readonly workItemId: string;
  readonly queuedCommandId: string;
}

export type EngineeringBlockerKind =
  | "required-input"
  | "decision-required"
  | "dependency"
  | "tool-failure";

export type EngineeringBlockerStatus = "open" | "resolved";

export interface EngineeringBlocker {
  readonly id: string;
  readonly phaseId: string;
  readonly title: string;
  readonly description: string;
  readonly kind: EngineeringBlockerKind;
  readonly status: EngineeringBlockerStatus;
  readonly openedAt: IsoDateTime;
  readonly resolvedAt?: IsoDateTime;
  readonly resolution?: string;
  readonly workItemIds: readonly string[];
  readonly decisionIds: readonly string[];
}

export interface EngineeringProjectSnapshot {
  readonly schemaVersion: EngineeringProjectSchemaVersion;
  readonly id: string;
  readonly revision: number;
  readonly previous?: EngineeringProjectPreviousSnapshot;
  readonly generatedAt: IsoDateTime;
  readonly project: EngineeringProjectIdentity;
  /** Required for V3: the living, versioned intent owned by this project. */
  readonly framing?: EngineeringProjectFraming;
  /** Present once an agent publishes a bounded path from an approved brief. */
  readonly plan?: EngineeringProjectPlan;
  /** Append-only history of reviewed changes after the initial project path. */
  readonly planChanges?: readonly EngineeringProjectChange[];
  readonly threadSnapshots: readonly EngineeringThreadSnapshotRef[];
  readonly phases: readonly EngineeringProjectPhase[];
  readonly workItems: readonly EngineeringWorkItem[];
  readonly agentRuns: readonly EngineeringAgentRun[];
  readonly decisions: readonly EngineeringDecision[];
  readonly approvals: readonly EngineeringApproval[];
  readonly blockers: readonly EngineeringBlocker[];
  /** Durable idempotency/audit ledger, introduced on the first command revision. */
  readonly commandReceipts?: readonly EngineeringProjectCommandReceipt[];
}

export type EngineeringPhaseStatus =
  | "planned"
  | "active"
  | "blocked"
  | "completed";

export type EngineeringProjectStatus =
  | "planned"
  | "active"
  | "attention-required"
  | "blocked"
  | "completed";

/**
 * A superseded decision is terminally satisfied only when its explicit
 * successor is approved. An abandoned decision is terminally satisfied:
 * the human deliberately closed it without approval, and it must not keep
 * its phase stuck waiting for a resolution that will never come.
 */
export function isEngineeringDecisionSatisfied(
  snapshot: EngineeringProjectSnapshot,
  decision: EngineeringDecision,
): boolean {
  return decision.status === "approved" ||
    decision.status === "abandoned" ||
    (decision.status === "superseded" &&
      snapshot.decisions.some((candidate) =>
        candidate.status === "approved" &&
        (candidate.supersedesDecisionId === decision.id ||
          decision.supersededByDecisionId === candidate.id)
      ));
}

/** Derive phase state from work, decisions, runs and blockers; never persist it. */
export function deriveEngineeringPhaseStatus(
  snapshot: EngineeringProjectSnapshot,
  phaseId: string,
): EngineeringPhaseStatus {
  const phase = snapshot.phases.find((candidate) => candidate.id === phaseId);
  if (!phase) throw new Error(`Unknown engineering phase: ${phaseId}.`);

  if (
    snapshot.blockers.some((blocker) =>
      blocker.phaseId === phaseId && blocker.status === "open"
    )
  ) return "blocked";

  const workItems = phase.workItemIds.map((id) =>
    snapshot.workItems.find((candidate) => candidate.id === id)
  ).filter((item): item is EngineeringWorkItem => item !== undefined);
  const requiredDecisions = phase.requiredDecisionIds.map((id) =>
    snapshot.decisions.find((candidate) => candidate.id === id)
  ).filter((item): item is EngineeringDecision => item !== undefined);

  if (
    workItems.length > 0 &&
    workItems.every((item) =>
      item.status === "completed" ||
      item.status === "abandoned" ||
      (item.status === "cancelled" && item.reconciliation !== undefined)
    ) &&
    requiredDecisions.every((decision) =>
      isEngineeringDecisionSatisfied(snapshot, decision)
    ) &&
    // Successor evidence on a cancelled item is not this phase's evidence.
    // Same-phase reconcile stays completed because the phase record already
    // owns those refs. An empty other-phase cancelled seed does not.
    phase.evidenceRefs.length > 0
  ) return "completed";

  const workItemIds = new Set(phase.workItemIds);
  if (
    workItems.some((item) =>
      item.status === "in-progress" || item.status === "waiting-for-decision"
      // abandoned items are deliberately excluded: they are terminal
    ) ||
    snapshot.agentRuns.some((run) =>
      workItemIds.has(run.workItemId) &&
      ["queued", "running", "waiting-for-decision", "publishing"].includes(run.status)
    )
  ) return "active";

  return "planned";
}

/** Derive the single project-level signal used by the cockpit header. */
export function deriveEngineeringProjectStatus(
  snapshot: EngineeringProjectSnapshot,
): EngineeringProjectStatus {
  // A project can exist before it has a technical baseline. Vacuous completion
  // would falsely claim that such a project has finished engineering work.
  if (snapshot.phases.length === 0) return "planned";
  const phaseStatuses = snapshot.phases.map((phase) =>
    deriveEngineeringPhaseStatus(snapshot, phase.id)
  );
  if (phaseStatuses.every((status) => status === "completed")) return "completed";
  if (
    snapshot.decisions.some((decision) =>
      decision.status === "required" || decision.status === "proposed" ||
      decision.status === "rejected"
      // abandoned decisions are intentionally terminal: they do not keep
      // the project in attention-required
    )
  ) return "attention-required";
  if (phaseStatuses.some((status) => status === "blocked")) return "blocked";
  if (phaseStatuses.some((status) => status === "active")) return "active";
  return "planned";
}
