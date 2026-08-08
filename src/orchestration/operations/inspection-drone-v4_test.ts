import { assertEquals, assertThrows } from "@std/assert";
import {
  getRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import { INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION } from "./inspection-drone-v4.ts";

Deno.test("inspection-drone V4 architecture is an exact reviewed two-binding operation", () => {
  const operation = getRegisteredEngineeringOperation(
    INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  );
  assertEquals(operation?.execution, "trusted");
  assertEquals(operation?.bindings.map((binding) => binding.name), [
    "approvedBrief",
    "sysonModelSeed",
  ]);
  assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        stage: "planning",
        operation: {
          ...INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
      }),
    Error,
    "required binding sysonModelSeed is missing",
  );
});
