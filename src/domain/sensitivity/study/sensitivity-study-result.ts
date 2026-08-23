/** Scientific result of a fresh or exact-reused sensitivity run. */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../kernel/case-validation.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { SensitivityExperienceRecord } from "../experience/sensitivity-experience.ts";
import {
  type SensitivityStudyCapture,
  validateSensitivityStudyCapture,
  validateSensitivityStudyScientificResult,
} from "./sensitivity-study-capture.ts";
import type { SensitivityStudyCaseV2 } from "./sensitivity-study-v2.ts";

export const SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA =
  "sensitivity-study-reuse-result/1.0" as const;
export const SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX =
  "casys://sensitivity-study-reuse-result/sha256/" as const;
export const SENSITIVITY_STUDY_FRESH_ARTIFACT_ID_PREFIX = "sensitivity-study-" as const;
export const SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX =
  "sensitivity-study-reuse-result-" as const;

export interface SensitivityStudyReuseResult {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA;
  readonly operation: {
    readonly id: "analyze.run-fea-sensitivity";
    readonly version: "1";
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly studyCase: SensitivityStudyCaseV2;
  readonly measurements: SensitivityExperienceRecord["result"]["measurements"];
  readonly derivatives: SensitivityExperienceRecord["result"]["derivatives"];
  readonly reuseReceiptFingerprint: ContentFingerprint;
  readonly capturedAt: string;
}

export type SensitivityStudyResult =
  | SensitivityStudyCapture
  | SensitivityStudyReuseResult;

/** Closed Thread identity union for fresh captures and target-local reuse results. */
export function isSensitivityStudyResultArtifactId(
  artifactId: string,
  fingerprint: ContentFingerprint,
): boolean {
  return artifactId ===
      `${SENSITIVITY_STUDY_FRESH_ARTIFACT_ID_PREFIX}${fingerprint.digest}` ||
    artifactId ===
      `${SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX}${fingerprint.digest}`;
}

export async function makeSensitivityStudyReuseResult(input: {
  readonly trustedRunId: string;
  readonly studyCase: SensitivityStudyCaseV2;
  readonly record: SensitivityExperienceRecord;
  readonly reuseReceiptFingerprint: ContentFingerprint;
  readonly capturedAt: string;
}): Promise<SensitivityStudyReuseResult> {
  return await validateSensitivityStudyReuseResult({
    schemaVersion: SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: input.trustedRunId,
    caseDigest: (await sha256Fingerprint(input.studyCase)).digest,
    studyCase: input.studyCase,
    measurements: input.record.result.measurements,
    derivatives: input.record.result.derivatives,
    reuseReceiptFingerprint: input.reuseReceiptFingerprint,
    capturedAt: input.capturedAt,
  });
}

export async function validateSensitivityStudyResult(
  value: unknown,
): Promise<SensitivityStudyResult> {
  if (
    value && typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion ===
      SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA
  ) return await validateSensitivityStudyReuseResult(value);
  return await validateSensitivityStudyCapture(value);
}

export async function validateSensitivityStudyReuseResult(
  value: unknown,
): Promise<SensitivityStudyReuseResult> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "studyCase",
    "measurements",
    "derivatives",
    "reuseReceiptFingerprint",
    "capturedAt",
  ], "$sensitivityStudyReuseResult");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA,
    "$sensitivityStudyReuseResult.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$sensitivityStudyReuseResult.operation",
  );
  literalValue(
    operation.id,
    "analyze.run-fea-sensitivity",
    "$sensitivityStudyReuseResult.operation.id",
  );
  literalValue(
    operation.version,
    "1",
    "$sensitivityStudyReuseResult.operation.version",
  );
  const capturedAt = nonEmptyText(
    root.capturedAt,
    "$sensitivityStudyReuseResult.capturedAt",
  );
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new TypeError("$sensitivityStudyReuseResult.capturedAt must be ISO-8601.");
  }
  const receiptFingerprint = parseFingerprint(root.reuseReceiptFingerprint);
  const validated = await validateSensitivityStudyScientificResult({
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: safeId(
      root.trustedRunId,
      "$sensitivityStudyReuseResult.trustedRunId",
    ),
    caseDigest: root.caseDigest,
    studyCase: root.studyCase,
    measurements: root.measurements,
    derivatives: root.derivatives,
    capturedAt,
  }, "$sensitivityStudyReuseResult");
  return {
    schemaVersion: SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA,
    operation: validated.operation,
    trustedRunId: validated.trustedRunId,
    caseDigest: validated.caseDigest,
    studyCase: validated.studyCase,
    measurements: validated.measurements,
    derivatives: validated.derivatives,
    reuseReceiptFingerprint: receiptFingerprint,
    capturedAt,
  };
}

function parseFingerprint(value: unknown): ContentFingerprint {
  const root = exactRecord(
    value,
    ["algorithm", "digest"],
    "$sensitivityStudyReuseResult.reuseReceiptFingerprint",
  );
  literalValue(
    root.algorithm,
    "sha256",
    "$sensitivityStudyReuseResult.reuseReceiptFingerprint.algorithm",
  );
  const parsed = {
    algorithm: "sha256" as const,
    digest: nonEmptyText(
      root.digest,
      "$sensitivityStudyReuseResult.reuseReceiptFingerprint.digest",
    ),
  };
  if (!/^[a-f0-9]{64}$/.test(parsed.digest)) {
    throw new TypeError("Reuse receipt fingerprint must be SHA-256.");
  }
  return parsed;
}
