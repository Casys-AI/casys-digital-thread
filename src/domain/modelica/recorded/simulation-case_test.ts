import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalSimulationCaseText,
  SIMULATION_CASE_SCHEMA,
  type SimulationCase,
  validateSimulationCase,
} from "./simulation-case.ts";

// ---------------------------------------------------------------------------
// Minimal valid fixture
// ---------------------------------------------------------------------------

const VALID_SHA256 = "a".repeat(64);
const SCENARIO_SHA256 = "b".repeat(64);

function validInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/1.0",
    id: "sim-thermal-cm01-v1",
    revision: 1,
    scope: "Thermal validation of the CM-01 heating circuit",
    evidenceBoundary:
      "Observations only — no verdict; thermal scenario results require independent constraint check.",
    project: {
      id: "coffee-machine-cm01",
      subjectId: "coffee-machine-cm01",
      baseThreadSnapshot: {
        id: "thread-coffee-machine-cm01-r5",
        revision: 5,
        subjectId: "coffee-machine-cm01",
      },
    },
    kit: {
      modelId: "cm01-thermal-heating",
      modelVersion: "1.0.0",
      modelSha256: VALID_SHA256,
    },
    scenario: {
      id: "nominal-90degC",
      sha256: SCENARIO_SHA256,
    },
    parameters: [
      { id: "initial_temperature_degC", value: 20.0, unit: "degC" },
      { id: "heater_power_W", value: 1500.0, unit: "W" },
    ],
    expectedMetrics: [
      { id: "water_temperature_max", unit: "degC" },
      { id: "time_to_90degC", unit: "s" },
    ],
    parameterMode: "explicit-overrides",
    timeoutMs: 60000,
  };
}

// ---------------------------------------------------------------------------
// Complete validation — happy path
// ---------------------------------------------------------------------------

Deno.test("SimulationCase accepts a complete well-formed declaration and returns an immutable frozen value", () => {
  const result = validateSimulationCase(validInput());

  assertEquals(result.schemaVersion, SIMULATION_CASE_SCHEMA);
  assertEquals(result.id, "sim-thermal-cm01-v1");
  assertEquals(result.revision, 1);
  assertEquals(result.project.id, "coffee-machine-cm01");
  assertEquals(result.project.subjectId, "coffee-machine-cm01");
  assertEquals(result.project.baseThreadSnapshot.revision, 5);
  assertEquals(result.kit.modelId, "cm01-thermal-heating");
  assertEquals(result.kit.modelSha256, VALID_SHA256);
  assertEquals(result.scenario.id, "nominal-90degC");
  assertEquals(result.scenario.sha256, SCENARIO_SHA256);
  assertEquals(result.parameters.length, 2);
  assertEquals(result.expectedMetrics.length, 2);
  assertEquals(result.parameterMode, "explicit-overrides");
  assertEquals(result.timeoutMs, 60000);
  assertEquals(Object.isFrozen(result), true);
  assertEquals(Object.isFrozen(result.project), true);
  assertEquals(Object.isFrozen(result.kit), true);
  assertEquals(Object.isFrozen(result.scenario), true);
  assertEquals(Object.isFrozen(result.parameters), true);
  assertEquals(Object.isFrozen(result.expectedMetrics), true);
});

// ---------------------------------------------------------------------------
// Schema version and root structure
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects a wrong schemaVersion", () => {
  const input = validInput();
  input.schemaVersion = "simulation-case/0.9";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    '$case.schemaVersion must equal "simulation-case/1.0"',
  );
});

Deno.test("SimulationCase rejects extra fields at root level", () => {
  const input = validInput();
  (input as Record<string, unknown>).extra = "injected";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case has unsupported field extra",
  );
});

Deno.test("SimulationCase rejects null at root level", () => {
  assertThrows(
    () => validateSimulationCase(null),
    TypeError,
    "$case must be an object",
  );
});

Deno.test("SimulationCase rejects a missing required root field", () => {
  const input = validInput();
  delete input["scope"];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.scope is required",
  );
});

// ---------------------------------------------------------------------------
// id, revision, scope, evidenceBoundary
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects an id that contains spaces", () => {
  const input = validInput();
  input.id = "bad id with spaces";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.id must be a stable identifier",
  );
});

Deno.test("SimulationCase rejects revision zero", () => {
  const input = validInput();
  input.revision = 0;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.revision must be a positive integer",
  );
});

Deno.test("SimulationCase rejects a blank scope", () => {
  const input = validInput();
  input.scope = "   ";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.scope must be a non-empty string",
  );
});

