import type { ContentFingerprint } from "../thread/thread-snapshot.ts";
import type { IsoDateTime } from "../kernel/primitives.ts";

/** Human-readable project intent and its reviewable MBSE framing. */

export type ProjectBriefActorOrigin = "human" | "agent";

export interface ProjectBriefActor {
  readonly id: string;
  readonly origin: ProjectBriefActorOrigin;
}

export interface ProjectIntentSource {
  readonly kind: "human" | "document";
  readonly reference: string;
}

export interface ProjectIntent {
  readonly statement: string;
  readonly source: ProjectIntentSource;
  readonly capturedAt: IsoDateTime;
  /** Caller that persisted the reported intent, distinct from its source. */
  readonly capturedBy: ProjectBriefActor;
}

export type ProjectQuestionConfidence = "low" | "medium" | "high";

export type ProjectQuestionRisk =
  | "reversible"
  | "material"
  | "safety-critical"
  | "regulatory";

export interface ProjectQuestionRecommendation {
  readonly value: string;
  readonly rationale: string;
  readonly confidence: ProjectQuestionConfidence;
}

export interface ProjectQuestionOption {
  readonly value: string;
  readonly label: string;
  readonly consequences: string;
}

export interface ProjectQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters: string;
  readonly recommendation: ProjectQuestionRecommendation;
  readonly options: readonly ProjectQuestionOption[];
  readonly allowUnknown: boolean;
  readonly risk: ProjectQuestionRisk;
  readonly evidenceNeeded: readonly string[];
  readonly proposedAt: IsoDateTime;
  readonly proposedBy: ProjectBriefActor;
}

export type ProjectAnswerKind = "provided" | "unknown";

export type ProjectAnswerSourceKind =
  | "human"
  | "tool"
  | "document"
  | "expert";

export interface ProjectAnswerSource {
  readonly kind: ProjectAnswerSourceKind;
  readonly reference: string;
}

export interface ProjectAnswer {
  readonly id: string;
  readonly questionId: string;
  readonly kind: ProjectAnswerKind;
  readonly value?: string;
  readonly explanation?: string;
  readonly source: ProjectAnswerSource;
  readonly supersedesAnswerId?: string;
  readonly recordedAt: IsoDateTime;
  /** Caller that persisted the answer, distinct from its declared source. */
  readonly recordedBy: ProjectBriefActor;
}

/**
 * Stable semantic slots in the living brief.
 *
 * The brief remains authoritative for stakeholder and project intent. Formal
 * requirements, architecture and verification results belong to their linked
 * SysML and ThreadSnapshot records rather than being copied back as fake facts.
 */
export type ProjectBriefItemKind =
  | "objective"
  | "primary-user"
  | "mission-scenario"
  | "operating-environment"
  | "success-criterion"
  | "constraint"
  | "exclusion"
  | "intended-market"
  | "manufacturing-jurisdiction"
  | "operating-jurisdiction"
  | "compliance-target"
  | "verification-activity"
  | "manufacturing-evidence"
  | "observed-fact"
  | "assumption"
  | "open-question"
  | "proposed-decision";

/**
 * V1 brief records predate explicit gate dependencies. V2 makes that
 * declaration part of the reviewed mandate without rewriting V1 history.
 */
export type ProjectBriefContractVersion = "1.0" | "2.0";

/** Existing brief kinds that can be claimed by engineering work. */
export type ProjectBriefGateItemKind =
  | "success-criterion"
  | "verification-activity";

export function isProjectBriefGateKind(
  kind: ProjectBriefItemKind,
): kind is ProjectBriefGateItemKind {
  return kind === "success-criterion" || kind === "verification-activity";
}

/**
 * Brief V2 `dependsOnItemIds` identity is the unique named set.
 * Persistence order has no domain semantics.
 */
export function canonicalizeBriefGateDependsOnItemIds(
  dependsOnItemIds: readonly string[],
): readonly string[] {
  const canonical = [...dependsOnItemIds].sort((left, right) =>
    left.localeCompare(right)
  );
  if (new Set(canonical).size !== canonical.length) {
    throw new TypeError("Brief V2 gate dependencies are duplicated.");
  }
  return canonical;
}

export type ProjectBriefSourceKind =
  | "intent"
  | "answer"
  | "tool"
  | "document"
  | "expert";

export interface ProjectBriefSourceRef {
  readonly kind: ProjectBriefSourceKind;
  /** Stable answer/entity id or an exact external source reference. */
  readonly reference: string;
}

/**
 * A versioned, provider-neutral verification method authority.
 *
 * It identifies the semantic method that may legitimately own a verification
 * activity. It is deliberately not a provider, MCP tool, runtime, or solver
 * selection.
 */
export interface ProjectBriefVerificationAuthority {
  readonly id: string;
  readonly version: string;
}

export function sameProjectBriefVerificationAuthority(
  left: ProjectBriefVerificationAuthority,
  right: ProjectBriefVerificationAuthority,
): boolean {
  return left.id === right.id && left.version === right.version;
}

