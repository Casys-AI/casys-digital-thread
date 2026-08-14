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
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./recorded-analysis.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/analysis/technical-compilation-proposal.ts";
import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/engineering/architecture-sysml-seal-proposal.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/engineering/part-definitions-capture.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/analysis/build123d-execution-proposal.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "../../domain/analysis/isolated-geometry-seal-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/analysis/modelica-qualified-kit-run-proposal.ts";

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

Deno.test("the local CalculiX @3 successor retains the exact ROP2 and artifact-binding boundary", () => {
  const operation = getRegisteredEngineeringOperation(
    VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
  )!;

  assertEquals(operation.execution, "trusted");
  assertEquals(operation.resolvedOperationPlan, "2.0");
  assertEquals(operation.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(operation.bindings.map((binding) => binding.name), [
    "proofCase",
    "geometry",
  ]);
});

Deno.test(
  "model.capture-part-definitions@1 is a trusted low-risk define operation that binds one architecture artifact",
  () => {
    const registered = getRegisteredEngineeringOperation(
      MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
    )!;
    assertEquals(registered.execution, "trusted");
    assertEquals(registered.riskClass, "low");
    assertEquals(registered.workItemKind, "define");
    assertEquals(registered.requiresAdditiveChange, true);
    assertEquals(registered.decisionEvidenceScope, undefined);
    assertEquals(registered.mustOrigin, undefined);
    assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(registered.bindings, [{
      name: "architecture",
      allowedSourceKinds: ["thread-entity"],
      cardinality: "one",
      allowedThreadEntityKinds: ["artifact"],
    }]);
  },
);

Deno.test("model.capture-part-definitions@1 cannot appear in the initial plan", () => {
  const registered = getRegisteredEngineeringOperation(
    MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
  )!;
  assertEquals(registered.requiresAdditiveChange, true);
});

Deno.test(
  "model.capture-part-definitions@1 refuses any basis other than thread-snapshot",
  () => {
    const binding = {
      name: "architecture",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: "thread.snapshot.3",
          snapshotRevision: 3,
          kind: "artifact" as const,
          id: "architecture-" + "a".repeat(64),
        },
      },
    };
    const error = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
            bindings: [binding],
          },
          stage: "queue",
          basisKind: "approved-brief",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(error.code, "unsupported_basis");
  },
);

Deno.test(
  "model.capture-part-definitions@1 refuses a missing, duplicate, or non-artifact architecture binding",
  () => {
    const binding = {
      name: "architecture",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: "thread.snapshot.3",
          snapshotRevision: 3,
          kind: "artifact" as const,
          id: "architecture-" + "a".repeat(64),
        },
      },
    };
    const queued = validateRegisteredEngineeringOperationInput({
      operation: {
        ...MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
        bindings: [binding],
      },
      stage: "queue",
      basisKind: "thread-snapshot",
    });
    assertEquals(queued.bindings, [binding]);

    for (
      const bindings of [
        [],
        [{
          ...binding,
          source: {
            ...binding.source,
            reference: {
              ...binding.source.reference,
              kind: "requirement" as const,
            },
          },
        }],
        [binding, structuredClone(binding)],
      ]
    ) {
      const error = assertThrows(
        () =>
          validateRegisteredEngineeringOperationInput({
            operation: {
              ...MODEL_CAPTURE_PART_DEFINITIONS_OPERATION,
              bindings,
            },
            stage: "planning",
          }),
        EngineeringOperationRegistryError,
      );
      assertEquals(error.code, "invalid_bindings");
    }
  },
);

Deno.test("model.seal-architecture-sysml@1 is a provider-free Thread-document seal", () => {
  const registered = getRegisteredEngineeringOperation(
    MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION,
  )!;
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.workItemKind, "architect");
  assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(registered.bindings, []);
});

