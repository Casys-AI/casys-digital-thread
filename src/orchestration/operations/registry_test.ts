import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  engineeringOperationRegistry,
  EngineeringOperationRegistryError,
  getRegisteredEngineeringOperation,
  getRegisteredIntakeOperation,
  requireRegisteredEngineeringOperation,
  validateRegisteredEngineeringOperationInput,
} from "./registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../domain/architecture/seed/syson-model-seed.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "./fea-isolated-static-proof.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../domain/compile/admission/technical-compilation-proposal.ts";

import { MODEL_SEAL_ARCHITECTURE_SYSML_OPERATION } from "../../domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts";
import { MODEL_CAPTURE_PART_DEFINITIONS_OPERATION } from "../../domain/architecture/part-definitions/part-definitions-capture.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../domain/cad/isolated/build123d-execution-proposal.ts";
import { DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION } from "../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import { VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION } from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-proposal.ts";
import { DESIGN_APPLY_VECTOR_CORRECTION_OPERATION } from "../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import {
  DESIGN_PREVIEW_GEOMETRY_OPERATION,
} from "../../domain/cad/canonical/geometry-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../domain/modelica/admitted/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../../domain/electrical/spice/admitted/run-proposal.ts";
import { VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION } from "../../domain/electrical/observation-method-sheet-proposal.ts";
import { VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION } from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
} from "../../domain/electrical/spice/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import { VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION } from "../../domain/modelica/thermal-method-sheet-proposal.ts";
import { VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION } from "../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION } from "../../domain/impact/cross-domain-impact-mechanical-preservation-proposal.ts";
import { VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION } from "../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
} from "../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
  DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
} from "../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
} from "../../domain/make/printability/printability-proposal.ts";
import {
  INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
} from "../../domain/make/print-estimate/print-estimate-proposal.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
} from "../../domain/make/dfm/dfm-proposal.ts";

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

Deno.test("the SysON seed must depend on the unique approved-brief baseline work item", () => {
  const seed = getRegisteredEngineeringOperation(SYSON_MODEL_SEED_OPERATION)!;
  assertEquals(seed.requiresAdditiveChange, true);
  assertEquals(seed.requiresDependsOnOperation, {
    id: "baseline.from-approved-brief",
    version: "1",
  });
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

Deno.test("cross-domain impact-manifest seal is a provider-free review with only the approved brief binding", () => {
  const operation = getRegisteredEngineeringOperation(
    VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
  )!;
  assertEquals(operation.workItemKind, "review");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);
  assertEquals(operation.decisionEvidenceScope, undefined);
});

Deno.test("assembly-integrity L4 is a trusted consequential zero-binding verdict recross", () => {
  const operation = getRegisteredEngineeringOperation(
    VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
  )!;
  assertEquals(operation.workItemKind, "verify");
  assertEquals(operation.riskClass, "consequential");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.requiresAdditiveChange, true);
  assertEquals(
    operation.requiresDependsOnOperation,
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
  );
  assertEquals(operation.bindings, []);

  const error = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
          bindings: [{
            name: "callerSelectedTolerance",
            source: {
              kind: "thread-entity" as const,
              reference: {
                snapshotId: "thread.snapshot.9",
                snapshotRevision: 9,
                kind: "artifact" as const,
                id: "artifact.tolerance",
              },
            },
          }],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(error.code, "invalid_bindings");
});

Deno.test("cross-domain impact evaluation follows the manifest seal without an MRTR or caller-selected artifact binding", () => {
  const operation = getRegisteredEngineeringOperation(
    ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
  )!;
  assertEquals(operation.workItemKind, "review");
  assertEquals(operation.riskClass, "low");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.requiresAdditiveChange, true);
  assertEquals(
    operation.requiresDependsOnOperation,
    VERIFY_SEAL_CROSS_DOMAIN_IMPACT_MANIFEST_OPERATION,
  );
  assertEquals(operation.decisionEvidenceScope, undefined);
  assertEquals(operation.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);
});

