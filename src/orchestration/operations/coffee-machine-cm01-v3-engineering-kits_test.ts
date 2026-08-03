import { assertEquals, assertExists } from "@std/assert";
import {
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS,
  getCoffeeMachineCm01V3EngineeringKit,
  listCoffeeMachineCm01V3EngineeringKits,
  listCoffeeMachineCm01V3OperationDescriptors,
} from "./coffee-machine-cm01-v3-engineering-kits.ts";

Deno.test("CM-01 V3 exposes the five manually-qualified golden-path kits", () => {
  const kits = listCoffeeMachineCm01V3EngineeringKits();

  assertEquals(
    kits.map((kit) => `${kit.kitId}@${kit.kitVersion}`),
    [
      "cm01.syson-architecture@1",
      "cm01.cad-assembly@1",
      "cm01.thermal-nominal@1",
      "cm01.erp-bom-observation@1",
      "cm01.drip-tray-static-proof@1",
    ],
  );
  assertEquals(
    kits.map((kit) => kit.qualification.status),
    Array(5).fill("manually-qualified"),
  );
  assertEquals(
    kits.map((kit) => kit.presentationRole),
    ["architecture", "cad", "simulation", "supply", "verification"],
  );
  assertEquals(
    kits.map((kit) => kit.activityCategory),
    ["model", "design", "analysis", "observation", "verification"],
  );

  for (const kit of kits) {
    assertEquals(kit.qualification.sourceRefs.length > 0, true);
    assertEquals(kit.evidenceBoundary.length > 0, true);
    assertEquals(kit.operation.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(kit.operation.bindings, [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }]);
  }
  assertEquals(
    kits.map((kit) => kit.operation.execution),
    ["trusted", "trusted", "trusted", "trusted", "trusted"],
  );
});

Deno.test("CM-01 V3 operation references are stable and descriptors retain no executor authority", () => {
  const operations = listCoffeeMachineCm01V3OperationDescriptors();

  assertEquals(
    operations.map((operation) => `${operation.id}@${operation.version}`),
    [
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom.id}@1`,
      `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical.id}@1`,
    ],
  );
  assertEquals(operations[0]?.execution, "trusted");
  assertEquals(operations[1]?.execution, "trusted");
  assertEquals(operations[2]?.execution, "trusted");
  assertEquals(operations[3]?.execution, "trusted");
  assertEquals(operations[4]?.execution, "trusted");
  assertEquals(
    operations.every((operation) => operation.execution === "trusted"),
    true,
  );
  assertEquals(
    operations.every((operation) =>
      !Object.keys(operation).some((key) =>
        ["executor", "provider", "tool", "arguments"].includes(key)
      )
    ),
    true,
  );
});

Deno.test("CM-01 V3 catalog callers receive isolated copies", () => {
  const first = getCoffeeMachineCm01V3EngineeringKit("cm01.cad-assembly");
  assertExists(first);
  (first.qualification.sourceRefs as unknown as { path: string }[])[0].path = "mutated";
  (first.operation.allowedBasisKinds as string[]).push("approved-brief");

  const second = getCoffeeMachineCm01V3EngineeringKit("cm01.cad-assembly");
  assertExists(second);
  assertEquals(
    second.qualification.sourceRefs[0].path,
    "config/golden-references/coffee-machine-cm01-v3.json",
  );
  assertEquals(second.operation.allowedBasisKinds, ["thread-snapshot"]);
});
