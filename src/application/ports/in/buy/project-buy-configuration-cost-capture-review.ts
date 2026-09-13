import type { EngineeringDecisionProposalParameter } from "../../../../domain/project/engineering-project.ts";
import type { BuyCaptureDecisionParameters } from "../../../../domain/buy/buy-proposal.ts";
import type { BuyConfiguration } from "../../../../domain/buy/buy-configuration.ts";
import type { BuyDocumentRequest } from "../../../../domain/buy/buy-proposal.ts";
import type { BuyPricingContext } from "../../../../domain/buy/buy-cost-bundle.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";

export interface ProjectBuyConfigurationCostCaptureReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly configurationResourceUri: string;
  readonly configurationResourceDigest: string;
  readonly geometryArtifactId: string;
  readonly geometryArtifactFingerprint: string;
  readonly documents: readonly BuyDocumentRequest[];
  readonly pricing: BuyPricingContext;
}

export type ProjectBuyConfigurationCostCaptureReviewResult =
  | {
    readonly status: "ready";
    readonly configuration: BuyConfiguration;
    readonly configurationDigest: string;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly admission: BuyCaptureDecisionParameters;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly reason: string;
  };

export interface ProjectBuyConfigurationCostCaptureReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectBuyConfigurationCostCaptureReviewResult>;
}