export interface ProjectBriefItem {
  readonly id: string;
  readonly kind: ProjectBriefItemKind;
  readonly statement: string;
  readonly sourceRefs: readonly ProjectBriefSourceRef[];
  /** Required for assumptions; identifies who must resolve or own it. */
  readonly owner?: string;
  /** Required for assumptions; says when the provisional value must be revisited. */
  readonly reviewTrigger?: string;
  /**
   * V2-only declaration on a gate. Its presence is mandatory for gate items in
   * a V2 brief; an empty array explicitly declares independence from other
   * brief items. Its absence remains the V1 historical representation.
   */
  readonly dependsOnItemIds?: readonly string[];
  /**
   * V2-only authority for one verification activity. It is absent for
   * unqualified activities and is never a provider/runtime configuration.
   */
  readonly verificationAuthority?: ProjectBriefVerificationAuthority;
}

export interface ProjectBriefPreviousRevision {
  readonly snapshotId: string;
  readonly revision: number;
}

/** One immutable proposal in the stable brief lineage of a project. */
export interface ProjectBriefRevision {
  /**
   * Omitted records are historical V1 briefs. New proposals are always V2 and
   * persist this field explicitly so their gate contract is reviewable.
   */
  readonly contractVersion?: ProjectBriefContractVersion;
  readonly briefId: string;
  readonly id: string;
  readonly revision: number;
  readonly previous?: ProjectBriefPreviousRevision;
  readonly items: readonly ProjectBriefItem[];
  readonly proposedAt: IsoDateTime;
  readonly proposedBy: ProjectBriefActor;
}

/** Resolve the historical omitted form without inventing a field in storage. */
export function projectBriefContractVersion(
  brief: ProjectBriefRevision,
): ProjectBriefContractVersion {
  return brief.contractVersion ?? "1.0";
}

export type ProjectBriefReviewStatus = "pending" | "approved" | "rejected";

export interface ProjectBriefReview {
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly status: ProjectBriefReviewStatus;
  /** Exact proposal scope shown to the person in the paired conversation. */
  readonly inputFingerprint: ContentFingerprint;
  readonly requestedAt: IsoDateTime;
  readonly decidedAt?: IsoDateTime;
  readonly decidedBy?: ProjectBriefActor;
  readonly rationale?: string;
}

/**
 * Framing lives inside the engineering project from its first revision.
 * `currentBrief` is the latest human-approved canonical intent. A newer
 * `proposedBrief` never replaces it until the exact review succeeds.
 */
export interface EngineeringProjectFraming {
  readonly intent: ProjectIntent;
  readonly questions: readonly ProjectQuestion[];
  readonly answers: readonly ProjectAnswer[];
  readonly currentBrief?: ProjectBriefRevision;
  readonly currentBriefApproval?: ProjectBriefReview & {
    readonly status: "approved";
  };
  readonly proposedBrief?: ProjectBriefRevision;
  readonly proposalReview?: ProjectBriefReview & {
    readonly status: "pending" | "rejected";
  };
}

export type EngineeringProjectFramingStatus =
  | "framing"
  | "awaiting-review"
  | "revision-requested"
  | "approved";

export function currentProjectAnswer(
  framing: EngineeringProjectFraming,
  questionId: string,
): ProjectAnswer | undefined {
  const superseded = new Set(
    framing.answers.flatMap((answer) =>
      answer.supersedesAnswerId ? [answer.supersedesAnswerId] : []
    ),
  );
  return framing.answers.find((answer) =>
    answer.questionId === questionId && !superseded.has(answer.id)
  );
}

export function engineeringProjectFramingStatus(
  framing: EngineeringProjectFraming,
): EngineeringProjectFramingStatus {
  if (framing.proposalReview?.status === "pending") return "awaiting-review";
  if (framing.proposalReview?.status === "rejected") {
    return "revision-requested";
  }
  if (framing.currentBrief) return "approved";
  return "framing";
}

export function projectBriefItems(
  brief: ProjectBriefRevision,
  kind: ProjectBriefItemKind,
): readonly ProjectBriefItem[] {
  return brief.items.filter((item) => item.kind === kind);
}

export function projectBriefObjective(brief: ProjectBriefRevision): string {
  return projectBriefItems(brief, "objective")[0]?.statement ?? "";
}

/**
 * One Behave question taken from a V2 success-criterion. Sibling branches
 * never roll up into a combined verdict. Missing evidence stays `declared`.
 */
export type ProjectBriefQuestionBranchState = "declared";

export interface ProjectBriefQuestionBranch {
  readonly successCriterionId: string;
  readonly statement: string;
  readonly verificationActivityIds: readonly string[];
  readonly state: ProjectBriefQuestionBranchState;
}

/**
 * Project each success-criterion as its own question. A verification-activity
 * is attached only when it explicitly depends on that criterion. Absence of a
 * run, fixture or inventory cannot produce `pass`.
 */
export function projectBriefIndependentQuestionBranches(
  brief: ProjectBriefRevision,
): readonly ProjectBriefQuestionBranch[] {
  const verifications = projectBriefItems(brief, "verification-activity");
  return projectBriefItems(brief, "success-criterion").map((criterion) => ({
    successCriterionId: criterion.id,
    statement: criterion.statement,
    verificationActivityIds: verifications
      .filter((activity) => activity.dependsOnItemIds?.includes(criterion.id))
      .map((activity) => activity.id),
    state: "declared",
  }));
}