Deno.test("cross-domain impact decision is human-only, additive after evaluation, and approvedBrief only", () => {
  const operation = getRegisteredEngineeringOperation(
    DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  )!;
  assertEquals(operation.workItemKind, "review");
  assertEquals(operation.riskClass, "consequential");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.mustOrigin, "human");
  assertEquals(operation.requiresAdditiveChange, true);
  assertEquals(
    operation.requiresDependsOnOperation,
    ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
  );
  assertEquals(operation.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);

  const extras = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
          bindings: [{
            name: "providerEnvelope",
            source: {
              kind: "thread-entity" as const,
              reference: {
                snapshotId: "thread.snapshot.9",
                snapshotRevision: 9,
                kind: "artifact" as const,
                id: "artifact.provider",
              },
            },
          }],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(extras.code, "invalid_bindings");
});

Deno.test("mechanical preservation follows the impact decision without MRTR, CalculiX, or caller-selected artifacts", () => {
  const operation = getRegisteredEngineeringOperation(
    ANALYZE_EVALUATE_MECHANICAL_PRESERVATION_OPERATION,
  )!;
  assertEquals(operation.workItemKind, "review");
  assertEquals(operation.riskClass, "low");
  assertEquals(operation.execution, "trusted");
  assertEquals(operation.requiresAdditiveChange, true);
  assertEquals(
    operation.requiresDependsOnOperation,
    DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  );
  assertEquals(operation.decisionEvidenceScope, undefined);
  assertEquals(operation.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);
  assertEquals(operation.description.includes("CalculiX"), true);
});

Deno.test("historical MCP FEA and recorded Modelica versions are neither lookupable nor queueable", () => {
  for (
    const operation of [
      { id: "verify.run-fea-static-proof", version: "1" },
      VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
      { id: "simulate.seal-simulation-case", version: "1" },
      { id: "simulate.seal-simulation-case", version: "2" },
      { id: "simulate.run-modelica-scenario", version: "1" },
      { id: "simulate.run-modelica-scenario", version: "2" },
    ]
  ) {
    assertEquals(getRegisteredEngineeringOperation(operation), undefined);
    const error = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: { ...operation, bindings: [] },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(error.code, "unknown_operation");
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

Deno.test("assembly-integrity observation is trusted and binds exactly one canonical geometry module artifact", () => {
  const registered = getRegisteredEngineeringOperation(
    VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
  )!;
  assertEquals(registered.workItemKind, "verify");
  assertEquals(registered.riskClass, "consequential");
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
  assertEquals(registered.bindings, [{
    name: "geometryModule",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
    uniqueThreadEntityReferences: true,
  }]);

  const binding = {
    name: "geometryModule",
    source: {
      kind: "thread-entity" as const,
      reference: {
        snapshotId: "thread.snapshot.12",
        snapshotRevision: 12,
        kind: "artifact" as const,
        id: "geometry-" + "a".repeat(64),
      },
    },
  };
  const planned = validateRegisteredEngineeringOperationInput({
    operation: {
      ...VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
      bindings: [binding],
    },
    stage: "planning",
  });
  assertEquals(planned.bindings, [binding]);

  for (
    const bindings of [
      [],
      [binding, structuredClone(binding)],
      [{
        ...binding,
        source: {
          ...binding.source,
          reference: { ...binding.source.reference, kind: "observation" as const },
        },
      }],
    ]
  ) {
    const error = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
            bindings,
          },
          stage: "planning",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(error.code, "invalid_bindings");
  }
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

Deno.test("the registry lists the three sensitivity operations as trusted and not ROP 2.0", () => {
  const seal = getRegisteredEngineeringOperation(
    ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  )!;
  const run = getRegisteredEngineeringOperation(
    ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  )!;
  const write = getRegisteredEngineeringOperation(
    MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  )!;
  for (const registered of [seal, run, write]) {
    assertEquals(registered.execution, "trusted");
    assertEquals(registered.resolvedOperationPlan, undefined);
  }
  assertEquals(seal.workItemKind, "review");
  assertEquals(run.workItemKind, "simulate");
  assertEquals(run.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(run.bindings.map((binding) => binding.name), ["studyCase"]);
  assertEquals(write.workItemKind, "architect");
  assertEquals(write.bindings.map((binding) => binding.name), ["studyCapture"]);
});

Deno.test("verify.evaluate-sensitivity-base@1 is a trusted SysON join, not a sensitivity run", () => {
  const registered = getRegisteredEngineeringOperation(
    VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
  )!;
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.workItemKind, "verify");
  assertEquals(registered.riskClass, "consequential");
  assertEquals(registered.resolvedOperationPlan, undefined);
  assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(registered.bindings.map((binding) => binding.name), ["studyCapture"]);
});

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

Deno.test("admitted Modelica execution binds one compilation admission and refuses caller source", () => {
  const registered = getRegisteredEngineeringOperation(
    SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  )!;
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.workItemKind, "simulate");
  assertEquals(registered.riskClass, "consequential");
  assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(registered.bindings, [{
    name: "compilationAdmission",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
  }]);

  const extraBinding = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
          bindings: [
            {
              name: "compilationAdmission",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: "thread.snapshot.7",
                  snapshotRevision: 7,
                  kind: "artifact",
                  id: "artifact.admission",
                },
              },
            },
            {
              name: "modelicaText",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: "thread.snapshot.7",
                  snapshotRevision: 7,
                  kind: "artifact",
                  id: "artifact.caller-selected-modelica",
                },
              },
            },
          ],
        },
        stage: "planning",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(extraBinding.code, "invalid_bindings");
});

