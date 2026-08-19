/**
 * Capture envelope for industrialize.seal-dfm-case@1.
 *
 * Provider-free: the sealed dfm-check-case/1.0 only. No DFM payload lives here.
 */

import {
  DFM_CHECK_CASE_SCHEMA,
  type DfmCheckCase,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  validateDfmCheckCase,
} from "../../../domain/make/dfm/dfm-case.ts";
import {
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const DFM_CASE_CAPTURE_SCHEMA = "dfm-case-capture/1.0" as const;

export const DFM_CASE_CAPTURE_URI_PREFIX = "casys://dfm-case-capture/sha256/" as const;

export interface DfmCaseCapture {
  readonly schemaVersion: typeof DFM_CASE_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly canonicalCaseText: string;
  readonly dfmCase: DfmCheckCase;
  readonly sealedAt: string;
}

export async function validateDfmCaseCapture(
  value: unknown,
): Promise<DfmCaseCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "canonicalCaseText",
    "dfmCase",
    "sealedAt",
  ], "$dfmCaseCapture");
  literalValue(
    root.schemaVersion,
    DFM_CASE_CAPTURE_SCHEMA,
    "$dfmCaseCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$dfmCaseCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.id,
    "$dfmCaseCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION.version,
    "$dfmCaseCapture.operation.version",
  );
  const sealedAt = nonEmptyText(root.sealedAt, "$dfmCaseCapture.sealedAt");
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("$dfmCaseCapture.sealedAt must be ISO-8601.");
  }
  const dfmCase = validateDfmCheckCase(root.dfmCase);
  if (dfmCase.schemaVersion !== DFM_CHECK_CASE_SCHEMA) {
    throw new TypeError("$dfmCaseCapture.dfmCase schema is divergent.");
  }
  const canonicalCaseText = nonEmptyText(
    root.canonicalCaseText,
    "$dfmCaseCapture.canonicalCaseText",
  );
  if (canonicalCaseText !== deterministicJson(dfmCase)) {
    throw new TypeError(
      "$dfmCaseCapture.canonicalCaseText does not match the case.",
    );
  }
  const caseDigest = nonEmptyText(root.caseDigest, "$dfmCaseCapture.caseDigest");
  const observed = await sha256Fingerprint(dfmCase);
  if (caseDigest !== observed.digest) {
    throw new TypeError("$dfmCaseCapture.caseDigest does not match the case.");
  }
  return {
    schemaVersion: DFM_CASE_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$dfmCaseCapture.trustedRunId"),
    caseDigest,
    canonicalCaseText,
    dfmCase,
    sealedAt,
  };
}

export async function fingerprintDfmCaseCapture(
  capture: DfmCaseCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}
