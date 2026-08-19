/**
 * Closed successor declaration for a qualified Modelica simulation case.
 *
 * V1 retained only the public scenario-projection hash.  V2 makes the two
 * different provider facts explicit: the exact native scenario source and
 * the canonical public projection derived from it.  A qualified run can now
 * prove both facts independently instead of treating a projection as source
 * provenance.
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
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { SimulationCaseThreadSnapshot } from "./simulation-case.ts";

export const SIMULATION_CASE_V2_SCHEMA = "simulation-case/2.0" as const;

export interface SimulationCaseV2 {
  readonly schemaVersion: typeof SIMULATION_CASE_V2_SCHEMA;
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
    /** SHA-256 of exact native provider scenario bytes. */
    readonly sourceSha256: string;
    /** SHA-256 of exact canonical public scenario projection bytes. */
    readonly projectionSha256: string;
  };
  readonly parameters: readonly SimulationCaseV2Parameter[];
  readonly expectedMetrics: readonly SimulationCaseV2ExpectedMetric[];
  readonly parameterMode: "explicit-overrides";
  readonly timeoutMs: number;
}

export interface SimulationCaseV2Parameter {
  readonly id: string;
  readonly value: number;
  readonly unit: string;
}

export interface SimulationCaseV2ExpectedMetric {
  readonly id: string;
  readonly unit: string;
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

/** Validate and canonicalize an untrusted V2 declaration. */
export function validateSimulationCaseV2(value: unknown): SimulationCaseV2 {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(root.schemaVersion, SIMULATION_CASE_V2_SCHEMA, "$case.schemaVersion");

  const projectInput = exactRecord(
    root.project,
    ["id", "subjectId", "baseThreadSnapshot"],
    "$case.project",
  );
  const project = {
    id: safeId(projectInput.id, "$case.project.id"),
    subjectId: safeId(projectInput.subjectId, "$case.project.subjectId"),
    baseThreadSnapshot: threadSnapshotRef(
      projectInput.baseThreadSnapshot,
      "$case.project.baseThreadSnapshot",
    ),
  };
  if (project.baseThreadSnapshot.subjectId !== project.subjectId) {
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
    ["id", "sourceSha256", "projectionSha256"],
    "$case.scenario",
  );
  const scenario = {
    id: safeId(scenarioInput.id, "$case.scenario.id"),
    sourceSha256: sha256Hex(
      scenarioInput.sourceSha256,
      "$case.scenario.sourceSha256",
    ),
    projectionSha256: sha256Hex(
      scenarioInput.projectionSha256,
      "$case.scenario.projectionSha256",
    ),
  };

  const rawParameters = arrayOf(root.parameters, "$case.parameters").map(
    (item, index) => parameter(item, `$case.parameters[${index}]`),
  );
  rejectDuplicates(rawParameters.map((item) => item.id), "$case.parameters ids");
  const parameters = [...rawParameters].sort(compareById);

  const rawMetrics = nonEmptyArray(root.expectedMetrics, "$case.expectedMetrics").map(
    (item, index) => metric(item, `$case.expectedMetrics[${index}]`),
  );
  rejectDuplicates(rawMetrics.map((item) => item.id), "$case.expectedMetrics ids");
  const expectedMetrics = [...rawMetrics].sort(compareById);

  literalValue(root.parameterMode, "explicit-overrides", "$case.parameterMode");
  const timeoutMs = timeout(root.timeoutMs, "$case.timeoutMs");
  return deepFreeze({
    schemaVersion: SIMULATION_CASE_V2_SCHEMA,
    id: safeId(root.id, "$case.id"),
    revision: positiveInteger(root.revision, "$case.revision"),
    scope: nonEmptyText(root.scope, "$case.scope"),
    evidenceBoundary: nonEmptyText(root.evidenceBoundary, "$case.evidenceBoundary"),
    project,
    kit,
    scenario,
    parameters,
    expectedMetrics,
    parameterMode: "explicit-overrides",
    timeoutMs,
  });
}

/** The sole CAS text representation of a validated V2 case. */
export function canonicalSimulationCaseV2Text(
  simulationCase: SimulationCaseV2,
): string {
  return deterministicJson(simulationCase);
}

function threadSnapshotRef(value: unknown, path: string): SimulationCaseThreadSnapshot {
  const input = exactRecord(value, ["id", "revision", "subjectId"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    revision: positiveInteger(input.revision, `${path}.revision`),
    subjectId: safeId(input.subjectId, `${path}.subjectId`),
  };
}

function parameter(value: unknown, path: string): SimulationCaseV2Parameter {
  const input = exactRecord(value, ["id", "value", "unit"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    value: finite(input.value, `${path}.value`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

function metric(value: unknown, path: string): SimulationCaseV2ExpectedMetric {
  const input = exactRecord(value, ["id", "unit"], path);
  return {
    id: safeId(input.id, `${path}.id`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  };
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be a lowercase hex SHA-256 digest.`);
  }
  return digest;
}

function timeout(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 120_000) {
    throw new TypeError(`${path} must be an integer between 1 and 120000.`);
  }
  return Number(value);
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
