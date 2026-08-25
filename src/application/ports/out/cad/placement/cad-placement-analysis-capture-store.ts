/**
 * Durable store for one opaque cad-placement-analysis-capture/1.0 document.
 */

import type {
  CadPlacementAnalysisCaptureLocator,
  CadPlacementAnalysisDocument,
} from "../../../../../domain/cad/placement/cad-placement-analysis-capture.ts";

export type CadPlacementAnalysisCaptureStoreErrorCode =
  | "capture_readback_failed"
  | "capture_invalid"
  | "capture_absent";

export class CadPlacementAnalysisCaptureStoreError extends Error {
  constructor(
    readonly code: CadPlacementAnalysisCaptureStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CadPlacementAnalysisCaptureStoreError";
  }
}

export interface ReopenedCadPlacementAnalysisCapture {
  readonly locator: CadPlacementAnalysisCaptureLocator;
  readonly document: CadPlacementAnalysisDocument;
}

export interface CadPlacementAnalysisCaptureStore {
  persist(
    document: CadPlacementAnalysisDocument,
  ): Promise<ReopenedCadPlacementAnalysisCapture>;
  reopenLocator(
    locator: CadPlacementAnalysisCaptureLocator,
  ): Promise<ReopenedCadPlacementAnalysisCapture>;
}
