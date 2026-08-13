import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/engineering/syson-model-seed.ts";
import {
  SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
  SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
} from "./recorded-analysis.ts";

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

Deno.test("recorded-analysis @2 operations are reviewed registry entries with their plan boundary", () => {
  const seal = getRegisteredEngineeringOperation(
    SIMULATE_SEAL_SIMULATION_CASE_V2_OPERATION,
  )!;
  assertEquals(seal.execution, "trusted");
  assertEquals(seal.resolvedOperationPlan, undefined);
  assertEquals(seal.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);

  for (
    const operation of [
      SIMULATE_RUN_MODELICA_SCENARIO_V2_OPERATION,
      VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
    ]
  ) {
    const registered = getRegisteredEngineeringOperation(operation)!;
    assertEquals(registered.execution, "trusted");
    assertEquals(registered.resolvedOperationPlan, "2.0");
    assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
  }
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

Deno.test("retired CM-01 operations are neither lookupable nor queueable", () => {
  const operation = {
    id: "verify.coffee-machine-cm01-drip-tray-mechanical",
    version: "3",
  };
  assertEquals(getRegisteredEngineeringOperation(operation), undefined);

  const error = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...operation,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(error.code, "unknown_operation");
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