Deno.test("admitted SPICE execution binds one compilation admission and refuses caller source", () => {
  const registered = getRegisteredEngineeringOperation(
    SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  )!;
  assertEquals(registered.execution, "trusted");
  assertEquals(registered.workItemKind, "simulate");
  assertEquals(registered.riskClass, "consequential");
  assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(registered.bindings, [{
    name: "compilationAdmission",
    allowedSourceKinds: ["thread-entity"],
    cardinality: "one",
    allowedThreadEntityKinds: ["artifact"],
  }]);

  const extraBinding = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
          bindings: [
            {
              name: "compilationAdmission",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: "thread.snapshot.7",
                  snapshotRevision: 7,
                  kind: "artifact",
                  id: "artifact.admission",
                },
              },
            },
            {
              name: "sourceText",
              source: {
                kind: "thread-entity",
                reference: {
                  snapshotId: "thread.snapshot.7",
                  snapshotRevision: 7,
                  kind: "artifact",
                  id: "artifact.caller-selected-spice",
                },
              },
            },
          ],
        },
        stage: "planning",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(extraBinding.code, "invalid_bindings");
});

Deno.test("compile.seal-admission@1, compile.seal-admission@2 and compile.capture-corrected-source@1 are unknown operations", () => {
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "compile.seal-admission",
      version: "1",
    }),
    undefined,
  );
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "compile.seal-admission",
      version: "2",
    }),
    undefined,
  );
  assertEquals(
    getRegisteredEngineeringOperation({
      id: "compile.capture-corrected-source",
      version: "1",
    }),
    undefined,
  );
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

Deno.test(
  "thermal method-sheet seal is a provider-free Thread-document seal with approvedBrief only",
  () => {
    const operation = getRegisteredEngineeringOperation(
      VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
    )!;

    assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(operation.workItemKind, "verify");
    assertEquals(operation.riskClass, "consequential");
    assertEquals(operation.execution, "trusted");
    assertEquals(operation.bindings, [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }]);

    const binding = {
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    };
    const queued = validateRegisteredEngineeringOperationInput({
      operation: {
        ...VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
        bindings: [binding],
      },
      stage: "queue",
      basisKind: "thread-snapshot",
    });
    assertEquals(queued.bindings, [binding]);

    const extras = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
            bindings: [{
              name: "executionCapture",
              source: {
                kind: "thread-entity" as const,
                reference: {
                  snapshotId: "thread.snapshot.9",
                  snapshotRevision: 9,
                  kind: "artifact" as const,
                  id: "artifact.omc",
                },
              },
            }],
          },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(extras.code, "invalid_bindings");
  },
);

