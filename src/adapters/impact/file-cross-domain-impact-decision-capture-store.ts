/** Durable content-addressed store for human impact-decision captures. */

import type {
  CrossDomainImpactDecisionCaptureReceipt,
  CrossDomainImpactDecisionCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type CrossDomainImpactDecisionCapture,
  crossDomainImpactDecisionCaptureUri,
  validateCrossDomainImpactDecisionCapture,
} from "../../domain/impact/cross-domain-impact-decision-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";

export class FileCrossDomainImpactDecisionCaptureStore
  implements CrossDomainImpactDecisionCaptureStore {
  readonly #captures: FileCaptureStore<"cross-domain-impact-decision-capture">;

  constructor(captures: FileCaptureStore<"cross-domain-impact-decision-capture">) {
    this.#captures = captures;
  }

  async save(
    value: CrossDomainImpactDecisionCapture,
  ): Promise<CrossDomainImpactDecisionCaptureReceipt> {
    const capture = validateCrossDomainImpactDecisionCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const stored = await this.#captures.save(fingerprint, deterministicJson(capture));
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
      throw new Error(
        "Cross-domain impact decision capture was not exactly readable after save.",
      );
    }
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactDecisionCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = validateCrossDomainImpactDecisionCapture(JSON.parse(text));
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened impact-decision capture does not match its content address.",
      );
    }
    const uri = this.#captures.uriFor(actual);
    if (uri !== crossDomainImpactDecisionCaptureUri(actual.digest)) {
      throw new TypeError(
        "Impact-decision capture store uses an unexpected CAS URI namespace.",
      );
    }
    return capture;
  }
}
