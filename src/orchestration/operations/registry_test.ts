import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";

Deno.test("the V1 intake registry exposes exactly reviewed operation revisions", () => {
  const idea = engineeringOperationRegistry.getIntake("idea-or-spec")!;
  const cad = getRegisteredIntakeOperation("existing-cad")!;
  const product = getRegisteredIntakeOperation("existing-product")!;

  assertEquals(`${idea.id}@${idea.version}`, "baseline.from-approved-discovery@1");
  assertEquals(`${cad.id}@${cad.version}`, "baseline.capture-existing-cad@1");
  assertEquals(
    `${product.id}@${product.version}`,
    "baseline.capture-existing-product@1",
  );
  assertEquals(idea.allowedBasisKinds, ["approved-discovery"]);
  assertEquals(idea.workItemKind, "define");
  assertEquals(idea.title, "Create the engineering baseline");
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
  assertEquals(second.allowedBasisKinds, ["approved-discovery"]);
  assertEquals(second.bindings[0].allowedSourceKinds, ["approved-discovery"]);
});

Deno.test("a reviewed operation can enter a plan before its execution basis exists", () => {
  const architecture = validateRegisteredEngineeringOperationInput({
    operation: {
      id: "architecture.seed-syson-model",
      version: "1",
      bindings: [{
        name: "approvedDiscovery",
        source: { kind: "approved-discovery" },
      }],
    },
    stage: "planning",
  });
  assertEquals(architecture.operation.id, "architecture.seed-syson-model");
  assertEquals(architecture.basisKind, undefined);
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
      id: "architecture.seed-syson-model",
      version: "1",
      bindings: [{
        name: "approvedDiscovery",
        source: { kind: "approved-discovery" },
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
