import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  type CapabilityReference,
  ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY,
  GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY,
  GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
  GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY,
  MANUFACTURING_ESTIMATE_FFF_CAPABILITY,
  MANUFACTURING_OBSERVE_PRINTABILITY_CAPABILITY,
  MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY,
  MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY,
  MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY,
  MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY,
  MODEL_AUTHOR_SYSTEM_CAPABILITY,
  MODEL_EVALUATE_REQUIREMENT_CAPABILITY,
  MODEL_INSPECT_SYSTEM_CAPABILITY,
  SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY,
  SIMULATION_RUN_QUALIFIED_MODELICA_CAPABILITY,
} from "../../domain/capability/engineering-capability.ts";
import {
  DESIGN_PREPARE_GEOMETRY_MODULE_OPERATION,
  engineeringOperationRegistry,
  fingerprintRegisteredEngineeringOperationRegistry,
} from "./registry.ts";
import {
  resolveRuntimePreparationPrerequisiteRegistry,
  runtimePreparationPrerequisiteRegistryFingerprintPayload,
} from "./runtime-preparation-prerequisite-closure.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";

const qualified = (
  capability: CapabilityReference,
  use: "preparation" | "execution" = "execution",
) => ({ ...capability, minimumQualification: "qualified" as const, use });

const DEMANDING_OPERATIONS = new Map<string, readonly ReturnType<typeof qualified>[]>([
  ["architecture.seed-syson-model@2", [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)]],
  ["model.write-architecture@1", [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)]],
  ["model.write-requirements@1", [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)]],
  ["model.write-sensitivity-edges@1", [qualified(MODEL_AUTHOR_SYSTEM_CAPABILITY)]],
  ["model.capture-part-definitions@1", [qualified(MODEL_INSPECT_SYSTEM_CAPABILITY)]],
  ["design.execute-build123d@1", [
    qualified(GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY),
  ]],
  ["design.prepare-geometry-module@1", [
    qualified(GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY, "preparation"),
  ]],
  ["verify.observe-assembly-integrity@1", [
    qualified(GEOMETRY_OBSERVE_ASSEMBLY_INTEGRITY_CAPABILITY),
  ]],
  ["verify.run-prescribed-kinematics@1", [
    qualified(MECHANICS_OBSERVE_PRESCRIBED_KINEMATICS_CAPABILITY),
  ]],
  ["simulate.run-qualified-modelica-kit@1", [
    qualified(SIMULATION_RUN_QUALIFIED_MODELICA_CAPABILITY),
  ]],
  ["simulate.run-admitted-modelica@1", [
    qualified(SIMULATION_RUN_ADMITTED_MODELICA_CAPABILITY),
  ]],
  ["simulate.run-admitted-spice@1", [
    qualified(ELECTRONICS_RUN_ADMITTED_SPICE_CAPABILITY),
  ]],
  ["verify.evaluate-admitted-modelica-observations@1", [
    qualified(MODEL_EVALUATE_REQUIREMENT_CAPABILITY),
  ]],
  ["verify.evaluate-sensitivity-base@1", [
    qualified(MODEL_EVALUATE_REQUIREMENT_CAPABILITY),
  ]],
  ["design.write-geometry@1", [
    qualified(GEOMETRY_EXPORT_ADMITTED_SOURCE_CAPABILITY, "preparation"),
  ]],
  [
    "analyze.run-fea-sensitivity@1",
    [
      qualified(GEOMETRY_EXECUTE_ADMITTED_SOURCE_CAPABILITY, "preparation"),
      qualified(MECHANICS_OBSERVE_STATIC_STRUCTURAL_SENSITIVITY_CAPABILITY),
    ],
  ],
  ["industrialize.observe-printability@1", [
    qualified(MANUFACTURING_OBSERVE_PRINTABILITY_CAPABILITY),
  ]],
  ["industrialize.observe-print-estimate@1", [
    qualified(MANUFACTURING_ESTIMATE_FFF_CAPABILITY),
  ]],
  ["industrialize.run-dfm-checks@1", [
    qualified(MANUFACTURING_RUN_DFM_CHECKS_CAPABILITY),
  ]],
  [
    "verify.run-fea-static-proof@3",
    [
      qualified(MECHANICS_SOLVE_STATIC_STRUCTURAL_CAPABILITY),
      qualified(MODEL_EVALUATE_REQUIREMENT_CAPABILITY),
    ],
  ],
]);

