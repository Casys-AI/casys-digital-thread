/**
 * Persistence for one admitted Modelica observation-evaluation capture.
 *
 * Callers receive a content-addressed URI. They never see a filesystem path,
 * HTTP endpoint or SysON tool.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface AdmittedObservationEvaluationCaptureStoreReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface AdmittedObservationEvaluationCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<AdmittedObservationEvaluationCaptureStoreReceipt>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}
