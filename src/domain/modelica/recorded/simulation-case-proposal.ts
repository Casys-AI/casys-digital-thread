/**
 * Domain module for the Modelica simulation MRTR decision grammar.
 *
 * WHY THIS MODULE EXISTS — the decision MRTRs that gate
 * `simulate.seal-simulation-case@1` and `simulate.run-modelica-scenario@1`
 * carry a flat key/value parameter list signed by the human operator.  The
 * parser here is the only authority allowed to reconstruct the typed
 * SimulationCase identity from those human-signed parameters.  The executor
 * must not attempt a second interpretation of the raw parameter strings.
 *
 * WHY FLAT GRAMMAR — the MRTR parameters field is reviewed and signed by the
 * human in a chat interface.  A flat key/value grammar (`sim.case.*`) is
 * readable without tooling and parsed fail-closed into a typed hierarchy on
 * the server.  The agent never supplies SysML text or provider arguments; the
 * executor owns those.
 */

import type { SimulationCase } from "./simulation-case.ts";

// ── Operation identity ───────────────────────────────────────────────────────

/**
 * Trusted executor reference for `simulate.seal-simulation-case@1`.
 *
 * WHY DOMAIN LAYER — the registry (orchestration/) and the executor (adapters/)
 * both need this constant.  Defining it in the executor would force the
 * registry to import from adapters, violating the hexagonal layering rule.
 */
export const SIMULATE_SEAL_SIMULATION_CASE_OPERATION = {
  id: "simulate.seal-simulation-case",
  version: "1",
} as const;

/**
 * Trusted executor reference for `simulate.run-modelica-scenario@1`.
 *
 * WHY DOMAIN LAYER — same hexagonal layering reason as the seal operation
 * constant above.
 */
export const SIMULATE_RUN_MODELICA_SCENARIO_OPERATION = {
  id: "simulate.run-modelica-scenario",
  version: "1",
} as const;

// ── Error types ──────────────────────────────────────────────────────────────

export type SimulationCaseProposalErrorCode =
  | "duplicate_parameter"
  | "unexpected_parameter"
  | "missing_parameter"
  | "invalid_format"
  | "verification_mismatch";

/**
 * Structured parse / encode / verification failure.
 *
 * `code` is stable across releases and safe to switch on.  `message` is
 * diagnostic prose intended for log output, not for agent parsing.
 */
export class SimulationCaseProposalError extends Error {
  constructor(
    readonly code: SimulationCaseProposalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SimulationCaseProposalError";
  }
}

// ── Parsed result type ───────────────────────────────────────────────────────

/**
 * Typed representation of the human-reviewed MRTR parameters for a simulation
 * case decision.
 *
 * All fields mirror the SimulationCase schema verbatim except `reviewBasis`,
 * which holds the `project.baseThreadSnapshot` identity in a flatter shape for
 * the MRTR display.  The `caseDigest` is the CAS address of the case capture
 * computed by the seal executor — it is not a field of the case schema itself.
 */
export interface SimulationCaseDecisionParameters {
  readonly caseDigest: string;
  readonly schemaVersion: string;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly reviewBasis: {
    readonly snapshotId: string;
    readonly revision: number;
  };
  readonly kit: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly modelSha256: string;
  };
  readonly scenario: {
    readonly id: string;
    readonly sha256: string;
  };
  readonly parameterMode: "explicit-overrides";
  readonly timeoutMs: number;
  readonly parameters: ReadonlyArray<{
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }>;
  readonly expectedMetrics: ReadonlyArray<{
    readonly id: string;
    readonly unit: string;
  }>;
}

// ── Conversion: array → map ──────────────────────────────────────────────────

/**
 * Convert an ordered parameter list from a decision proposal into a keyed map.
 *
 * WHY NOT MAP DIRECTLY — a Map cannot prove uniqueness because constructing it
 * already silently drops the earlier signed value.  This function rejects a
 * duplicate before building the map, so the invariant is provable and the
 * caller can trust that every signed value is retained.
 */
