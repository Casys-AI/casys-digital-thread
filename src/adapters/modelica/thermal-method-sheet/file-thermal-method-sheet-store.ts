import { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  type ModelicaThermalMethodSheet,
  validateModelicaThermalMethodSheet,
} from "../../../domain/modelica/thermal-method-sheet.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  ThermalMethodSheetStore,
  ThermalMethodSheetStoreReceipt,
} from "../../../application/ports/out/modelica/thermal-method-sheet-store.ts";

export class FileThermalMethodSheetStore implements ThermalMethodSheetStore {
  readonly #captures: FileCaptureStore<"modelica-thermal-method-sheet">;

  constructor(captures: FileCaptureStore<"modelica-thermal-method-sheet">) {
    this.#captures = captures;
  }

  async save(
    sheet: ModelicaThermalMethodSheet,
  ): Promise<ThermalMethodSheetStoreReceipt> {
    const canonical = validateModelicaThermalMethodSheet(sheet);
    const fingerprint = await fingerprintModelicaThermalMethodSheet(canonical);
    const stored = await this.#captures.save(
      fingerprint,
      deterministicJson(canonical),
    );
    return { fingerprint, uri: stored.uri };
  }

  async read(
    fingerprint: ContentFingerprint,
  ): Promise<ModelicaThermalMethodSheet | undefined> {
    const text = await this.#captures.read(fingerprint);
    if (text === undefined) return undefined;
    const sheet = validateModelicaThermalMethodSheet(JSON.parse(text));
    const actual = await fingerprintModelicaThermalMethodSheet(sheet);
    if (actual.digest !== fingerprint.digest) {
      throw new TypeError(
        "Reopened thermal method sheet fingerprint does not match the requested digest.",
      );
    }
    return sheet;
  }
}
