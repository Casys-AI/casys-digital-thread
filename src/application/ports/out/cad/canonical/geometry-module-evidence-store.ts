/**
 * Durable CAS ports for module drafts and canonical module captures.
 *
 * These are the only persistence seams the later admitted exporter and
 * `design.write-geometry@1` sealer need. They reuse the existing geometry
 * draft and capture stores; schemaVersion is the family discriminant.
 */

import type {
  GeometryModuleCapture,
  GeometryModuleDraftCapture,
} from "../../../../../domain/cad/canonical/geometry-module-evidence.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface PersistedGeometryModuleDraft {
  readonly draft: GeometryModuleDraftCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface PersistedGeometryModuleCapture {
  readonly capture: GeometryModuleCapture;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

/** Review-only module draft CAS. Never a Thread artifact. */
export interface GeometryModuleDraftStore {
  save(value: unknown): Promise<PersistedGeometryModuleDraft>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<GeometryModuleDraftCapture | undefined>;
}

/** Canonical module evidence CAS used after the existing geometry sealer. */
export interface GeometryModuleCaptureStore {
  save(value: unknown): Promise<PersistedGeometryModuleCapture>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<GeometryModuleCapture | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}
