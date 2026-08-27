import { assertEquals, assertThrows } from "@std/assert";
import { computeSensitivities } from "./sensitivity-study.ts";
import {
  SENSITIVITY_STUDY_CASE_V2_SCHEMA,
  validateSensitivityStudyCaseV2,
} from "./sensitivity-study-v2.ts";

// Minimal valid 2.0 case used as a baseline across tests.
const VALID_CASE = {
  schemaVersion: "sensitivity-study-case/2.0",
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
  baseValue: { value: 50.0, unit: "mm" },
  step: { value: 1.0, unit: "mm" },
  metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
  solver: {
    provider: "calculix",
    tool: "calculix_solve_static",
    resultSchemaVersion: "2.0",
    mesh: { kind: "tetrahedral-volume", targetSizeMm: 3.0 },
    material: {
      model: "isotropic-linear-elastic",
      eMpa: 70000,
      nu: 0.33,
      basis: "dl04-aluminium-reviewed",
    },
    supports: [
      {
        id: "wall-mount",
        kind: "fixed",
        selection: {
          name: "Wall",
          box: { min: [0, 0, 0], max: [5, 5, 5], unit: "mm" },
        },
      },
    ],
    loads: [
      {
        id: "tip-load",
        kind: "force",
        selection: {
          name: "Tip",
          box: { min: [10, 10, 10], max: [15, 15, 15], unit: "mm" },
        },
        force: { value: [0, 0, -10], unit: "N" },
      },
    ],
  },
  domain: {
    approximationOrder: "first-order-forward",
    remeshingVariationIncluded: false,
    localValidityNote: "Valid for size_z in [49, 51] mm.",
    limitations: ["Remeshing variation not captured."],
  },
};

Deno.test("sensitivity-study-case/2.0 accepts a fully valid case", () => {
  const result = validateSensitivityStudyCaseV2(VALID_CASE);
  assertEquals(result.schemaVersion, SENSITIVITY_STUDY_CASE_V2_SCHEMA);
  assertEquals(result.cadSource.artifactUri, VALID_CASE.cadSource.artifactUri);
  assertEquals(result.cadSource.sha256, VALID_CASE.cadSource.sha256);
});

Deno.test(
  "sensitivity-study-case/2.0 rejects a value with the 1.0 schema version",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          schemaVersion: "sensitivity-study-case/1.0",
        }),
      TypeError,
    );
  },
);

Deno.test("sensitivity-study-case/2.0 rejects a legacy recipeSource key", () => {
  // A 1.0 case converted to 2.0 with recipeSource still present should fail.
  const withRecipe = {
    ...VALID_CASE,
    recipeSource: { schemaVersion: "build123d-recipe/1.0", key: "arm-v1" },
  };
  assertThrows(
    () => validateSensitivityStudyCaseV2(withRecipe),
    TypeError,
    // exactRecord rejects the unknown key
  );
});

Deno.test(
  "sensitivity-study-case/2.0 rejects a cadSource with a non-thread-artifact URI",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          cadSource: {
            ...VALID_CASE.cadSource,
            artifactUri: "https://example.com/artifact",
          },
        }),
      TypeError,
      "thread-artifact://",
    );
  },
);

Deno.test(
  "sensitivity-study-case/2.0 rejects a cadSource sha256 that is not 64 hex chars",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          cadSource: { ...VALID_CASE.cadSource, sha256: "short" },
        }),
      TypeError,
      "sha256",
    );
  },
);

Deno.test(
  "sensitivity-study-case/2.0 rejects a cadSource sha256 with uppercase hex",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          cadSource: { ...VALID_CASE.cadSource, sha256: "A".repeat(64) },
        }),
      TypeError,
    );
  },
);

Deno.test(
  "sensitivity-study-case/2.0 rejects a zero step value",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          step: { value: 0, unit: "mm" },
        }),
      TypeError,
      "step.value must not be zero",
    );
  },
);

Deno.test(
  "sensitivity-study-case/2.0 rejects duplicate metric ids",
  () => {
    assertThrows(
      () =>
        validateSensitivityStudyCaseV2({
          ...VALID_CASE,
          metrics: [
            { id: "assembly_max_displacement", unit: "mm" },
            { id: "assembly_max_displacement", unit: "mm" },
          ],
        }),
      TypeError,
    );
  },
);

Deno.test(
  "sensitivity-study-case/2.0 produces a frozen result that cannot be mutated",
  () => {
    const result = validateSensitivityStudyCaseV2(VALID_CASE);
    // Object.isFrozen walks top-level only; deepFreeze covers nested objects.
    assertEquals(Object.isFrozen(result), true);
    assertEquals(Object.isFrozen(result.cadSource), true);
    assertEquals(Object.isFrozen(result.domain), true);
  },
);

Deno.test(
  "computeSensitivities accepts a sensitivity-study-case/2.0 without a recipeSource",
  () => {
    const studyCase = validateSensitivityStudyCaseV2(VALID_CASE);
    const result = computeSensitivities(
      studyCase,
      new Map([["assembly_max_displacement", { value: 0.5, unit: "mm" }]]),
      new Map([["assembly_max_displacement", { value: 1.5, unit: "mm" }]]),
    );
    assertEquals(result.derivatives, [{
      metric: "assembly_max_displacement",
      value: 1,
      unit: "mm/mm",
    }]);
    assertEquals(result.domain, { base: 50, step: 1, parameterUnit: "mm" });
  },
);
