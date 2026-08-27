import { assertEquals } from "@std/assert";
import { ISOLATED_CALCULIX_RUN_OPERATION } from "../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";
import {
  FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./fea-isolated-static-proof.ts";

Deno.test("isolated FEA static proof registers only CalculiX @3 as a plan-bound run", () => {
  assertEquals(
    FEA_ISOLATED_STATIC_PROOF_OPERATION_DESCRIPTORS.map((operation) => ({
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
    ISOLATED_CALCULIX_RUN_OPERATION,
    VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
  );
});
