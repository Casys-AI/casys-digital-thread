/** Durable content-addressed store for provider-free mechanical preservation captures. */

import type {
  MechanicalPreservationCaptureReceipt,
  MechanicalPreservationCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  crossDomainImpactMechanicalPreservationCaptureUri,
  type MechanicalPreservationCapture,
  validateMechanicalPreservationCapture,
} from "../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";

export class FileMechanicalPreservationCaptureStore
  implements MechanicalPreservationCaptureStore {
  readonly #captures: FileCaptureStore<
    "cross-domain-impact-mechanical-preservation-capture"
  >;

  constructor(
    captures: FileCaptureStore<"cross-domain-impact-mechanical-preservation-capture">,
  ) {
    this.#captures = captures;
  }

  async save(
    value: MechanicalPreservationCapture,
  ): Promise<MechanicalPreservationCaptureReceipt> {
    const capture = await validateMechanicalPreservationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const stored = await this.#captures.save(fingerprint, deterministicJson(capture));
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
      throw new Error(
        "Mechanical preservation capture was not exactly readable after save.",
      );
    }
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<MechanicalPreservationCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = await validateMechanicalPreservationCapture(JSON.parse(text));
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened mechanical-preservation capture does not match its content address.",
      );
    }
    const uri = this.#captures.uriFor(actual);
    if (uri !== crossDomainImpactMechanicalPreservationCaptureUri(actual.digest)) {
      throw new TypeError(
        "Mechanical-preservation capture store uses an unexpected CAS URI namespace.",
      );
    }
    return capture;
  }
}
