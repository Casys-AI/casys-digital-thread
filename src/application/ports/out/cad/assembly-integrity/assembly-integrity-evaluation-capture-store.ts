/** Content-addressed persistence for provider-free L4 assembly evaluation. */

import type { AssemblyIntegrityEvaluationCapture } from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface AssemblyIntegrityEvaluationCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface AssemblyIntegrityEvaluationCaptureStore {
  save(
    capture: AssemblyIntegrityEvaluationCapture,
  ): Promise<AssemblyIntegrityEvaluationCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<AssemblyIntegrityEvaluationCapture | undefined>;
}
