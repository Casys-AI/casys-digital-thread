/**
 * Closed MRTR grammar for `simulation-case/2.0`.
 *
 * The registered operation version and explicit schemaVersion keep this
 * successor distinct from V1. An unrecognised key cannot be silently omitted
 * from the human-signed decision surface.
 */

import type { SimulationCaseV2 } from "./simulation-case-v2.ts";

/** Historical recorded Modelica seal. Not registered; cannot be queued. */
export const SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION = {
  id: "simulate.seal-simulation-case",
  version: "2",
} as const;

/** Historical recorded Modelica scenario run. Not registered; cannot be queued. */
export const SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION = {
  id: "simulate.run-modelica-scenario",
  version: "2",
} as const;

type DecisionValue = string | number | boolean;
type DecisionParameter = {
  readonly key: string;
  readonly label: string;
  readonly value: DecisionValue;
};

export type SimulationCaseV2ProposalErrorCode =
  | "duplicate_parameter"
  | "unexpected_parameter"
  | "missing_parameter"
  | "invalid_format"
  | "verification_mismatch";

export class SimulationCaseV2ProposalError extends Error {
  constructor(readonly code: SimulationCaseV2ProposalErrorCode, message: string) {
    super(message);
    this.name = "SimulationCaseV2ProposalError";
  }
}

export interface SimulationCaseV2DecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: "simulation-case/2.0";
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: { readonly id: string; readonly subjectId: string };
  readonly reviewBasis: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly kit: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly modelSha256: string;
  };
  readonly scenario: {
    readonly id: string;
    readonly sourceSha256: string;
    readonly projectionSha256: string;
  };
  readonly parameterMode: "explicit-overrides";
  readonly timeoutMs: number;
  readonly parameters: readonly {
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }[];
  readonly expectedMetrics: readonly { readonly id: string; readonly unit: string }[];
}

const PREFIX = "sim.case";
const SHA256 = /^[a-f0-9]{64}$/;
const NON_EMPTY = /\S/;

export function simulationCaseV2DecisionParametersToMap(
  parameters: ReadonlyArray<{ readonly key: string; readonly value: DecisionValue }>,
): ReadonlyMap<string, DecisionValue> {
  const result = new Map<string, DecisionValue>();
  for (const parameter of parameters) {
    if (result.has(parameter.key)) {
      throw new SimulationCaseV2ProposalError(
        "duplicate_parameter",
        `Duplicate simulation-case decision parameter: ${parameter.key}`,
      );
    }
    result.set(parameter.key, parameter.value);
  }
  return result;
}

export function encodeSimulationCaseV2DecisionParameters(
  caseDigest: string,
  simulationCase: SimulationCaseV2,
): readonly DecisionParameter[] {
  if (!SHA256.test(caseDigest)) invalid("caseDigest must be lowercase SHA-256.");
  const parameters: DecisionParameter[] = [];
  const add = (suffix: string, label: string, value: DecisionValue): void => {
    parameters.push({ key: `${PREFIX}.${suffix}`, label, value });
  };
  add("digest", "Simulation case SHA-256 digest", caseDigest);
  add("schemaVersion", "Schema version", simulationCase.schemaVersion);
  add("id", "Simulation case ID", simulationCase.id);
  add("revision", "Simulation case revision", simulationCase.revision);
  add("scope", "Scope", simulationCase.scope);
  add("evidenceBoundary", "Evidence boundary", simulationCase.evidenceBoundary);
  add("project.id", "Project ID", simulationCase.project.id);
  add("project.subjectId", "Project subject ID", simulationCase.project.subjectId);
  add(
    "reviewBasis.snapshotId",
    "Review basis snapshot ID",
    simulationCase.project.baseThreadSnapshot.id,
  );
  add(
    "reviewBasis.revision",
    "Review basis snapshot revision",
    simulationCase.project.baseThreadSnapshot.revision,
  );
  add(
    "reviewBasis.subjectId",
    "Review basis subject ID",
    simulationCase.project.baseThreadSnapshot.subjectId,
  );
  add("kit.modelId", "Kit model ID", simulationCase.kit.modelId);
  add("kit.modelVersion", "Kit model version", simulationCase.kit.modelVersion);
  add("kit.modelSha256", "Kit model SHA-256", simulationCase.kit.modelSha256);
  add("scenario.id", "Scenario ID", simulationCase.scenario.id);
  add(
    "scenario.sourceSha256",
    "Native scenario source SHA-256",
    simulationCase.scenario.sourceSha256,
  );
  add(
    "scenario.projectionSha256",
    "Scenario public projection SHA-256",
    simulationCase.scenario.projectionSha256,
  );
  add("parameterMode", "Parameter mode", simulationCase.parameterMode);
  add("timeoutMs", "Timeout (ms)", simulationCase.timeoutMs);
  add("parameters.count", "Parameter count", simulationCase.parameters.length);
  for (const [index, parameter] of simulationCase.parameters.entries()) {
    add(`parameters.${index}.id`, `Parameter ${index} ID`, parameter.id);
    add(`parameters.${index}.value`, `Parameter ${index} value`, parameter.value);
    add(`parameters.${index}.unit`, `Parameter ${index} unit`, parameter.unit);
  }
  add(
    "expectedMetrics.count",
    "Expected metric count",
    simulationCase.expectedMetrics.length,
  );
  for (const [index, metric] of simulationCase.expectedMetrics.entries()) {
    add(`expectedMetrics.${index}.id`, `Expected metric ${index} ID`, metric.id);
    add(`expectedMetrics.${index}.unit`, `Expected metric ${index} unit`, metric.unit);
  }
  return parameters;
}

