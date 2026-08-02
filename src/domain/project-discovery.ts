import type { ContentFingerprint } from "./thread-snapshot.ts";
import type { IsoDateTime } from "./types.ts";

/**
 * Immutable discovery state for an industrial project that does not exist yet.
 *
 * Discovery is deliberately separate from EngineeringProjectSnapshot and
 * ThreadSnapshot. A plain-language intent, reported answers, and a proposed
 * brief are not technical evidence and must not acquire project authority
 * before an explicit human review.
 */

export type ProjectDiscoverySchemaVersion = "1.0";

export interface ProjectDiscoveryPreviousSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
}

export type ProjectDiscoveryActorOrigin = "human" | "agent";

export interface ProjectDiscoveryActor {
  readonly id: string;
  readonly origin: ProjectDiscoveryActorOrigin;
}

export interface ProjectDiscoveryIntent {
  readonly statement: string;
  readonly capturedAt: IsoDateTime;
  readonly capturedBy: ProjectDiscoveryActor;
}

export type ProjectDiscoveryConfidence = "low" | "medium" | "high";

export type ProjectDiscoveryQuestionRisk =
  | "reversible"
  | "material"
  | "safety-critical"
  | "regulatory";

export interface ProjectDiscoveryRecommendation {
  readonly value: string;
  readonly rationale: string;
  readonly confidence: ProjectDiscoveryConfidence;
}

export interface ProjectDiscoveryQuestionOption {
  readonly value: string;
  readonly label: string;
  readonly consequences: string;
}

export interface ProjectDiscoveryQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters: string;
  readonly recommendation: ProjectDiscoveryRecommendation;
  readonly options: readonly ProjectDiscoveryQuestionOption[];
  readonly allowUnknown: boolean;
  readonly risk: ProjectDiscoveryQuestionRisk;
  readonly evidenceNeeded: readonly string[];
  readonly proposedAt: IsoDateTime;
  readonly proposedBy: ProjectDiscoveryActor;
}

export type ProjectDiscoveryAnswerKind = "provided" | "unknown";

export type ProjectDiscoveryAnswerSourceKind =
  | "human"
  | "tool"
  | "document"
  | "expert";

/** The exact reported origin of an answer; never inferred by the store. */
export interface ProjectDiscoveryAnswerSource {
  readonly kind: ProjectDiscoveryAnswerSourceKind;
  readonly reference: string;
}

export interface ProjectDiscoveryAnswer {
  readonly id: string;
  readonly questionId: string;
  readonly kind: ProjectDiscoveryAnswerKind;
  readonly value?: string;
  readonly explanation?: string;
  readonly source: ProjectDiscoveryAnswerSource;
  readonly supersedesAnswerId?: string;
  readonly recordedAt: IsoDateTime;
  /** The caller who reported the answer, distinct from its declared source. */
  readonly recordedBy: ProjectDiscoveryActor;
}

export interface ProjectDiscoveryBrief {
  readonly id: string;
  readonly objective: string;
  readonly missionScenarios: readonly string[];
  readonly successCriteria: readonly string[];
  readonly constraints: readonly string[];
  /** Markets where the product is intended to be sold or supplied. */
  readonly intendedMarkets: readonly string[];
  /** Jurisdictions where manufacturing is intended to take place. */
  readonly manufacturingJurisdictions: readonly string[];
  /** Jurisdictions where the product is intended to be operated or used. */
  readonly operatingJurisdictions: readonly string[];
  /**
   * Candidate standards, regulations or certification outcomes. Identifiers do
   * not imply legal advice or access to licensed standards content.
   */
  readonly complianceTargets: readonly string[];
  /** Planned tests, analyses or inspections that could later produce evidence. */
  readonly verificationPlan: readonly string[];
  readonly exclusions: readonly string[];
  readonly assumptions: readonly string[];
  readonly openQuestions: readonly string[];
  readonly proposedAt: IsoDateTime;
  readonly proposedBy: ProjectDiscoveryActor;
}

export type ProjectDiscoveryBriefReviewStatus =
  | "pending"
  | "approved"
  | "rejected";

export interface ProjectDiscoveryBriefReview {
  readonly briefId: string;
  readonly status: ProjectDiscoveryBriefReviewStatus;
  /** Exact proposal scope shown to the reviewer. */
  readonly inputFingerprint: ContentFingerprint;
  readonly requestedAt: IsoDateTime;
  readonly decidedAt?: IsoDateTime;
  readonly decidedBy?: ProjectDiscoveryActor;
  readonly rationale?: string;
}

export type ProjectDiscoveryStatus =
  | "discovering"
  | "awaiting-review"
  | "revision-requested"
  | "approved";

export type ProjectDiscoveryCommandName =
  | "discovery.start"
  | "question.propose"
  | "answer.record"
  | "brief.propose"
  | "brief.approve"
  | "brief.reject";

export interface ProjectDiscoveryCommandReceipt {
  readonly commandId: string;
  readonly type: ProjectDiscoveryCommandName;
  readonly actor: ProjectDiscoveryActor;
  readonly issuedAt: IsoDateTime;
  readonly appliedAt: IsoDateTime;
  readonly requestFingerprint: ContentFingerprint;
  readonly resultingSnapshot: ProjectDiscoveryPreviousSnapshot;
}

export interface ProjectDiscoverySnapshot {
  readonly schemaVersion: ProjectDiscoverySchemaVersion;
  readonly id: string;
  readonly discoveryId: string;
  readonly revision: number;
  readonly previous?: ProjectDiscoveryPreviousSnapshot;
  readonly generatedAt: IsoDateTime;
  readonly status: ProjectDiscoveryStatus;
  readonly intent: ProjectDiscoveryIntent;
  readonly questions: readonly ProjectDiscoveryQuestion[];
  readonly answers: readonly ProjectDiscoveryAnswer[];
  readonly brief?: ProjectDiscoveryBrief;
  readonly review?: ProjectDiscoveryBriefReview;
  readonly commandReceipts: readonly ProjectDiscoveryCommandReceipt[];
}

/** Return the single unsuperseded answer for a question, if one exists. */
export function currentProjectDiscoveryAnswer(
  snapshot: ProjectDiscoverySnapshot,
  questionId: string,
): ProjectDiscoveryAnswer | undefined {
  const superseded = new Set(
    snapshot.answers.flatMap((answer) =>
      answer.supersedesAnswerId ? [answer.supersedesAnswerId] : []
    ),
  );
  return snapshot.answers.find((answer) =>
    answer.questionId === questionId && !superseded.has(answer.id)
  );
}
