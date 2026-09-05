/**
 * File CAS adapter for review-only geometry draft binaries.
 *
 * Bytes are stored under a digest-keyed directory. This is not Thread
 * evidence and not the isolated-output CAS.
 */

import type {
  GeometryDraftAssetStore,
  PersistedGeometryDraftAsset,
} from "../../../application/ports/out/cad/canonical/geometry-draft-asset-store.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import type { ImmutableBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export class FileGeometryDraftAssetStore implements GeometryDraftAssetStore {
  readonly #store: FileByteStore<"geometry-draft-asset">;

  constructor(store: FileByteStore<"geometry-draft-asset">) {
    this.#store = store;
  }

  async persist(bytes: Uint8Array): Promise<PersistedGeometryDraftAsset> {
    const digest = await fingerprintResourceBytes(bytes);
    const fingerprint = { algorithm: "sha256" as const, digest };
    const stored = await this.#store.save(fingerprint, bytes);
    return Object.freeze({
      fingerprint: stored.fingerprint,
      byteCount: stored.byteCount,
    });
  }

  read(fingerprint: ContentFingerprint): Promise<ImmutableBytes | undefined> {
    return this.#store.read(fingerprint);
  }
}