Deno.test("the qualified local Modelica kit is a consequential zero-binding operation", () => {
  const registered = getRegisteredEngineeringOperation(
    SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  )!;

  assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(registered.workItemKind, "simulate");
  assertEquals(registered.riskClass, "consequential");
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.resolvedOperationPlan, undefined);
  assertEquals(registered.bindings, []);

  const queued = validateRegisteredEngineeringOperationInput({
    operation: {
      ...SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
      bindings: [],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(queued.bindings, []);

  const extraBinding = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
          bindings: [{
            name: "modelicaSource",
            source: {
              kind: "thread-entity",
              reference: {
                snapshotId: "thread.snapshot.7",
                snapshotRevision: 7,
                kind: "artifact",
                id: "artifact.caller-selected-modelica",
              },
            },
          }],
        },
        stage: "planning",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(extraBinding.code, "invalid_bindings");
});

Deno.test("technical compilation admission is one consequential trusted Thread operation", () => {
  const operation = getRegisteredEngineeringOperation(
    COMPILE_SEAL_ADMISSION_OPERATION,
  )!;

  assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(operation.workItemKind, "review");
  assertEquals(operation.riskClass, "consequential");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(operation.bindings, [{
    name: "sysmlModel",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
  }]);
});

Deno.test("technical compilation admission requires its exact SysML artifact and Thread basis", () => {
  const binding = {
    name: "sysmlModel",
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: "thread.snapshot.7",
        snapshotRevision: 7,
        kind: "artifact" as const,
        id: "artifact.sysml.model.4",
      },
    },
  };
  const queued = validateRegisteredEngineeringOperationInput({
    operation: {
      ...COMPILE_SEAL_ADMISSION_OPERATION,
      bindings: [binding],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(queued.operation.id, COMPILE_SEAL_ADMISSION_OPERATION.id);
  assertEquals(queued.bindings, [binding]);

  const wrongBasis = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...COMPILE_SEAL_ADMISSION_OPERATION,
          bindings: [binding],
        },
        stage: "queue",
        basisKind: "approved-brief",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(wrongBasis.code, "unsupported_basis");

  for (
    const bindings of [
      [],
      [{
        ...binding,
        source: {
          ...binding.source,
          reference: {
            ...binding.source.reference,
            kind: "requirement" as const,
          },
        },
      }],
      [binding, structuredClone(binding)],
    ]
  ) {
    const error = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...COMPILE_SEAL_ADMISSION_OPERATION,
            bindings,
          },
          stage: "planning",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(error.code, "invalid_bindings");
  }
});

Deno.test("Build123d execution is consequential and binds one exact compilation admission artifact", () => {
  const operation = getRegisteredEngineeringOperation(
    DESIGN_EXECUTE_BUILD123D_OPERATION,
  )!;

  assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(operation.workItemKind, "design");
  assertEquals(operation.riskClass, "consequential");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(operation.bindings, [{
    name: "compilationAdmission",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
  }]);
});

Deno.test("isolated geometry seal is a provider-free Thread-document seal of one execution capture", () => {
  const operation = getRegisteredEngineeringOperation(
    DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  )!;

  assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(operation.workItemKind, "design");
  assertEquals(operation.riskClass, "consequential");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(operation.bindings, [{
    name: "executionCapture",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
  }]);

  const binding = {
    name: "executionCapture",
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: "thread.snapshot.9",
        snapshotRevision: 9,
        kind: "artifact" as const,
        id: `build123d-execution-capture-${"a".repeat(64)}`,
      },
    },
  };
  const queued = validateRegisteredEngineeringOperationInput({
    operation: {
      ...DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
      bindings: [binding],
    },
    stage: "queue",
    basisKind: "thread-snapshot",
  });
  assertEquals(queued.bindings, [binding]);

  const stepBinding = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
          bindings: [{
            ...binding,
            source: {
              ...binding.source,
              reference: {
                ...binding.source.reference,
                kind: "requirement" as const,
              },
            },
          }],
        },
        stage: "planning",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(stepBinding.code, "invalid_bindings");
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
