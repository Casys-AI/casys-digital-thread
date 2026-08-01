import type { ContentFingerprint, ThreadEntityKind } from "./thread-snapshot.ts";
import type { IsoDateTime } from "./types.ts";

/**
 * Immutable, transport-independent intent and execution state for one
 * engineering project. Technical evidence remains owned by ThreadSnapshot and
 * is only addressed here through exact snapshot/entity references.
 */

export type EngineeringProjectSchemaVersion = "1.0";

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
  /** Exact thread state and normalized inputs used by this execution. */
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
