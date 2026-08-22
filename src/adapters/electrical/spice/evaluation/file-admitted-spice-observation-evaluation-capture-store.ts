import { FileCaptureStore } from "../../../shared/cas/file-capture-store.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  AdmittedSpiceObservationEvaluationCaptureStore,
  AdmittedSpiceObservationEvaluationCaptureStoreReceipt,
} from "../../../../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evaluation-capture-store.ts";

export class FileAdmittedSpiceObservationEvaluationCaptureStore
  implements AdmittedSpiceObservationEvaluationCaptureStore {
  readonly #captures: FileCaptureStore<"spice-admitted-observation-evaluation">;

  constructor(
    captures: FileCaptureStore<"spice-admitted-observation-evaluation">,
  ) {
    this.#captures = captures;
  }

  async save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<AdmittedSpiceObservationEvaluationCaptureStoreReceipt> {
    const stored = await this.#captures.save(fingerprint, canonicalText);
    return { fingerprint, uri: stored.uri };
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return this.#captures.read(fingerprint);
  }
}
