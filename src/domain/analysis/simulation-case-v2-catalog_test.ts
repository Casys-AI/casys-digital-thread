import { assertEquals, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "./provider-resource-reader.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";
import {
  assertCataloguedSimulationCaseV2,
  cataloguedSimulationCaseV2SourcePath,
  simulationCaseV2CatalogKey,
} from "./simulation-case-v2-catalog.ts";

Deno.test("V2 simulation-case catalogue is keyed by schema id and revision", async () => {
  const simulationCase = validateSimulationCaseV2(
    JSON.parse(
      await Deno.readTextFile(
        "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v2.json",
      ),
    ),
  );
  const digest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
  );
  assertEquals(
    simulationCaseV2CatalogKey(simulationCase),
    "simulation-case/2.0:coffee-machine-cm01-thermal-nominal-v2:r1",
  );
  assertEquals(
    cataloguedSimulationCaseV2SourcePath(simulationCase),
    "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v2.json",
  );
  assertCataloguedSimulationCaseV2(simulationCase, digest);
  assertThrows(
    () => assertCataloguedSimulationCaseV2(simulationCase, "a".repeat(64)),
    TypeError,
    "closed V2 catalogue",
  );
});
