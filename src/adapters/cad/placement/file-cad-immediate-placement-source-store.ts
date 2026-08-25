/**
 * Provider-free CAS codec for cad-immediate-placement-source/1.0.
 *
 * JSON is parsed and validated, then canonical bytes are stored and reread.
 */

import {
  type CadImmediatePlacementSourceStore,
  CadImmediatePlacementSourceStoreError,
  type ReopenedCadImmediatePlacementSource,
} from "../../../application/ports/out/cad/placement/cad-immediate-placement-source-store.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS,
  canonicalizeCadImmediatePlacementSource,
} from "../../../domain/cad/placement/cad-immediate-placement-source.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";

export { CadImmediatePlacementSourceStoreError };

export class FileCadImmediatePlacementSourceStore
  implements CadImmediatePlacementSourceStore {
  readonly #store: FileByteStore<"cad-immediate-placement-source">;

  constructor(store: FileByteStore<"cad-immediate-placement-source">) {
    this.#store = store;
  }

  async persist(sourceTextValue: string): Promise<ReopenedCadImmediatePlacementSource> {
    if (typeof sourceTextValue !== "string" || sourceTextValue.length === 0) {
      throw new TypeError("$placementSourceText must be a non-empty string.");
    }
    if (sourceTextValue.length > CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_size_limit_exceeded",
        `CAD placement source is ${sourceTextValue.length} characters; at most ${CAD_IMMEDIATE_PLACEMENT_SOURCE_MAX_CHARS} are permitted.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(sourceTextValue);
    } catch (error) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_parse_failed",
        `CAD placement source is not valid JSON: ${errorMessage(error)}`,
      );
    }
    let canonical;
    try {
      canonical = canonicalizeCadImmediatePlacementSource(parsed);
    } catch (error) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_parse_failed",
        `CAD placement source failed closed parse: ${errorMessage(error)}`,
      );
    }
    const sourceBytes = new TextEncoder().encode(canonical.text);
    const fingerprint = await fingerprintBytes(sourceBytes);
    try {
      const stored = await this.#store.save(fingerprint, sourceBytes);
      await requireExactStoredBytes(this.#store, stored, sourceBytes);
    } catch (error) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_capture_readback_failed",
        `CAD placement source was not durably readable before replay: ${
          errorMessage(error)
        }`,
      );
    }
    return await this.reopen(fingerprint);
  }

  async reopen(
    fingerprint: ContentFingerprint,
  ): Promise<ReopenedCadImmediatePlacementSource> {
    const sourceBytes = await this.#store.read(fingerprint);
    if (sourceBytes === undefined) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_absent",
        "CAD placement source is absent from draft CAS.",
      );
    }
    const copy = sourceBytes.copy();
    const recomputed = await fingerprintResourceBytes(copy);
    if (recomputed !== fingerprint.digest) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_capture_invalid",
        "CAD placement source sha256 does not match its capture reference.",
      );
    }
    const sourceText = decodeExactUtf8(copy);
    let canonical;
    try {
      canonical = canonicalizeCadImmediatePlacementSource(JSON.parse(sourceText));
    } catch (error) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_parse_failed",
        `CAD placement source is invalid on reopen: ${errorMessage(error)}`,
      );
    }
    if (canonical.text !== sourceText) {
      throw new CadImmediatePlacementSourceStoreError(
        "source_capture_invalid",
        "CAD placement source bytes are not the canonical source document.",
      );
    }
    return Object.freeze({
      fingerprint,
      byteCount: copy.byteLength,
      casUri: this.#store.uriFor(fingerprint),
      sourceText,
      source: canonical.source,
    });
  }
}

async function requireExactStoredBytes(
  store: FileByteStore<"cad-immediate-placement-source">,
  receipt: VerifiedStoredBytes<"cad-immediate-placement-source">,
  expected: Uint8Array,
): Promise<void> {
  const reopened = await store.read(receipt.fingerprint);
  if (
    reopened === undefined ||
    reopened.byteLength !== expected.byteLength ||
    receipt.byteCount !== expected.byteLength ||
    !bytesEqual(reopened.copy(), expected)
  ) {
    throw new TypeError("CAD placement source bytes changed during durable readback.");
  }
}

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
  return Object.freeze({
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  });
}

function decodeExactUtf8(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(
      `CAD placement source is not exact UTF-8: ${errorMessage(error)}`,
    );
  }
  if (!bytesEqual(new TextEncoder().encode(text), bytes)) {
    throw new TypeError(
      "CAD placement source did not round-trip as exact UTF-8 bytes.",
    );
  }
  return text;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index]! ^ right[index]!;
  }
  return different === 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
