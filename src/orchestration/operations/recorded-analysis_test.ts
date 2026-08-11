import { assertEquals } from "@std/assert";
import {
  RECORDED_ANALYSIS_OPERATION_DESCRIPTORS,
  SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
} from "./recorded-analysis.ts";

Deno.test("recorded analysis successors keep qualification planless and both runs plan-bound", () => {
  assertEquals(
    RECORDED_ANALYSIS_OPERATION_DESCRIPTORS.map((operation) => ({
      id: operation.id,
      version: operation.version,
      plan: "resolvedOperationPlan" in operation
        ? operation.resolvedOperationPlan
        : undefined,
      bindings: operation.bindings.map((binding) => binding.name),
    })),
    [
      {
        ...SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
        plan: undefined,
        bindings: ["approvedBrief"],
      },
      {
        ...SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
        plan: "2.0",
        bindings: ["simulationCase", "methodManifest"],
      },
      {
        ...VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
        plan: "2.0",
        bindings: ["proofCase", "geometry"],
      },
    ],
  );
});
