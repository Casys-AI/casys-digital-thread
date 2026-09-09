/**
 * Inward port for preparing `verify.evaluate-sensitivity-base@1`.
 *
 * Names exact identities only. Writes no Thread state. Does not invent a
 * metric mapping.
 */

import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { SensitivityStudyConsumerAdmission } from "../../../../../domain/sensitivity/study/sensitivity-study-consumer-admission.ts";
import type { SensitivityStudyConsumerReviewNext } from "../study/project-sensitivity-study-seal-review.ts";

export interface ProjectSensitivityBaseEvaluationReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly studyArtifactId: string;
}

export interface ProjectSensitivityBaseEvaluationReviewErrorBody {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly recovery: string;
}

export type ProjectSensitivityBaseEvaluationReviewResult =
  | {
    readonly status: "ready-for-review";
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly studyArtifactId: string;
    readonly metrics: readonly string[];
    readonly selected: {
      readonly workItemId: string;
      readonly decisionId: string;
    };
    readonly admission: SensitivityStudyConsumerAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: SensitivityStudyConsumerReviewNext;
    readonly grants: "none";
  }
  | {
    readonly status: "unresolved";
    readonly error: ProjectSensitivityBaseEvaluationReviewErrorBody;
  };

export interface ProjectSensitivityBaseEvaluationReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectSensitivityBaseEvaluationReviewResult>;
}