Deno.test(
  "admitted observation evaluation is a trusted SysON join with approvedBrief only",
  () => {
    const operation = getRegisteredEngineeringOperation(
      VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
    )!;
    assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(operation.workItemKind, "verify");
    assertEquals(operation.riskClass, "consequential");
    assertEquals(operation.execution, "trusted");
    assertEquals(operation.bindings, [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }]);

    const extras = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...VERIFY_EVALUATE_ADMITTED_MODELICA_OBSERVATIONS_OPERATION,
            bindings: [{
              name: "sysonEnvelope",
              source: {
                kind: "thread-entity" as const,
                reference: {
                  snapshotId: "thread.snapshot.9",
                  snapshotRevision: 9,
                  kind: "artifact" as const,
                  id: "artifact.syson",
                },
              },
            }],
          },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(extras.code, "invalid_bindings");
  },
);

Deno.test(
  "design.apply-vector-correction@1 is a trusted low-risk documentary seal of one evaluation and one study capture",
  () => {
    const registered = getRegisteredEngineeringOperation(
      DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
    )!;
    assertEquals(registered.execution, "trusted");
    assertEquals(registered.riskClass, "low");
    assertEquals(registered.workItemKind, "design");
    assertEquals(registered.decisionEvidenceScope, "thread-entity-bindings");
    assertEquals(registered.resolvedOperationPlan, undefined);
    assertEquals(registered.bindings, [
      {
        name: "failingEvaluation",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["evaluation"],
      },
      {
        name: "studyCapture",
        allowedSourceKinds: ["thread-entity"],
        cardinality: "one",
        allowedThreadEntityKinds: ["artifact"],
      },
    ]);
    assertEquals(
      registered.bindings.some((binding) => binding.name === "sensitivityEdges"),
      false,
    );
  },
);

Deno.test(
  "the registry refuses a failingEvaluation that is not kind: evaluation and a studyCapture that is not kind: artifact",
  () => {
    const evaluationBinding = {
      name: "failingEvaluation",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: "thread.snapshot.4",
          snapshotRevision: 4,
          kind: "evaluation" as const,
          id: "eval.fail",
        },
      },
    };
    const studyBinding = {
      name: "studyCapture",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: "thread.snapshot.4",
          snapshotRevision: 4,
          kind: "artifact" as const,
          id: `sensitivity-study-${"a".repeat(64)}`,
        },
      },
    };
    const queued = validateRegisteredEngineeringOperationInput({
      operation: {
        ...DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
        bindings: [evaluationBinding, studyBinding],
      },
      stage: "queue",
      basisKind: "thread-snapshot",
    });
    assertEquals(queued.bindings, [evaluationBinding, studyBinding]);

    const wrongEvaluationKind = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            bindings: [{
              ...evaluationBinding,
              source: {
                ...evaluationBinding.source,
                reference: {
                  ...evaluationBinding.source.reference,
                  kind: "artifact" as const,
                },
              },
            }, studyBinding],
          },
          stage: "planning",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(wrongEvaluationKind.code, "invalid_bindings");

    const wrongStudyKind = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            bindings: [evaluationBinding, {
              ...studyBinding,
              source: {
                ...studyBinding.source,
                reference: {
                  ...studyBinding.source.reference,
                  kind: "evaluation" as const,
                },
              },
            }],
          },
          stage: "planning",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(wrongStudyKind.code, "invalid_bindings");

    const extraEvaluation = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...DESIGN_APPLY_VECTOR_CORRECTION_OPERATION,
            bindings: [
              evaluationBinding,
              structuredClone(evaluationBinding),
              studyBinding,
            ],
          },
          stage: "planning",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(extraEvaluation.code, "invalid_bindings");
  },
);

