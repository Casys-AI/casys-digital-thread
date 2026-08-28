import { assertEquals, assertThrows } from "@std/assert";
import {
  assertSensitivityLiveMethod,
  liveSolverObservationForMetric,
} from "./sensitivity-live-method.ts";
import { validateSensitivityStudyCaseV3 } from "./sensitivity-study-v3.ts";

function validCase(overrides: Record<string, unknown> = {}) {
  return validateSensitivityStudyCaseV3({
    schemaVersion: "sensitivity-study-case/3.0",
    id: "dl04-size-z-sensitivity",
    revision: 1,
    scope: "mechanical-structural",
    evidenceBoundary: "fea-static",
    project: { id: "desk-lamp-dl04", subjectId: "lamp-arm" },
    target: { componentKey: "arm", semanticKey: "size_z" },
    cadSource: {
      artifactUri: "thread-artifact://desk-lamp-dl04/compile-admission-abc123",
      sha256: "a".repeat(64),
    },
    baseValue: { value: 50, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
    method: {
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 3 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 70000,
        nu: 0.33,
        basis: "reviewed",
      },
      supports: [{
        id: "wall-mount",
        kind: "fixed",
        selection: {
          name: "Wall",
          box: { min: [0, 0, 0], max: [5, 5, 5], unit: "mm" },
        },
      }],
      loads: [{
        id: "tip-load",
        kind: "force",
        selection: {
          name: "Tip",
          box: { min: [10, 10, 10], max: [15, 15, 15], unit: "mm" },
        },
        force: { value: [0, 0, -10], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "local",
      limitations: ["Remeshing variation is included."],
    },
    ...overrides,
  });
}

Deno.test(
  "a case declaring remeshingVariationIncluded false cannot be sealed for the live CalculiX method",
  () => {
    const studyCase = validCase({
      domain: {
        approximationOrder: "first-order-forward",
        remeshingVariationIncluded: false,
        localValidityNote: "local",
        limitations: ["claimed no remesh"],
      },
    });
    assertThrows(
      () => assertSensitivityLiveMethod(studyCase),
      TypeError,
      "remeshingVariationIncluded",
    );
  },
);

Deno.test("an unknown metric id is rejected fail-closed", () => {
  const studyCase = validCase({
    metrics: [{ id: "invented_metric", unit: "mm" }],
  });
  assertThrows(
    () => assertSensitivityLiveMethod(studyCase),
    TypeError,
    "invented_metric",
  );
});

Deno.test("Thread requirement metric ids are admitted by the live method", () => {
  const studyCase = validCase({
    metrics: [
      { id: "maxDisplacement", unit: "mm" },
      { id: "maxVonMises", unit: "MPa" },
    ],
  });
  assertSensitivityLiveMethod(studyCase);
  assertEquals(
    liveSolverObservationForMetric("maxDisplacement"),
    "maximumDisplacement",
  );
  assertEquals(liveSolverObservationForMetric("maxVonMises"), "maximumVonMisesStress");
  assertEquals(
    liveSolverObservationForMetric("assembly_max_displacement"),
    "maximumDisplacement",
  );
});
