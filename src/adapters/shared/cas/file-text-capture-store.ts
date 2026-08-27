/**
 * Immutable UTF-8 text transport over FileByteStore.
 *
 * Encodes and decodes canonical string bytes only. It does not own a context
 * descriptor, schema, manifest, selector, or evidence meaning.
 */

import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { FileByteStore, VerifiedStoredBytes } from "./file-byte-store.ts";

export interface FileTextCaptureStore<Kind extends string = string> {
  save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<VerifiedStoredBytes<Kind>>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export function fileTextCaptureStore<Kind extends string>(
  bytes: FileByteStore<Kind>,
): FileTextCaptureStore<Kind> {
  return {
    save(fingerprint, canonicalText) {
      return bytes.save(fingerprint, new TextEncoder().encode(canonicalText));
    },
    async read(fingerprint) {
      const stored = await bytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
}
