/**
 * Tests for simulation-case-proposal.ts.
 *
 * Invariants under test:
 *  - encode → toMap → parse is a symmetry: every field round-trips exactly.
 *  - verifySimulationCaseParametersMatchCase passes on an exact match and
 *    throws "verification_mismatch" on any diverging field.
 *  - simulationCaseDecisionParametersToMap throws "duplicate_parameter"
 *    before the duplicate can silently replace a signed value.
 *  - parseSimulationCaseDecisionParameters throws "unexpected_parameter" on
 *    any key not expected by the grammar.
 *  - parseSimulationCaseDecisionParameters throws "missing_parameter" when a
 *    required key is absent from the map.
 *  - The grammar rejects timeoutMs > 120000, parameterMode ≠ "explicit-overrides",
 *    and expectedMetrics.count = 0.
 *  - Parameters count = 0 is valid (no overrides).
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeSimulationCaseDecisionParameters,
  parseSimulationCaseDecisionParameters,
  SIMULATE_RUN_MODELICA_SCENARIO_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_OPERATION,
  type SimulationCaseDecisionParameters,
  simulationCaseDecisionParametersToMap,
  SimulationCaseProposalError,
  verifySimulationCaseParametersMatchCase,
} from "./simulation-case-proposal.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const CASE_DIGEST = "c".repeat(64);

/**
 * A well-formed SimulationCase object built from the design spec.
 * Cast through `unknown` so the test file does not carry a direct
 * `import type { SimulationCase } from "./simulation-case.ts"` — the
 * compile-time dependency is already satisfied by the module under test.
 */
// deno-lint-ignore no-explicit-any
const FAKE_CASE: any = {
  schemaVersion: "simulation-case/1.0",
  id: "thermal-test-case-1",
  revision: 3,
  scope: "nominal heating cycle",
  evidenceBoundary: "cm01-v3-thermal-evidence",
  project: {
    id: "coffee-machine-cm01",
    subjectId: "cm01-subject",
    baseThreadSnapshot: {
      id: "thread-snapshot-01",
      revision: 7,
      subjectId: "cm01-subject",
    },
  },
  kit: {
    modelId: "thermal-coffee-machine",
    modelVersion: "1.2.0",
    modelSha256: DIGEST_A,
  },
  scenario: {
    id: "nominal-heating",
    sha256: DIGEST_B,
  },
  parameters: [
    { id: "ambientTemp_K", value: 293.15, unit: "K" },
    { id: "heatingPower_W", value: 1200, unit: "W" },
  ],
  expectedMetrics: [
    { id: "energy_consumed", unit: "J" },
    { id: "water_temperature_max", unit: "degC" },
  ],
  parameterMode: "explicit-overrides",
  timeoutMs: 60000,
};

// ── Operation constants ───────────────────────────────────────────────────────

Deno.test("SIMULATE_SEAL_SIMULATION_CASE_OPERATION carries stable id and version", () => {
  assertEquals(
    SIMULATE_SEAL_SIMULATION_CASE_OPERATION.id,
    "simulate.seal-simulation-case",
  );
  assertEquals(SIMULATE_SEAL_SIMULATION_CASE_OPERATION.version, "1");
});

Deno.test("SIMULATE_RUN_MODELICA_SCENARIO_OPERATION carries stable id and version", () => {
  assertEquals(
    SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.id,
    "simulate.run-modelica-scenario",
  );
  assertEquals(SIMULATE_RUN_MODELICA_SCENARIO_OPERATION.version, "1");
});

// ── Symmetry: encode → toMap → parse ─────────────────────────────────────────

Deno.test("encode → toMap → parse round-trips every scalar field exactly", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const paramMap = simulationCaseDecisionParametersToMap(paramList);
  const parsed = parseSimulationCaseDecisionParameters(paramMap);

  assertEquals(parsed.caseDigest, CASE_DIGEST);
  assertEquals(parsed.schemaVersion, "simulation-case/1.0");
  assertEquals(parsed.id, "thermal-test-case-1");
  assertEquals(parsed.revision, 3);
  assertEquals(parsed.scope, "nominal heating cycle");
  assertEquals(parsed.evidenceBoundary, "cm01-v3-thermal-evidence");
  assertEquals(parsed.reviewBasis.snapshotId, "thread-snapshot-01");
  assertEquals(parsed.reviewBasis.revision, 7);
  assertEquals(parsed.kit.modelId, "thermal-coffee-machine");
  assertEquals(parsed.kit.modelVersion, "1.2.0");
  assertEquals(parsed.kit.modelSha256, DIGEST_A);
  assertEquals(parsed.scenario.id, "nominal-heating");
  assertEquals(parsed.scenario.sha256, DIGEST_B);
  assertEquals(parsed.parameterMode, "explicit-overrides");
  assertEquals(parsed.timeoutMs, 60000);
});

