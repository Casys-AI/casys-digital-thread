/** Read-only next-hop compiler for `model.write-sensitivity-edges@1`. */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";
import type { SensitivityEdge } from "../../../../../domain/sensitivity/edges/sensitivity-edge.ts";
import type { SensitivityStudyConsumerAdmission } from "../../../../../domain/sensitivity/study/sensitivity-study-consumer-admission.ts";
import type { SensitivityStudyConsumerReviewNext } from "../study/project-sensitivity-study-seal-review.ts";

export interface ProjectSensitivityEdgesReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly studyArtifactId: string;
}

export type ProjectSensitivityEdgesReviewResult =
  | {
    readonly status: "ready-for-review";
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly studyArtifactId: string;
    readonly partDefName: string;
    readonly edges: readonly SensitivityEdge[];
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
    readonly error: {
      readonly code: string;
      readonly context: Readonly<Record<string, unknown>>;
      readonly recovery: string;
    };
  };

export interface ProjectSensitivityEdgesReviewUseCase {
  execute(value: unknown): Promise<ProjectSensitivityEdgesReviewResult>;
}
