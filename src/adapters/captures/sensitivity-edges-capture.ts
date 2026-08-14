/**
 * Capture envelope for model.write-sensitivity-edges@1.
 */

import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "../../domain/analysis/sensitivity-study-proposal.ts";
import type { SensitivityEdge } from "../../domain/analysis/sensitivity-edge.ts";

export const SENSITIVITY_EDGES_CAPTURE_SCHEMA =
  "sensitivity-edges-capture/1.0" as const;
export const SENSITIVITY_EDGES_CAPTURE_URI_PREFIX =
  "casys://sensitivity-edges-capture/sha256/" as const;

export interface SensitivityEdgesCapture {
  readonly schemaVersion: typeof SENSITIVITY_EDGES_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id;
    readonly version: typeof MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly studyCaptureId: string;
  readonly partDefName: string;
  readonly sysml: string;
  readonly edges: readonly SensitivityEdge[];
  readonly capturedAt: string;
}
