/**
 * Inward port that turns a corrected-source document into
 * `compile.seal-admission@1` decisionParameters via the existing preview.
 */

import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectCorrectedAdmissionReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly correctedSourceArtifactId: string;
}

export type ProjectCorrectedAdmissionReviewResult =
  | {
    readonly status: "ready-for-review";
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  }
  | {
    readonly status: "unresolved";
    readonly error: {
      readonly code: string;
      readonly context: Readonly<Record<string, unknown>>;
      readonly recovery: string;
    };
  };

export interface ProjectCorrectedAdmissionReviewUseCase {
  execute(value: unknown): Promise<ProjectCorrectedAdmissionReviewResult>;
}
