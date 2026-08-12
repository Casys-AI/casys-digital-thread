import { assertEquals } from "@std/assert";
import { validateSimulationCaseV2 } from "./simulation-case-v2.ts";
import { buildSimulationCaseAnalysisGraph } from "./simulation-case-analysis-graph.ts";

function caseInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/2.0",
    id: "thermal-system-nominal-v2",
    revision: 1,
    scope: "Neutral thermal-system analysis-graph fixture.",
    evidenceBoundary: "Declared graph structure only; no causal influence is asserted.",
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
    parameters: [{ id: "ambientTemperature", value: 293.15, unit: "K" }],
    expectedMetrics: [{ id: "peakTemperature", unit: "K" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 15_000,
  };
}

Deno.test("simulation-case graph accepts V2 declarations without inventing source influence", () => {
  const simulationCase = validateSimulationCaseV2(caseInput());
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
