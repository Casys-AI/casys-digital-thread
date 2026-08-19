/**
 * Canonical, replayable evidence envelope for one recorded SysON FEA verdict.
 *
 * The envelope intentionally contains the complete tool request and the exact
 * structured response that the shared FEA oracle parser consumed.  A caller
 * must save and reread these canonical bytes before publishing evaluations.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";

export const FEA_SYSON_EVALUATION_CAPTURE_SCHEMA =
  "fea-syson-evaluation-capture/1.0" as const;

export interface FeaSysonEvaluationCapture {
  readonly schemaVersion: typeof FEA_SYSON_EVALUATION_CAPTURE_SCHEMA;
  readonly request: {
    readonly name: "syson_constraint_evaluate";
    readonly arguments: Readonly<Record<string, unknown>>;
  };
  readonly response: { readonly structuredContent: Readonly<Record<string, unknown>> };
}

export function validateFeaSysonEvaluationCapture(
  value: unknown,
  path = "$feaSysonEvaluationCapture",
): FeaSysonEvaluationCapture {
  const root = exactRecord(value, ["schemaVersion", "request", "response"], path);
  literalValue(
    root.schemaVersion,
    FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const request = exactRecord(root.request, ["name", "arguments"], `${path}.request`);
  literalValue(request.name, "syson_constraint_evaluate", `${path}.request.name`);
  const response = exactRecord(
    root.response,
    ["structuredContent"],
    `${path}.response`,
  );
  return deepFreeze({
    schemaVersion: FEA_SYSON_EVALUATION_CAPTURE_SCHEMA,
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

export function canonicalFeaSysonEvaluationCaptureText(
  value: FeaSysonEvaluationCapture,
): string {
  return deterministicJson(validateFeaSysonEvaluationCapture(value));
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
