import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import {
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION,
} from "../../domain/inspection-drone-architecture.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/syson-model-seed.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "./coffee-machine-cm01-v3-engineering-kits.ts";

Deno.test("the intake registry starts a new idea from the approved project brief", () => {
  const idea = engineeringOperationRegistry.getIntake("idea-or-spec")!;
  const cad = getRegisteredIntakeOperation("existing-cad")!;
  const product = getRegisteredIntakeOperation("existing-product")!;

  assertEquals(`${idea.id}@${idea.version}`, "baseline.from-approved-brief@1");
  assertEquals(`${cad.id}@${cad.version}`, "baseline.capture-existing-cad@1");
  assertEquals(
    `${product.id}@${product.version}`,
    "baseline.capture-existing-product@1",
  );
  assertEquals(idea.allowedBasisKinds, ["approved-brief"]);
  assertEquals(idea.workItemKind, "define");
  assertEquals(idea.execution, "trusted");
  assertEquals(idea.title, "Create the engineering baseline");
  assertEquals(cad.execution, "planning-only");
  assertEquals(product.execution, "planning-only");
  assertEquals(cad.bindings, [
    {
      name: "approvedDiscovery",
      allowedSourceKinds: ["approved-discovery"],
    },
    { name: "cadSource", allowedSourceKinds: ["discovery-answer"] },
  ]);
});

Deno.test("operation lookup is exact and fails closed for unknown revisions", () => {
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "baseline.from-approved-discovery",
      version: "2",
    }),
    undefined,
  );
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "baseline.unknown",
      version: "1",
    }),
    undefined,
  );

  const error = assertThrows(
    () =>
      requireRegisteredEngineeringOperation({
        id: "baseline.unknown",
        version: "1",
      }),
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
  (first.bindings[0].allowedSourceKinds as string[]).push("discovery-answer");

  const second = getRegisteredIntakeOperation("idea-or-spec")!;
  assertEquals(second.allowedBasisKinds, ["approved-brief"]);
  assertEquals(second.bindings[0].allowedSourceKinds, ["approved-brief"]);
});

