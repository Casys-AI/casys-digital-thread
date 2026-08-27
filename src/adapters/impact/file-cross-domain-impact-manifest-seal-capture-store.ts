/** Durable content-addressed store for closed impact-manifest seal captures. */

import type {
  CrossDomainImpactManifestSealCaptureReceipt,
  CrossDomainImpactManifestSealCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type CrossDomainImpactManifestSealCapture,
  crossDomainImpactManifestSealCaptureUri,
  validateCrossDomainImpactManifestSealCapture,
} from "../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";

export class FileCrossDomainImpactManifestSealCaptureStore
  implements CrossDomainImpactManifestSealCaptureStore {
  readonly #captures: FileCaptureStore<"cross-domain-impact-manifest-seal-capture">;

  constructor(captures: FileCaptureStore<"cross-domain-impact-manifest-seal-capture">) {
    this.#captures = captures;
  }

  async save(
    value: CrossDomainImpactManifestSealCapture,
  ): Promise<CrossDomainImpactManifestSealCaptureReceipt> {
    const capture = validateCrossDomainImpactManifestSealCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const stored = await this.#captures.save(fingerprint, deterministicJson(capture));
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
      throw new Error(
        "Cross-domain impact manifest seal capture was not exactly readable after save.",
      );
    }
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactManifestSealCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = validateCrossDomainImpactManifestSealCapture(JSON.parse(text));
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened impact-manifest seal capture does not match its content address.",
      );
    }
    const uri = this.#captures.uriFor(actual);
    if (uri !== crossDomainImpactManifestSealCaptureUri(actual.digest)) {
      throw new TypeError(
        "Impact-manifest seal capture store uses an unexpected CAS URI namespace.",
      );
    }
    return capture;
  }
}