// ---------------------------------------------------------------------------
// project
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects baseThreadSnapshot subjectId mismatch", () => {
  const input = validInput();
  object(object(input.project).baseThreadSnapshot).subjectId = "other-subject";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.project.baseThreadSnapshot.subjectId must equal $case.project.subjectId",
  );
});

Deno.test("SimulationCase rejects a project with extra fields", () => {
  const input = validInput();
  object(input.project).extra = "injected";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.project has unsupported field extra",
  );
});

Deno.test("SimulationCase rejects a baseThreadSnapshot with revision zero", () => {
  const input = validInput();
  object(object(input.project).baseThreadSnapshot).revision = 0;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.project.baseThreadSnapshot.revision must be a positive integer",
  );
});

// ---------------------------------------------------------------------------
// kit
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects kit with invalid modelSha256 — wrong length", () => {
  const input = validInput();
  object(input.kit).modelSha256 = "a".repeat(63);
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.kit.modelSha256 must be a lowercase hex SHA-256 digest",
  );
});

Deno.test("SimulationCase rejects kit with uppercase modelSha256", () => {
  const input = validInput();
  object(input.kit).modelSha256 = "A".repeat(64);
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.kit.modelSha256 must be a lowercase hex SHA-256 digest",
  );
});

Deno.test("SimulationCase rejects kit with extra field", () => {
  const input = validInput();
  object(input.kit).extra = "injected";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.kit has unsupported field extra",
  );
});

// ---------------------------------------------------------------------------
// scenario
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects scenario with invalid sha256", () => {
  const input = validInput();
  object(input.scenario).sha256 = "not-a-hash";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.scenario.sha256 must be a lowercase hex SHA-256 digest",
  );
});

Deno.test("SimulationCase rejects scenario with extra field", () => {
  const input = validInput();
  object(input.scenario).extra = "injected";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.scenario has unsupported field extra",
  );
});

// ---------------------------------------------------------------------------
// parameters
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects duplicate parameter ids", () => {
  const input = validInput();
  input.parameters = [
    { id: "heater_power_W", value: 1500, unit: "W" },
    { id: "heater_power_W", value: 2000, unit: "W" },
  ];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.parameters ids must not contain duplicates",
  );
});

Deno.test("SimulationCase rejects a non-finite parameter value", () => {
  const input = validInput();
  input.parameters = [{ id: "heater_power_W", value: Infinity, unit: "W" }];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.parameters[0].value must be a finite number",
  );
});

Deno.test("SimulationCase rejects a parameter with an extra field", () => {
  const input = validInput();
  input.parameters = [
    { id: "heater_power_W", value: 1500, unit: "W", extra: "injected" },
  ];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.parameters[0] has unsupported field extra",
  );
});

Deno.test("SimulationCase rejects parameters that is not an array", () => {
  const input = validInput();
  input.parameters = "not-an-array";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.parameters must be an array",
  );
});

// empty parameters array is accepted — kit defaults apply
Deno.test("SimulationCase accepts an empty parameters array", () => {
  const input = validInput();
  input.parameters = [];
  const result = validateSimulationCase(input);
  assertEquals(result.parameters.length, 0);
});

// ---------------------------------------------------------------------------
// expectedMetrics
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects an empty expectedMetrics array", () => {
  const input = validInput();
  input.expectedMetrics = [];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.expectedMetrics must not be empty",
  );
});

Deno.test("SimulationCase rejects duplicate expectedMetric ids", () => {
  const input = validInput();
  input.expectedMetrics = [
    { id: "water_temperature_max", unit: "degC" },
    { id: "water_temperature_max", unit: "K" },
  ];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.expectedMetrics ids must not contain duplicates",
  );
});

Deno.test("SimulationCase rejects an expectedMetric with an extra field", () => {
  const input = validInput();
  input.expectedMetrics = [
    { id: "water_temperature_max", unit: "degC", extra: "injected" },
  ];
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.expectedMetrics[0] has unsupported field extra",
  );
});

// ---------------------------------------------------------------------------
// parameterMode
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects parameterMode other than explicit-overrides", () => {
  const input = validInput();
  input.parameterMode = "defaults";
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    '$case.parameterMode must equal "explicit-overrides"',
  );
});

// ---------------------------------------------------------------------------
// timeoutMs
// ---------------------------------------------------------------------------

Deno.test("SimulationCase rejects timeoutMs below 1", () => {
  const input = validInput();
  input.timeoutMs = 0;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.timeoutMs must be an integer between 1 and 120000",
  );
});

