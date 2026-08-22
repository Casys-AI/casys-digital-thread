/**
 * Outward CAS seam for one mechanical proof-case source.
 *
 * Application code captures canonical JSON then reopens by fingerprint only.
 * The caller never supplies a URI, path, provider or tool.
 */

import type { FeaProofCaseSourceCaptureReference } from "../../../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import type { MechanicalProofCaseSource } from "../../../../../domain/fea/seal-case/mechanical-proof-case-source.ts";

export interface ReopenedFeaProofCaseSourceCapture {
  readonly reference: FeaProofCaseSourceCaptureReference;
  readonly sourceText: string;
  readonly source: MechanicalProofCaseSource;
}

export interface FeaProofCaseSourceCaptureReader {
  capture(sourceText: string): Promise<FeaProofCaseSourceCaptureReference>;
  reopen(value: unknown): Promise<ReopenedFeaProofCaseSourceCapture>;
}