export function simulationCaseDecisionParametersToMap(
  parameters: ReadonlyArray<{
    readonly key: string;
    readonly value: string | number | boolean;
  }>,
): ReadonlyMap<string, string | number | boolean> {
  const result = new Map<string, string | number | boolean>();
  for (const parameter of parameters) {
    if (result.has(parameter.key)) {
      throw new SimulationCaseProposalError(
        "duplicate_parameter",
        `Duplicate simulation case decision parameter: ${parameter.key}`,
      );
    }
    result.set(parameter.key, parameter.value);
  }
  return result;
}

// ── Encode ───────────────────────────────────────────────────────────────────

/**
 * Encode a SimulationCase and its content-addressed digest into a flat
 * parameter list suitable for an EngineeringDecisionProposal MRTR.
 *
 * WHY CASE DIGEST IS SEPARATE — the digest is the CAS address of the case
 * capture, computed by the seal executor.  The SimulationCase itself carries
 * no self-digest; the digest is a property of the storage operation, not of
 * the case schema.  Keeping them separate preserves the schema's closure under
 * serialisation.
 *
 * Every field is in clear text so the human operator can verify the exact case
 * identity they are approving before signing the MRTR.
 */
export function encodeSimulationCaseDecisionParameters(
  caseDigest: string,
  simulationCase: SimulationCase,
): ReadonlyArray<{ key: string; label: string; value: string | number | boolean }> {
  if (!FINGERPRINT_RE.test(caseDigest)) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      "caseDigest must be a 64-char lowercase hex SHA-256",
    );
  }

  const params: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
  }> = [];
  const p = (
    key: string,
    label: string,
    value: string | number | boolean,
  ) => {
    params.push({ key, label, value });
  };

  p("sim.case.digest", "Simulation case SHA-256 digest", caseDigest);
  p("sim.case.schemaVersion", "Schema version", simulationCase.schemaVersion);
  p("sim.case.id", "Simulation case ID", simulationCase.id);
  p("sim.case.revision", "Simulation case revision", simulationCase.revision);
  p("sim.case.scope", "Scope", simulationCase.scope);
  p(
    "sim.case.evidenceBoundary",
    "Evidence boundary",
    simulationCase.evidenceBoundary,
  );
  p(
    "sim.case.reviewBasis.snapshotId",
    "Review basis snapshot ID",
    simulationCase.project.baseThreadSnapshot.id,
  );
  p(
    "sim.case.reviewBasis.revision",
    "Review basis snapshot revision",
    simulationCase.project.baseThreadSnapshot.revision,
  );
  p("sim.case.kit.modelId", "Kit model ID", simulationCase.kit.modelId);
  p(
    "sim.case.kit.modelVersion",
    "Kit model version",
    simulationCase.kit.modelVersion,
  );
  p(
    "sim.case.kit.modelSha256",
    "Kit model SHA-256",
    simulationCase.kit.modelSha256,
  );
  p("sim.case.scenario.id", "Scenario ID", simulationCase.scenario.id);
  p(
    "sim.case.scenario.sha256",
    "Scenario SHA-256",
    simulationCase.scenario.sha256,
  );
  p("sim.case.parameterMode", "Parameter mode", simulationCase.parameterMode);
  p("sim.case.timeoutMs", "Timeout (ms)", simulationCase.timeoutMs);

  p(
    "sim.case.parameters.count",
    "Parameter count",
    simulationCase.parameters.length,
  );
  for (const [i, param] of simulationCase.parameters.entries()) {
    p(`sim.case.parameters.${i}.id`, `Parameter ${i} ID`, param.id);
    p(`sim.case.parameters.${i}.value`, `Parameter ${i} value`, param.value);
    p(`sim.case.parameters.${i}.unit`, `Parameter ${i} unit`, param.unit);
  }

  p(
    "sim.case.expectedMetrics.count",
    "Expected metric count",
    simulationCase.expectedMetrics.length,
  );
  for (const [i, metric] of simulationCase.expectedMetrics.entries()) {
    p(
      `sim.case.expectedMetrics.${i}.id`,
      `Expected metric ${i} ID`,
      metric.id,
    );
    p(
      `sim.case.expectedMetrics.${i}.unit`,
      `Expected metric ${i} unit`,
      metric.unit,
    );
  }

  return params;
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse a flat map of MRTR-reviewed decision parameters back into the typed
 * SimulationCaseDecisionParameters.
 *
 * Fail-closed: any unexpected or missing key throws SimulationCaseProposalError.
 * The executor must call this before acting on the case identity.  The count
 * keys are read first to determine array lengths; the expected key set is then
 * built from those lengths so that surplus or missing index keys are detected
 * reliably.
 */
