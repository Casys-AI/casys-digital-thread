/**
 * Replayable envelope for one closed-method evaluation of admitted SPICE
 * observations. This capture is not an L5 decision and not an ngspice
 * dispatch. SysON is never called.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION } from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
  type SpiceAdmittedCriterionEvaluation,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "../../../shared/cas/file-capture-store.ts";

export const SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA =
  "spice-admitted-observation-evaluation-capture/1.0" as const;

export { SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX };

export interface SpiceAdmittedObservationEvaluationCapture {
  readonly schemaVersion: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA;
  readonly kind: "spice-admitted-observation-evaluation";
  readonly operation: {
    readonly id: typeof VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id;
    readonly version:
      typeof VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version;
  };
  readonly overall: SpiceAdmittedCriterionEvaluation["status"];
  readonly evaluations: readonly SpiceAdmittedCriterionEvaluation[];
  readonly limitations: typeof SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS;
}

export function validateSpiceAdmittedObservationEvaluationCapture(
  value: unknown,
  path = "$spiceAdmittedObservationEvaluationCapture",
): SpiceAdmittedObservationEvaluationCapture {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "operation", "overall", "evaluations", "limitations"],
    path,
  );
  literalValue(
    root.schemaVersion,
    SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    "spice-admitted-observation-evaluation",
    `${path}.kind`,
  );
  const operation = exactRecord(root.operation, ["id", "version"], `${path}.operation`);
  literalValue(
    operation.id,
    VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id,
    `${path}.operation.id`,
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version,
    `${path}.operation.version`,
  );
  const overall = parseStatus(root.overall, `${path}.overall`);
  const evaluations = arrayOf(root.evaluations, `${path}.evaluations`).map(
    (item, index) => parseEvaluation(item, `${path}.evaluations[${index}]`),
  );
  if (
    deterministicJson(root.limitations) !==
      deterministicJson(SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS)
  ) {
    throw new TypeError(`${path}.limitations must be the exact closed list.`);
  }
  return deepFreeze({
    schemaVersion: SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_SCHEMA,
    kind: "spice-admitted-observation-evaluation",
    operation: {
      id: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.id,
      version: VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION.version,
    },
    overall,
    evaluations,
    limitations: SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
  });
}

export function canonicalSpiceAdmittedObservationEvaluationCaptureText(
  value: SpiceAdmittedObservationEvaluationCapture,
): string {
  return deterministicJson(
    validateSpiceAdmittedObservationEvaluationCapture(value),
  );
}

function parseEvaluation(
  value: unknown,
  path: string,
): SpiceAdmittedCriterionEvaluation {
  const input = exactRecord(
    value,
    Object.hasOwn(value as object, "actual")
      ? ["criterionId", "status", "message", "actual", "comparator", "natives"]
      : ["criterionId", "status", "message", "comparator", "natives"],
    path,
  );
  const comparator = nonEmptyText(input.comparator, `${path}.comparator`);
  if (
    comparator !== "<=" && comparator !== ">=" &&
    comparator !== "between-inclusive"
  ) {
    throw new TypeError(
      `${path}.comparator must be <=, >= or between-inclusive.`,
    );
  }
  const evaluation: SpiceAdmittedCriterionEvaluation = {
    criterionId: safeId(input.criterionId, `${path}.criterionId`),
    status: parseStatus(input.status, `${path}.status`),
    message: nonEmptyText(input.message, `${path}.message`),
    comparator,
    natives: arrayOf(input.natives, `${path}.natives`).map((item, index) =>
      nonEmptyText(item, `${path}.natives[${index}]`)
    ),
  };
  if (!Object.hasOwn(input, "actual")) return evaluation;
  const actual = exactRecord(input.actual, ["value", "unit"], `${path}.actual`);
  return {
    ...evaluation,
    actual: {
      value: finite(actual.value, `${path}.actual.value`),
      unit: nonEmptyText(actual.unit, `${path}.actual.unit`),
    },
  };
}

function parseStatus(
  value: unknown,
  path: string,
): SpiceAdmittedCriterionEvaluation["status"] {
  if (
    value !== "pass" && value !== "fail" && value !== "unresolved" &&
    value !== "error"
  ) {
    throw new TypeError(`${path} must be pass, fail, unresolved or error.`);
  }
  return value;
}
