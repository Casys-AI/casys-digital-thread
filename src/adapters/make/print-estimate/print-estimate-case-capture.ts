/**
 * Capture envelope for industrialize.seal-print-estimate-case@1.
 *
 * Provider-free: the sealed case only. No slicer payload or price lives here.
 */

import {
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
} from "../../../domain/make/print-estimate/print-estimate-proposal.ts";
import {
  PRINT_ESTIMATE_CASE_SCHEMA,
  type PrintEstimateCase,
  validatePrintEstimateCase,
} from "../../../domain/make/print-estimate/print-estimate-case.ts";
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

export const PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA =
  "print-estimate-case-capture/1.0" as const;

export const PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX =
  "casys://print-estimate-case-capture/sha256/" as const;

export interface PrintEstimateCaseCapture {
  readonly schemaVersion: typeof PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly canonicalCaseText: string;
  readonly printEstimateCase: PrintEstimateCase;
  readonly sealedAt: string;
}

export async function validatePrintEstimateCaseCapture(
  value: unknown,
): Promise<PrintEstimateCaseCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "canonicalCaseText",
    "printEstimateCase",
    "sealedAt",
  ], "$printEstimateCaseCapture");
  literalValue(
    root.schemaVersion,
    PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
    "$printEstimateCaseCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$printEstimateCaseCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id,
    "$printEstimateCaseCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version,
    "$printEstimateCaseCapture.operation.version",
  );
  const sealedAt = nonEmptyText(root.sealedAt, "$printEstimateCaseCapture.sealedAt");
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("$printEstimateCaseCapture.sealedAt must be ISO-8601.");
  }
  const printEstimateCase = validatePrintEstimateCase(root.printEstimateCase);
  if (printEstimateCase.schemaVersion !== PRINT_ESTIMATE_CASE_SCHEMA) {
    throw new TypeError(
      "$printEstimateCaseCapture.printEstimateCase schema is divergent.",
    );
  }
  const canonicalCaseText = nonEmptyText(
    root.canonicalCaseText,
    "$printEstimateCaseCapture.canonicalCaseText",
  );
  if (canonicalCaseText !== deterministicJson(printEstimateCase)) {
    throw new TypeError(
      "$printEstimateCaseCapture.canonicalCaseText does not match the case.",
    );
  }
  const caseDigest = nonEmptyText(
    root.caseDigest,
    "$printEstimateCaseCapture.caseDigest",
  );
  const observed = await sha256Fingerprint(printEstimateCase);
  if (caseDigest !== observed.digest) {
    throw new TypeError(
      "$printEstimateCaseCapture.caseDigest does not match the case.",
    );
  }
  return {
    schemaVersion: PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$printEstimateCaseCapture.trustedRunId"),
    caseDigest,
    canonicalCaseText,
    printEstimateCase,
    sealedAt,
  };
}

export async function fingerprintPrintEstimateCaseCapture(
  capture: PrintEstimateCaseCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}
