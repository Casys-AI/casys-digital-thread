/**
 * Persistence for a reviewed Modelica thermal method sheet.
 *
 * Callers receive a content-addressed URI. They never see a filesystem path.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";

export interface ThermalMethodSheetStoreReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface ThermalMethodSheetStore {
  save(
    sheet: ModelicaThermalMethodSheet,
  ): Promise<ThermalMethodSheetStoreReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ModelicaThermalMethodSheet | undefined>;
}
