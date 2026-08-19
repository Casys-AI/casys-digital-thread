import { assertEquals } from "@std/assert";
import { RECORDED_CALCULIX_RUN_OPERATION } from "../../domain/analysis/recorded-calculix-bindings.ts";
import {
  RECORDED_ANALYSIS_OPERATION_DESCRIPTORS,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./recorded-analysis.ts";

Deno.test("recorded analysis registers only isolated CalculiX @3 as a plan-bound run", () => {
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
        ...VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
        plan: "2.0",
        bindings: ["proofCase", "geometry"],
      },
    ],
  );
});

Deno.test("isolated CalculiX review identity is the registry @3 pair", () => {
  assertEquals(
    RECORDED_CALCULIX_RUN_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
  );
});
