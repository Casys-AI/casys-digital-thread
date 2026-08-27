/**
 * Read-only preparation for one human cross-domain impact decision.
 *
 * The caller names only a project. The server reopens the unique current
 * Thread tip and unique X07/X08 evaluation capture, then recrosses Brief V2
 * gates and existing work-item claims. This grants no approval, mutation,
 * rerun, or provider dispatch.
 */

import type { CrossDomainImpactDecisionAdmission } from "../../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../domain/project/engineering-project.ts";

export interface ProjectCrossDomainImpactDecisionReviewCommand {
  readonly projectId: string;
}

export interface ProjectCrossDomainImpactDecisionReviewDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ProjectCrossDomainImpactDecisionReviewResult =
  | {
    readonly status: "resolved";
    readonly admission: CrossDomainImpactDecisionAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly diagnostics: readonly ProjectCrossDomainImpactDecisionReviewDiagnostic[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics: readonly ProjectCrossDomainImpactDecisionReviewDiagnostic[];
  };

export interface ProjectCrossDomainImpactDecisionReviewUseCase {
  execute(value: unknown): Promise<ProjectCrossDomainImpactDecisionReviewResult>;
}
