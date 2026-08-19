/**
 * Thread document for `compile.capture-corrected-source@1`.
 *
 * Not an admission. Grants no Build123d execution.
 */

import { COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION } from "./apply-correction-source.ts";
import {
  exactRecord,
  finite,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const CORRECTED_SOURCE_CAPTURE_SCHEMA = "corrected-source-capture/1.0" as const;

export interface CorrectedSourceCapture {
  readonly schemaVersion: typeof CORRECTED_SOURCE_CAPTURE_SCHEMA;
  readonly operation: typeof COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION;
  readonly trustedRunId: string;
  readonly sealedAt: string;
  readonly semanticKey: string;
  readonly from: { readonly value: number; readonly unit: string };
  readonly to: { readonly value: number; readonly unit: string };
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly sourceRef: Readonly<Record<string, unknown>>;
  readonly correction: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly parentAdmission: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly studyCapture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export function validateCorrectedSourceCapture(
  value: unknown,
): CorrectedSourceCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "sealedAt",
    "semanticKey",
    "from",
    "to",
    "sourceText",
    "sourceSha256",
    "sourceRef",
    "correction",
    "parentAdmission",
    "studyCapture",
  ], "$correctedSourceCapture");
  literalValue(
    root.schemaVersion,
    CORRECTED_SOURCE_CAPTURE_SCHEMA,
    "$correctedSourceCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$correctedSourceCapture.operation",
  );
  literalValue(
    operation.id,
    COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.id,
    "$correctedSourceCapture.operation.id",
  );
  literalValue(
    operation.version,
    COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION.version,
    "$correctedSourceCapture.operation.version",
  );
  const from = quantity(root.from, "$correctedSourceCapture.from");
  const to = quantity(root.to, "$correctedSourceCapture.to");
  if (typeof root.sourceText !== "string" || root.sourceText.length === 0) {
    throw new TypeError("$correctedSourceCapture.sourceText must be non-empty UTF-8.");
  }
  if (
    typeof root.sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(root.sourceSha256)
  ) {
    throw new TypeError(
      "$correctedSourceCapture.sourceSha256 must be a sha256 hex digest.",
    );
  }
  if (
    typeof root.sourceRef !== "object" || root.sourceRef === null ||
    Array.isArray(root.sourceRef)
  ) {
    throw new TypeError("$correctedSourceCapture.sourceRef must be a JSON object.");
  }
  return {
    schemaVersion: CORRECTED_SOURCE_CAPTURE_SCHEMA,
    operation: COMPILE_CAPTURE_CORRECTED_SOURCE_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$correctedSourceCapture.trustedRunId"),
    sealedAt: nonEmptyIso(root.sealedAt, "$correctedSourceCapture.sealedAt"),
    semanticKey: safeId(root.semanticKey, "$correctedSourceCapture.semanticKey"),
    from,
    to,
    sourceText: root.sourceText,
    sourceSha256: root.sourceSha256,
    sourceRef: structuredClone(root.sourceRef) as Record<string, unknown>,
    correction: identity(root.correction, "$correctedSourceCapture.correction"),
    parentAdmission: identity(
      root.parentAdmission,
      "$correctedSourceCapture.parentAdmission",
    ),
    studyCapture: identity(
      root.studyCapture,
      "$correctedSourceCapture.studyCapture",
    ),
  };
}

export function canonicalCorrectedSourceCaptureText(
  value: CorrectedSourceCapture,
): string {
  return deterministicJson(validateCorrectedSourceCapture(value));
}

function quantity(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: string } {
  const root = exactRecord(value, ["value", "unit"], path);
  if (typeof root.unit !== "string" || root.unit.length === 0) {
    throw new TypeError(`${path}.unit must be a non-empty string.`);
  }
  return { value: finite(root.value, `${path}.value`), unit: root.unit };
}

function identity(
  value: unknown,
  path: string,
): { readonly artifactId: string; readonly fingerprint: ContentFingerprint } {
  const root = exactRecord(value, ["artifactId", "fingerprint"], path);
  const fingerprint = exactRecord(
    root.fingerprint,
    ["algorithm", "digest"],
    `${path}.fingerprint`,
  );
  literalValue(fingerprint.algorithm, "sha256", `${path}.fingerprint.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.fingerprint.digest must be a sha256 hex digest.`);
  }
  return {
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: { algorithm: "sha256", digest: fingerprint.digest },
  };
}

function nonEmptyIso(value: unknown, path: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new TypeError(`${path} must be ISO-8601.`);
  }
  return value;
}