export function parseSimulationCaseV2DecisionParameters(
  params: ReadonlyMap<string, DecisionValue>,
): SimulationCaseV2DecisionParameters {
  const str = (suffix: string, pattern = NON_EMPTY): string =>
    stringParam(params, key(suffix), pattern);
  const integer = (suffix: string): number => positiveInt(params, key(suffix));
  const parameterCount = count(params, key("parameters.count"));
  const metricCount = count(params, key("expectedMetrics.count"));
  if (metricCount === 0) {
    invalid("Simulation case must declare at least one expected metric.");
  }

  const expected = new Set<string>([
    key("digest"),
    key("schemaVersion"),
    key("id"),
    key("revision"),
    key("scope"),
    key("evidenceBoundary"),
    key("project.id"),
    key("project.subjectId"),
    key("reviewBasis.snapshotId"),
    key("reviewBasis.revision"),
    key("reviewBasis.subjectId"),
    key("kit.modelId"),
    key("kit.modelVersion"),
    key("kit.modelSha256"),
    key("scenario.id"),
    key("scenario.sourceSha256"),
    key("scenario.projectionSha256"),
    key("parameterMode"),
    key("timeoutMs"),
    key("parameters.count"),
    key("expectedMetrics.count"),
  ]);
  for (let index = 0; index < parameterCount; index++) {
    expected.add(key(`parameters.${index}.id`));
    expected.add(key(`parameters.${index}.value`));
    expected.add(key(`parameters.${index}.unit`));
  }
  for (let index = 0; index < metricCount; index++) {
    expected.add(key(`expectedMetrics.${index}.id`));
    expected.add(key(`expectedMetrics.${index}.unit`));
  }
  for (const parameterKey of params.keys()) {
    if (!expected.has(parameterKey)) {
      throw new SimulationCaseV2ProposalError(
        "unexpected_parameter",
        `Unexpected simulation-case decision parameter: ${parameterKey}`,
      );
    }
  }

  const schemaVersion = str("schemaVersion", /^simulation-case\/2\.0$/);
  const parameterMode = str("parameterMode", /^explicit-overrides$/);
  const timeoutMs = integer("timeoutMs");
  if (timeoutMs > 120_000) invalid("sim.case.timeoutMs must not exceed 120000.");
  const parsedParameters = Array.from({ length: parameterCount }, (_, index) => ({
    id: str(`parameters.${index}.id`),
    value: numberParam(params, key(`parameters.${index}.value`)),
    unit: str(`parameters.${index}.unit`),
  }));
  const parsedMetrics = Array.from({ length: metricCount }, (_, index) => ({
    id: str(`expectedMetrics.${index}.id`),
    unit: str(`expectedMetrics.${index}.unit`),
  }));
  assertDistinct(
    parsedParameters.map((item) => item.id),
    "Simulation-case parameter IDs",
  );
  assertDistinct(parsedMetrics.map((item) => item.id), "Simulation-case metric IDs");
  return {
    caseDigest: str("digest", SHA256),
    schemaVersion: schemaVersion as "simulation-case/2.0",
    id: str("id"),
    revision: integer("revision"),
    scope: str("scope"),
    evidenceBoundary: str("evidenceBoundary"),
    project: { id: str("project.id"), subjectId: str("project.subjectId") },
    reviewBasis: {
      snapshotId: str("reviewBasis.snapshotId"),
      revision: integer("reviewBasis.revision"),
      subjectId: str("reviewBasis.subjectId"),
    },
    kit: {
      modelId: str("kit.modelId"),
      modelVersion: str("kit.modelVersion"),
      modelSha256: str("kit.modelSha256", SHA256),
    },
    scenario: {
      id: str("scenario.id"),
      sourceSha256: str("scenario.sourceSha256", SHA256),
      projectionSha256: str("scenario.projectionSha256", SHA256),
    },
    parameterMode: parameterMode as "explicit-overrides",
    timeoutMs,
    parameters: parsedParameters,
    expectedMetrics: parsedMetrics,
  };
}

