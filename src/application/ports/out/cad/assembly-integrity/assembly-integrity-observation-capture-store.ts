/** Content-addressed persistence for one factual L3 assembly observation. */

import type {
  AssemblyIntegrityObservationCapture,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface AssemblyIntegrityObservationCaptureStoreReceipt {
  readonly capture: AssemblyIntegrityObservationCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface AssemblyIntegrityObservationCaptureStore {
  save(
    capture: AssemblyIntegrityObservationCapture,
  ): Promise<AssemblyIntegrityObservationCaptureStoreReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<AssemblyIntegrityObservationCapture | undefined>;
}
