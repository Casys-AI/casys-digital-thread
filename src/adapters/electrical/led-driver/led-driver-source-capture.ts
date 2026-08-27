/**
 * Provider-free CAS capture of one LED-driver human-source fiche.
 *
 * Exact UTF-8 bytes are hashed and reread before any parse. The adapter
 * never calls ngspice, never writes a Thread result, and never chooses D1.
 */

import type {
  LedDriverSourceCaptureReader,
  ReopenedLedDriverSourceCapture,
} from "../../../application/ports/out/electrical/led-driver-source-capture-reader.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { validateLedDriverHumanSource } from "../../../domain/electrical/led-driver/led-driver-human-source.ts";
import {
  assembleLedDriverSourceCaptureDocument,
  type LedDriverSourceCaptureDocument,
  sameLedDriverSourceFacts,
  validateLedDriverSourceCaptureDocument,
} from "../../../domain/electrical/led-driver/led-driver-source-capture.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";

export const MAX_LED_DRIVER_SOURCE_BYTES = 262_144;

export type LedDriverSourceCaptureErrorCode =
  | "source_size_limit_exceeded"
  | "source_capture_readback_failed"
  | "source_capture_invalid"
  | "source_parse_failed"
  | "capture_identity_mismatch";

export class LedDriverSourceCaptureError extends Error {
  constructor(
    readonly code: LedDriverSourceCaptureErrorCode,
    message: string,
    readonly reference?: LedDriverSourceCaptureDocument,
  ) {
    super(message);
    this.name = "LedDriverSourceCaptureError";
  }
}

export interface LedDriverSourceCaptureDependencies {
  readonly sourceCaptures: FileByteStore<"led-driver-source">;
}

/** Persist exact UTF-8 fiche bytes, then parse only the reread object. */
export class LedDriverSourceCaptureService implements LedDriverSourceCaptureReader {
  readonly #sourceCaptures: FileByteStore<"led-driver-source">;

  constructor(dependencies: LedDriverSourceCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
  }

  async capture(sourceTextValue: string): Promise<LedDriverSourceCaptureDocument> {
    const sourceText = requireSourceText(sourceTextValue, "$ledDriverSourceText");
    const sourceBytes = new TextEncoder().encode(sourceText);
    if (sourceBytes.byteLength > MAX_LED_DRIVER_SOURCE_BYTES) {
      throw new LedDriverSourceCaptureError(
        "source_size_limit_exceeded",
        `LED-driver human source is ${sourceBytes.byteLength} UTF-8 bytes; at most ${MAX_LED_DRIVER_SOURCE_BYTES} are permitted.`,
      );
    }
    const sourceFingerprint = await fingerprintBytes(sourceBytes);

    let sourceStored: VerifiedStoredBytes<"led-driver-source">;
    try {
      sourceStored = await this.#sourceCaptures.save(
        sourceFingerprint,
        sourceBytes,
      );
      await requireExactStoredBytes(
        this.#sourceCaptures,
        sourceStored,
        sourceBytes,
        "LED-driver human source",
      );
    } catch (error) {
      throw new LedDriverSourceCaptureError(
        "source_capture_readback_failed",
        `LED-driver human source was not durably readable before parse: ${
          errorMessage(error)
        }`,
      );
    }

    const reopenedText = decodeExactUtf8(
      sourceStored.copyBytes(),
      "LED-driver human source",
    );
    let parsed: ReturnType<typeof validateLedDriverHumanSource>;
    try {
      parsed = validateLedDriverHumanSource(JSON.parse(reopenedText));
    } catch (error) {
      throw new LedDriverSourceCaptureError(
        "source_parse_failed",
        `LED-driver human source failed closed parse after hash: ${
          errorMessage(error)
        }`,
      );
    }

    const reference = assembleLedDriverSourceCaptureDocument({
      source: parsed,
      sha256: sourceStored.fingerprint.digest,
      byteCount: sourceStored.byteCount,
      casUri: sourceStored.uri,
    });
    await this.reopen(reference).catch((error) => {
      if (error instanceof LedDriverSourceCaptureError) throw error;
      throw new LedDriverSourceCaptureError(
        "source_capture_readback_failed",
        `LED-driver human source failed exact replay after capture: ${
          errorMessage(error)
        }`,
        reference,
      );
    });
    return reference;
  }

  async reopen(value: unknown): Promise<ReopenedLedDriverSourceCapture> {
    const reference = validateLedDriverSourceCaptureDocument(value);
    const sourceFingerprint = fingerprintFromDigest(reference.source.sha256);
    if (this.#sourceCaptures.uriFor(sourceFingerprint) !== reference.source.casUri) {
      throw new LedDriverSourceCaptureError(
        "source_capture_invalid",
        "LED-driver source reference names a foreign CAS URI.",
        reference,
      );
    }
    let sourceBytes;
    try {
      sourceBytes = await this.#sourceCaptures.read(sourceFingerprint);
    } catch (error) {
      throw new LedDriverSourceCaptureError(
        "source_capture_invalid",
        `LED-driver human source failed content-addressed readback: ${
          errorMessage(error)
        }`,
        reference,
      );
    }
    if (
      sourceBytes === undefined ||
      sourceBytes.byteLength !== reference.source.byteCount ||
      sourceBytes.byteLength > MAX_LED_DRIVER_SOURCE_BYTES
    ) {
      throw new LedDriverSourceCaptureError(
        "source_capture_invalid",
        "LED-driver human source byte count does not match its capture reference.",
        reference,
      );
    }
    const copy = sourceBytes.copy();
    const recomputed = await fingerprintResourceBytes(copy);
    if (recomputed !== reference.source.sha256) {
      throw new LedDriverSourceCaptureError(
        "source_capture_invalid",
        "LED-driver human source sha256 does not match its capture reference.",
        reference,
      );
    }
    const sourceText = decodeExactUtf8(copy, "LED-driver human source");
    let source;
    try {
      source = validateLedDriverHumanSource(JSON.parse(sourceText));
    } catch (error) {
      throw new LedDriverSourceCaptureError(
        "source_parse_failed",
        `LED-driver human source is invalid on reopen: ${errorMessage(error)}`,
        reference,
      );
    }
    if (!sameLedDriverSourceFacts(reference, source)) {
      throw new LedDriverSourceCaptureError(
        "capture_identity_mismatch",
        "LED-driver capture identity, provenance, circuit, test condition or unknowns diverged from the reopened bytes.",
        reference,
      );
    }
    return Object.freeze({ reference, sourceText, source });
  }
}

function requireSourceText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

async function requireExactStoredBytes(
  store: FileByteStore<"led-driver-source">,
  receipt: VerifiedStoredBytes<"led-driver-source">,
  expected: Uint8Array,
  label: string,
): Promise<void> {
  const reopened = await store.read(receipt.fingerprint);
  if (
    reopened === undefined ||
    reopened.byteLength !== expected.byteLength ||
    receipt.byteCount !== expected.byteLength ||
    !bytesEqual(reopened.copy(), expected)
  ) {
    throw new TypeError(`${label} bytes changed during durable readback.`);
  }
}

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
  return Object.freeze({
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  });
}

function fingerprintFromDigest(digest: string): ContentFingerprint {
  return Object.freeze({
    algorithm: "sha256",
    digest,
  });
}

function decodeExactUtf8(bytes: Uint8Array, label: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    throw new TypeError(`${label} is not exact UTF-8: ${errorMessage(error)}`);
  }
  if (!bytesEqual(new TextEncoder().encode(text), bytes)) {
    throw new TypeError(`${label} did not round-trip as exact UTF-8 bytes.`);
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
