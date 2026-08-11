import { assertEquals, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "./provider-resource-reader.ts";
import {
  canonicalSimulationCaseV2Text,
  SIMULATION_CASE_V2_SCHEMA,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";

const CM01_PATH = "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v2.json";

Deno.test("simulation-case/2.0 retains separate exact source and projection identities", async () => {
  const source = JSON.parse(await Deno.readTextFile(CM01_PATH));
  const simulationCase = validateSimulationCaseV2(source);
  assertEquals(simulationCase.schemaVersion, SIMULATION_CASE_V2_SCHEMA);
  assertEquals(simulationCase.revision, 1);
  assertEquals(
    simulationCase.kit.modelSha256,
    "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
  );
  assertEquals(
    simulationCase.scenario.sourceSha256,
    "ef75820fad5e80a2c6a541e1d7ab4ac4983af417d769b970a17c57734ce93849",
  );
  assertEquals(
    simulationCase.scenario.projectionSha256,
    "057610356a675f16f9395cc3c1e1637ea0871ccb28c616cec284a9cf654268f3",
  );
  assertEquals(
    await fingerprintResourceBytes(
      new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
    ),
    "7efeebf57c20cd2462395f8f47626392c3bb9be450c7ac2d471a9c2e060979bb",
  );
});

Deno.test("simulation-case/2.0 rejects the V1 single scenario hash field", async () => {
  const source = JSON.parse(await Deno.readTextFile(CM01_PATH)) as Record<
    string,
    unknown
  >;
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

Deno.test("simulation-case/2.0 canonical ordering uses code units rather than host locale", async () => {
  const source = JSON.parse(await Deno.readTextFile(CM01_PATH)) as Record<
    string,
    unknown
  >;
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
