/** Durable CAS adapter for the custom L4 assembly-integrity evaluation record. */

import type {
  AssemblyIntegrityEvaluationCaptureReceipt,
  AssemblyIntegrityEvaluationCaptureStore,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-evaluation-capture-store.ts";
import {
  type AssemblyIntegrityEvaluationCapture,
  assemblyIntegrityEvaluationCaptureUri,
  validateAssemblyIntegrityEvaluationCapture,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";

export class FileAssemblyIntegrityEvaluationCaptureStore
  implements AssemblyIntegrityEvaluationCaptureStore {
  readonly #captures: FileCaptureStore<"assembly-integrity-evaluation-capture">;

  constructor(
    captures: FileCaptureStore<"assembly-integrity-evaluation-capture"> =
      new FileCaptureStore(
        ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
      ),
  ) {
    this.#captures = captures;
  }

  async save(
    value: AssemblyIntegrityEvaluationCapture,
  ): Promise<AssemblyIntegrityEvaluationCaptureReceipt> {
    const capture = await validateAssemblyIntegrityEvaluationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const stored = await this.#captures.save(fingerprint, deterministicJson(capture));
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
      throw new Error(
        "Assembly-integrity evaluation capture was not exactly readable after save.",
      );
    }
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<AssemblyIntegrityEvaluationCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = await validateAssemblyIntegrityEvaluationCapture(JSON.parse(text));
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened assembly-integrity evaluation capture does not match its content address.",
      );
    }
    if (
      this.#captures.uriFor(actual) !==
        assemblyIntegrityEvaluationCaptureUri(actual.digest)
    ) {
      throw new TypeError(
        "Assembly-integrity evaluation capture store uses an unexpected CAS URI namespace.",
      );
    }
    return capture;
  }
}
