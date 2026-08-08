import type {
  ContentFingerprint,
  ThreadEntityKind,
} from "../thread/thread-snapshot.ts";
import type { IsoDateTime } from "../kernel/types.ts";
import type { EngineeringProjectFraming } from "./project-brief.ts";

/**
 * Immutable, transport-independent intent and execution state for one
 * engineering project. Technical evidence remains owned by ThreadSnapshot and
 * is only addressed here through exact snapshot/entity references.
 */

/**
 * V1 remains an immutable history format. New projects are V3: they exist
 * from first intent, own their living brief, anchor the documentary baseline to
 * its exact human-approved revision, then anchor later runs to ThreadSnapshots.
 */
export type EngineeringProjectSchemaVersion = "1.0" | "3.0";

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
  | "decision.propose"
  | "decision.approve"
  | "decision.reject"
  | "agent-run.queue"
  | "agent-run.claim"
  | "agent-run.progress"
  | "agent-run.publish"
  | "agent-run.complete"
  | "agent-run.fail"
  | "agent-run.cancel";

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
  | "cancelled";

export type EngineeringWorkOwner = "human" | "agent" | "shared";

/**
 * A terminal closeout for work that did not itself produce evidence.
 *
 * This deliberately names both the failed attempt and the independently
 * completed successor. It prevents a recovered successor from being
 * misreported as a successful execution of the failed work item.
 */
export interface EngineeringWorkItemSuccessorReconciliation {
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
   */
  readonly successorSnapshot: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly rationale: string;
}

export interface EngineeringWorkItem {
  readonly id: string;
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
  /** V3 execution anchor. V3 runs must use this field and never `baseSnapshot`. */
  readonly basis?: EngineeringBasisRef;
  /**
   * V1-only exact thread state. It remains readable for the immutable CM-01
   * history and is deliberately not a fallback for V3 execution.
   */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  readonly inputFingerprint?: ContentFingerprint;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly waitingForDecisionIds?: readonly string[];
  readonly resultSnapshot?: EngineeringThreadSnapshotRef;
  readonly failure?: EngineeringAgentRunFailure;
  /**
   * Present only when a human cancelled a run before any agent claim or
   * execution. This is intentionally distinct from a failed execution.
   */
  readonly cancellation?: EngineeringAgentRunCancellation;
  readonly statusHistory?: readonly EngineeringAgentRunTransition[];
}

export interface EngineeringAgentRunFailure {
  readonly code: string;
  readonly message: string;
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
  | "superseded";

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
      (item.status === "cancelled" && item.reconciliation !== undefined)
    ) &&
    requiredDecisions.every((decision) => decision.status === "approved") &&
    (phase.evidenceRefs.length > 0 ||
      workItems.some((item) =>
        item.reconciliation !== undefined &&
        item.reconciliation.successorEvidenceRefs.length > 0
      ))
  ) return "completed";

  const workItemIds = new Set(phase.workItemIds);
  if (
    workItems.some((item) =>
      item.status === "in-progress" || item.status === "waiting-for-decision"
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
    )
  ) return "attention-required";
  if (phaseStatuses.some((status) => status === "blocked")) return "blocked";
  if (phaseStatuses.some((status) => status === "active")) return "active";
  return "planned";
}