export function parseSimulationCaseDecisionParameters(
  params: ReadonlyMap<string, string | number | boolean>,
): SimulationCaseDecisionParameters {
  const caseDigest = requireStringParam(
    params,
    "sim.case.digest",
    FINGERPRINT_RE,
    "sim.case.digest must be a 64-char lowercase hex SHA-256",
  );
  const schemaVersion = requireStringParam(
    params,
    "sim.case.schemaVersion",
    /^simulation-case\/1\.0$/,
    "sim.case.schemaVersion must be simulation-case/1.0",
  );
  const id = requireStringParam(
    params,
    "sim.case.id",
    NON_EMPTY_RE,
    "sim.case.id must be non-empty",
  );
  const revision = requirePositiveIntParam(params, "sim.case.revision");
  const scope = requireStringParam(
    params,
    "sim.case.scope",
    NON_EMPTY_RE,
    "sim.case.scope must be non-empty",
  );
  const evidenceBoundary = requireStringParam(
    params,
    "sim.case.evidenceBoundary",
    NON_EMPTY_RE,
    "sim.case.evidenceBoundary must be non-empty",
  );
  const reviewBasisSnapshotId = requireStringParam(
    params,
    "sim.case.reviewBasis.snapshotId",
    NON_EMPTY_RE,
    "sim.case.reviewBasis.snapshotId must be non-empty",
  );
  const reviewBasisRevision = requirePositiveIntParam(
    params,
    "sim.case.reviewBasis.revision",
  );
  const kitModelId = requireStringParam(
    params,
    "sim.case.kit.modelId",
    NON_EMPTY_RE,
    "sim.case.kit.modelId must be non-empty",
  );
  const kitModelVersion = requireStringParam(
    params,
    "sim.case.kit.modelVersion",
    NON_EMPTY_RE,
    "sim.case.kit.modelVersion must be non-empty",
  );
  const kitModelSha256 = requireStringParam(
    params,
    "sim.case.kit.modelSha256",
    FINGERPRINT_RE,
    "sim.case.kit.modelSha256 must be a 64-char lowercase hex SHA-256",
  );
  const scenarioId = requireStringParam(
    params,
    "sim.case.scenario.id",
    NON_EMPTY_RE,
    "sim.case.scenario.id must be non-empty",
  );
  const scenarioSha256 = requireStringParam(
    params,
    "sim.case.scenario.sha256",
    FINGERPRINT_RE,
    "sim.case.scenario.sha256 must be a 64-char lowercase hex SHA-256",
  );
  const parameterMode = requireStringParam(
    params,
    "sim.case.parameterMode",
    /^explicit-overrides$/,
    `sim.case.parameterMode must be "explicit-overrides"`,
  ) as "explicit-overrides";
  const timeoutMs = requirePositiveIntParam(params, "sim.case.timeoutMs");
  if (timeoutMs > 120_000) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      `sim.case.timeoutMs must not exceed 120000 (got: ${timeoutMs})`,
    );
  }

  const parameterCount = requireNonNegativeIntParam(
    params,
    "sim.case.parameters.count",
  );
  const parameters: Array<{ id: string; value: number; unit: string }> = [];
  for (let i = 0; i < parameterCount; i++) {
    const paramId = requireStringParam(
      params,
      `sim.case.parameters.${i}.id`,
      NON_EMPTY_RE,
      `sim.case.parameters.${i}.id must be non-empty`,
    );
    const paramValue = requireFiniteNumberParam(
      params,
      `sim.case.parameters.${i}.value`,
    );
    const paramUnit = requireStringParam(
      params,
      `sim.case.parameters.${i}.unit`,
      NON_EMPTY_RE,
      `sim.case.parameters.${i}.unit must be non-empty`,
    );
    parameters.push({ id: paramId, value: paramValue, unit: paramUnit });
  }

  const expectedMetricCount = requirePositiveIntParam(
    params,
    "sim.case.expectedMetrics.count",
  );
  const expectedMetrics: Array<{ id: string; unit: string }> = [];
  for (let i = 0; i < expectedMetricCount; i++) {
    const metricId = requireStringParam(
      params,
      `sim.case.expectedMetrics.${i}.id`,
      NON_EMPTY_RE,
      `sim.case.expectedMetrics.${i}.id must be non-empty`,
    );
    const metricUnit = requireStringParam(
      params,
      `sim.case.expectedMetrics.${i}.unit`,
      NON_EMPTY_RE,
      `sim.case.expectedMetrics.${i}.unit must be non-empty`,
    );
    expectedMetrics.push({ id: metricId, unit: metricUnit });
  }

  // Fail-closed: reject any key not in the expected set.
  const expectedKeys = buildExpectedKeys(parameterCount, expectedMetricCount);
  for (const key of params.keys()) {
    if (!expectedKeys.has(key)) {
      throw new SimulationCaseProposalError(
        "unexpected_parameter",
        `Unexpected simulation case decision parameter: ${key}`,
      );
    }
  }

  return {
    caseDigest,
    schemaVersion,
    id,
    revision,
    scope,
    evidenceBoundary,
    reviewBasis: {
      snapshotId: reviewBasisSnapshotId,
      revision: reviewBasisRevision,
    },
    kit: {
      modelId: kitModelId,
      modelVersion: kitModelVersion,
      modelSha256: kitModelSha256,
    },
    scenario: { id: scenarioId, sha256: scenarioSha256 },
    parameterMode,
    timeoutMs,
    parameters,
    expectedMetrics,
  };
}

