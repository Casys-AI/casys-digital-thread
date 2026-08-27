/**
 * Inward port for preparing `verify.evaluate-sensitivity-base@1`.
 *
 * Names exact identities only. Writes no Thread state. Does not invent a
 * metric mapping.
 */

import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

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
    readonly studyArtifactId: string;
    readonly metrics: readonly string[];
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
