/**
 * Run capture for analyze.run-fea-sensitivity@1.
 *
 * Holds both measurements, the sealed step, neighborhood and limitations.
 * It is data, never a verdict.
 */

import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "../../domain/analysis/sensitivity-study-proposal.ts";
import type { SensitivityDerivatives } from "../../domain/analysis/sensitivity-study.ts";
import type { SensitivityStudyCaseV2 } from "../../domain/analysis/sensitivity-study-v2.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const SENSITIVITY_STUDY_CAPTURE_SCHEMA =
  "sensitivity-study-capture/1.0" as const;
export const SENSITIVITY_STUDY_CAPTURE_URI_PREFIX =
  "casys://sensitivity-study-capture/sha256/" as const;

export interface SensitivityStudyMeasurement {
  readonly metric: string;
  readonly value: number;
  readonly unit: string;
}

export interface SensitivityCadPublication {
  readonly executionRunId: string;
  readonly sourceSha256: string;
  readonly stepSha256: string;
  readonly stepBytes: number;
}

export interface SensitivityStudyCapture {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id;
    readonly version: typeof ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly studyCase: SensitivityStudyCaseV2;
  readonly cad: {
    readonly base: SensitivityCadPublication;
    readonly stepped: SensitivityCadPublication;
  };
  readonly measurements: {
    readonly base: readonly SensitivityStudyMeasurement[];
    readonly stepped: readonly SensitivityStudyMeasurement[];
  };
  readonly derivatives: SensitivityDerivatives;
  readonly capturedAt: string;
}

export async function fingerprintSensitivityStudyCapture(
  capture: SensitivityStudyCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function validateSensitivityStudyCaptureEnvelope(
  value: unknown,
): asserts value is SensitivityStudyCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "studyCase",
    "cad",
    "measurements",
    "derivatives",
    "capturedAt",
  ], "$sensitivityStudyCapture");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    "$sensitivityStudyCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$sensitivityStudyCapture.operation",
  );
  literalValue(
    operation.id,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id,
    "$sensitivityStudyCapture.operation.id",
  );
  safeId(root.trustedRunId, "$sensitivityStudyCapture.trustedRunId");
  nonEmptyText(root.caseDigest, "$sensitivityStudyCapture.caseDigest");
  nonEmptyText(root.capturedAt, "$sensitivityStudyCapture.capturedAt");
}
