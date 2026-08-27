import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../../domain/electrical/observation-method-sheet.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  ElectricalObservationMethodSheetStore,
  ElectricalObservationMethodSheetStoreReceipt,
} from "../../../application/ports/out/electrical/observation-method-sheet-store.ts";

export class FileElectricalObservationMethodSheetStore
  implements ElectricalObservationMethodSheetStore {
  readonly #captures: FileCaptureStore<"electrical-observation-method-sheet">;

  constructor(
    captures: FileCaptureStore<"electrical-observation-method-sheet">,
  ) {
    this.#captures = captures;
  }

  async save(
    sheet: ElectricalObservationMethodSheet,
  ): Promise<ElectricalObservationMethodSheetStoreReceipt> {
    const canonical = validateElectricalObservationMethodSheet(sheet);
    const fingerprint = await fingerprintElectricalObservationMethodSheet(
      canonical,
    );
    const stored = await this.#captures.save(
      fingerprint,
      deterministicJson(canonical),
    );
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ElectricalObservationMethodSheet | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const sheet = validateElectricalObservationMethodSheet(JSON.parse(text));
    const actual = await fingerprintElectricalObservationMethodSheet(sheet);
    if (actual.digest !== fingerprint.digest) {
      throw new TypeError(
        "Reopened electrical observation method sheet fingerprint does not match the requested digest.",
      );
    }
    return sheet;
  }
}
