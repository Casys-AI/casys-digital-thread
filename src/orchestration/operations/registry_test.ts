import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/platform/syson-model-seed.ts";
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
  // sensitivityRelationsV2 (@2) was registered planning-only until the operator
  // consented in chat on 2026-08-05 to migrating the live @1 element. Every
  // registered CM-01 V3 reference is now trusted.
  for (const operation of Object.values(COFFEE_MACHINE_CM01_V3_OPERATION_REFS)) {
    const registered = getRegisteredEngineeringOperation(operation);
    assertEquals(registered?.execution, "trusted");
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

Deno.test("CM-01 archive lineage accepts explicit N targets and rejects non-retirable entities", () => {
  const target = (kind: "artifact" | "requirement" | "observation") => ({
    snapshotId: "project:coffee-machine-cm01-v3:r8:archive-basis",
    snapshotRevision: 8,
    kind,
    id: `${kind}-target`,
  });
  const validated = validateRegisteredEngineeringOperationInput({
    operation: {
      ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage,
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "archiveTarget",
          source: { kind: "thread-entity", reference: target("artifact") },
        },
        {
          name: "archiveTarget",
          source: { kind: "thread-entity", reference: target("requirement") },
        },
        {
          name: "archiveTarget",
          source: { kind: "thread-entity", reference: target("observation") },
        },
      ],
    },
    stage: "planning",
  });
  assertEquals(
    validated.bindings.filter((binding) => binding.name === "archiveTarget").length,
    3,
  );

  for (const kind of ["consumption", "change", "action"] as const) {
    const error = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage,
            bindings: [
              { name: "approvedBrief", source: { kind: "approved-brief" } },
              {
                name: "archiveTarget",
                source: {
                  kind: "thread-entity",
                  reference: {
                    snapshotId: "project:coffee-machine-cm01-v3:r8:archive-basis",
                    snapshotRevision: 8,
                    kind,
                    id: `${kind}-target`,
                  },
                },
              },
            ],
          },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(error.code, "invalid_bindings");
  }

  const duplicate = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...COFFEE_MACHINE_CM01_V3_OPERATION_REFS.archiveLineage,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
            {
              name: "archiveTarget",
              source: { kind: "thread-entity", reference: target("artifact") },
            },
            {
              name: "archiveTarget",
              source: { kind: "thread-entity", reference: target("artifact") },
            },
          ],
        },
        stage: "planning",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(duplicate.code, "invalid_bindings");
});

Deno.test("a human-only operation declares its origin so a human can reach it", () => {
  const reconcile = getRegisteredEngineeringOperation({
    id: "record.reconcile-uncertain-writer",
    version: "1",
  })!;

  // The executor refuses an agent origin. Without this declaration the surface
  // that dispatches runs cannot know to offer the operator its elicitation, so
  // the run becomes executable by nobody — and the write-basis lock it exists
  // to lift never comes off.
  assertEquals(reconcile.mustOrigin, "human");
});
