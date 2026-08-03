import type { ContentFingerprint, ThreadEntityKind } from "./thread-snapshot.ts";
import type { IsoDateTime } from "./types.ts";

/**
 * Immutable, transport-independent intent and execution state for one
 * engineering project. Technical evidence remains owned by ThreadSnapshot and
 * is only addressed here through exact snapshot/entity references.
 */

/**
 * V1 remains the immutable CM-01 history format. New projects created from a
 * human-approved discovery handoff are V2: their first run is anchored to the
 * approved discovery, then every later run is anchored to a ThreadSnapshot.
 */
export type EngineeringProjectSchemaVersion = "1.0" | "2.0";

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
  | "project.create-from-discovery"
  | "project.plan-publish"
  | "project.change-append"
  | "decision.propose"
  | "decision.approve"
  | "decision.reject"
  | "agent-run.queue"
  | "agent-run.claim"
  | "agent-run.progress"
  | "agent-run.publish"
  | "agent-run.complete"
  | "agent-run.fail";

export interface EngineeringCommandActor {
  readonly id: string;
  readonly origin: EngineeringCommandOriginKind;
}

/**
 * Immutable origin for a project that was explicitly created from an approved
 * pre-project discovery brief. This records planning provenance only: it is
 * neither a SysON model nor technical ThreadSnapshot evidence.
 */
export interface EngineeringProjectDiscoveryHandoff {
  /** Stable pre-project discovery aggregate identity. */
  readonly discoveryId: string;
  /** Exact immutable discovery revision accepted for this project. */
  readonly snapshotId: string;
  readonly revision: number;
  /** The exact approved brief within that discovery revision. */
  readonly briefId: string;
  /** Fingerprint of the precise brief-review input that the human approved. */
  readonly approvedBriefFingerprint: ContentFingerprint;
  readonly approvedAt: IsoDateTime;
  readonly approvedBy: EngineeringCommandActor;
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
 * distinct from an execution run's technical snapshot anchor: a discovery
 * handoff is planning provenance, never fabricated engineering evidence.
 */
export interface EngineeringApprovedDiscoveryBasis {
  readonly kind: "approved-discovery";
  readonly discoveryId: string;
  readonly snapshotId: string;
  readonly revision: number;
  readonly briefId: string;
  readonly approvedBriefFingerprint: ContentFingerprint;
}

/** Exact ThreadSnapshot state used after the first V2 documentary baseline. */
export interface EngineeringThreadSnapshotBasis extends EngineeringThreadSnapshotRef {
  readonly kind: "thread-snapshot";
}

/**
 * An execution anchor, never a `latest` alias.
 *
 * `approved-discovery` is valid only for the one reviewed first-baseline
 * operation. A result created from it is a documentary pre-technical
 * baseline, not a descendant of a fabricated ThreadSnapshot or a claim of
 * engineering proof. All later V2 runs use the
 * `thread-snapshot` arm and retain the normal descendant invariant.
 */
export type EngineeringBasisRef =
  | EngineeringApprovedDiscoveryBasis
  | EngineeringThreadSnapshotBasis;

/**
 * A reviewed source slot for an operation. Provider endpoints, tool names,
 * paths, scripts and raw tool outputs are intentionally not representable.
 */
export type EngineeringOperationInputBinding =
  | {
    readonly name: string;
    readonly source: { readonly kind: "approved-discovery" };
  }
  | {
    readonly name: string;
    readonly source: {
      readonly kind: "discovery-answer";
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
 * Agent-published planning metadata. It names the exact approved discovery
 * that grounded the path and carries no technical evidence or authorization.
 */
export interface EngineeringProjectPlan {
  readonly startingPoint: EngineeringProjectStartingPoint;
  readonly basis: EngineeringApprovedDiscoveryBasis;
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
  /**
   * V2 execution anchor. V2 runs must use this field and never `baseSnapshot`.
   * The validator enforces the schema-version boundary at JSON ingress.
   */
  readonly basis?: EngineeringBasisRef;
  /**
   * V1-only exact thread state. It remains readable for the immutable CM-01
   * history and is deliberately not a fallback for V2 execution.
   */
  readonly baseSnapshot?: EngineeringThreadSnapshotRef;
  readonly inputFingerprint?: ContentFingerprint;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly waitingForDecisionIds?: readonly string[];
  readonly resultSnapshot?: EngineeringThreadSnapshotRef;
  readonly failure?: EngineeringAgentRunFailure;
  readonly statusHistory?: readonly EngineeringAgentRunTransition[];
}

export interface EngineeringAgentRunFailure {
  readonly code: string;
  readonly message: string;
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
  /**
   * Present only for a project born from a human-approved discovery handoff.
   * Existing projects retain their own independently established provenance.
   */
  readonly discoveryHandoff?: EngineeringProjectDiscoveryHandoff;
  /** Present once an agent publishes a bounded path from an approved discovery. */
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
    workItems.length > 0 && workItems.every((item) => item.status === "completed") &&
    requiredDecisions.every((decision) => decision.status === "approved") &&
    phase.evidenceRefs.length > 0
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
  // A discovery handoff deliberately creates a project before there is a
  // technical baseline. Vacuous completion would falsely claim that such a
  // project has finished engineering work.
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
