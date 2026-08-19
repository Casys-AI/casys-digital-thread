import { assertEquals, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import {
  canonicalSimulationCaseV2Text,
  SIMULATION_CASE_V2_SCHEMA,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";

function caseInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/2.0",
    id: "thermal-system-nominal-v2",
    revision: 1,
    scope: "Neutral thermal-system contract fixture.",
    evidenceBoundary: "Schema and canonicalization only; no provider run is asserted.",
    project: {
      id: "thermal-system-project",
      subjectId: "project:thermal-system",
      baseThreadSnapshot: {
        id: "project:thermal-system:r3",
        revision: 3,
        subjectId: "project:thermal-system",
      },
    },
    kit: {
      modelId: "thermal-system-model",
      modelVersion: "1.0.0",
      modelSha256: "a".repeat(64),
    },
    scenario: {
      id: "nominal-heating",
      sourceSha256: "b".repeat(64),
      projectionSha256: "c".repeat(64),
    },
    parameters: [
      { id: "targetTemperature", value: 333.15, unit: "K" },
      { id: "ambientTemperature", value: 293.15, unit: "K" },
    ],
    expectedMetrics: [
      { id: "settlingTime", unit: "s" },
      { id: "peakTemperature", unit: "K" },
    ],
    parameterMode: "explicit-overrides",
    timeoutMs: 15_000,
  };
}

Deno.test("simulation-case/2.0 retains separate exact source and projection identities", async () => {
  const simulationCase = validateSimulationCaseV2(caseInput());
  assertEquals(simulationCase.schemaVersion, SIMULATION_CASE_V2_SCHEMA);
  assertEquals(simulationCase.revision, 1);
  assertEquals(simulationCase.kit.modelSha256, "a".repeat(64));
  assertEquals(simulationCase.scenario.sourceSha256, "b".repeat(64));
  assertEquals(simulationCase.scenario.projectionSha256, "c".repeat(64));
  assertEquals(
    await fingerprintResourceBytes(
      new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
    ),
    "065187be150c4a05b176314e9614d5abce21dd1eda092bc2eddf8408d33e6966",
  );
});

Deno.test("simulation-case/2.0 rejects the V1 single scenario hash field", () => {
  const source = caseInput();
  const scenario = source.scenario as Record<string, unknown>;
  source.scenario = {
    id: scenario.id,
    sha256: scenario.projectionSha256,
  };
  assertThrows(
    () => validateSimulationCaseV2(source),
    TypeError,
    "$case.scenario has unsupported field sha256",
  );
});

Deno.test("simulation-case/2.0 canonical ordering uses code units rather than host locale", () => {
  const source = caseInput();
  source.parameters = [
    { id: "zeta", value: 1, unit: "1" },
    { id: "alpha", value: 1, unit: "1" },
  ];
  source.expectedMetrics = [
    { id: "zeta_metric", unit: "1" },
    { id: "alpha_metric", unit: "1" },
  ];
  const simulationCase = validateSimulationCaseV2(source);
  assertEquals(simulationCase.parameters.map((item) => item.id), ["alpha", "zeta"]);
  assertEquals(simulationCase.expectedMetrics.map((item) => item.id), [
    "alpha_metric",
    "zeta_metric",
  ]);
});
