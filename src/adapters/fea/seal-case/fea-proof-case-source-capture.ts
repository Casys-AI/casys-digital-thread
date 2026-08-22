/**
 * Provider-free CAS capture of one mechanical-proof-case-source/1.0 document.
 *
 * JSON is parsed and validated, then canonical bytes are stored and reread.
 * The adapter never chooses a provider, tool, runtime or Thread write.
 */

import type {
  FeaProofCaseSourceCaptureReader,
  ReopenedFeaProofCaseSourceCapture,
} from "../../../application/ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  type FeaProofCaseSourceCaptureReference,
  validateFeaProofCaseSourceCaptureReference,
} from "../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import {
  canonicalizeMechanicalProofCaseSource,
  MECHANICAL_PROOF_CASE_SOURCE_MAX_CHARS,
  type MechanicalProofCaseSource,
} from "../../../domain/fea/seal-case/mechanical-proof-case-source.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";

export type FeaProofCaseSourceCaptureErrorCode =
  | "source_size_limit_exceeded"
  | "source_capture_readback_failed"
  | "source_capture_invalid"
  | "source_parse_failed"
  | "source_absent";

export class FeaProofCaseSourceCaptureError extends Error {
  constructor(
    readonly code: FeaProofCaseSourceCaptureErrorCode,
    message: string,
    readonly reference?: FeaProofCaseSourceCaptureReference,
  ) {
    super(message);
    this.name = "FeaProofCaseSourceCaptureError";
  }
}

export interface FeaProofCaseSourceCaptureDependencies {
  readonly sourceCaptures: FileByteStore<"fea-proof-case-source">;
}

/** Persist canonical JSON bytes, then parse only the reread object. */
export class FeaProofCaseSourceCaptureService
  implements FeaProofCaseSourceCaptureReader {
  readonly #sourceCaptures: FileByteStore<"fea-proof-case-source">;

  constructor(dependencies: FeaProofCaseSourceCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
  }

  async capture(
    sourceTextValue: string,
  ): Promise<FeaProofCaseSourceCaptureReference> {
    if (typeof sourceTextValue !== "string" || sourceTextValue.length === 0) {
      throw new TypeError("$feaProofCaseSourceText must be a non-empty string.");
    }
    if (sourceTextValue.length > MECHANICAL_PROOF_CASE_SOURCE_MAX_CHARS) {
      throw new FeaProofCaseSourceCaptureError(
        "source_size_limit_exceeded",
        `Mechanical proof-case source is ${sourceTextValue.length} characters; at most ${MECHANICAL_PROOF_CASE_SOURCE_MAX_CHARS} are permitted.`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(sourceTextValue);
    } catch (error) {
      throw new FeaProofCaseSourceCaptureError(
        "source_parse_failed",
        `Mechanical proof-case source is not valid JSON: ${errorMessage(error)}`,
      );
    }
    let canonical: { source: MechanicalProofCaseSource; text: string };
    try {
      canonical = canonicalizeMechanicalProofCaseSource(parsed);
    } catch (error) {
      throw new FeaProofCaseSourceCaptureError(
        "source_parse_failed",
        `Mechanical proof-case source failed closed parse: ${errorMessage(error)}`,
      );
    }
    const sourceBytes = new TextEncoder().encode(canonical.text);
    const sourceFingerprint = await fingerprintBytes(sourceBytes);
    try {
      const stored = await this.#sourceCaptures.save(
        sourceFingerprint,
        sourceBytes,
      );
      await requireExactStoredBytes(
        this.#sourceCaptures,
        stored,
        sourceBytes,
        "Mechanical proof-case source",
      );
    } catch (error) {
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_readback_failed",
        `Mechanical proof-case source was not durably readable before replay: ${
          errorMessage(error)
        }`,
      );
    }
    const reference = { fingerprint: sourceFingerprint.digest };
    await this.reopen(reference).catch((error) => {
      if (error instanceof FeaProofCaseSourceCaptureError) throw error;
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_readback_failed",
        `Mechanical proof-case source failed exact replay after capture: ${
          errorMessage(error)
        }`,
        reference,
      );
    });
    return reference;
  }

  async reopen(value: unknown): Promise<ReopenedFeaProofCaseSourceCapture> {
    const reference = validateFeaProofCaseSourceCaptureReference(value);
    const sourceFingerprint = fingerprintFromDigest(reference.fingerprint);
    let sourceBytes;
    try {
      sourceBytes = await this.#sourceCaptures.read(sourceFingerprint);
    } catch (error) {
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_invalid",
        `Mechanical proof-case source failed content-addressed readback: ${
          errorMessage(error)
        }`,
        reference,
      );
    }
    if (sourceBytes === undefined) {
      throw new FeaProofCaseSourceCaptureError(
        "source_absent",
        "Mechanical proof-case source is absent from draft CAS.",
        reference,
      );
    }
    if (sourceBytes.byteLength > MECHANICAL_PROOF_CASE_SOURCE_MAX_CHARS) {
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_invalid",
        "Mechanical proof-case source byte count exceeds the capture limit.",
        reference,
      );
    }
    const copy = sourceBytes.copy();
    const recomputed = await fingerprintResourceBytes(copy);
    if (recomputed !== reference.fingerprint) {
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_invalid",
        "Mechanical proof-case source sha256 does not match its capture reference.",
        reference,
      );
    }
    const sourceText = decodeExactUtf8(copy, "Mechanical proof-case source");
    let canonical;
    try {
      canonical = canonicalizeMechanicalProofCaseSource(JSON.parse(sourceText));
    } catch (error) {
      throw new FeaProofCaseSourceCaptureError(
        "source_parse_failed",
        `Mechanical proof-case source is invalid on reopen: ${errorMessage(error)}`,
        reference,
      );
    }
    if (canonical.text !== sourceText) {
      throw new FeaProofCaseSourceCaptureError(
        "source_capture_invalid",
        "Mechanical proof-case source bytes are not the canonical source document.",
        reference,
      );
    }
    return Object.freeze({
      reference,
      sourceText,
      source: canonical.source,
    });
  }
}

async function requireExactStoredBytes(
  store: FileByteStore<"fea-proof-case-source">,
  receipt: VerifiedStoredBytes<"fea-proof-case-source">,
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
  return Object.freeze({ algorithm: "sha256", digest });
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
