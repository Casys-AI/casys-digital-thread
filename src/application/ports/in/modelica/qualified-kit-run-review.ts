/** Inward boundary for one qualified local Modelica review. */

import type {
  ModelicaQualifiedKitRunAdmission,
} from "../../../../domain/modelica/qualified-kit/run-proposal.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

export interface ProjectModelicaQualifiedKitRunReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
}

export interface ProjectModelicaQualifiedKitRunReviewResult {
  /** Review facts only; this result contains no source bytes or capability. */
  readonly admission: ModelicaQualifiedKitRunAdmission;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectModelicaQualifiedKitRunReviewUseCase {
  execute(value: unknown): Promise<ProjectModelicaQualifiedKitRunReviewResult>;
}
