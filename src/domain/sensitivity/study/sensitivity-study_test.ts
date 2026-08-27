import { assertEquals, assertThrows } from "@std/assert";
import {
  computeSensitivities,
  SENSITIVITY_STUDY_CASE_SCHEMA,
  type SensitivityMetricMeasurement,
  validateSensitivityStudyCase,
} from "./sensitivity-study.ts";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal valid case JSON that passes all validators. */
function minimalCaseJson(): Record<string, unknown> {
  return {
    schemaVersion: "sensitivity-study-case/1.0",
    id: "test-sensitivity-case-v1",
    revision: 1,
    scope: "Unit test scope.",
    evidenceBoundary: "Unit test boundary — not a verdict.",
    project: { id: "test-project", subjectId: "project:test-project" },
    target: { componentKey: "cantilever", semanticKey: "length" },
    recipeSource: {
      schemaVersion: "parametric-geometry-recipe/1.0",
      key: "test-recipe",
    },
    baseValue: { value: 30, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [
      { id: "assembly_max_displacement", unit: "mm" },
      { id: "assembly_max_von_mises", unit: "MPa" },
    ],
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 5 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 2200,
        nu: 0.35,
        basis: "Test PPMA nominal.",
      },
      supports: [
        {
          id: "rear-wall",
          kind: "fixed",
          selection: {
            name: "FIXED",
            box: { min: [-96, 66.5, -16], max: [96, 68.5, 16], unit: "mm" },
          },
        },
      ],
      loads: [
        {
          id: "front-face",
          kind: "force",
          selection: {
            name: "LOADED",
            box: { min: [-96, -68.5, -16], max: [96, -66.5, 16], unit: "mm" },
          },
          force: { value: [0, 0, -100], unit: "N" },
        },
      ],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Valid near 30 mm only.",
      limitations: ["Step h = 2 mm rejected for box margin reasons."],
    },
  };
}

function baseMap(): Map<string, SensitivityMetricMeasurement> {
  return new Map([
    // 0.5 and 10 are exact binary fractions — no IEEE 754 rounding on differences.
    ["assembly_max_displacement", { value: 0.5, unit: "mm" }],
    ["assembly_max_von_mises", { value: 10, unit: "MPa" }],
  ]);
}

function steppedMap(): Map<string, SensitivityMetricMeasurement> {
  return new Map([
    // 1.5 - 0.5 = 1.0 exactly; 8 - 10 = -2 exactly.
    ["assembly_max_displacement", { value: 1.5, unit: "mm" }],
    ["assembly_max_von_mises", { value: 8, unit: "MPa" }],
  ]);
}

// ---------------------------------------------------------------------------
// validateSensitivityStudyCase
// ---------------------------------------------------------------------------

Deno.test(
  "validateSensitivityStudyCase accepts a minimal conforming case and freezes the result",
  () => {
    const sc = validateSensitivityStudyCase(minimalCaseJson());
    assertEquals(sc.schemaVersion, SENSITIVITY_STUDY_CASE_SCHEMA);
    assertEquals(sc.id, "test-sensitivity-case-v1");
    assertEquals(sc.revision, 1);
    assertEquals(sc.baseValue, { value: 30, unit: "mm" });
    assertEquals(sc.step, { value: 1, unit: "mm" });
    assertEquals(sc.metrics.length, 2);
    assertEquals(sc.solver.provider, "calculix");
    assertEquals(sc.domain.approximationOrder, "first-order-forward");
    assertEquals(Object.isFrozen(sc), true);
    assertEquals(Object.isFrozen(sc.metrics), true);
    assertEquals(Object.isFrozen(sc.solver.supports), true);
  },
);

Deno.test("validateSensitivityStudyCase rejects step value of zero", () => {
  const bad = { ...minimalCaseJson(), step: { value: 0, unit: "mm" } };
  assertThrows(
    () => validateSensitivityStudyCase(bad),
    TypeError,
    "$case.step.value must not be zero",
  );
});

Deno.test("validateSensitivityStudyCase rejects a non-finite step value", () => {
  const bad = { ...minimalCaseJson(), step: { value: Infinity, unit: "mm" } };
  assertThrows(() => validateSensitivityStudyCase(bad), TypeError);
});

Deno.test("validateSensitivityStudyCase rejects an unsupported root field", () => {
  const bad = { ...minimalCaseJson(), unexpectedField: "surprise" };
  assertThrows(
    () => validateSensitivityStudyCase(bad),
    TypeError,
    "unsupported field",
  );
});

