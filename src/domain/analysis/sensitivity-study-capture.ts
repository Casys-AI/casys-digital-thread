/**
 * Run capture for analyze.run-fea-sensitivity@1.
 *
 * Holds both measurements, the sealed step, neighborhood and limitations.
 * It is data, never a verdict.
 */

import { ANALYZE_RUN_FEA_SENSITIVITY_OPERATION } from "./sensitivity-study-proposal.ts";
import {
  computeSensitivities,
  type SensitivityDerivatives,
} from "./sensitivity-study.ts";
import {
  type SensitivityStudyCaseV2,
  validateSensitivityStudyCaseV2,
} from "./sensitivity-study-v2.ts";
import {
  arrayOf,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const SENSITIVITY_STUDY_CAPTURE_SCHEMA =
  "sensitivity-study-capture/1.0" as const;
export const SENSITIVITY_STUDY_CAPTURE_URI_PREFIX =
  "casys://sensitivity-study-capture/sha256/" as const;

const SHA256_HEX = /^[0-9a-f]{64}$/;

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

export async function validateSensitivityStudyCapture(
  value: unknown,
): Promise<SensitivityStudyCapture> {
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
  literalValue(
    operation.version,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version,
    "$sensitivityStudyCapture.operation.version",
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    "$sensitivityStudyCapture.trustedRunId",
  );
  const caseDigest = sha256Hex(
    root.caseDigest,
    "$sensitivityStudyCapture.caseDigest",
  );
  const capturedAt = nonEmptyText(
    root.capturedAt,
    "$sensitivityStudyCapture.capturedAt",
  );
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new TypeError("$sensitivityStudyCapture.capturedAt must be ISO-8601.");
  }
  const studyCase = validateSensitivityStudyCaseV2(root.studyCase);
  const observedDigest = (await sha256Fingerprint(studyCase)).digest;
  if (caseDigest !== observedDigest) {
    throw new TypeError(
      "$sensitivityStudyCapture.caseDigest does not match the case.",
    );
  }
  const cad = exactRecord(
    root.cad,
    ["base", "stepped"],
    "$sensitivityStudyCapture.cad",
  );
  const measurementsRoot = exactRecord(
    root.measurements,
    ["base", "stepped"],
    "$sensitivityStudyCapture.measurements",
  );
  const base = parseMeasurements(
    measurementsRoot.base,
    studyCase,
    "$sensitivityStudyCapture.measurements.base",
  );
  const stepped = parseMeasurements(
    measurementsRoot.stepped,
    studyCase,
    "$sensitivityStudyCapture.measurements.stepped",
  );
  const computed = computeSensitivities(
    studyCase,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
  );
  if (deterministicJson(root.derivatives) !== deterministicJson(computed)) {
    throw new TypeError(
      "$sensitivityStudyCapture.derivatives do not match the sealed case and measurements.",
    );
  }
  return {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
    trustedRunId,
    caseDigest,
    studyCase,
    cad: {
      base: parseCadPublication(cad.base, "$sensitivityStudyCapture.cad.base"),
      stepped: parseCadPublication(
        cad.stepped,
        "$sensitivityStudyCapture.cad.stepped",
      ),
    },
    measurements: { base, stepped },
    derivatives: computed,
    capturedAt,
  };
}

export async function validateSensitivityStudyCaptureEnvelope(
  value: unknown,
): Promise<SensitivityStudyCapture> {
  return await validateSensitivityStudyCapture(value);
}

function parseCadPublication(
  value: unknown,
  path: string,
): SensitivityCadPublication {
  const input = exactRecord(value, [
    "executionRunId",
    "sourceSha256",
    "stepSha256",
    "stepBytes",
  ], path);
  return {
    executionRunId: nonEmptyText(input.executionRunId, `${path}.executionRunId`),
    sourceSha256: sha256Hex(input.sourceSha256, `${path}.sourceSha256`),
    stepSha256: sha256Hex(input.stepSha256, `${path}.stepSha256`),
    stepBytes: positiveInteger(input.stepBytes, `${path}.stepBytes`),
  };
}

function parseMeasurements(
  value: unknown,
  studyCase: SensitivityStudyCaseV2,
  path: string,
): readonly SensitivityStudyMeasurement[] {
  const items = arrayOf(value, path);
  if (items.length !== studyCase.metrics.length) {
    throw new TypeError(
      `${path} must declare exactly one measurement per sealed metric.`,
    );
  }
  const parsed = items.map((item, index) => {
    const row = exactRecord(item, ["metric", "value", "unit"], `${path}[${index}]`);
    return {
      metric: safeId(row.metric, `${path}[${index}].metric`),
      value: finite(row.value, `${path}[${index}].value`),
      unit: nonEmptyText(row.unit, `${path}[${index}].unit`),
    };
  });
  rejectDuplicates(parsed.map((item) => item.metric), `${path} metrics`);
  for (const declaration of studyCase.metrics) {
    const observed = parsed.find((item) => item.metric === declaration.id);
    if (!observed) {
      throw new TypeError(`${path} is missing sealed metric ${declaration.id}.`);
    }
    if (observed.unit !== declaration.unit) {
      throw new TypeError(
        `${path} unit for ${declaration.id} does not match the sealed case.`,
      );
    }
  }
  return parsed;
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex string.`);
  }
  return digest;
}
