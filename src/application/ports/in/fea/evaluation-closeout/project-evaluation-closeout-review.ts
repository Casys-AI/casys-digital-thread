/**
 * Read-only entry point for the generic static-mechanical L5 closeout review.
 * The caller names only a project; the server selects the unique current
 * Thread tip and reopens every identity itself.
 */

import type {
  StaticMechanicalCloseoutCriterion,
  StaticMechanicalEvaluationCloseoutAdmission,
  StaticMechanicalProofLimitations,
} from "../../../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface ProjectEvaluationCloseoutReviewRequest {
  readonly projectId: string;
}

export interface ProjectEvaluationCloseoutReviewEvidenceRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly freshness: "fresh";
}

export interface ProjectEvaluationCloseoutReviewResolved {
  readonly family: "static-mechanical";
  readonly basis: StaticMechanicalEvaluationCloseoutAdmission["basis"];
  readonly acceptanceEligibility: boolean;
  readonly criteria: readonly StaticMechanicalCloseoutCriterion[];
  readonly proofLimitations: StaticMechanicalProofLimitations;
  readonly evidence: {
    readonly canonicalStep: ProjectEvaluationCloseoutReviewEvidenceRef;
    readonly sealedProof: ProjectEvaluationCloseoutReviewEvidenceRef;
    readonly executionEvidence: ProjectEvaluationCloseoutReviewEvidenceRef;
    readonly evaluationCapture: ProjectEvaluationCloseoutReviewEvidenceRef;
  };
  /** Present only when every declared criterion is literal L4 pass. */
  readonly accept?: {
    readonly admission: StaticMechanicalEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
  /** Always a human choice; it grants no CAD, correction, FEA, or provider work. */
  readonly reject: {
    readonly admission: StaticMechanicalEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
}

export type ProjectEvaluationCloseoutReviewResult =
  | {
    readonly status: "resolved";
    readonly selected: ProjectEvaluationCloseoutReviewResolved;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly family: "static-mechanical";
    readonly diagnostic: { readonly code: string; readonly message: string };
  };

export interface ProjectEvaluationCloseoutReviewUseCase {
  execute(value: unknown): Promise<ProjectEvaluationCloseoutReviewResult>;
}