Deno.test("validateSensitivityStudyCase rejects a missing required root field", () => {
  const { evidenceBoundary: _drop, ...bad } = minimalCaseJson();
  assertThrows(() => validateSensitivityStudyCase(bad), TypeError, "required");
});

Deno.test("validateSensitivityStudyCase rejects duplicate metric ids", () => {
  const bad = {
    ...minimalCaseJson(),
    metrics: [
      { id: "assembly_max_displacement", unit: "mm" },
      { id: "assembly_max_displacement", unit: "mm" },
    ],
  };
  assertThrows(() => validateSensitivityStudyCase(bad), TypeError, "duplicates");
});

Deno.test("validateSensitivityStudyCase rejects an empty limitations array", () => {
  const base = minimalCaseJson();
  const bad = {
    ...base,
    domain: { ...(base.domain as Record<string, unknown>), limitations: [] },
  };
  assertThrows(() => validateSensitivityStudyCase(bad), TypeError, "must not be empty");
});

Deno.test("validateSensitivityStudyCase rejects Poisson ratio >= 0.5", () => {
  const base = minimalCaseJson();
  const badMaterial = {
    model: "isotropic-linear-elastic",
    eMpa: 2200,
    nu: 0.5,
    basis: "test",
  };
  const bad = {
    ...base,
    solver: { ...(base.solver as Record<string, unknown>), material: badMaterial },
  };
  assertThrows(() => validateSensitivityStudyCase(bad), TypeError, "0.5");
});

// ---------------------------------------------------------------------------
// computeSensitivities
// ---------------------------------------------------------------------------

Deno.test(
  "computeSensitivities returns exact derivative on known metric values",
  () => {
    const sc = validateSensitivityStudyCase(minimalCaseJson());
    const result = computeSensitivities(sc, baseMap(), steppedMap());

    assertEquals(result.domain.base, 30);
    assertEquals(result.domain.step, 1);
    assertEquals(result.domain.parameterUnit, "mm");
    assertEquals(result.derivatives.length, 2);

    // (1.5 - 0.5) / 1 = 1.0 exactly in IEEE 754.
    const dispDeriv = result.derivatives.find(
      (d) => d.metric === "assembly_max_displacement",
    );
    assertEquals(dispDeriv?.value, 1.0);
    assertEquals(dispDeriv?.unit, "mm/mm");

    // (8 - 10) / 1 = -2 exactly in IEEE 754.
    const stressDeriv = result.derivatives.find(
      (d) => d.metric === "assembly_max_von_mises",
    );
    assertEquals(stressDeriv?.value, -2);
    assertEquals(stressDeriv?.unit, "MPa/mm");
  },
);

Deno.test("computeSensitivities result is frozen", () => {
  const sc = validateSensitivityStudyCase(minimalCaseJson());
  const result = computeSensitivities(sc, baseMap(), steppedMap());
  assertEquals(Object.isFrozen(result), true);
  assertEquals(Object.isFrozen(result.derivatives), true);
});

Deno.test("computeSensitivities rejects base measurement with wrong unit", () => {
  const sc = validateSensitivityStudyCase(minimalCaseJson());
  const wrongBase = new Map(baseMap());
  wrongBase.set("assembly_max_displacement", { value: 0.5, unit: "MPa" });
  assertThrows(
    () => computeSensitivities(sc, wrongBase, steppedMap()),
    TypeError,
    "unit mismatch",
  );
});

Deno.test("computeSensitivities rejects stepped measurement with wrong unit", () => {
  const sc = validateSensitivityStudyCase(minimalCaseJson());
  const wrongStepped = new Map(steppedMap());
  wrongStepped.set("assembly_max_von_mises", { value: 9, unit: "mm" });
  assertThrows(
    () => computeSensitivities(sc, baseMap(), wrongStepped),
    TypeError,
    "unit mismatch",
  );
});

Deno.test("computeSensitivities rejects a missing base measurement", () => {
  const sc = validateSensitivityStudyCase(minimalCaseJson());
  const partial = new Map(baseMap());
  partial.delete("assembly_max_displacement");
  assertThrows(
    () => computeSensitivities(sc, partial, steppedMap()),
    TypeError,
    "base measurement not found",
  );
});

Deno.test("computeSensitivities rejects a missing stepped measurement", () => {
  const sc = validateSensitivityStudyCase(minimalCaseJson());
  const partial = new Map(steppedMap());
  partial.delete("assembly_max_von_mises");
  assertThrows(
    () => computeSensitivities(sc, baseMap(), partial),
    TypeError,
    "stepped measurement not found",
  );
});
