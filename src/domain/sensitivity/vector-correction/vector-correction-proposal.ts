/**
 * Closed MRTR grammar for sealing one bounded vector-correction document.
 *
 * The signed parameters name exact identities and the recomputed scalars.
 * They grant no CAD write, no SysON insertion, no provider dispatch, and no
 * execution admission. `unitTransformation` is the literal `identity`: this
 * grammar does not import or apply `UNIT_NORMALISATION`.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import type { EngineeringDecisionProposalParameter } from "../../project/engineering-project.ts";
import {
  CORRECTION_PROPOSAL_SCHEMA,
  type CorrectionProposal,
} from "./propose-vector-correction.ts";
import { isSensitivityStudyResultArtifactId } from "../study/sensitivity-study-result.ts";

export const DESIGN_APPLY_VECTOR_CORRECTION_OPERATION = Object.freeze(
  {
    id: "design.apply-vector-correction",
    version: "1",
  } as const,
);

export const VECTOR_CORRECTION_UNIT_TRANSFORMATION = "identity" as const;

type ParameterValue = EngineeringDecisionProposalParameter["value"];

interface ParameterSpec {
  readonly key: string;
  readonly label: string;
  readonly value: ParameterValue;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
const PARAMETER_PREFIX = "design.vectorCorrection";
const FIXED_PARAMETER_COUNT = 27;

export interface VectorCorrectionDecisionParameters {
  readonly schemaVersion: typeof CORRECTION_PROPOSAL_SCHEMA;
  readonly studyCapture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evaluationId: string;
  readonly metricId: string;
  readonly driver: {
    readonly current: { readonly value: number; readonly unit: string };
    readonly proposed: { readonly value: number; readonly unit: string };
    readonly delta: { readonly value: number; readonly unit: string };
  };
  readonly actual: { readonly value: number; readonly unit: string };
  readonly limit: { readonly value: number; readonly unit: string };
  readonly predicted: { readonly value: number; readonly unit: string };
  readonly derivative: { readonly value: number; readonly unit: string };
  readonly neighborhood: {
    readonly lower: { readonly value: number; readonly unit: string };
    readonly upper: { readonly value: number; readonly unit: string };
  };
  readonly unitTransformation: typeof VECTOR_CORRECTION_UNIT_TRANSFORMATION;
  readonly caseDigest: string;
  readonly formula: string;
}

export function encodeVectorCorrectionDecisionParameters(
  value: unknown,
): readonly EngineeringDecisionProposalParameter[] {
  const parameters = validateVectorCorrectionDecisionParameters(value);
  return deepFreeze(
    parameterSpecs(parameters).map(({ key, label, value }) => ({
      key,
      label,
      value,
    })),
  );
}

export function parseVectorCorrectionDecisionParameters(
  parameters: readonly EngineeringDecisionProposalParameter[],
): VectorCorrectionDecisionParameters {
  if (!Array.isArray(parameters)) {
    throw new TypeError("$parameters must be an array.");
  }
  if (parameters.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      `$parameters must contain exactly ${FIXED_PARAMETER_COUNT} entries.`,
    );
  }

  const values = new Map<string, ParameterValue>();
  const actualKeys: string[] = [];
  const actualLabels = new Map<string, string>();
  for (const [index, parameter] of parameters.entries()) {
    const record = exactRecord(
      parameter,
      ["key", "label", "value"],
      `$parameters[${index}]`,
    );
    const key = safeId(record.key, `$parameters[${index}].key`);
    if (values.has(key)) {
      throw new TypeError(`$parameters contains duplicate key ${key}.`);
    }
    values.set(
      key,
      requireParameterValue(record.value, `$parameters[${index}].value`),
    );
    actualLabels.set(
      key,
      requireLabel(record.label, `$parameters[${index}].label`),
    );
    actualKeys.push(key);
  }

  const parsed = validateVectorCorrectionDecisionParameters({
    schemaVersion: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.schemaVersion`,
      CORRECTION_PROPOSAL_SCHEMA,
    ),
    studyCapture: {
      artifactId: requireId(values, `${PARAMETER_PREFIX}.studyCapture.artifactId`),
      fingerprint: requireFingerprint(
        values,
        `${PARAMETER_PREFIX}.studyCapture.sha256`,
      ),
    },
    evaluationId: requireId(values, `${PARAMETER_PREFIX}.evaluation.id`),
    metricId: requireId(values, `${PARAMETER_PREFIX}.metricId`),
    driver: {
      current: {
        value: requireFinite(values, `${PARAMETER_PREFIX}.driver.current.value`),
        unit: requireUnit(values, `${PARAMETER_PREFIX}.driver.current.unit`),
      },
      proposed: {
        value: requireFinite(values, `${PARAMETER_PREFIX}.driver.proposed.value`),
        unit: requireUnit(values, `${PARAMETER_PREFIX}.driver.proposed.unit`),
      },
      delta: {
        value: requireFinite(values, `${PARAMETER_PREFIX}.driver.delta.value`),
        unit: requireUnit(values, `${PARAMETER_PREFIX}.driver.delta.unit`),
      },
    },
    actual: {
      value: requireFinite(values, `${PARAMETER_PREFIX}.actual.value`),
      unit: requireUnit(values, `${PARAMETER_PREFIX}.actual.unit`),
    },
    limit: {
      value: requireFinite(values, `${PARAMETER_PREFIX}.limit.value`),
      unit: requireUnit(values, `${PARAMETER_PREFIX}.limit.unit`),
    },
    predicted: {
      value: requireFinite(values, `${PARAMETER_PREFIX}.predicted.value`),
      unit: requireUnit(values, `${PARAMETER_PREFIX}.predicted.unit`),
    },
    derivative: {
      value: requireFinite(values, `${PARAMETER_PREFIX}.derivative.value`),
      unit: requireUnit(values, `${PARAMETER_PREFIX}.derivative.unit`),
    },
    neighborhood: {
      lower: {
        value: requireFinite(values, `${PARAMETER_PREFIX}.neighborhood.lower.value`),
        unit: requireUnit(values, `${PARAMETER_PREFIX}.neighborhood.lower.unit`),
      },
      upper: {
        value: requireFinite(values, `${PARAMETER_PREFIX}.neighborhood.upper.value`),
        unit: requireUnit(values, `${PARAMETER_PREFIX}.neighborhood.upper.unit`),
      },
    },
    unitTransformation: requireLiteral(
      values,
      `${PARAMETER_PREFIX}.unitTransformation`,
      VECTOR_CORRECTION_UNIT_TRANSFORMATION,
    ),
    caseDigest: requireSha256(values, `${PARAMETER_PREFIX}.caseDigest`),
    formula: requireFormula(values, `${PARAMETER_PREFIX}.formula`),
  });

  const expected = parameterSpecs(parsed);
  for (const [index, spec] of expected.entries()) {
    if (actualKeys[index] !== spec.key) {
      throw new TypeError(
        `$parameters[${index}].key must equal ${spec.key}.`,
      );
    }
    if (actualLabels.get(spec.key) !== spec.label) {
      throw new TypeError(
        `$parameters label for ${spec.key} must equal ${JSON.stringify(spec.label)}.`,
      );
    }
    if (!Object.is(values.get(spec.key), spec.value)) {
      throw new TypeError(
        `$parameters value for ${spec.key} is not its exact canonical scalar.`,
      );
    }
  }
  return parsed;
}

export function validateVectorCorrectionDecisionParameters(
  value: unknown,
  path = "$vectorCorrectionDecision",
): VectorCorrectionDecisionParameters {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "studyCapture",
      "evaluationId",
      "metricId",
      "driver",
      "actual",
      "limit",
      "predicted",
      "derivative",
      "neighborhood",
      "unitTransformation",
      "caseDigest",
      "formula",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    CORRECTION_PROPOSAL_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.unitTransformation,
    VECTOR_CORRECTION_UNIT_TRANSFORMATION,
    `${path}.unitTransformation`,
  );

  const studyCapture = exactRecord(
    root.studyCapture,
    ["artifactId", "fingerprint"],
    `${path}.studyCapture`,
  );
  const fingerprint = parseFingerprint(
    studyCapture.fingerprint,
    `${path}.studyCapture.fingerprint`,
  );
  const artifactId = safeId(studyCapture.artifactId, `${path}.studyCapture.artifactId`);
  if (!isSensitivityStudyResultArtifactId(artifactId, fingerprint)) {
    throw new TypeError(
      `${path}.studyCapture.artifactId must be derived from its exact fingerprint.`,
    );
  }

  const driver = exactRecord(
    root.driver,
    ["current", "proposed", "delta"],
    `${path}.driver`,
  );
  const neighborhood = exactRecord(
    root.neighborhood,
    ["lower", "upper"],
    `${path}.neighborhood`,
  );
  const formula = nonEmptyFormula(root.formula, `${path}.formula`);
  const caseDigest = canonicalSha256(root.caseDigest, `${path}.caseDigest`);

  return deepFreeze({
    schemaVersion: CORRECTION_PROPOSAL_SCHEMA,
    studyCapture: {
      artifactId,
      fingerprint,
    },
    evaluationId: safeId(root.evaluationId, `${path}.evaluationId`),
    metricId: safeId(root.metricId, `${path}.metricId`),
    driver: {
      current: quantity(driver.current, `${path}.driver.current`),
      proposed: quantity(driver.proposed, `${path}.driver.proposed`),
      delta: quantity(driver.delta, `${path}.driver.delta`),
    },
    actual: quantity(root.actual, `${path}.actual`),
    limit: quantity(root.limit, `${path}.limit`),
    predicted: quantity(root.predicted, `${path}.predicted`),
    derivative: quantity(root.derivative, `${path}.derivative`),
    neighborhood: {
      lower: quantity(neighborhood.lower, `${path}.neighborhood.lower`),
      upper: quantity(neighborhood.upper, `${path}.neighborhood.upper`),
    },
    unitTransformation: VECTOR_CORRECTION_UNIT_TRANSFORMATION,
    caseDigest,
    formula,
  });
}

export function vectorCorrectionDecisionFromComputed(input: {
  readonly proposal: CorrectionProposal;
  readonly studyCapture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly evaluationId: string;
  readonly caseDigest: string;
  readonly limit: { readonly value: number; readonly unit: string };
}): VectorCorrectionDecisionParameters {
  const { proposal } = input;
  return validateVectorCorrectionDecisionParameters({
    schemaVersion: proposal.schemaVersion,
    studyCapture: input.studyCapture,
    evaluationId: input.evaluationId,
    metricId: proposal.edgeUsed.response.metric,
    driver: {
      current: proposal.driverCurrent,
      proposed: proposal.driverProposed,
      delta: proposal.driverDelta,
    },
    actual: proposal.linearizedJustification.actualResponse,
    limit: input.limit,
    predicted: proposal.linearizedJustification.predictedResponse,
    derivative: proposal.linearizedJustification.derivative,
    neighborhood: {
      lower: proposal.edgeUsed.driver.validityNeighborhood.lower,
      upper: proposal.edgeUsed.driver.validityNeighborhood.upper,
    },
    unitTransformation: VECTOR_CORRECTION_UNIT_TRANSFORMATION,
    caseDigest: input.caseDigest,
    formula: proposal.linearizedJustification.formula,
  });
}

export function verifyVectorCorrectionParametersMatch(
  signed: VectorCorrectionDecisionParameters,
  expected: VectorCorrectionDecisionParameters,
): void {
  const signedSpecs = parameterSpecs(signed);
  const expectedSpecs = parameterSpecs(expected);
  if (signedSpecs.length !== expectedSpecs.length) {
    throw new TypeError(
      "Signed vector-correction parameters do not match the recompute.",
    );
  }
  for (const [index, spec] of expectedSpecs.entries()) {
    const actual = signedSpecs[index]!;
    if (actual.key !== spec.key || !Object.is(actual.value, spec.value)) {
      throw new TypeError(
        `parameter_mismatch: ${spec.key} is not Object.is-equal to the recomputed scalar.`,
      );
    }
  }
}

function parameterSpecs(
  parameters: VectorCorrectionDecisionParameters,
): ParameterSpec[] {
  const specs: ParameterSpec[] = [];
  const add = (key: string, label: string, value: ParameterValue) => {
    specs.push({ key, label, value });
  };
  add(
    `${PARAMETER_PREFIX}.schemaVersion`,
    "Correction proposal schema",
    parameters.schemaVersion,
  );
  add(
    `${PARAMETER_PREFIX}.operation`,
    "Reviewed operation",
    `${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.id}@${DESIGN_APPLY_VECTOR_CORRECTION_OPERATION.version}`,
  );
  add(
    `${PARAMETER_PREFIX}.studyCapture.artifactId`,
    "Study capture artifact ID",
    parameters.studyCapture.artifactId,
  );
  add(
    `${PARAMETER_PREFIX}.studyCapture.sha256`,
    "Study capture SHA-256",
    parameters.studyCapture.fingerprint.digest,
  );
  add(
    `${PARAMETER_PREFIX}.evaluation.id`,
    "Failing evaluation ID",
    parameters.evaluationId,
  );
  add(`${PARAMETER_PREFIX}.metricId`, "Corrected metric", parameters.metricId);
  add(
    `${PARAMETER_PREFIX}.driver.current.value`,
    "Current driver value",
    parameters.driver.current.value,
  );
  add(
    `${PARAMETER_PREFIX}.driver.current.unit`,
    "Current driver unit",
    parameters.driver.current.unit,
  );
  add(
    `${PARAMETER_PREFIX}.driver.proposed.value`,
    "Proposed driver value",
    parameters.driver.proposed.value,
  );
  add(
    `${PARAMETER_PREFIX}.driver.proposed.unit`,
    "Proposed driver unit",
    parameters.driver.proposed.unit,
  );
  add(
    `${PARAMETER_PREFIX}.driver.delta.value`,
    "Driver correction delta",
    parameters.driver.delta.value,
  );
  add(
    `${PARAMETER_PREFIX}.driver.delta.unit`,
    "Driver correction unit",
    parameters.driver.delta.unit,
  );
  add(
    `${PARAMETER_PREFIX}.actual.value`,
    "Study-base actual response",
    parameters.actual.value,
  );
  add(
    `${PARAMETER_PREFIX}.actual.unit`,
    "Study-base actual unit",
    parameters.actual.unit,
  );
  add(
    `${PARAMETER_PREFIX}.limit.value`,
    "Requirement limit",
    parameters.limit.value,
  );
  add(
    `${PARAMETER_PREFIX}.limit.unit`,
    "Requirement limit unit",
    parameters.limit.unit,
  );
  add(
    `${PARAMETER_PREFIX}.predicted.value`,
    "Predicted response at z*",
    parameters.predicted.value,
  );
  add(
    `${PARAMETER_PREFIX}.predicted.unit`,
    "Predicted response unit",
    parameters.predicted.unit,
  );
  add(
    `${PARAMETER_PREFIX}.derivative.value`,
    "Sensitivity derivative k",
    parameters.derivative.value,
  );
  add(
    `${PARAMETER_PREFIX}.derivative.unit`,
    "Sensitivity derivative unit",
    parameters.derivative.unit,
  );
  add(
    `${PARAMETER_PREFIX}.neighborhood.lower.value`,
    "Validity neighborhood lower bound",
    parameters.neighborhood.lower.value,
  );
  add(
    `${PARAMETER_PREFIX}.neighborhood.lower.unit`,
    "Validity neighborhood lower unit",
    parameters.neighborhood.lower.unit,
  );
  add(
    `${PARAMETER_PREFIX}.neighborhood.upper.value`,
    "Validity neighborhood upper bound",
    parameters.neighborhood.upper.value,
  );
  add(
    `${PARAMETER_PREFIX}.neighborhood.upper.unit`,
    "Validity neighborhood upper unit",
    parameters.neighborhood.upper.unit,
  );
  add(
    `${PARAMETER_PREFIX}.unitTransformation`,
    "Unit transformation",
    parameters.unitTransformation,
  );
  add(
    `${PARAMETER_PREFIX}.caseDigest`,
    "Sensitivity case SHA-256 digest",
    parameters.caseDigest,
  );
  add(`${PARAMETER_PREFIX}.formula`, "Linearization formula", parameters.formula);
  if (specs.length !== FIXED_PARAMETER_COUNT) {
    throw new TypeError(
      "Vector-correction MRTR grammar is internally inconsistent.",
    );
  }
  return specs;
}

function quantity(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: string } {
  const record = exactRecord(value, ["value", "unit"], path);
  return {
    value: finite(record.value, `${path}.value`),
    unit: nonEmptyUnit(record.unit, `${path}.unit`),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  return deepFreeze({
    algorithm: "sha256",
    digest: canonicalSha256(fingerprint.digest, `${path}.digest`),
  });
}

function canonicalSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(`${path} must be canonical lowercase SHA-256 hex.`);
  }
  return value;
}

function nonEmptyUnit(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty unit.`);
  }
  return value;
}

function nonEmptyFormula(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty formula.`);
  }
  return value;
}

function requireParameterValue(value: unknown, path: string): ParameterValue {
  if (
    (typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean") ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    throw new TypeError(`${path} must be a finite MRTR scalar.`);
  }
  return value;
}

function requireLabel(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 128
  ) {
    throw new TypeError(
      `${path} must be a non-empty label of at most 128 characters without edge whitespace.`,
    );
  }
  return value;
}

function requireValue(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ParameterValue {
  if (!values.has(key)) throw new TypeError(`$parameters is missing key ${key}.`);
  return values.get(key)!;
}

function requireId(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return safeId(requireValue(values, key), `$parameters.${key}`);
}

function requireLiteral<const Value extends string>(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
  expected: Value,
): Value {
  literalValue(requireValue(values, key), expected, `$parameters.${key}`);
  return expected;
}

function requireFingerprint(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): ContentFingerprint {
  return deepFreeze({
    algorithm: "sha256",
    digest: requireSha256(values, key),
  });
}

function requireSha256(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return canonicalSha256(requireValue(values, key), `$parameters.${key}`);
}

function requireFinite(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): number {
  return finite(requireValue(values, key), `$parameters.${key}`);
}

function requireUnit(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return nonEmptyUnit(requireValue(values, key), `$parameters.${key}`);
}

function requireFormula(
  values: ReadonlyMap<string, ParameterValue>,
  key: string,
): string {
  return nonEmptyFormula(requireValue(values, key), `$parameters.${key}`);
}
