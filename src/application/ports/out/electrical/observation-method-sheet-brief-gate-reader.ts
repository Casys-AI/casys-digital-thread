/**
 * Exact current approved brief gate view for electrical observation
 * method-sheet recross. Only gate identities cross this port.
 */

import type { ElectricalObservationMethodSheetBriefGate } from "../../../../domain/electrical/observation-method-sheet-recross.ts";

export interface ElectricalObservationMethodSheetApprovedBriefGates {
  readonly projectId: string;
  readonly gates: readonly ElectricalObservationMethodSheetBriefGate[];
}

export interface ElectricalObservationMethodSheetBriefGateReader {
  read(
    projectId: string,
  ): Promise<ElectricalObservationMethodSheetApprovedBriefGates | undefined>;
}