Deno.test("encode → toMap → parse round-trips parameters array exactly", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );

  assertEquals(parsed.parameters.length, 2);
  assertEquals(parsed.parameters[0].id, "ambientTemp_K");
  assertEquals(parsed.parameters[0].value, 293.15);
  assertEquals(parsed.parameters[0].unit, "K");
  assertEquals(parsed.parameters[1].id, "heatingPower_W");
  assertEquals(parsed.parameters[1].value, 1200);
  assertEquals(parsed.parameters[1].unit, "W");
});

Deno.test("encode → toMap → parse round-trips expectedMetrics array exactly", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );

  assertEquals(parsed.expectedMetrics.length, 2);
  assertEquals(parsed.expectedMetrics[0].id, "energy_consumed");
  assertEquals(parsed.expectedMetrics[0].unit, "J");
  assertEquals(parsed.expectedMetrics[1].id, "water_temperature_max");
  assertEquals(parsed.expectedMetrics[1].unit, "degC");
});

Deno.test("encode → toMap → parse with zero parameters produces empty parameters array", () => {
  const noParamCase = { ...FAKE_CASE, parameters: [] };
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    noParamCase,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  assertEquals(parsed.parameters.length, 0);
  assertEquals(parsed.expectedMetrics.length, 2);
});

// ── verifySimulationCaseParametersMatchCase ───────────────────────────────────

Deno.test("verifySimulationCaseParametersMatchCase passes on exact identity match", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  // Should not throw — parsed is a faithful encoding of FAKE_CASE.
  verifySimulationCaseParametersMatchCase(parsed, FAKE_CASE);
});

Deno.test("verifySimulationCaseParametersMatchCase rejects diverging id", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  const altCase = { ...FAKE_CASE, id: "other-case-id" };
  // code property carries the machine-readable error code.
  const err = assertThrows(
    () => verifySimulationCaseParametersMatchCase(parsed, altCase),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "verification_mismatch");
  // The error message names the diverging field.
  assertThrows(
    () => verifySimulationCaseParametersMatchCase(parsed, altCase),
    SimulationCaseProposalError,
    '"id"',
  );
});

Deno.test("verifySimulationCaseParametersMatchCase rejects diverging revision", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  const altCase = { ...FAKE_CASE, revision: 99 };
  const err = assertThrows(
    () => verifySimulationCaseParametersMatchCase(parsed, altCase),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "verification_mismatch");
});

Deno.test("verifySimulationCaseParametersMatchCase rejects diverging parameter value", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  const altCase = {
    ...FAKE_CASE,
    parameters: [
      { id: "ambientTemp_K", value: 300, unit: "K" },
      { id: "heatingPower_W", value: 1200, unit: "W" },
    ],
  };
  const err = assertThrows(
    () => verifySimulationCaseParametersMatchCase(parsed, altCase),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "verification_mismatch");
});

Deno.test("verifySimulationCaseParametersMatchCase rejects diverging expectedMetric unit", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed = parseSimulationCaseDecisionParameters(
    simulationCaseDecisionParametersToMap(paramList),
  );
  const altCase = {
    ...FAKE_CASE,
    expectedMetrics: [
      { id: "energy_consumed", unit: "kJ" }, // unit changed
      { id: "water_temperature_max", unit: "degC" },
    ],
  };
  const err = assertThrows(
    () => verifySimulationCaseParametersMatchCase(parsed, altCase),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "verification_mismatch");
});

// ── simulationCaseDecisionParametersToMap ─────────────────────────────────────

Deno.test("simulationCaseDecisionParametersToMap rejects duplicate key", () => {
  const params = [
    { key: "sim.case.id", value: "case-a" },
    { key: "sim.case.id", value: "case-b" },
  ];
  const err = assertThrows(
    () => simulationCaseDecisionParametersToMap(params),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "duplicate_parameter");
});

