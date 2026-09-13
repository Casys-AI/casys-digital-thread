/** Compose documentary Buy previews from retained bytes, without an ERP client. */
import type { ProjectBuyConfigurationCostSealReviewUseCase } from "../../application/ports/in/buy/project-buy-configuration-cost-seal-review.ts";
import type { BuyCandidateCaptureReader } from "../../application/use-cases/buy/prepare-project-buy-configuration-cost-seal-review.ts";
import { PrepareProjectBuyCostEstimatePreview } from "../../application/use-cases/buy/prepare-project-buy-cost-estimate-preview.ts";
import {
  BoundedBuyCostEstimatePreview,
  ReadBuyCostEstimatePreviewEvidence,
} from "../../application/use-cases/buy/bounded-buy-cost-estimate-preview.ts";
import type { ReopenAgentResource } from "../../application/use-cases/resource/reopen-agent-resource.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import {
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
  BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
  FileBuyCostEstimatePreviewEvidenceStore,
} from "./file-buy-cost-estimate-preview-evidence-store.ts";

export function createBuyCostEstimatePreviewComposition(options: {
  readonly sealReview: ProjectBuyConfigurationCostSealReviewUseCase;
  readonly candidates: BuyCandidateCaptureReader;
  readonly resources: ReopenAgentResource;
  readonly evidenceDirectory: string;
}) {
  const evidence = new FileBuyCostEstimatePreviewEvidenceStore(
    new FileByteStore({
      kind: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_KIND,
      directory: options.evidenceDirectory,
      uriNamespace: BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_URI_NAMESPACE,
      label: "Buy cost estimate preview evidence",
    }),
  );
  return {
    costEstimatePreview: new BoundedBuyCostEstimatePreview(
      new PrepareProjectBuyCostEstimatePreview(
        options.sealReview,
        options.candidates,
        options.resources,
      ),
      evidence,
    ),
    costEstimatePreviewDetail: new ReadBuyCostEstimatePreviewEvidence(evidence),
  };
}
