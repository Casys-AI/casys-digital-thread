import { assert, assertEquals, assertThrows } from "@std/assert";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import { validateSimulationCase } from "./simulation-case.ts";
import { buildSimulationCaseAnalysisGraph } from "./simulation-case-analysis-graph.ts";

const CASE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
const CASE_DECLARATION_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "d".repeat(64),
};

function caseInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/1.0",
    id: "thermal-system-nominal-v1",
    revision: 1,
    scope: "Neutral thermal-system analysis-graph fixture.",
    evidenceBoundary: "Declared graph structure only; no causal influence is asserted.",
    project: {
      id: "thermal-system-project",
      subjectId: "project:thermal-system",
      baseThreadSnapshot: {
        id: "project:thermal-system:r2",
        revision: 2,
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
      sha256: "b".repeat(64),
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

Deno.test("simulation case graph records only declared case incidences with its exact artifact", () => {
  const simulationCase = validateSimulationCase(caseInput());
  const graph = buildSimulationCaseAnalysisGraph({
    simulationCase,
    caseFingerprint: CASE_DECLARATION_FINGERPRINT,
    evidence: { id: "simulation-case-seal", fingerprint: CASE_FINGERPRINT },
  });

  assertEquals(
    graph.nodes.filter((node) => node.kind === "simulation-case").length,
    1,
  );
  assertEquals(
    graph.relations.length,
    simulationCase.parameters.length + simulationCase.expectedMetrics.length,
  );
  for (const relation of graph.relations) {
    assertEquals(relation.assertion.relation, "structural-incidence");
    assertEquals(relation.assertion.epistemicBasis, "declared");
    assertEquals(relation.assertion.from.kind, "simulation-case");
    assertEquals(relation.assertion.evidence, [{
      id: "simulation-case-seal",
      fingerprint: CASE_FINGERPRINT,
    }]);
    assertEquals(relation.assertion.scope, {
      kind: "basis",
      basisFingerprint: CASE_DECLARATION_FINGERPRINT,
    });
  }
  assert(
    !graph.relations.some((relation) =>
      relation.assertion.from.kind === "parameter" &&
      relation.assertion.to.kind === "metric"
    ),
  );
});

Deno.test("simulation case graph identity is deterministic and does not depend on case ordering", () => {
  const source = caseInput();
  const simulationCase = validateSimulationCase(source);
  const reversed = validateSimulationCase({
    ...source,
    parameters: [...(source.parameters as unknown[])].reverse(),
    expectedMetrics: [...(source.expectedMetrics as unknown[])].reverse(),
  });
  const evidence = { id: "simulation-case-seal", fingerprint: CASE_FINGERPRINT };

  assertEquals(
    deterministicJson(
      buildSimulationCaseAnalysisGraph({
        simulationCase,
        caseFingerprint: CASE_DECLARATION_FINGERPRINT,
        evidence,
      }),
    ),
    deterministicJson(
      buildSimulationCaseAnalysisGraph({
        simulationCase: reversed,
        caseFingerprint: CASE_DECLARATION_FINGERPRINT,
        evidence,
      }),
    ),
  );
});

Deno.test("simulation case graph rejects an evidence artifact without an exact fingerprint", () => {
  const simulationCase = validateSimulationCase(caseInput());
  assertThrows(
    () =>
      buildSimulationCaseAnalysisGraph({
        simulationCase,
        caseFingerprint: CASE_DECLARATION_FINGERPRINT,
        evidence: {
          id: "simulation-case-seal",
          fingerprint: { algorithm: "sha256", digest: "not-a-fingerprint" },
        },
      }),
    TypeError,
    "lowercase SHA-256",
  );
});

Deno.test("simulation case nodes remain stable across seal occurrences while assertions retain distinct evidence", () => {
  const simulationCase = validateSimulationCase(caseInput());
  const first = buildSimulationCaseAnalysisGraph({
    simulationCase,
    caseFingerprint: CASE_DECLARATION_FINGERPRINT,
    evidence: { id: "seal-1", fingerprint: CASE_FINGERPRINT },
  });
  const secondFingerprint = {
    algorithm: "sha256" as const,
    digest: "e".repeat(64),
  };
  const second = buildSimulationCaseAnalysisGraph({
    simulationCase,
    caseFingerprint: CASE_DECLARATION_FINGERPRINT,
    evidence: { id: "seal-2", fingerprint: secondFingerprint },
  });

  assertEquals(first.nodes, second.nodes);
  assertEquals(
    first.relations.map((relation) => relation.assertion.id).some((id) =>
      second.relations.some((relation) => relation.assertion.id === id)
    ),
    false,
  );
  assertEquals(
    first.relations[0]?.assertion.evidence[0]?.fingerprint,
    CASE_FINGERPRINT,
  );
  assertEquals(
    second.relations[0]?.assertion.evidence[0]?.fingerprint,
    secondFingerprint,
  );
});
