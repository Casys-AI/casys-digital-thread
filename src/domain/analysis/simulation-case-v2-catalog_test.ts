import { assertEquals, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "./provider-resource-reader.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";
import {
  assertCataloguedSimulationCaseV2,
  cataloguedSimulationCaseV2SourcePath,
  SIMULATION_CASE_V2_CATALOG,
  simulationCaseV2CatalogKey,
} from "./simulation-case-v2-catalog.ts";

function caseInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/2.0",
    id: "unreviewed-thermal-case-v2",
    revision: 1,
    scope: "Neutral closed-catalogue test fixture.",
    evidenceBoundary: "Catalogue admission only; no provider run is asserted.",
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
    parameters: [],
    expectedMetrics: [{ id: "peakTemperature", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 15_000,
  };
}

Deno.test("an unreviewed V2 simulation case is not admitted by the empty catalogue", async () => {
  const simulationCase = validateSimulationCaseV2(caseInput());
  const digest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
  );
  assertEquals(
    simulationCaseV2CatalogKey(simulationCase),
    "simulation-case/2.0:unreviewed-thermal-case-v2:r1",
  );
  assertEquals(SIMULATION_CASE_V2_CATALOG.size, 0);
  assertEquals(cataloguedSimulationCaseV2SourcePath(simulationCase), undefined);
  assertThrows(
    () => assertCataloguedSimulationCaseV2(simulationCase, digest),
    TypeError,
    "closed V2 catalogue",
  );
});
