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
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

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

export interface SensitivityStudyScientificResult {
  readonly operation: {
    readonly id: typeof ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id;
    readonly version: typeof ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly studyCase: SensitivityStudyCaseV2;
  readonly measurements: {
    readonly base: readonly SensitivityStudyMeasurement[];
    readonly stepped: readonly SensitivityStudyMeasurement[];
  };
  readonly derivatives: SensitivityDerivatives;
  readonly capturedAt: string;
}

export interface SensitivityStudyCapture extends SensitivityStudyScientificResult {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CAPTURE_SCHEMA;
  readonly cad: {
    readonly base: SensitivityCadPublication;
    readonly stepped: SensitivityCadPublication;
  };
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
  const scientific = await validateSensitivityStudyScientificResult({
    operation: root.operation,
    trustedRunId: root.trustedRunId,
    caseDigest: root.caseDigest,
    studyCase: root.studyCase,
    measurements: root.measurements,
    derivatives: root.derivatives,
    capturedAt: root.capturedAt,
  }, "$sensitivityStudyCapture");
  const cad = exactRecord(
    root.cad,
    ["base", "stepped"],
    "$sensitivityStudyCapture.cad",
  );
  return {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    ...scientific,
    cad: {
      base: parseCadPublication(cad.base, "$sensitivityStudyCapture.cad.base"),
      stepped: parseCadPublication(
        cad.stepped,
        "$sensitivityStudyCapture.cad.stepped",
      ),
    },
  };
}

/** Shared validation of only the scientific result; it creates no CAD facts. */
export async function validateSensitivityStudyScientificResult(
  value: unknown,
  path = "$sensitivityStudyScientificResult",
): Promise<SensitivityStudyScientificResult> {
  const root = exactRecord(value, [
    "operation",
    "trustedRunId",
    "caseDigest",
    "studyCase",
    "measurements",
    "derivatives",
    "capturedAt",
  ], path);
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  literalValue(
    operation.id,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION.version,
    `${path}.operation.version`,
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    `${path}.trustedRunId`,
  );
  const caseDigest = sha256Hex(
    root.caseDigest,
    `${path}.caseDigest`,
  );
  const capturedAt = nonEmptyText(
    root.capturedAt,
    `${path}.capturedAt`,
  );
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new TypeError(`${path}.capturedAt must be ISO-8601.`);
  }
  const studyCase = validateSensitivityStudyCaseV2(root.studyCase);
  const observedDigest = (await sha256Fingerprint(studyCase)).digest;
  if (caseDigest !== observedDigest) {
    throw new TypeError(
      `${path}.caseDigest does not match the case.`,
    );
  }
  const measurementsRoot = exactRecord(
    root.measurements,
    ["base", "stepped"],
    `${path}.measurements`,
  );
  const base = parseMeasurements(
    measurementsRoot.base,
    studyCase,
    `${path}.measurements.base`,
  );
  const stepped = parseMeasurements(
    measurementsRoot.stepped,
    studyCase,
    `${path}.measurements.stepped`,
  );
  const computed = computeSensitivities(
    studyCase,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
  );
  if (deterministicJson(root.derivatives) !== deterministicJson(computed)) {
    throw new TypeError(
      `${path}.derivatives do not match the sealed case and measurements.`,
    );
  }
  return {
    operation: ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
    trustedRunId,
    caseDigest,
    studyCase,
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
