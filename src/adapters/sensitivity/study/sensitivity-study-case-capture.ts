/**
 * Capture envelope for analyze.seal-sensitivity-study@1.
 *
 * Provider-free: the sealed case plus the exact admission identity that was
 * re-read. No solver payload lives here.
 */

import {
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
} from "../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  SENSITIVITY_STUDY_CASE_V3_SCHEMA,
  type SensitivityStudyCaseV3,
  validateSensitivityStudyCaseV3,
} from "../../../domain/sensitivity/study/sensitivity-study-v3.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA =
  "sensitivity-study-case-capture/1.0" as const;

export const SENSITIVITY_STUDY_CASE_CAPTURE_URI_PREFIX =
  "casys://sensitivity-study-case-capture/sha256/" as const;

export interface SensitivityStudyCaseCapture {
  readonly schemaVersion: typeof SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id;
    readonly version: typeof ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly canonicalCaseText: string;
  readonly studyCase: SensitivityStudyCaseV3;
  readonly admissionArtifact: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly sealedAt: string;
}

export async function validateSensitivityStudyCaseCapture(
  value: unknown,
): Promise<SensitivityStudyCaseCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "canonicalCaseText",
    "studyCase",
    "admissionArtifact",
    "sealedAt",
  ], "$sensitivityStudyCaseCapture");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
    "$sensitivityStudyCaseCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$sensitivityStudyCaseCapture.operation",
  );
  literalValue(
    operation.id,
    ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.id,
    "$sensitivityStudyCaseCapture.operation.id",
  );
  literalValue(
    operation.version,
    ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION.version,
    "$sensitivityStudyCaseCapture.operation.version",
  );
  const sealedAt = nonEmptyText(
    root.sealedAt,
    "$sensitivityStudyCaseCapture.sealedAt",
  );
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("$sensitivityStudyCaseCapture.sealedAt must be ISO-8601.");
  }
  const studyCase = validateSensitivityStudyCaseV3(root.studyCase);
  if (studyCase.schemaVersion !== SENSITIVITY_STUDY_CASE_V3_SCHEMA) {
    throw new TypeError("$sensitivityStudyCaseCapture.studyCase schema is divergent.");
  }
  const canonicalCaseText = nonEmptyText(
    root.canonicalCaseText,
    "$sensitivityStudyCaseCapture.canonicalCaseText",
  );
  if (canonicalCaseText !== deterministicJson(studyCase)) {
    throw new TypeError(
      "$sensitivityStudyCaseCapture.canonicalCaseText does not match the case.",
    );
  }
  const caseDigest = nonEmptyText(
    root.caseDigest,
    "$sensitivityStudyCaseCapture.caseDigest",
  );
  const observed = await sha256Fingerprint(studyCase);
  if (caseDigest !== observed.digest) {
    throw new TypeError(
      "$sensitivityStudyCaseCapture.caseDigest does not match the case.",
    );
  }
  const admissionArtifact = exactRecord(
    root.admissionArtifact,
    ["id", "fingerprint"],
    "$sensitivityStudyCaseCapture.admissionArtifact",
  );
  const fingerprint = exactRecord(
    admissionArtifact.fingerprint,
    ["algorithm", "digest"],
    "$sensitivityStudyCaseCapture.admissionArtifact.fingerprint",
  );
  literalValue(
    fingerprint.algorithm,
    "sha256",
    "$sensitivityStudyCaseCapture.admissionArtifact.fingerprint.algorithm",
  );
  return {
    schemaVersion: SENSITIVITY_STUDY_CASE_CAPTURE_SCHEMA,
    operation: ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$sensitivityStudyCaseCapture.trustedRunId",
    ),
    caseDigest,
    canonicalCaseText,
    studyCase,
    admissionArtifact: {
      id: safeId(
        admissionArtifact.id,
        "$sensitivityStudyCaseCapture.admissionArtifact.id",
      ),
      fingerprint: {
        algorithm: "sha256",
        digest: nonEmptyText(
          fingerprint.digest,
          "$sensitivityStudyCaseCapture.admissionArtifact.fingerprint.digest",
        ),
      },
    },
    sealedAt,
  };
}

export async function fingerprintSensitivityStudyCaseCapture(
  capture: SensitivityStudyCaseCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function capturesEqual(
  left: SensitivityStudyCaseCapture,
  right: SensitivityStudyCaseCapture,
): boolean {
  return deterministicJson(left) === deterministicJson(right) &&
    fingerprintsEqual(
      left.admissionArtifact.fingerprint,
      right.admissionArtifact.fingerprint,
    );
}
