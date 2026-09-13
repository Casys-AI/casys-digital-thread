import type { EngineeringDecisionProposalParameter } from "../../../../domain/project/engineering-project.ts";
import type { BuySealDecisionParameters } from "../../../../domain/buy/buy-proposal.ts";
import type { BuyCostBundle } from "../../../../domain/buy/buy-cost-bundle.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";

export interface ProjectBuyConfigurationCostSealReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly candidateArtifactId: string;
  readonly candidateFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}

export type ProjectBuyConfigurationCostSealReviewResult =
  | {
    readonly status: "ready";
    readonly bundle: BuyCostBundle;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly admission: BuySealDecisionParameters;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly reason: string;
  };

export interface ProjectBuyConfigurationCostSealReviewUseCase {
  execute(value: unknown): Promise<ProjectBuyConfigurationCostSealReviewResult>;
}
