/**
 * Read-only entry point for the generic admitted SPICE L5 closeout review.
 * The caller names only a project; the server selects the unique current
 * Thread tip and reopens every identity itself.
 *
 * L4 pass/fail/unresolved/error stay literal. They never imply accept or
 * reject. Both human closeout grammars are always derived when evidence
 * recrosses.
 */

import type { SpiceAdmittedObservationEvaluationCloseoutAdmission } from "../../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../../../domain/kernel/primitives.ts";
import type {
  EvaluationComparison,
  RequirementEvaluationStatus,
} from "../../../../../../domain/thread/thread-snapshot.ts";

export interface ProjectAdmittedSpiceEvaluationCloseoutReviewRequest {
  readonly projectId: string;
}

export interface ProjectAdmittedSpiceEvaluationCloseoutReviewEvidenceRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly freshness: "fresh";
}

export interface ProjectAdmittedSpiceEvaluationCloseoutReviewEvaluation {
  readonly id: string;
  readonly requirementId: string;
  readonly status: RequirementEvaluationStatus;
  readonly evidenceArtifactId: string;
  readonly observationIds: readonly string[];
  readonly message: string;
  readonly comparison?: EvaluationComparison;
  readonly criterionId: string;
}

export interface ProjectAdmittedSpiceEvaluationCloseoutReviewResolved {
  readonly basis: SpiceAdmittedObservationEvaluationCloseoutAdmission["basis"];
  readonly capture: ProjectAdmittedSpiceEvaluationCloseoutReviewEvidenceRef;
  readonly sheet: SpiceAdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly evaluations:
    readonly ProjectAdmittedSpiceEvaluationCloseoutReviewEvaluation[];
  readonly limitations: {
    readonly engineCalls: "none";
    readonly l4PassIsNotL5: true;
    readonly sheetScope: string;
    readonly sheetLimitations: string;
  };
  readonly accept: {
    readonly admission: SpiceAdmittedObservationEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
  readonly reject: {
    readonly admission: SpiceAdmittedObservationEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
}

export type ProjectAdmittedSpiceEvaluationCloseoutReviewResult =
  | {
    readonly status: "resolved";
    readonly selected: ProjectAdmittedSpiceEvaluationCloseoutReviewResolved;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: { readonly code: string; readonly message: string };
  };

export interface ProjectAdmittedSpiceEvaluationCloseoutReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAdmittedSpiceEvaluationCloseoutReviewResult>;
}
