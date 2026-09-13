import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

/**
 * Closed review input. The server reopens the current approved brief and
 * every named source. Caller URL+digest pairs are not a capture.
 */
export interface ProjectDocumentaryClauseResponseReviewCommand {
  readonly projectId: string;
  readonly sourceItemId: string;
  readonly answer: string;
  readonly scope: string;
  readonly sourceRefs: readonly ProjectDocumentaryClauseResponseReviewSourceRef[];
}

export type ProjectDocumentaryClauseResponseReviewSourceRef =
  | {
    readonly kind: "agent-resource";
    readonly resourceRef: unknown;
  }
  | {
    readonly kind: "thread-artifact";
    readonly artifactId: string;
  };

export type ProjectDocumentaryClauseResponseReviewResult = {
  readonly status: "resolved";
  readonly operation: {
    readonly id: "record.seal-documentary-clause-response";
    readonly version: "1";
  };
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly baseSnapshot: EngineeringThreadSnapshotBasis;
  readonly inputEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  readonly diagnostics: readonly [];
} | {
  readonly status: "unresolved";
  readonly diagnostics: readonly {
    readonly code: "source-unresolved";
    readonly message: string;
  }[];
};

export interface ProjectDocumentaryClauseResponseReviewUseCase {
  execute(value: unknown): Promise<ProjectDocumentaryClauseResponseReviewResult>;
}
