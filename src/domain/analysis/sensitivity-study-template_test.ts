import { assertEquals, assertThrows } from "@std/assert";
import {
  assembleSensitivityStudyCaseV2,
  SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA,
  validateSensitivityStudyCaseTemplate,
} from "./sensitivity-study-template.ts";

const TEMPLATE = {
  schemaVersion: SENSITIVITY_STUDY_CASE_TEMPLATE_SCHEMA,
  id: "dl04-size-z-sensitivity",
  revision: 1,
  scope: "mechanical-structural",
  evidenceBoundary: "fea-static",
  project: { id: "desk-lamp-dl04", subjectId: "lamp-arm" },
  target: { componentKey: "arm", semanticKey: "size_z" },
  baseValue: { value: 50, unit: "mm" },
  step: { value: 1, unit: "mm" },
  metrics: [{ id: "assembly_max_displacement", unit: "mm" }],
  solver: {
    provider: "calculix",
    tool: "calculix_solve_static",
    resultSchemaVersion: "2.0",
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
};

Deno.test("a catalog template rejects a legacy cadSource key", () => {
  assertThrows(
    () =>
      validateSensitivityStudyCaseTemplate({
        ...TEMPLATE,
        cadSource: {
          artifactUri: "thread-artifact://x/y",
          sha256: "a".repeat(64),
        },
      }),
    TypeError,
  );
});

Deno.test("assembling a template binds only the reviewed cadSource", () => {
  const template = validateSensitivityStudyCaseTemplate(TEMPLATE);
  const studyCase = assembleSensitivityStudyCaseV2(template, {
    artifactUri: "thread-artifact://desk-lamp-dl04/admission-1",
    sha256: "b".repeat(64),
  });
  assertEquals(studyCase.schemaVersion, "sensitivity-study-case/2.0");
  assertEquals(
    studyCase.cadSource.artifactUri,
    "thread-artifact://desk-lamp-dl04/admission-1",
  );
  assertEquals(studyCase.id, template.id);
  assertEquals(studyCase.step.value, 1);
});
