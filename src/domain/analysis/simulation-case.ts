/**
 * Strict declaration of a Modelica simulation case.
 *
 * WHY THIS MODULE EXISTS — the simulation executor needs a schema-versioned,
 * content-addressed authority that records exactly which kit, scenario,
 * parameters and expected metrics are approved for a run. Validation here
 * establishes declaration shape and internal consistency only. It does not
 * prove that the kit was reachable, the scenario executed, any provider was
 * called, or any result exists. The canonical text is the sealing surface;
 * caseDigest (sha256 of that text) is a business property, never an address.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";

export const SIMULATION_CASE_SCHEMA = "simulation-case/1.0" as const;

/**
 * Exact thread-snapshot reference carried by the simulation case.
 * Exported so adapters can construct bindings without importing the full case.
 */
export interface SimulationCaseThreadSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly subjectId: string;
}

/** A single override applied to a kit parameter. Values are finite reals. */
export interface SimulationParameter {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
}

/** A metric the run must produce with the declared unit. */
export interface ExpectedMetric {
  readonly id: string;
  readonly unit: string;
}

/**
 * Approved declaration for a single Modelica simulation run.
 * parameters and expectedMetrics are always sorted by id (ascending) so the
 * canonical text is deterministic regardless of the order the author supplied.
 */
export interface SimulationCase {
  readonly schemaVersion: typeof SIMULATION_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
    readonly baseThreadSnapshot: SimulationCaseThreadSnapshot;
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
  /** Sorted ascending by id. All ids are unique. All values are finite. */
  readonly parameters: readonly SimulationParameter[];
  /** Sorted ascending by id. Non-empty. All ids are unique. */
  readonly expectedMetrics: readonly ExpectedMetric[];
  /** Only value defined by schema version 1.0. */
  readonly parameterMode: "explicit-overrides";
  /** Integer in [1, 120000] ms. */
  readonly timeoutMs: number;
}

const SHA256_HEX = /^[a-f0-9]{64}$/;

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "kit",
  "scenario",
  "parameters",
  "expectedMetrics",
  "parameterMode",
  "timeoutMs",
] as const;

/**
 * Validate untrusted JSON and return an immutable, sorted simulation case.
 * Throws TypeError on any structural or semantic violation — fail-closed.
 * parameters and expectedMetrics are sorted by id before the object is frozen
 * so the canonical text is stable regardless of input order.
 */
export function validateSimulationCase(value: unknown): SimulationCase {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(root.schemaVersion, SIMULATION_CASE_SCHEMA, "$case.schemaVersion");

  const projectInput = exactRecord(
    root.project,
    ["id", "subjectId", "baseThreadSnapshot"],
    "$case.project",
  );
  const projectId = safeId(projectInput.id, "$case.project.id");
  const subjectId = safeId(projectInput.subjectId, "$case.project.subjectId");
  const baseThreadSnapshot = threadSnapshotRef(
    projectInput.baseThreadSnapshot,
    "$case.project.baseThreadSnapshot",
  );
  if (baseThreadSnapshot.subjectId !== subjectId) {
    throw new TypeError(
      "$case.project.baseThreadSnapshot.subjectId must equal $case.project.subjectId.",
    );
  }

  const kitInput = exactRecord(
    root.kit,
    ["modelId", "modelVersion", "modelSha256"],
    "$case.kit",
  );
  const kit = {
    modelId: safeId(kitInput.modelId, "$case.kit.modelId"),
    modelVersion: nonEmptyText(kitInput.modelVersion, "$case.kit.modelVersion"),
    modelSha256: sha256Hex(kitInput.modelSha256, "$case.kit.modelSha256"),
  };

  const scenarioInput = exactRecord(
    root.scenario,
    ["id", "sha256"],
    "$case.scenario",
  );
  const scenario = {
    id: safeId(scenarioInput.id, "$case.scenario.id"),
    sha256: sha256Hex(scenarioInput.sha256, "$case.scenario.sha256"),
  };

  const rawParameters = arrayOf(root.parameters, "$case.parameters").map(
    (item, index) => simulationParameter(item, `$case.parameters[${index}]`),
  );
  rejectDuplicates(rawParameters.map((p) => p.id), "$case.parameters ids");
  const parameters = [...rawParameters].sort((a, b) => a.id.localeCompare(b.id));

  const rawMetrics = nonEmptyArray(
    root.expectedMetrics,
    "$case.expectedMetrics",
  ).map((item, index) => expectedMetric(item, `$case.expectedMetrics[${index}]`));
  rejectDuplicates(rawMetrics.map((m) => m.id), "$case.expectedMetrics ids");
  const expectedMetrics = [...rawMetrics].sort((a, b) => a.id.localeCompare(b.id));

  literalValue(root.parameterMode, "explicit-overrides", "$case.parameterMode");
  const timeoutMs = validTimeoutMs(root.timeoutMs, "$case.timeoutMs");

  return deepFreeze({
    schemaVersion: SIMULATION_CASE_SCHEMA,
    id: safeId(root.id, "$case.id"),
    revision: positiveInteger(root.revision, "$case.revision"),
    scope: nonEmptyText(root.scope, "$case.scope"),
    evidenceBoundary: nonEmptyText(
      root.evidenceBoundary,
      "$case.evidenceBoundary",
    ),
    project: { id: projectId, subjectId, baseThreadSnapshot },
    kit,
    scenario,
    parameters,
    expectedMetrics,
    parameterMode: "explicit-overrides",
    timeoutMs,
  });
}

/**
 * Produce the canonical serialised text for a validated simulation case.
 * The case must have been validated by validateSimulationCase first —
 * sorted arrays and frozen keys guarantee a stable output for hashing.
 */
export function canonicalSimulationCaseText(simulationCase: SimulationCase): string {
  return deterministicJson(simulationCase);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function threadSnapshotRef(
  value: unknown,
  path: string,
): SimulationCaseThreadSnapshot {
  const input = exactRecord(value, ["id", "revision", "subjectId"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
  };
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be a lowercase hex SHA-256 digest.`);
  }
  return digest;
}

function simulationParameter(value: unknown, path: string): SimulationParameter {
  const input = exactRecord(value, ["id", "value", "unit"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    value: finite(input.value, `${path}.value`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

function expectedMetric(value: unknown, path: string): ExpectedMetric {
  const input = exactRecord(value, ["id", "unit"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

/** timeoutMs must be a safe integer in [1, 120000]. */
function validTimeoutMs(value: unknown, path: string): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 1 ||
    Number(value) > 120_000
  ) {
    throw new TypeError(`${path} must be an integer between 1 and 120000.`);
  }
  return Number(value);
}
