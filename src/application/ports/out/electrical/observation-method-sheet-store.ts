/**
 * Persistence for a reviewed electrical observation method sheet.
 *
 * Callers receive a content-addressed URI. They never see a filesystem path.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ElectricalObservationMethodSheet } from "../../../../domain/electrical/observation-method-sheet.ts";

export interface ElectricalObservationMethodSheetStoreReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface ElectricalObservationMethodSheetStore {
  save(
    sheet: ElectricalObservationMethodSheet,
  ): Promise<ElectricalObservationMethodSheetStoreReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ElectricalObservationMethodSheet | undefined>;
}
