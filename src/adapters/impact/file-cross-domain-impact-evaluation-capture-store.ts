/** Durable content-addressed store for provider-free impact-evaluation captures. */

import type {
  CrossDomainImpactEvaluationCaptureReceipt,
  CrossDomainImpactEvaluationCaptureStore,
} from "../../application/ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";

export class FileCrossDomainImpactEvaluationCaptureStore
  implements CrossDomainImpactEvaluationCaptureStore {
  readonly #captures: FileCaptureStore<"cross-domain-impact-evaluation-capture">;

  constructor(captures: FileCaptureStore<"cross-domain-impact-evaluation-capture">) {
    this.#captures = captures;
  }

  async save(
    value: CrossDomainImpactEvaluationCapture,
  ): Promise<CrossDomainImpactEvaluationCaptureReceipt> {
    const capture = await validateCrossDomainImpactEvaluationCapture(value);
    const fingerprint = await sha256Fingerprint(capture);
    const stored = await this.#captures.save(fingerprint, deterministicJson(capture));
    const reopened = await this.read(fingerprint);
    if (!reopened || deterministicJson(reopened) !== deterministicJson(capture)) {
      throw new Error(
        "Cross-domain impact evaluation capture was not exactly readable after save.",
      );
    }
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactEvaluationCapture | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const capture = await validateCrossDomainImpactEvaluationCapture(JSON.parse(text));
    const actual = await sha256Fingerprint(capture);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened impact-evaluation capture does not match its content address.",
      );
    }
    const uri = this.#captures.uriFor(actual);
    if (uri !== crossDomainImpactEvaluationCaptureUri(actual.digest)) {
      throw new TypeError(
        "Impact-evaluation capture store uses an unexpected CAS URI namespace.",
      );
    }
    return capture;
  }
}