Deno.test("design.preview-geometry@1 is neither lookupable nor queueable", () => {
  assertEquals(
    getRegisteredEngineeringOperation(DESIGN_PREVIEW_GEOMETRY_OPERATION),
    undefined,
  );
  const error = assertThrows(
    () =>
      validateRegisteredEngineeringOperationInput({
        operation: {
          ...DESIGN_PREVIEW_GEOMETRY_OPERATION,
          bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" } }],
        },
        stage: "queue",
        basisKind: "thread-snapshot",
      }),
    EngineeringOperationRegistryError,
  );
  assertEquals(error.code, "unknown_operation");
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

Deno.test("retired inspection-drone operations are neither lookupable nor queueable", () => {
  const retired = [
    {
      id: "architecture.author-inspection-drone",
      version: "3",
    },
    {
      id: "model.capture-inspection-drone-part-definitions",
      version: "1",
    },
  ] as const;
  for (const operation of retired) {
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
  }
});

Deno.test("retired CM-01 operations are neither lookupable nor queueable", () => {
  const retired = [
    {
      id: "verify.coffee-machine-cm01-drip-tray-mechanical",
      version: "3",
    },
    {
      id: "industrialize.observe-coffee-machine-cm01-drip-tray-printability",
      version: "1",
    },
    {
      id: "industrialize.observe-coffee-machine-cm01-drip-tray-print-estimate",
      version: "1",
    },
  ] as const;
  for (const operation of retired) {
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
  }
});

Deno.test("generic DFM seal and observe operations are registered with the reviewed risk split", () => {
  const sealPrintability = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_SEAL_PRINTABILITY_CASE_OPERATION,
  )!;
  assertEquals(sealPrintability.execution, "trusted");
  assertEquals(sealPrintability.riskClass, "consequential");
  assertEquals(sealPrintability.workItemKind, "industrialize");
  assertEquals(sealPrintability.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);

  const observePrintability = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  )!;
  assertEquals(observePrintability.execution, "trusted");
  assertEquals(observePrintability.riskClass, "low");
  assertEquals(observePrintability.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(observePrintability.bindings.map((binding) => binding.name), [
    "printabilityCase",
    "geometry",
  ]);

  const sealEstimate = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
  )!;
  assertEquals(sealEstimate.execution, "trusted");
  assertEquals(sealEstimate.riskClass, "consequential");
  assertEquals(sealEstimate.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);

  const observeEstimate = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
  )!;
  assertEquals(observeEstimate.execution, "trusted");
  assertEquals(observeEstimate.riskClass, "low");
  assertEquals(observeEstimate.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(observeEstimate.bindings.map((binding) => binding.name), [
    "printEstimateCase",
    "geometry",
  ]);
});

Deno.test("measured DFM seal and run operations are registered without replacing printability", () => {
  const seal = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION,
  )!;
  assertEquals(seal.execution, "trusted");
  assertEquals(seal.riskClass, "consequential");
  assertEquals(seal.workItemKind, "industrialize");
  assertEquals(seal.bindings, [{
    name: "approvedBrief",
    allowedSourceKinds: ["approved-brief"],
  }]);

  const run = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  )!;
  assertEquals(run.execution, "trusted");
  assertEquals(run.riskClass, "consequential");
  assertEquals(run.decisionEvidenceScope, "thread-entity-bindings");
  assertEquals(run.bindings.map((binding) => binding.name), ["dfmCase", "geometry"]);

  const documentary = getRegisteredEngineeringOperation(
    INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
  )!;
  assertEquals(documentary.id, "industrialize.observe-printability");
  assertEquals(documentary.riskClass, "low");
});