Deno.test("simulationCaseDecisionParametersToMap rejects duplicate keeping first value invisible", () => {
  // Ensures the guard fires even when the duplicate would silently overwrite.
  const params = [
    { key: "sim.case.kit.modelSha256", value: DIGEST_A },
    { key: "sim.case.kit.modelSha256", value: DIGEST_B },
  ];
  const err = assertThrows(
    () => simulationCaseDecisionParametersToMap(params),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "duplicate_parameter");
});

// ── parseSimulationCaseDecisionParameters — rejections ────────────────────────

Deno.test("parseSimulationCaseDecisionParameters rejects unexpected parameter key", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const asArray = Array.from(
    simulationCaseDecisionParametersToMap(paramList).entries(),
  ).map(([key, value]) => ({ key, value }));
  asArray.push({ key: "sim.case.intruder", value: "evil" });
  const withExtra = new Map(asArray.map((e) => [e.key, e.value]));
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(withExtra),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "unexpected_parameter");
});

Deno.test("parseSimulationCaseDecisionParameters rejects missing sim.case.digest", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const paramMap = new Map(simulationCaseDecisionParametersToMap(paramList));
  paramMap.delete("sim.case.digest");
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "missing_parameter");
});

Deno.test("parseSimulationCaseDecisionParameters rejects missing sim.case.kit.modelSha256", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const paramMap = new Map(simulationCaseDecisionParametersToMap(paramList));
  paramMap.delete("sim.case.kit.modelSha256");
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "missing_parameter");
});

Deno.test("parseSimulationCaseDecisionParameters rejects timeoutMs exceeding 120000", () => {
  const overLimit = { ...FAKE_CASE, timeoutMs: 120001 };
  const paramList = encodeSimulationCaseDecisionParameters(CASE_DIGEST, overLimit);
  const paramMap = simulationCaseDecisionParametersToMap(paramList);
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "invalid_format");
});

Deno.test("parseSimulationCaseDecisionParameters rejects parameterMode other than explicit-overrides", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const paramMap = new Map(simulationCaseDecisionParametersToMap(paramList));
  paramMap.set("sim.case.parameterMode", "implicit");
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "invalid_format");
});

Deno.test("parseSimulationCaseDecisionParameters rejects expectedMetrics.count = 0", () => {
  const zeroMetricsCase = { ...FAKE_CASE, expectedMetrics: [] };
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    zeroMetricsCase,
  );
  const paramMap = simulationCaseDecisionParametersToMap(paramList);
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "invalid_format");
});

Deno.test("parseSimulationCaseDecisionParameters rejects non-hex digest for sim.case.digest", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const paramMap = new Map(simulationCaseDecisionParametersToMap(paramList));
  paramMap.set("sim.case.digest", "not-a-valid-sha256");
  const err = assertThrows(
    () => parseSimulationCaseDecisionParameters(paramMap),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "invalid_format");
});

Deno.test("encodeSimulationCaseDecisionParameters rejects non-hex caseDigest", () => {
  const err = assertThrows(
    () => encodeSimulationCaseDecisionParameters("not-a-valid-digest", FAKE_CASE),
    SimulationCaseProposalError,
  );
  assertEquals(err.code, "invalid_format");
});

// ── Cross-field round-trip: reviewBasis maps to project.baseThreadSnapshot ───

Deno.test("reviewBasis.snapshotId encodes project.baseThreadSnapshot.id", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const found = paramList.find(
    (p) => p.key === "sim.case.reviewBasis.snapshotId",
  );
  assertEquals(found?.value, "thread-snapshot-01");
});

Deno.test("reviewBasis.revision encodes project.baseThreadSnapshot.revision", () => {
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const found = paramList.find(
    (p) => p.key === "sim.case.reviewBasis.revision",
  );
  assertEquals(found?.value, 7);
});

// ── SimulationCaseDecisionParameters type is exported ────────────────────────

Deno.test("SimulationCaseDecisionParameters type can be referenced by callers", () => {
  // Structural check only — the type must be exported and assignable.
  const paramList = encodeSimulationCaseDecisionParameters(
    CASE_DIGEST,
    FAKE_CASE,
  );
  const parsed: SimulationCaseDecisionParameters =
    parseSimulationCaseDecisionParameters(
      simulationCaseDecisionParametersToMap(paramList),
    );
  assertEquals(typeof parsed.caseDigest, "string");
});
