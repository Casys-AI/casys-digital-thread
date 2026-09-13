import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../../../domain/resource/agent-resource-capture.ts";
import type { ProjectBuyCostEstimatePreviewResult } from "../../in/buy/project-buy-cost-estimate-preview.ts";

export const BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA =
  "buy-cost-estimate-preview-evidence-reference/1.0" as const;
export const BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA =
  "buy-cost-estimate-preview-evidence/1.0" as const;

export interface BuyCostEstimatePreviewEvidenceReference {
  readonly schemaVersion: typeof BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_REFERENCE_SCHEMA;
  readonly projectId: string;
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
}

export interface BuyCostEstimatePreviewEvidence {
  readonly schemaVersion: typeof BUY_COST_ESTIMATE_PREVIEW_EVIDENCE_SCHEMA;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly candidate: { readonly artifactId: string; readonly digest: string };
  readonly configurationDigest: string;
  readonly baseBundleDigest: string;
  readonly inputRefs: readonly AgentResourceReference[];
  readonly result: Extract<
    ProjectBuyCostEstimatePreviewResult,
    { readonly status: "preview" }
  >;
}

export interface BuyCostEstimatePreviewEvidenceCursor {
  readonly projectId: string;
  readonly fingerprint: string;
  readonly section: string;
  readonly offset: number;
}

export interface BuyCostEstimatePreviewEvidenceStore {
  save(
    evidence: BuyCostEstimatePreviewEvidence,
  ): Promise<BuyCostEstimatePreviewEvidenceReference>;
  read(
    reference: BuyCostEstimatePreviewEvidenceReference,
  ): Promise<BuyCostEstimatePreviewEvidence | undefined>;
  saveCursor(
    value: BuyCostEstimatePreviewEvidenceCursor,
  ): Promise<string>;
  readCursor(
    cursor: string,
  ): Promise<BuyCostEstimatePreviewEvidenceCursor | undefined>;
}
