/**
 * Replayable envelope for one SysON evaluation of admitted Modelica
 * observations. SysON remains the comparator. This capture is not an L5
 * decision and not an OMC dispatch.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";

export const ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA =
  "modelica-admitted-observation-evaluation-capture/1.0" as const;

export { ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX };

export type AdmittedObservationDispatchSkipReason = "unit-identity-mismatch";

export interface AdmittedObservationEvaluationCapture {
  readonly schemaVersion: typeof ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA;
  readonly kind: "modelica-admitted-observation-evaluation";
  readonly operation: {
    readonly id: typeof VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id;
    readonly version:
      typeof VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version;
  };
  readonly request: {
    readonly name: "syson_constraint_evaluate";
    readonly arguments: Readonly<Record<string, unknown>>;
  };
  readonly response: {
    readonly structuredContent: Readonly<Record<string, unknown>>;
  };
  readonly unresolved: readonly {
    readonly requirementElementId: string;
    readonly reason: AdmittedObservationDispatchSkipReason;
  }[];
}

export function validateAdmittedObservationEvaluationCapture(
  value: unknown,
  path = "$admittedObservationEvaluationCapture",
): AdmittedObservationEvaluationCapture {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "operation", "request", "response", "unresolved"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    "modelica-admitted-observation-evaluation",
    `${path}.kind`,
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    `${path}.operation`,
  );
  literalValue(
    operation.id,
    VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version,
    `${path}.operation.version`,
  );
  const request = exactRecord(root.request, ["name", "arguments"], `${path}.request`);
  literalValue(request.name, "syson_constraint_evaluate", `${path}.request.name`);
  const response = exactRecord(
    root.response,
    ["structuredContent"],
    `${path}.response`,
  );
  const unresolved = arrayOf(root.unresolved, `${path}.unresolved`).map(
    (item, index) => parseUnresolved(item, `${path}.unresolved[${index}]`),
  );
  return deepFreeze({
    schemaVersion: ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
    kind: "modelica-admitted-observation-evaluation",
    operation: {
      id: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.id,
      version: VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION.version,
    },
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
    unresolved,
  });
}

export function canonicalAdmittedObservationEvaluationCaptureText(
  value: AdmittedObservationEvaluationCapture,
): string {
  return deterministicJson(validateAdmittedObservationEvaluationCapture(value));
}

function parseUnresolved(
  value: unknown,
  path: string,
): AdmittedObservationEvaluationCapture["unresolved"][number] {
  const item = exactRecord(value, ["requirementElementId", "reason"], path);
  literalValue(item.reason, "unit-identity-mismatch", `${path}.reason`);
  return {
    requirementElementId: safeId(
      item.requirementElementId,
      `${path}.requirementElementId`,
    ),
    reason: "unit-identity-mismatch",
  };
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
