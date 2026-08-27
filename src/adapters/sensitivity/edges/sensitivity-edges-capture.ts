/**
 * Capture envelope for model.write-sensitivity-edges@1.
 *
 * Like every capture schema, this one carries its own fail-closed validator:
 * a reader that parses stored bytes without `validateSensitivityEdgesCapture`
 * would silently accept an arbitrary JSON shape, which is exactly what the
 * exactRecord discipline exists to forbid.
 */

import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  type SensitivityEdge,
  validateSensitivityEdgeSet,
} from "../../../domain/sensitivity/edges/sensitivity-edge.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
} from "../../../domain/kernel/case-validation.ts";

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

export function validateSensitivityEdgesCapture(
  value: unknown,
): SensitivityEdgesCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "studyCaptureId",
    "partDefName",
    "sysml",
    "edges",
    "capturedAt",
  ], "$sensitivityEdgesCapture");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EDGES_CAPTURE_SCHEMA,
    "$sensitivityEdgesCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$sensitivityEdgesCapture.operation",
  );
  literalValue(
    operation.id,
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id,
    "$sensitivityEdgesCapture.operation.id",
  );
  literalValue(
    operation.version,
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version,
    "$sensitivityEdgesCapture.operation.version",
  );
  const trustedRunId = nonEmptyText(
    root.trustedRunId,
    "$sensitivityEdgesCapture.trustedRunId",
  );
  const studyCaptureId = nonEmptyText(
    root.studyCaptureId,
    "$sensitivityEdgesCapture.studyCaptureId",
  );
  const partDefName = nonEmptyText(
    root.partDefName,
    "$sensitivityEdgesCapture.partDefName",
  );
  const sysml = nonEmptyText(root.sysml, "$sensitivityEdgesCapture.sysml");
  const edges = validateSensitivityEdgeSet(root.edges);
  const capturedAt = nonEmptyText(
    root.capturedAt,
    "$sensitivityEdgesCapture.capturedAt",
  );
  if (new Date(capturedAt).toISOString() !== capturedAt) {
    throw new TypeError(
      "$sensitivityEdgesCapture.capturedAt must be a canonical ISO-8601 instant.",
    );
  }
  return {
    schemaVersion: SENSITIVITY_EDGES_CAPTURE_SCHEMA,
    operation: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
    trustedRunId,
    studyCaptureId,
    partDefName,
    sysml,
    edges,
    capturedAt,
  };
}