// ── Verify ───────────────────────────────────────────────────────────────────

/**
 * Verify that every field of the parsed decision parameters matches the
 * SimulationCase they claim to represent.
 *
 * WHY A SEPARATE STEP — parse checks grammar; this step checks identity against
 * the live SimulationCase object.  Combining them would mix syntax and semantic
 * concerns and make it impossible to test them independently.  The executor
 * calls parse first, then verify against the case re-read from the CAS store.
 *
 * Any divergence throws SimulationCaseProposalError with code
 * "verification_mismatch", naming the diverging field.
 */
export function verifySimulationCaseParametersMatchCase(
  params: SimulationCaseDecisionParameters,
  simulationCase: SimulationCase,
): void {
  assertMatch(params.schemaVersion, simulationCase.schemaVersion, "schemaVersion");
  assertMatch(params.id, simulationCase.id, "id");
  assertMatch(params.revision, simulationCase.revision, "revision");
  assertMatch(params.scope, simulationCase.scope, "scope");
  assertMatch(
    params.evidenceBoundary,
    simulationCase.evidenceBoundary,
    "evidenceBoundary",
  );
  assertMatch(
    params.reviewBasis.snapshotId,
    simulationCase.project.baseThreadSnapshot.id,
    "reviewBasis.snapshotId",
  );
  assertMatch(
    params.reviewBasis.revision,
    simulationCase.project.baseThreadSnapshot.revision,
    "reviewBasis.revision",
  );
  assertMatch(params.kit.modelId, simulationCase.kit.modelId, "kit.modelId");
  assertMatch(
    params.kit.modelVersion,
    simulationCase.kit.modelVersion,
    "kit.modelVersion",
  );
  assertMatch(
    params.kit.modelSha256,
    simulationCase.kit.modelSha256,
    "kit.modelSha256",
  );
  assertMatch(params.scenario.id, simulationCase.scenario.id, "scenario.id");
  assertMatch(
    params.scenario.sha256,
    simulationCase.scenario.sha256,
    "scenario.sha256",
  );
  assertMatch(params.parameterMode, simulationCase.parameterMode, "parameterMode");
  assertMatch(params.timeoutMs, simulationCase.timeoutMs, "timeoutMs");
  assertMatch(
    params.parameters.length,
    simulationCase.parameters.length,
    "parameters.count",
  );
  for (let i = 0; i < params.parameters.length; i++) {
    assertMatch(
      params.parameters[i].id,
      simulationCase.parameters[i].id,
      `parameters.${i}.id`,
    );
    assertMatch(
      params.parameters[i].value,
      simulationCase.parameters[i].value,
      `parameters.${i}.value`,
    );
    assertMatch(
      params.parameters[i].unit,
      simulationCase.parameters[i].unit,
      `parameters.${i}.unit`,
    );
  }
  assertMatch(
    params.expectedMetrics.length,
    simulationCase.expectedMetrics.length,
    "expectedMetrics.count",
  );
  for (let i = 0; i < params.expectedMetrics.length; i++) {
    assertMatch(
      params.expectedMetrics[i].id,
      simulationCase.expectedMetrics[i].id,
      `expectedMetrics.${i}.id`,
    );
    assertMatch(
      params.expectedMetrics[i].unit,
      simulationCase.expectedMetrics[i].unit,
      `expectedMetrics.${i}.unit`,
    );
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

const FINGERPRINT_RE = /^[a-f0-9]{64}$/;
const NON_EMPTY_RE = /^.+$/s;

function requireStringParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
  pattern: RegExp,
  message: string,
): string {
  const value = params.get(key);
  if (value === undefined) {
    throw new SimulationCaseProposalError(
      "missing_parameter",
      `Missing parameter: ${key}`,
    );
  }
  const str = String(value);
  if (!pattern.test(str)) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      `${message} (got: ${str.slice(0, 64)})`,
    );
  }
  return str;
}

function requirePositiveIntParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = params.get(key);
  if (value === undefined) {
    throw new SimulationCaseProposalError(
      "missing_parameter",
      `Missing parameter: ${key}`,
    );
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      `${key} must be a positive integer (got: ${value})`,
    );
  }
  return n;
}

function requireNonNegativeIntParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = params.get(key);
  if (value === undefined) {
    throw new SimulationCaseProposalError(
      "missing_parameter",
      `Missing parameter: ${key}`,
    );
  }
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      `${key} must be a non-negative integer (got: ${value})`,
    );
  }
  return n;
}

function requireFiniteNumberParam(
  params: ReadonlyMap<string, string | number | boolean>,
  key: string,
): number {
  const value = params.get(key);
  if (value === undefined) {
    throw new SimulationCaseProposalError(
      "missing_parameter",
      `Missing parameter: ${key}`,
    );
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new SimulationCaseProposalError(
      "invalid_format",
      `${key} must be a finite number (got: ${value})`,
    );
  }
  return n;
}

function buildExpectedKeys(
  parameterCount: number,
  expectedMetricCount: number,
): Set<string> {
  const keys = new Set<string>([
    "sim.case.digest",
    "sim.case.schemaVersion",
    "sim.case.id",
    "sim.case.revision",
    "sim.case.scope",
    "sim.case.evidenceBoundary",
    "sim.case.reviewBasis.snapshotId",
    "sim.case.reviewBasis.revision",
    "sim.case.kit.modelId",
    "sim.case.kit.modelVersion",
    "sim.case.kit.modelSha256",
    "sim.case.scenario.id",
    "sim.case.scenario.sha256",
    "sim.case.parameterMode",
    "sim.case.timeoutMs",
    "sim.case.parameters.count",
    "sim.case.expectedMetrics.count",
  ]);
  for (let i = 0; i < parameterCount; i++) {
    keys.add(`sim.case.parameters.${i}.id`);
    keys.add(`sim.case.parameters.${i}.value`);
    keys.add(`sim.case.parameters.${i}.unit`);
  }
  for (let i = 0; i < expectedMetricCount; i++) {
    keys.add(`sim.case.expectedMetrics.${i}.id`);
    keys.add(`sim.case.expectedMetrics.${i}.unit`);
  }
  return keys;
}

function assertMatch(actual: unknown, expected: unknown, field: string): void {
  if (actual !== expected) {
    throw new SimulationCaseProposalError(
      "verification_mismatch",
      `Field "${field}" diverges: parameters carry ${JSON.stringify(actual)} ` +
        `but the simulation case holds ${JSON.stringify(expected)}.`,
    );
  }
}