Deno.test("runtime demand is an exhaustive provider-neutral registry projection", async () => {
  const operations = engineeringOperationRegistry.list();
  assertEquals(operations.length, 53);
  assertEquals(Object.isFrozen(operations), true);
  assertEquals(operations.every((operation) => Object.isFrozen(operation)), true);
  assertEquals(
    operations.every((operation) =>
      !operation.requiresDependsOnOperation ||
      Object.isFrozen(operation.requiresDependsOnOperation)
    ),
    true,
  );
  assertEquals(
    operations.every((operation) => Object.isFrozen(operation.runtimeDemand)),
    true,
  );

  const seenDemanding = new Set<string>();
  let noneCount = 0;
  for (const operation of operations) {
    const key = `${operation.id}@${operation.version}`;
    const expected = DEMANDING_OPERATIONS.get(key);
    if (!expected) {
      assertEquals(operation.runtimeDemand, { kind: "none" }, key);
      noneCount++;
      continue;
    }
    seenDemanding.add(key);
    assertEquals(operation.runtimeDemand, {
      kind: "required",
      capabilities: expected,
    }, key);
  }
  assertEquals(
    [...seenDemanding].toSorted(),
    [...DEMANDING_OPERATIONS.keys()].toSorted(),
  );
  assertEquals(noneCount, 33);

  const preparation = engineeringOperationRegistry.require(
    DESIGN_PREPARE_GEOMETRY_MODULE_OPERATION,
  );
  assertEquals(preparation.execution, "planning-only");
  assertEquals(preparation.prerequisiteOnly, true);
  assertEquals(preparation.runtimePreparationPrerequisites, undefined);
  assertEquals(
    engineeringOperationRegistry.require({
      id: "verify.observe-assembly-integrity",
      version: "1",
    }).runtimePreparationPrerequisites,
    [DESIGN_PREPARE_GEOMETRY_MODULE_OPERATION],
  );

  const first = await fingerprintRegisteredEngineeringOperationRegistry();
  const second = await engineeringOperationRegistry.fingerprint();
  assertEquals(first, second);
  assertEquals(first.algorithm, "sha256");
  assertEquals(first.digest.length, 64);
  const closure = resolveRuntimePreparationPrerequisiteRegistry(
    engineeringOperationRegistry,
  );
  const withoutPreparationEdges = await sha256Fingerprint({
    ...runtimePreparationPrerequisiteRegistryFingerprintPayload(closure.entries()),
    operations: closure.entries().map((operation) => ({
      id: operation.id,
      version: operation.version,
      prerequisiteOnly: operation.prerequisiteOnly === true,
      runtimeDemand: operation.runtimeDemand,
      runtimePreparationPrerequisites: [],
    })),
  });
  assertNotEquals(first, withoutPreparationEdges);
  assert(operations.every((operation) => {
    const demandKeys = Object.keys(operation.runtimeDemand).toSorted();
    if (operation.runtimeDemand.kind === "none") {
      return JSON.stringify(demandKeys) === JSON.stringify(["kind"]);
    }
    return JSON.stringify(demandKeys) === JSON.stringify(["capabilities", "kind"]) &&
      operation.runtimeDemand.capabilities.every((capability) =>
        JSON.stringify(Object.keys(capability).toSorted()) ===
          JSON.stringify(["id", "minimumQualification", "use", "version"])
      );
  }));
});