Deno.test("a human-only operation declares its origin so a human can reach it", () => {
  const humanOnly = [
    { id: "record.reconcile-uncertain-writer", version: "1" },
    DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
    DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
    DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
    DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
    DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
  ];
  for (const operation of humanOnly) {
    const registered = getRegisteredEngineeringOperation(operation)!;
    // The executor refuses an agent origin. Without this declaration the surface
    // that dispatches runs cannot know to offer the operator its elicitation, so
    // the run becomes executable by nobody.
    assertEquals(registered.mustOrigin, "human");
  }
});

Deno.test(
  "admitted SPICE observation evaluation is a trusted closed comparator with approvedBrief only",
  () => {
    const operation = getRegisteredEngineeringOperation(
      VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
    )!;
    assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(operation.workItemKind, "verify");
    assertEquals(operation.riskClass, "consequential");
    assertEquals(operation.execution, "trusted");
    assertEquals(operation.bindings, [{
      name: "approvedBrief",
      allowedSourceKinds: ["approved-brief"],
    }]);

    const extras = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...VERIFY_EVALUATE_ADMITTED_SPICE_OBSERVATIONS_OPERATION,
            bindings: [{
              name: "ngspiceEnvelope",
              source: {
                kind: "thread-entity" as const,
                reference: {
                  snapshotId: "thread.snapshot.9",
                  snapshotRevision: 9,
                  kind: "artifact" as const,
                  id: "artifact.ngspice",
                },
              },
            }],
          },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(extras.code, "invalid_bindings");
  },
);

Deno.test(
  "electrical observation method-sheet seal is trusted, approvedBrief only, and rejects engine bindings",
  () => {
    const operation = getRegisteredEngineeringOperation(
      VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
    )!;
    assertEquals(operation.allowedBasisKinds, ["thread-snapshot"]);
    assertEquals(operation.workItemKind, "verify");
    assertEquals(operation.execution, "trusted");
    const extras = assertThrows(
      () =>
        validateRegisteredEngineeringOperationInput({
          operation: {
            ...VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
            bindings: [{
              name: "executionCapture",
              source: {
                kind: "thread-entity" as const,
                reference: {
                  snapshotId: "thread.snapshot.9",
                  snapshotRevision: 9,
                  kind: "artifact" as const,
                  id: "artifact.ngspice",
                },
              },
            }],
          },
          stage: "queue",
          basisKind: "thread-snapshot",
        }),
      EngineeringOperationRegistryError,
    );
    assertEquals(extras.code, "invalid_bindings");
  },
);

Deno.test(
  "admitted Modelica evaluation closeout is human-only, approvedBrief only, and rejects engine bindings",
  () => {
    for (
      const operation of [
        DECIDE_ACCEPT_ADMITTED_MODELICA_EVALUATION_OPERATION,
        DECIDE_REJECT_ADMITTED_MODELICA_EVALUATION_OPERATION,
      ]
    ) {
      const registered = getRegisteredEngineeringOperation(operation)!;
      assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
      assertEquals(registered.workItemKind, "review");
      assertEquals(registered.riskClass, "consequential");
      assertEquals(registered.execution, "trusted");
      assertEquals(registered.mustOrigin, "human");
      assertEquals(registered.bindings, [{
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      }]);

      const extras = assertThrows(
        () =>
          validateRegisteredEngineeringOperationInput({
            operation: {
              ...operation,
              bindings: [{
                name: "sysonEnvelope",
                source: {
                  kind: "thread-entity" as const,
                  reference: {
                    snapshotId: "thread.snapshot.9",
                    snapshotRevision: 9,
                    kind: "artifact" as const,
                    id: "artifact.syson",
                  },
                },
              }],
            },
            stage: "queue",
            basisKind: "thread-snapshot",
          }),
        EngineeringOperationRegistryError,
      );
      assertEquals(extras.code, "invalid_bindings");
    }
  },
);