/** Cross-check every human-signed V2 field against the exact server declaration. */
export function verifySimulationCaseV2ParametersMatchCase(
  parsed: SimulationCaseV2DecisionParameters,
  simulationCase: SimulationCaseV2,
): void {
  const same = parsed.schemaVersion === simulationCase.schemaVersion &&
    parsed.id === simulationCase.id &&
    parsed.revision === simulationCase.revision &&
    parsed.scope === simulationCase.scope &&
    parsed.evidenceBoundary === simulationCase.evidenceBoundary &&
    parsed.project.id === simulationCase.project.id &&
    parsed.project.subjectId === simulationCase.project.subjectId &&
    parsed.reviewBasis.snapshotId === simulationCase.project.baseThreadSnapshot.id &&
    parsed.reviewBasis.revision ===
      simulationCase.project.baseThreadSnapshot.revision &&
    parsed.reviewBasis.subjectId ===
      simulationCase.project.baseThreadSnapshot.subjectId &&
    parsed.kit.modelId === simulationCase.kit.modelId &&
    parsed.kit.modelVersion === simulationCase.kit.modelVersion &&
    parsed.kit.modelSha256 === simulationCase.kit.modelSha256 &&
    parsed.scenario.id === simulationCase.scenario.id &&
    parsed.scenario.sourceSha256 === simulationCase.scenario.sourceSha256 &&
    parsed.scenario.projectionSha256 === simulationCase.scenario.projectionSha256 &&
    parsed.parameterMode === simulationCase.parameterMode &&
    parsed.timeoutMs === simulationCase.timeoutMs &&
    sameParameters(parsed.parameters, simulationCase.parameters) &&
    sameMetrics(parsed.expectedMetrics, simulationCase.expectedMetrics);
  if (!same) {
    throw new SimulationCaseV2ProposalError(
      "verification_mismatch",
      "Simulation-case MRTR parameters do not exactly match the reviewed V2 declaration.",
    );
  }
}

function key(suffix: string): string {
  return `${PREFIX}.${suffix}`;
}

function stringParam(
  params: ReadonlyMap<string, DecisionValue>,
  parameterKey: string,
  pattern: RegExp,
): string {
  const value = required(params, parameterKey);
  if (typeof value !== "string" || !pattern.test(value)) {
    invalid(`${parameterKey} has invalid format.`);
  }
  return value;
}

function positiveInt(
  params: ReadonlyMap<string, DecisionValue>,
  parameterKey: string,
): number {
  const value = required(params, parameterKey);
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalid(`${parameterKey} must be a positive integer.`);
  }
  return Number(value);
}

function count(
  params: ReadonlyMap<string, DecisionValue>,
  parameterKey: string,
): number {
  const value = required(params, parameterKey);
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    invalid(`${parameterKey} must be a non-negative integer.`);
  }
  return Number(value);
}

function numberParam(
  params: ReadonlyMap<string, DecisionValue>,
  parameterKey: string,
): number {
  const value = required(params, parameterKey);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    invalid(`${parameterKey} must be a finite number.`);
  }
  return value;
}

function required(
  params: ReadonlyMap<string, DecisionValue>,
  parameterKey: string,
): DecisionValue {
  const value = params.get(parameterKey);
  if (value === undefined) {
    throw new SimulationCaseV2ProposalError(
      "missing_parameter",
      `Missing simulation-case decision parameter: ${parameterKey}`,
    );
  }
  return value;
}

function assertDistinct(ids: readonly string[], description: string): void {
  if (new Set(ids).size !== ids.length) invalid(`${description} must be unique.`);
}

function sameParameters(
  left: readonly {
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }[],
  right: readonly {
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }[],
): boolean {
  return left.length === right.length &&
    left.every((item, index) =>
      item.id === right[index]?.id && item.value === right[index]?.value &&
      item.unit === right[index]?.unit
    );
}

function sameMetrics(
  left: readonly { readonly id: string; readonly unit: string }[],
  right: readonly { readonly id: string; readonly unit: string }[],
): boolean {
  return left.length === right.length &&
    left.every((item, index) =>
      item.id === right[index]?.id && item.unit === right[index]?.unit
    );
}

function invalid(message: string): never {
  throw new SimulationCaseV2ProposalError("invalid_format", message);
}
