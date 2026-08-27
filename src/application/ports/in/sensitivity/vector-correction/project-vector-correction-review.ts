/**
 * Inward port for preparing the human review of one vector-correction document.
 *
 * The caller names only exact identities. The use case mutates no Thread
 * state and grants no CAD, SysON, or provider authority.
 */

import type { VectorCorrectionDecisionParameters } from "../../../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";

export interface ProjectVectorCorrectionReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly evaluationId: string;
  readonly studyArtifactId: string;
}

export interface ProjectVectorCorrectionReviewErrorBody {
  readonly code: string;
  readonly context: Readonly<Record<string, unknown>>;
  readonly recovery: string;
}

export type ProjectVectorCorrectionReviewResult =
  | {
    readonly status: "ready-for-review";
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly proposal: VectorCorrectionDecisionParameters;
  }
  | {
    readonly status: "unresolved";
    readonly error: ProjectVectorCorrectionReviewErrorBody;
    readonly decisionParameters?: undefined;
  };

export interface ProjectVectorCorrectionReviewUseCase {
  execute(value: unknown): Promise<ProjectVectorCorrectionReviewResult>;
}
