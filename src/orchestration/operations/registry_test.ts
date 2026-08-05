import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/syson-model-seed.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "./coffee-machine-cm01-v3-engineering-kits.ts";

Deno.test("the intake registry starts a new idea from the approved project brief", () => {
  const idea = engineeringOperationRegistry.getIntake("idea-or-spec")!;

  assertEquals(`${idea.id}@${idea.version}`, "baseline.from-approved-brief@1");
  assertEquals(idea.allowedBasisKinds, ["approved-brief"]);
  assertEquals(idea.workItemKind, "define");
  assertEquals(idea.execution, "trusted");
  assertEquals(idea.title, "Create the engineering baseline");
  assertEquals(idea.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);
  assertEquals(getRegisteredIntakeOperation("existing-cad"), undefined);
  assertEquals(getRegisteredIntakeOperation("existing-product"), undefined);
});

Deno.test("operation lookup is exact and fails closed for unknown revisions", () => {
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "baseline.from-approved-brief",
      version: "2",
    }),
    undefined,
  );
  assertEquals(
    getRegisteredEngineeringOperation({ id: "baseline.unknown", version: "1" }),
    undefined,
  );

  const error = assertThrows(
    () =>
      requireRegisteredEngineeringOperation({ id: "baseline.unknown", version: "1" }),
    EngineeringOperationRegistryError,
  );
  assertEquals(error.code, "unknown_operation");
  assertStringIncludes(error.message, "baseline.unknown@1");
  assertEquals(error.message.includes("tool"), false);
  assertEquals(error.message.includes("arguments"), false);
});

Deno.test("operation declarations cannot mutate the code-owned registry", () => {
  const first = getRegisteredIntakeOperation("idea-or-spec")!;
  (first.allowedBasisKinds as string[]).push("thread-snapshot");
  (first.bindings[0].allowedSourceKinds as string[]).push("project-answer");

  const second = getRegisteredIntakeOperation("idea-or-spec")!;
  assertEquals(second.allowedBasisKinds, ["approved-brief"]);
  assertEquals(second.bindings[0].allowedSourceKinds, ["approved-brief"]);
});

Deno.test("reviewed operations validate only their declared current plan and queue basis", () => {
  const planned = validateRegisteredEngineeringOperationInput({
    operation: {
      id: SYSON_MODEL_SEED_OPERATION.id,
      version: SYSON_MODEL_SEED_OPERATION.version,
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
    stage: "planning",
  });
  assertEquals(planned.operation.id, SYSON_MODEL_SEED_OPERATION.id);
  assertEquals(planned.basisKind, undefined);

  const queued = validateRegisteredEngineeringOperationInput({
    operation: {
      id: SYSON_MODEL_SEED_OPERATION.id,
      version: SYSON_MODEL_SEED_OPERATION.version,
      bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(queued.operation.execution, "trusted");
  assertEquals(queued.basisKind, "thread-snapshot");

  const wrongBasis = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: SYSON_MODEL_SEED_OPERATION.id,
          version: SYSON_MODEL_SEED_OPERATION.version,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
        stage: "queue",
        basisKind: "approved-brief",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(wrongBasis.code, "unsupported_basis");
});

Deno.test("CM-01 V3 golden-path kits remain reviewed trusted operations", () => {
  // sensitivityRelationsV2 (@2) is planning-only — executor code is complete but
  // migration of the live @1 element requires explicit operator consent. It is a
  // registered operation but not yet on the golden path. All other refs are trusted.
  const PLANNING_ONLY_REFS = new Set([
    `${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.id}@${COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityRelationsV2.version}`,
  ]);
  for (const operation of Object.values(COFFEE_MACHINE_CM01_V3_OPERATION_REFS)) {
    const registered = getRegisteredEngineeringOperation(operation);
    const key = `${operation.id}@${operation.version}`;
    if (PLANNING_ONLY_REFS.has(key)) {
      assertEquals(registered?.execution, "planning-only");
    } else {
      assertEquals(registered?.execution, "trusted");
    }
    assertEquals(registered?.allowedBasisKinds, ["thread-snapshot"]);
  }
});

Deno.test("CM-01 correction operations require an exact thread entity binding", () => {
  const reference = {
    snapshotId: "project:coffee-machine-cm01-v3:r8:correction",
    snapshotRevision: 8,
    kind: "artifact" as const,
    id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
  };
  const validated = validateRegisteredEngineeringOperationInput({
    operation: {
      id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.id,
      version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.version,
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: { kind: "thread-entity", reference },
        },
      ],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(validated.bindings[1], {
    name: "dripTrayHeightCorrection",
    source: { kind: "thread-entity", reference },
  });
});