Deno.test(
  "admitted SPICE evaluation closeout is human-only, approvedBrief only, and rejects engine bindings",
  () => {
    for (
      const operation of [
        DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
        DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
      ]
    ) {
      const registered = getRegisteredEngineeringOperation(operation)!;
      assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
      assertEquals(registered.workItemKind, "review");
      assertEquals(registered.riskClass, "consequential");
      assertEquals(registered.execution, "trusted");
      assertEquals(registered.mustOrigin, "human");
      assertEquals(registered.bindings, [{
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      }]);

      const extras = assertThrows(
        () =>
          validateRegisteredEngineeringOperationInput({
            operation: {
              ...operation,
              bindings: [{
                name: "ngspiceEnvelope",
                source: {
                  kind: "thread-entity" as const,
                  reference: {
                    snapshotId: "thread.snapshot.9",
                    snapshotRevision: 9,
                    kind: "artifact" as const,
                    id: "artifact.ngspice",
                  },
                },
              }],
            },
            stage: "queue",
            basisKind: "thread-snapshot",
          }),
        EngineeringOperationRegistryError,
      );
      assertEquals(extras.code, "invalid_bindings");
    }
  },
);

Deno.test(
  "assembly-integrity L5 closeout is human-only, appended after the L4 dependency, and has no caller evidence binding",
  () => {
    for (
      const operation of [
        DECIDE_ACCEPT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
        DECIDE_REJECT_ASSEMBLY_INTEGRITY_EVALUATION_OPERATION,
      ]
    ) {
      const registered = getRegisteredEngineeringOperation(operation)!;
      assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
      assertEquals(registered.workItemKind, "review");
      assertEquals(registered.riskClass, "consequential");
      assertEquals(registered.execution, "trusted");
      assertEquals(registered.mustOrigin, "human");
      assertEquals(registered.requiresAdditiveChange, true);
      assertEquals(registered.requiresDependsOnOperation, {
        id: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
        version: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
      });
      assertEquals(registered.bindings, [{
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      }]);

      const extras = assertThrows(
        () =>
          validateRegisteredEngineeringOperationInput({
            operation: {
              ...operation,
              bindings: [{
                name: "providerOrGate",
                source: {
                  kind: "thread-entity" as const,
                  reference: {
                    snapshotId: "thread.snapshot.9",
                    snapshotRevision: 9,
                    kind: "artifact" as const,
                    id: "artifact.provider-or-gate",
                  },
                },
              }],
            },
            stage: "queue",
            basisKind: "thread-snapshot",
          }),
        EngineeringOperationRegistryError,
      );
      assertEquals(extras.code, "invalid_bindings");
    }
  },
);

Deno.test(
  "static-mechanical closeout operations are consequential approvedBrief-only agent dispatches after human MRTR",
  () => {
    for (
      const operation of [
        DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
        DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
      ]
    ) {
      const registered = getRegisteredEngineeringOperation(operation)!;
      assertEquals(registered.allowedBasisKinds, ["thread-snapshot"]);
      assertEquals(registered.workItemKind, "review");
      assertEquals(registered.riskClass, "consequential");
      assertEquals(registered.execution, "trusted");
      // `mustOrigin: human` would route lifecycle commands through the human
      // actor, but command policy reserves claim/publish/complete for the
      // registered agent. The executor independently requires a human MRTR.
      assertEquals(registered.mustOrigin, undefined);
      assertEquals(registered.bindings, [{
        name: "approvedBrief",
        allowedSourceKinds: ["approved-brief"],
      }]);

      const extras = assertThrows(
        () =>
          validateRegisteredEngineeringOperationInput({
            operation: {
              ...operation,
              bindings: [{
                name: "providerEnvelope",
                source: {
                  kind: "thread-entity" as const,
                  reference: {
                    snapshotId: "thread.snapshot.9",
                    snapshotRevision: 9,
                    kind: "artifact" as const,
                    id: "artifact.provider",
                  },
                },
              }],
            },
            stage: "queue",
            basisKind: "thread-snapshot",
          }),
        EngineeringOperationRegistryError,
      );
      assertEquals(extras.code, "invalid_bindings");
    }
  },
);
