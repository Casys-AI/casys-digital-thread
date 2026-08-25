/** Durable CAS persistence for canonical factual assembly-integrity captures. */

import type {
  AssemblyIntegrityObservationCaptureStore,
  AssemblyIntegrityObservationCaptureStoreReceipt,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observation-capture-store.ts";
import {
  type AssemblyIntegrityObservationCapture,
  assemblyIntegrityObservationCaptureUri,
  canonicalAssemblyIntegrityObservationCaptureText,
  fingerprintAssemblyIntegrityObservationCapture,
  validateAssemblyIntegrityObservationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export class AssemblyIntegrityObservationCaptureStoreIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssemblyIntegrityObservationCaptureStoreIntegrityError";
  }
}

export class FileAssemblyIntegrityObservationCaptureStore
  implements AssemblyIntegrityObservationCaptureStore {
  readonly #captures: FileCaptureStore<"assembly-integrity-observation">;

  constructor(
    captures: FileCaptureStore<"assembly-integrity-observation"> = new FileCaptureStore(
      ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
    ),
  ) {
    this.#captures = captures;
  }

  async save(
    value: AssemblyIntegrityObservationCapture,
  ): Promise<AssemblyIntegrityObservationCaptureStoreReceipt> {
    const capture = await validateAssemblyIntegrityObservationCapture(value);
    const fingerprint = await fingerprintAssemblyIntegrityObservationCapture(capture);
    const canonical = await canonicalAssemblyIntegrityObservationCaptureText(capture);
    const stored = await this.#captures.save(fingerprint, canonical);
    const reread = await this.read(fingerprint);
    if (
      reread === undefined ||
      deterministicJson(reread) !== canonical ||
      stored.uri !== assemblyIntegrityObservationCaptureUri(fingerprint.digest)
    ) {
      throw new AssemblyIntegrityObservationCaptureStoreIntegrityError(
        "The assembly-integrity observation capture failed exact durable reread.",
      );
    }
    return Object.freeze({ capture: reread, fingerprint, uri: stored.uri });
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<AssemblyIntegrityObservationCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AssemblyIntegrityObservationCaptureStoreIntegrityError(
        "The assembly-integrity observation capture is not JSON.",
      );
    }
    let capture: AssemblyIntegrityObservationCapture;
    try {
      capture = await validateAssemblyIntegrityObservationCapture(parsed);
    } catch {
      throw new AssemblyIntegrityObservationCaptureStoreIntegrityError(
        "The assembly-integrity observation capture failed exact replay validation.",
      );
    }
    const actual = await fingerprintAssemblyIntegrityObservationCapture(capture);
    if (
      text !== deterministicJson(capture) ||
      !fingerprintsEqual(actual, fingerprint) ||
      this.#captures.uriFor(actual) !==
        assemblyIntegrityObservationCaptureUri(actual.digest)
    ) {
      throw new AssemblyIntegrityObservationCaptureStoreIntegrityError(
        "The assembly-integrity observation capture is non-canonical or divergent.",
      );
    }
    return capture;
  }
}
