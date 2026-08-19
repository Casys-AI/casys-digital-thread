import { assertEquals, assertThrows } from "@std/assert";
import { fingerprintResourceBytes } from "../../analysis/provider-resource-reader.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";
import {
  encodeSimulationCaseV2DecisionParameters,
  parseSimulationCaseV2DecisionParameters,
  simulationCaseV2DecisionParametersToMap,
  SimulationCaseV2ProposalError,
  verifySimulationCaseV2ParametersMatchCase,
} from "./simulation-case-v2-proposal.ts";

function caseInput(): Record<string, unknown> {
  return {
    schemaVersion: "simulation-case/2.0",
    id: "thermal-system-nominal-v2",
    revision: 1,
    scope: "Neutral thermal-system proposal fixture.",
    evidenceBoundary: "Proposal encoding only; no provider run is asserted.",
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

async function proposal() {
  const simulationCase = validateSimulationCaseV2(caseInput());
  const digest = await fingerprintResourceBytes(
    new TextEncoder().encode(canonicalSimulationCaseV2Text(simulationCase)),
  );
  return {
    simulationCase,
    parameters: encodeSimulationCaseV2DecisionParameters(digest, simulationCase),
  };
}

Deno.test("V2 simulation-case proposal signs project and review-basis subjects plus both scenario hashes", async () => {
  const { simulationCase, parameters } = await proposal();
  const byKey = simulationCaseV2DecisionParametersToMap(parameters);
  const parsed = parseSimulationCaseV2DecisionParameters(byKey);
  verifySimulationCaseV2ParametersMatchCase(parsed, simulationCase);
  assertEquals(parsed.project.subjectId, simulationCase.project.subjectId);
  assertEquals(
    parsed.reviewBasis.subjectId,
    simulationCase.project.baseThreadSnapshot.subjectId,
  );
  assertEquals(parsed.scenario.sourceSha256, simulationCase.scenario.sourceSha256);
  assertEquals(
    parsed.scenario.projectionSha256,
    simulationCase.scenario.projectionSha256,
  );
});

Deno.test("V2 simulation-case proposal explicitly rejects obsolete scenario sha256", async () => {
  const { parameters } = await proposal();
  const values = simulationCaseV2DecisionParametersToMap(parameters);
  const altered = new Map(values);
  altered.set("sim.case.scenario.sha256", "a".repeat(64));
  const error = assertThrows(
    () => parseSimulationCaseV2DecisionParameters(altered),
    SimulationCaseV2ProposalError,
  );
  assertEquals(error.code, "unexpected_parameter");
});

Deno.test("V2 simulation-case proposal rejects a source hash substitution after parsing", async () => {
  const { simulationCase, parameters } = await proposal();
  const altered = new Map(simulationCaseV2DecisionParametersToMap(parameters));
  altered.set("sim.case.scenario.sourceSha256", "d".repeat(64));
  const parsed = parseSimulationCaseV2DecisionParameters(altered);
  const error = assertThrows(
    () => verifySimulationCaseV2ParametersMatchCase(parsed, simulationCase),
    SimulationCaseV2ProposalError,
  );
  assertEquals(error.code, "verification_mismatch");
});