Deno.test("SimulationCase rejects timeoutMs above 120000", () => {
  const input = validInput();
  input.timeoutMs = 120001;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.timeoutMs must be an integer between 1 and 120000",
  );
});

Deno.test("SimulationCase rejects non-integer timeoutMs", () => {
  const input = validInput();
  input.timeoutMs = 60000.5;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.timeoutMs must be an integer between 1 and 120000",
  );
});

Deno.test("SimulationCase accepts timeoutMs at boundary values 1 and 120000", () => {
  const low = validInput();
  low.timeoutMs = 1;
  assertEquals(validateSimulationCase(low).timeoutMs, 1);

  const high = validInput();
  high.timeoutMs = 120000;
  assertEquals(validateSimulationCase(high).timeoutMs, 120000);
});

Deno.test("SimulationCase rejects NaN as timeoutMs", () => {
  const input = validInput();
  input.timeoutMs = NaN;
  assertThrows(
    () => validateSimulationCase(input),
    TypeError,
    "$case.timeoutMs must be an integer between 1 and 120000",
  );
});

// ---------------------------------------------------------------------------
// Sorting — parameters and expectedMetrics sorted ascending by id
// ---------------------------------------------------------------------------

Deno.test("parameters are sorted by id ascending regardless of input order", () => {
  const input = validInput();
  input.parameters = [
    { id: "z_param", value: 1.0, unit: "K" },
    { id: "a_param", value: 2.0, unit: "W" },
    { id: "m_param", value: 3.0, unit: "s" },
  ];
  const result = validateSimulationCase(input);
  assertEquals(
    result.parameters.map((p) => p.id),
    ["a_param", "m_param", "z_param"],
  );
});

Deno.test("expectedMetrics are sorted by id ascending regardless of input order", () => {
  const input = validInput();
  input.expectedMetrics = [
    { id: "z_metric", unit: "K" },
    { id: "a_metric", unit: "degC" },
    { id: "m_metric", unit: "s" },
  ];
  const result = validateSimulationCase(input);
  assertEquals(
    result.expectedMetrics.map((m) => m.id),
    ["a_metric", "m_metric", "z_metric"],
  );
});

// ---------------------------------------------------------------------------
// canonicalSimulationCaseText stability
// ---------------------------------------------------------------------------

Deno.test("canonicalSimulationCaseText is stable regardless of input parameter order", () => {
  const orderedInput = validInput();
  orderedInput.parameters = [
    { id: "a_param", value: 1.0, unit: "degC" },
    { id: "z_param", value: 2.0, unit: "W" },
  ];
  orderedInput.expectedMetrics = [
    { id: "a_metric", unit: "degC" },
    { id: "z_metric", unit: "s" },
  ];

  const reversedInput = validInput();
  reversedInput.parameters = [
    { id: "z_param", value: 2.0, unit: "W" },
    { id: "a_param", value: 1.0, unit: "degC" },
  ];
  reversedInput.expectedMetrics = [
    { id: "z_metric", unit: "s" },
    { id: "a_metric", unit: "degC" },
  ];

  const caseA = validateSimulationCase(orderedInput);
  const caseB = validateSimulationCase(reversedInput);

  const textA = canonicalSimulationCaseText(caseA);
  const textB = canonicalSimulationCaseText(caseB);

  assertEquals(textA, textB);
  assertEquals(typeof textA, "string");
  assertEquals(textA.length > 0, true);
});

Deno.test("canonicalSimulationCaseText contains the schemaVersion and id", () => {
  const result = validateSimulationCase(validInput());
  const text = canonicalSimulationCaseText(result);
  assertEquals(text.includes("simulation-case/1.0"), true);
  assertEquals(text.includes("sim-thermal-cm01-v1"), true);
});

Deno.test("canonicalSimulationCaseText differs for two cases with distinct timeoutMs", () => {
  const inputA = validInput();
  inputA.timeoutMs = 30000;
  const inputB = validInput();
  inputB.timeoutMs = 60000;

  const textA = canonicalSimulationCaseText(validateSimulationCase(inputA));
  const textB = canonicalSimulationCaseText(validateSimulationCase(inputB));

  assertEquals(textA === textB, false);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a plain object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

// Satisfy the TypeScript compiler: SimulationCase is referenced indirectly
// through validateSimulationCase — exported for adapter use.
const _typeCheck: SimulationCase = validateSimulationCase(validInput());
void _typeCheck;
