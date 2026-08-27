/**
 * Provider-free CAS store for cad-placement-analysis-capture/1.0.
 *
 * The document is canonicalized, stored, reread and returned only as an
 * opaque locator plus the reopened document.
 */

import {
  type CadPlacementAnalysisCaptureStore,
  CadPlacementAnalysisCaptureStoreError,
  type ReopenedCadPlacementAnalysisCapture,
} from "../../../application/ports/out/cad/placement/cad-placement-analysis-capture-store.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX,
  type CadPlacementAnalysisCaptureLocator,
  type CadPlacementAnalysisDocument,
  validateCadPlacementAnalysisCaptureLocator,
  validateCadPlacementAnalysisDocument,
} from "../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";

export { CadPlacementAnalysisCaptureStoreError };

export class FileCadPlacementAnalysisCaptureStore
  implements CadPlacementAnalysisCaptureStore {
  readonly #store: FileByteStore<"cad-placement-analysis-capture">;

  constructor(store: FileByteStore<"cad-placement-analysis-capture">) {
    this.#store = store;
  }

  async persist(
    documentValue: CadPlacementAnalysisDocument,
  ): Promise<ReopenedCadPlacementAnalysisCapture> {
    const document = validateCadPlacementAnalysisDocument(documentValue);
    const text = deterministicJson(document);
    const bytes = new TextEncoder().encode(text);
    const fingerprint = await fingerprintBytes(bytes);
    try {
      const stored = await this.#store.save(fingerprint, bytes);
      await requireExactStoredBytes(this.#store, stored, bytes);
    } catch (error) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_readback_failed",
        `CAD placement analysis capture was not durably readable: ${
          errorMessage(error)
        }`,
      );
    }
    const locator = validateCadPlacementAnalysisCaptureLocator({
      schemaVersion: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
      kind: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
      fingerprint,
      byteCount: bytes.byteLength,
      casUri: `${CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PREFIX}${fingerprint.digest}`,
    });
    return await this.reopenLocator(locator);
  }

  async reopenLocator(
    locatorValue: CadPlacementAnalysisCaptureLocator,
  ): Promise<ReopenedCadPlacementAnalysisCapture> {
    const locator = validateCadPlacementAnalysisCaptureLocator(locatorValue);
    const stored = await this.#store.read(locator.fingerprint);
    if (stored === undefined) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_absent",
        "CAD placement analysis capture is absent from draft CAS.",
      );
    }
    const copy = stored.copy();
    if (copy.byteLength !== locator.byteCount) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_invalid",
        "CAD placement analysis capture byte count does not match its locator.",
      );
    }
    const digest = await fingerprintResourceBytes(copy);
    if (digest !== locator.fingerprint.digest) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_invalid",
        "CAD placement analysis capture sha256 does not match its locator.",
      );
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      copy,
    );
    let document: CadPlacementAnalysisDocument;
    try {
      document = validateCadPlacementAnalysisDocument(JSON.parse(text));
    } catch (error) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_invalid",
        `CAD placement analysis capture is invalid on reopen: ${errorMessage(error)}`,
      );
    }
    if (deterministicJson(document) !== text) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_invalid",
        "CAD placement analysis capture bytes are not the canonical document.",
      );
    }
    if (document.kind !== CAD_PLACEMENT_ANALYSIS_CAPTURE_KIND) {
      throw new CadPlacementAnalysisCaptureStoreError(
        "capture_invalid",
        "CAD placement analysis capture kind drifted on reopen.",
      );
    }
    return Object.freeze({ locator, document });
  }
}

async function requireExactStoredBytes(
  store: FileByteStore<"cad-placement-analysis-capture">,
  receipt: VerifiedStoredBytes<"cad-placement-analysis-capture">,
  expected: Uint8Array,
): Promise<void> {
  const reopened = await store.read(receipt.fingerprint);
  if (
    reopened === undefined ||
    reopened.byteLength !== expected.byteLength ||
    receipt.byteCount !== expected.byteLength
  ) {
    throw new TypeError(
      "CAD placement analysis capture bytes changed during durable readback.",
    );
  }
}

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
  return Object.freeze({
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
