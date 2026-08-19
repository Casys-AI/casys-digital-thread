/**
 * Capture envelope for industrialize.seal-printability-case@1.
 *
 * Provider-free: the sealed case only. No DFM payload lives here.
 */

import {
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
} from "../../../domain/make/printability/printability-proposal.ts";
import {
  PRINTABILITY_CHECK_CASE_SCHEMA,
  type PrintabilityCheckCase,
  validatePrintabilityCheckCase,
} from "../../../domain/make/printability/printability-case.ts";
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

export const PRINTABILITY_CASE_CAPTURE_SCHEMA =
  "printability-case-capture/1.0" as const;

export const PRINTABILITY_CASE_CAPTURE_URI_PREFIX =
  "casys://printability-case-capture/sha256/" as const;

export interface PrintabilityCaseCapture {
  readonly schemaVersion: typeof PRINTABILITY_CASE_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly caseDigest: string;
  readonly canonicalCaseText: string;
  readonly printabilityCase: PrintabilityCheckCase;
  readonly sealedAt: string;
}

export async function validatePrintabilityCaseCapture(
  value: unknown,
): Promise<PrintabilityCaseCapture> {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "caseDigest",
    "canonicalCaseText",
    "printabilityCase",
    "sealedAt",
  ], "$printabilityCaseCapture");
  literalValue(
    root.schemaVersion,
    PRINTABILITY_CASE_CAPTURE_SCHEMA,
    "$printabilityCaseCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$printabilityCaseCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.id,
    "$printabilityCaseCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION.version,
    "$printabilityCaseCapture.operation.version",
  );
  const sealedAt = nonEmptyText(root.sealedAt, "$printabilityCaseCapture.sealedAt");
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("$printabilityCaseCapture.sealedAt must be ISO-8601.");
  }
  const printabilityCase = validatePrintabilityCheckCase(root.printabilityCase);
  if (printabilityCase.schemaVersion !== PRINTABILITY_CHECK_CASE_SCHEMA) {
    throw new TypeError(
      "$printabilityCaseCapture.printabilityCase schema is divergent.",
    );
  }
  const canonicalCaseText = nonEmptyText(
    root.canonicalCaseText,
    "$printabilityCaseCapture.canonicalCaseText",
  );
  if (canonicalCaseText !== deterministicJson(printabilityCase)) {
    throw new TypeError(
      "$printabilityCaseCapture.canonicalCaseText does not match the case.",
    );
  }
  const caseDigest = nonEmptyText(
    root.caseDigest,
    "$printabilityCaseCapture.caseDigest",
  );
  const observed = await sha256Fingerprint(printabilityCase);
  if (caseDigest !== observed.digest) {
    throw new TypeError(
      "$printabilityCaseCapture.caseDigest does not match the case.",
    );
  }
  return {
    schemaVersion: PRINTABILITY_CASE_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$printabilityCaseCapture.trustedRunId"),
    caseDigest,
    canonicalCaseText,
    printabilityCase,
    sealedAt,
  };
}

export async function fingerprintPrintabilityCaseCapture(
  capture: PrintabilityCaseCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}
