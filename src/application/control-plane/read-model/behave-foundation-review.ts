import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { RuntimePlatform } from "./capability-pack.ts";
import type { BehaveFoundationCensusReviewEvidence } from "./behave-foundation-census.ts";

export const BEHAVE_FOUNDATION_REVIEW_SCHEMA_VERSION =
  "behave-foundation-candidate-review/0.1" as const;

export interface BehaveFoundationReviewDocument {
  readonly path: string;
  readonly fingerprint: ContentFingerprint;
}

export interface BehaveFoundationPlatformClaim {
  readonly materialId: string;
  readonly platforms: readonly RuntimePlatform[];
}

/**
 * Reviewed repository input for a local developer candidate. It is not a
 * production qualification, runtime observation, installation lock or Thread
 * document.
 */
export interface BehaveFoundationCandidateReview {
  readonly schemaVersion: typeof BEHAVE_FOUNDATION_REVIEW_SCHEMA_VERSION;
  readonly pack: {
    readonly id: "casys.behave-foundation";
    readonly version: "0.1.0";
  };
  readonly scope: "local-developer-candidate";
  readonly productionEligible: false;
  readonly platformClaims: readonly BehaveFoundationPlatformClaim[];
  readonly platformEvidence: BehaveFoundationReviewDocument;
  readonly reviews: {
    readonly licences: BehaveFoundationReviewDocument;
    readonly volumes: BehaveFoundationReviewDocument;
    readonly security: BehaveFoundationReviewDocument;
  };
}

export interface VerifiedBehaveFoundationCandidateReview
  extends BehaveFoundationCandidateReview {
  readonly platformsByMaterialId: Readonly<
    Record<string, readonly RuntimePlatform[]>
  >;
  readonly reviewEvidence: BehaveFoundationCensusReviewEvidence;
}