Deno.test("a reviewed operation can enter a plan before its execution basis exists", () => {
  const architecture = validateRegisteredEngineeringOperationInput({
    operation: {
      id: SYSON_MODEL_SEED_OPERATION.id,
      version: SYSON_MODEL_SEED_OPERATION.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    stage: "planning",
  });
  assertEquals(architecture.operation.id, "architecture.seed-syson-model");
  assertEquals(architecture.operation.execution, "trusted");
  assertEquals(architecture.basisKind, undefined);

  const boundedDroneArchitecture = validateRegisteredEngineeringOperationInput({
    operation: {
      id: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.id,
      version: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    stage: "planning",
  });
  assertEquals(
    boundedDroneArchitecture.operation.id,
    INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.id,
  );
  assertEquals(boundedDroneArchitecture.operation.execution, "trusted");
});

Deno.test("registered operations accept only their declared queue basis", () => {
  const error = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: "baseline.from-approved-discovery",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(error.code, "unsupported_basis");

  const architecture = validateRegisteredEngineeringOperationInput({
    operation: {
      id: SYSON_MODEL_SEED_OPERATION.id,
      version: SYSON_MODEL_SEED_OPERATION.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(architecture.operation.id, "architecture.seed-syson-model");

  const seedFromDiscovery = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: "architecture.seed-syson-model",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
        stage: "queue",
        basisKind: "approved-discovery",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(seedFromDiscovery.code, "unsupported_basis");

  const boundedDroneArchitecture = validateRegisteredEngineeringOperationInput({
    operation: {
      id: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.id,
      version: INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      }],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(
    boundedDroneArchitecture.operation.id,
    INSPECTION_DRONE_ARCHITECTURE_V3_OPERATION.id,
  );

  const historical = requireRegisteredEngineeringOperation({
    id: INSPECTION_DRONE_ARCHITECTURE_OPERATION.id,
    version: INSPECTION_DRONE_ARCHITECTURE_OPERATION.version,
  });
  assertEquals(historical.execution, "planning-only");
});

Deno.test("registered operations accept only exact declared state-reference inputs", () => {
  const validated = validateRegisteredEngineeringOperationInput({
    operation: {
      id: "baseline.capture-existing-cad",
      version: "1",
      bindings: [
        {
          name: "approvedDiscovery",
          source: { kind: "approved-discovery" },
        },
        {
          name: "cadSource",
          source: { kind: "discovery-answer", answerId: "source-cad-file" },
        },
      ],
    },
    stage: "queue",
    basisKind: "approved-discovery",
  });
  assertEquals(validated.operation.id, "baseline.capture-existing-cad");
  assertEquals(validated.operation.execution, "planning-only");
  assertEquals(validated.bindings[1], {
    name: "cadSource",
    source: { kind: "discovery-answer", answerId: "source-cad-file" },
  });

  const missing = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: "baseline.capture-existing-product",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
        stage: "queue",
        basisKind: "approved-discovery",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(missing.code, "invalid_bindings");

  const undeclared = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: "baseline.from-approved-discovery",
          version: "1",
          bindings: [{
            name: "rawProviderArguments",
            source: { kind: "approved-discovery" },
          }],
        },
        stage: "queue",
        basisKind: "approved-discovery",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(undeclared.code, "invalid_bindings");

  const malformed = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: "baseline.capture-existing-cad",
          version: "1",
          bindings: [
            {
              name: "approvedDiscovery",
              source: { kind: "approved-discovery" },
            },
            {
              name: "cadSource",
              source: { kind: "discovery-answer", answerId: "" },
            },
          ],
        },
        stage: "queue",
        basisKind: "approved-discovery",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(malformed.code, "invalid_input");
});

Deno.test("CM-01 V3 promotes each server-wired golden-path kit", () => {
  const architecture = getRegisteredEngineeringOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.architecture,
  );
  const cad = getRegisteredEngineeringOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cad,
  );
  const thermal = getRegisteredEngineeringOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.thermal,
  );
  const bom = getRegisteredEngineeringOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.bom,
  );
  const mechanical = getRegisteredEngineeringOperation(
    COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanical,
  );

  assertEquals(architecture?.execution, "trusted");
  assertEquals(architecture?.workItemKind, "architect");
  assertEquals(architecture?.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(cad?.execution, "trusted");
  assertEquals(cad?.workItemKind, "design");
  assertEquals(thermal?.execution, "trusted");
  assertEquals(thermal?.workItemKind, "simulate");
  assertEquals(thermal?.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(thermal?.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);
  assertEquals(bom?.execution, "trusted");
  assertEquals(bom?.workItemKind, "industrialize");
  assertEquals(mechanical?.execution, "trusted");
  assertEquals(mechanical?.workItemKind, "verify");
});

Deno.test("CM-01 R2 correction operations accept only exact ThreadSnapshot entity bindings", () => {
  const correction = {
    snapshotId: "project:coffee-machine-cm01-v3:r8:correction",
    snapshotRevision: 8,
    kind: "artifact" as const,
    id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:record",
  };
  const revisedCadStep = {
    snapshotId: "project:coffee-machine-cm01-v3:r9:cad-r2",
    snapshotRevision: 9,
    kind: "artifact" as const,
    id: "coffee-machine-cm01-v3-cad-r2-step",
  };

  const cad = validateRegisteredEngineeringOperationInput({
    operation: {
      id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.id,
      version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.version,
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: { kind: "thread-entity", reference: correction },
        },
      ],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(cad.operation.execution, "trusted");
  assertEquals(cad.bindings[1], {
    name: "dripTrayHeightCorrection",
    source: { kind: "thread-entity", reference: correction },
  });

  const mechanical = validateRegisteredEngineeringOperationInput({
    operation: {
      id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30.id,
      version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30.version,
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: { kind: "thread-entity", reference: correction },
        },
        {
          name: "revisedCadStep",
          source: { kind: "thread-entity", reference: revisedCadStep },
        },
      ],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(mechanical.operation.execution, "trusted");
  assertEquals(mechanical.bindings[2], {
    name: "revisedCadStep",
    source: { kind: "thread-entity", reference: revisedCadStep },
  });

  const recovery = validateRegisteredEngineeringOperationInput({
    operation: {
      id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3.id,
      version:
        COFFEE_MACHINE_CM01_V3_OPERATION_REFS.mechanicalDripTrayHeight30R3.version,
      bindings: [
        { name: "approvedBrief", source: { kind: "approved-brief" } },
        {
          name: "dripTrayHeightCorrection",
          source: { kind: "thread-entity", reference: correction },
        },
        {
          name: "revisedCadStep",
          source: { kind: "thread-entity", reference: revisedCadStep },
        },
      ],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(recovery.operation.version, "3");

  const malformed = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          id: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.id,
          version: COFFEE_MACHINE_CM01_V3_OPERATION_REFS.cadDripTrayHeight30.version,
          bindings: [
            { name: "approvedBrief", source: { kind: "approved-brief" } },
            {
              name: "dripTrayHeightCorrection",
              source: {
                kind: "thread-entity",
                reference: { ...correction, snapshotRevision: 0 },
              },
            },
          ],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(malformed.code, "invalid_input");
});
