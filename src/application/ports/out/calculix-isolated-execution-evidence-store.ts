import type { CalculixIsolatedExecutionEvidence } from "../../../domain/analysis/calculix-isolated-execution.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export interface CalculixIsolatedExecutionEvidenceStore {
  save(value: unknown): Promise<{
    readonly evidence: CalculixIsolatedExecutionEvidence;
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
  }>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CalculixIsolatedExecutionEvidence | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}
