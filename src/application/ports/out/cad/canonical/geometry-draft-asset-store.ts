/**
 * Outward port for persisting review-only geometry draft binaries.
 *
 * The application names only bytes. Filesystem layout and CAS URIs stay in
 * the adapter. This is not Thread evidence and not the isolated-output CAS.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface PersistedGeometryDraftAsset {
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
}

export interface GeometryDraftAssetStore {
  persist(bytes: Uint8Array): Promise<PersistedGeometryDraftAsset>;
}
