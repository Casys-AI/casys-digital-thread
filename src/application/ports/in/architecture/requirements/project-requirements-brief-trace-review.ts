import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";

/** Only identities are caller declarations; existing criterion values are reopened by the server. */
export interface ProjectRequirementsBriefTraceReviewCommand {
  readonly projectId: string;
  readonly containerComponent: string;
  readonly containerSourceItemId: string;
  readonly requirementId: string;
  readonly sourceItemId: string;
}

export type ProjectRequirementsBriefTraceReviewResult = {
  readonly status: "resolved";
  readonly operation: {
    readonly id: "record.seal-requirements-brief-trace";
    readonly version: "1";
  };
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly baseSnapshot: EngineeringThreadSnapshotBasis;
  readonly requirementsCaptureEvidenceRef: EngineeringThreadEntityRef;
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

export interface ProjectRequirementsBriefTraceReviewUseCase {
  execute(value: unknown): Promise<ProjectRequirementsBriefTraceReviewResult>;
}
