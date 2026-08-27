/**
 * Persistence for one admitted SPICE observation-evaluation capture.
 *
 * Callers receive a content-addressed URI. They never see a filesystem path.
 */

import type { ContentFingerprint } from "../../../../../../domain/kernel/primitives.ts";

export interface AdmittedSpiceObservationEvaluationCaptureStoreReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface AdmittedSpiceObservationEvaluationCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<AdmittedSpiceObservationEvaluationCaptureStoreReceipt>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}
