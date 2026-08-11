import { assertEquals } from "@std/assert";
import { validateSimulationCaseV2 } from "./simulation-case-v2.ts";
import { buildSimulationCaseAnalysisGraph } from "./simulation-case-analysis-graph.ts";

Deno.test("simulation-case graph accepts V2 declarations without inventing source influence", async () => {
  const simulationCase = validateSimulationCaseV2(
    JSON.parse(
      await Deno.readTextFile(
        "config/simulation-cases/coffee-machine-cm01-thermal-nominal-v2.json",
      ),
    ),
  );
  const graph = buildSimulationCaseAnalysisGraph({
    simulationCase,
    caseFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    evidence: {
      id: "simulation-case-v2-seal",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
    },
  });
  assertEquals(
    graph.relations.length,
    simulationCase.parameters.length + simulationCase.expectedMetrics.length,
  );
  assertEquals(
    graph.relations.every((relation) =>
      relation.assertion.epistemicBasis === "declared"
    ),
    true,
  );
});
