import type {
  Build123dExecutionCapture,
  Build123dExecutionDraft,
  Build123dExecutionDraftReference,
} from "../../../../../domain/cad/isolated/build123d-execution-evidence.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface PersistedBuild123dExecutionCapture {
  readonly capture: Build123dExecutionCapture;
  readonly fingerprint: ContentFingerprint;
  /** Canonical evidence URI for the single documentary Thread artifact. */
  readonly uri: string;
}

/** Private CAS for the non-canonical output awaiting a later geometry MRTR. */
export interface Build123dExecutionDraftStore {
  save(value: unknown): Promise<{
    readonly draft: Build123dExecutionDraft;
    readonly reference: Build123dExecutionDraftReference;
  }>;
  read(
    reference: Build123dExecutionDraftReference,
  ): Promise<Build123dExecutionDraft | undefined>;
}

/** CAS for the documentary evidence attached to the Thread. */
export interface Build123dExecutionCaptureStore {
  save(value: unknown): Promise<PersistedBuild123dExecutionCapture>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<Build123dExecutionCapture | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}
