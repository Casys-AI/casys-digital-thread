import type { BuyCostBundleV2 } from "../../../../domain/buy/buy-cost-bundle-v2.ts";
import type { BuyProductionEstimateBundle } from "../../../../domain/buy/buy-production-estimate.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../../../domain/resource/agent-resource-capture.ts";

export const BUY_COST_ESTIMATE_PREVIEW_MAX_ESTIMATES = 8;

/**
 * Server resource policy for one read-only preview request, not engineering
 * values. At most 512 unique operand evidence sources and 4 MiB of declared
 * evidence bytes are reopened; unique-reference count and declared bytes are
 * refused before any source I/O, and actually reopened bytes are refused as
 * soon as they cross the same bound. Excess yields no alias, no recompute,
 * and no retained evidence.
 */
export const BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_REFS = 512;
export const BUY_COST_ESTIMATE_PREVIEW_MAX_EVIDENCE_BYTES = 4_194_304;

export interface ProjectBuyCostEstimatePreviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly candidateArtifactId: string;
  readonly candidateFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
  readonly estimateRefs: readonly AgentResourceReference[];
}

export interface ProjectBuyCostEstimatePreviewEstimate {
  readonly captureUri: string;
  readonly digest: string;
  readonly estimateId: string;
  readonly lineIds: readonly string[];
  readonly provisionalLineIds: readonly string[];
}

export interface ProjectBuyCostEstimatePreviewEvidence {
  readonly uri: string;
  readonly digest: string;
  readonly byteCount: number;
  readonly mimeType: string;
  readonly anchors: readonly string[];
  readonly observedAts: readonly string[];
}

export type ProjectBuyCostEstimatePreviewResult =
  | {
    readonly status: "preview";
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly candidate: { readonly artifactId: string; readonly digest: string };
    readonly configurationDigest: string;
    readonly pricing: { readonly currency: string; readonly asOf: string };
    readonly estimates: readonly ProjectBuyCostEstimatePreviewEstimate[];
    readonly evidence: readonly ProjectBuyCostEstimatePreviewEvidence[];
    readonly annexes: readonly BuyProductionEstimateBundle[];
    readonly bundle: BuyCostBundleV2;
    readonly nature: "documentary";
    readonly provisional: boolean;
    readonly authority: {
      readonly registeredSeal: "no registered seal executed";
      readonly spendingApproval: "none";
      readonly qualification: "none";
    };
    readonly limits: {
      readonly maxEstimates: number;
      readonly maxBytesPerSource: number;
      readonly acceptedMimeTypes: readonly string[];
    };
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly reason: string;
  };

export interface ProjectBuyCostEstimatePreviewUseCase {
  execute(value: unknown): Promise<ProjectBuyCostEstimatePreviewResult>;
}
