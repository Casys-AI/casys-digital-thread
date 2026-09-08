import { assertEquals, assertThrows } from "@std/assert";
import {
  assembleSensitivityStudyCaseV3,
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

Deno.test(
  "the reviewed ID01 catalog template validates with the exact Thread metric and union-safe boxes",
  async () => {
    const catalog = JSON.parse(
      await Deno.readTextFile("config/sensitivity-study-cases/catalog.json"),
    ) as {
      readonly cases: readonly { readonly id: string; readonly file: string }[];
    };
    assertEquals(
      catalog.cases.find((entry) => entry.id === "id01-radial-arm-height-isolated"),
      {
        id: "id01-radial-arm-height-isolated",
        file: "id01-radial-arm-height-isolated.json",
      },
    );
    const template = validateSensitivityStudyCaseTemplate(
      JSON.parse(
        await Deno.readTextFile(
          "config/sensitivity-study-cases/id01-radial-arm-height-isolated.json",
        ),
      ),
    );
    assertEquals(template.id, "id01-radial-arm-height-isolated");
    assertEquals(template.revision, 1);
    assertEquals(template.scope, "mechanical-structural");
    assertEquals(template.evidenceBoundary, "fea-static");
    assertEquals(template.project, {
      id: "inspection-drone-id01",
      subjectId: "project:inspection-drone-id01",
    });
    assertEquals(template.target, {
      componentKey: "RadialArm",
      semanticKey: "arm_height",
    });
    assertEquals(template.baseValue, { value: 5, unit: "mm" });
    assertEquals(template.step, { value: 1, unit: "mm" });
    assertEquals(template.metrics, [{
      id: "radial_arm_bench_max_displacement_mm",
      unit: "mm",
    }]);
    assertEquals(template.method.mesh, {
      kind: "tetrahedral-volume",
      targetSizeMm: 1,
    });
    assertEquals(template.method.material.eMpa, 70000);
    assertEquals(template.method.material.nu, 0.33);
    assertEquals(
      template.method.supports[0]?.selection.box,
      { min: [-50.1, -8.1, -0.1], max: [-49.9, 8.1, 6.1], unit: "mm" },
    );
    assertEquals(
      template.method.loads[0]?.selection.box,
      { min: [49.9, -8.1, -0.1], max: [50.1, 8.1, 6.1], unit: "mm" },
    );
    assertEquals(template.method.loads[0]?.force, { value: [0, 0, -5], unit: "N" });
    assertEquals(template.domain.approximationOrder, "first-order-forward");
    assertEquals(template.domain.remeshingVariationIncluded, true);
    assertEquals(
      template.domain.localValidityNote,
      "Valid for arm_height in [5, 6] mm on the sealed isolated RadialArm bench case id01-radial-arm-bench.",
    );
  },
);

Deno.test("assembling a template binds only the reviewed cadSource", () => {
  const template = validateSensitivityStudyCaseTemplate(TEMPLATE);
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: "thread-artifact://desk-lamp-dl04/admission-1",
    sha256: "b".repeat(64),
  });
  assertEquals(studyCase.schemaVersion, "sensitivity-study-case/3.0");
  assertEquals(
    studyCase.cadSource.artifactUri,
    "thread-artifact://desk-lamp-dl04/admission-1",
  );
  assertEquals(studyCase.id, template.id);
  assertEquals(studyCase.step.value, 1);
});
