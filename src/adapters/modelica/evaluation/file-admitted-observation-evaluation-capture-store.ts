import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  AdmittedObservationEvaluationCaptureStore,
  AdmittedObservationEvaluationCaptureStoreReceipt,
} from "../../../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";

export class FileAdmittedObservationEvaluationCaptureStore
  implements AdmittedObservationEvaluationCaptureStore {
  readonly #captures: FileCaptureStore<"modelica-admitted-observation-evaluation">;

  constructor(
    captures: FileCaptureStore<"modelica-admitted-observation-evaluation">,
  ) {
    this.#captures = captures;
  }

  async save(
    fingerprint: ContentFingerprint,
    canonicalText: string,
  ): Promise<AdmittedObservationEvaluationCaptureStoreReceipt> {
    const stored = await this.#captures.save(fingerprint, canonicalText);
    return { fingerprint, uri: stored.uri };
  }

  read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    return this.#captures.read(fingerprint);
  }
}
