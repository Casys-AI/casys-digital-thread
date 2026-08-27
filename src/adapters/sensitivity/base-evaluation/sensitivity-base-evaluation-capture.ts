/**
 * Replayable envelope for one SysON evaluation of study-base observations.
 *
 * Distinct from fea-syson-evaluation-capture/1.0: this is not a proof-run
 * verdict. The caller must persist and reread these bytes before publishing
 * evaluations.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";

export const SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA =
  "sensitivity-base-evaluation-capture/1.0" as const;

export const SENSITIVITY_BASE_EVALUATION_CAPTURE_URI_PREFIX =
  "casys://sensitivity-base-evaluation-capture/sha256/" as const;

export interface SensitivityBaseEvaluationCapture {
  readonly schemaVersion: typeof SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id;
    readonly version: typeof VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version;
  };
  readonly studyDigest: string;
  readonly request: {
    readonly name: "syson_constraint_evaluate";
    readonly arguments: Readonly<Record<string, unknown>>;
  };
  readonly response: { readonly structuredContent: Readonly<Record<string, unknown>> };
}

export function validateSensitivityBaseEvaluationCapture(
  value: unknown,
  path = "$sensitivityBaseEvaluationCapture",
): SensitivityBaseEvaluationCapture {
  const root = exactRecord(
    value,
    ["schemaVersion", "operation", "studyDigest", "request", "response"],
    path,
  );
  literalValue(
    root.schemaVersion,
    SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version,
    `${path}.operation.version`,
  );
  const studyDigest = literalSha256(root.studyDigest, `${path}.studyDigest`);
  const request = exactRecord(root.request, ["name", "arguments"], `${path}.request`);
  literalValue(request.name, "syson_constraint_evaluate", `${path}.request.name`);
  const response = exactRecord(
    root.response,
    ["structuredContent"],
    `${path}.response`,
  );
  return deepFreeze({
    schemaVersion: SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA,
    operation: {
      id: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id,
      version: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version,
    },
    studyDigest,
    request: {
      name: "syson_constraint_evaluate",
      arguments: jsonRecord(request.arguments, `${path}.request.arguments`),
    },
    response: {
      structuredContent: jsonRecord(
        response.structuredContent,
        `${path}.response.structuredContent`,
      ),
    },
  });
}

export function canonicalSensitivityBaseEvaluationCaptureText(
  value: SensitivityBaseEvaluationCapture,
): string {
  return deterministicJson(validateSensitivityBaseEvaluationCapture(value));
}

function literalSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a 64-character lowercase hex digest.`);
  }
  return value;
}

function jsonRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  if (!isJson(value) || Array.isArray(value) || value === null) {
    throw new TypeError(`${path} must be a JSON object.`);
  }
  return structuredClone(value) as Record<string, unknown>;
}

function isJson(value: unknown): boolean {
  if (
    value === null || typeof value === "string" || typeof value === "boolean"
  ) return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  if (typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every(isJson);
}
