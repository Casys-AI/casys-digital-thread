import { assertEquals, assertThrows } from "@std/assert";
import {
  assertBaseValueMatchesDripTrayRecipeR2,
  DRIP_TRAY_SIZE_Z_R2_BASE_MM,
  renderDripTrayPrintabilityScript,
  renderDripTrayPrintEstimateScript,
  renderDripTraySensitivityScriptForHeight,
} from "./cm01-drip-tray-analysis-scripts.ts";
import {
  type SensitivityMetricMeasurement,
  validateSensitivityStudyCase,
} from "../analysis/sensitivity-study.ts";

// Minimal sensitivity case targeting drip-tray/size-z at the R2 base value.
function minimalDripTraySensitivityCaseJson(): Record<string, unknown> {
  return {
    schemaVersion: "sensitivity-study-case/1.0",
    id: "test-sensitivity-case-v1",
    revision: 1,
    scope: "Unit test scope.",
    evidenceBoundary: "Unit test boundary — not a verdict.",
    project: { id: "test-project", subjectId: "project:test-project" },
    target: { componentKey: "drip-tray", semanticKey: "size-z" },
    recipeSource: {
      schemaVersion: "coffee-machine-semantic-recipe/2.0",
      key: "cm01-drip-tray-height-30",
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

// Unused in the moved tests, but kept here so the fixture is self-contained
// and the type reference compiles.
function _unusedMetric(): SensitivityMetricMeasurement {
  return { value: 0, unit: "mm" };
}

// ---------------------------------------------------------------------------
// assertBaseValueMatchesDripTrayRecipeR2
// ---------------------------------------------------------------------------

Deno.test(
  "assertBaseValueMatchesDripTrayRecipeR2 accepts the reviewed R2 base value",
  () => {
    const sc = validateSensitivityStudyCase(minimalDripTraySensitivityCaseJson());
    // Must not throw.
    assertBaseValueMatchesDripTrayRecipeR2(sc);
  },
);

Deno.test(
  "assertBaseValueMatchesDripTrayRecipeR2 rejects a divergent base value",
  () => {
    const bad = {
      ...minimalDripTraySensitivityCaseJson(),
      baseValue: { value: 28, unit: "mm" },
    };
    const sc = validateSensitivityStudyCase(bad);
    assertThrows(
      () => assertBaseValueMatchesDripTrayRecipeR2(sc),
      TypeError,
      "30",
    );
  },
);

Deno.test(
  "assertBaseValueMatchesDripTrayRecipeR2 rejects wrong target component",
  () => {
    const bad = {
      ...minimalDripTraySensitivityCaseJson(),
      target: { componentKey: "boiler", semanticKey: "size-z" },
    };
    const sc = validateSensitivityStudyCase(bad);
    assertThrows(
      () => assertBaseValueMatchesDripTrayRecipeR2(sc),
      TypeError,
      "drip-tray",
    );
  },
);

// DRIP_TRAY_SIZE_Z_R2_BASE_MM is the single source of truth for the R2 height.
Deno.test("DRIP_TRAY_SIZE_Z_R2_BASE_MM equals 30", () => {
  assertEquals(DRIP_TRAY_SIZE_Z_R2_BASE_MM, 30);
});

// ---------------------------------------------------------------------------
// renderDripTraySensitivityScriptForHeight
// ---------------------------------------------------------------------------

Deno.test("renderDripTraySensitivityScriptForHeight is deterministic for the same height", () => {
  const a = renderDripTraySensitivityScriptForHeight(30);
  const b = renderDripTraySensitivityScriptForHeight(30);
  assertEquals(a, b);
});

Deno.test(
  "renderDripTraySensitivityScriptForHeight produces distinct scripts for base and perturbed",
  () => {
    const base = renderDripTraySensitivityScriptForHeight(30);
    const perturbed = renderDripTraySensitivityScriptForHeight(31);
    assertEquals(base !== perturbed, true);
    assertEquals(base.includes("30"), true);
    assertEquals(perturbed.includes("31"), true);
  },
);

Deno.test("renderDripTraySensitivityScriptForHeight emits a valid build123d Box call", () => {
  const script = renderDripTraySensitivityScriptForHeight(30);
  assertEquals(script.startsWith("from build123d import Align, Box"), true);
  assertEquals(
    script.includes(
      "result = Box(190, 135, 30, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
    ),
    true,
  );
});

Deno.test("renderDripTraySensitivityScriptForHeight rejects a non-positive height", () => {
  assertThrows(
    () => renderDripTraySensitivityScriptForHeight(0),
    TypeError,
    "finite positive",
  );
  assertThrows(
    () => renderDripTraySensitivityScriptForHeight(-5),
    TypeError,
    "finite positive",
  );
});

Deno.test("renderDripTraySensitivityScriptForHeight rejects a non-finite height", () => {
  assertThrows(
    () => renderDripTraySensitivityScriptForHeight(NaN),
    TypeError,
    "finite positive",
  );
  assertThrows(
    () => renderDripTraySensitivityScriptForHeight(Infinity),
    TypeError,
    "finite positive",
  );
});

// ---------------------------------------------------------------------------
// renderDripTrayPrintabilityScript
// ---------------------------------------------------------------------------

Deno.test(
  "renderDripTrayPrintabilityScript is deterministic and contains the R2 30 mm height",
  () => {
    const first = renderDripTrayPrintabilityScript();
    const second = renderDripTrayPrintabilityScript();
    assertEquals(first, second, "same call must produce identical bytes");
    assertEquals(
      first.includes("30"),
      true,
      "script must embed the 30 mm R2 height",
    );
    assertEquals(
      first.includes("Box(190, 135, 30"),
      true,
      "script must embed the DripTray plan geometry",
    );
  },
);

// ---------------------------------------------------------------------------
// renderDripTrayPrintEstimateScript
// ---------------------------------------------------------------------------

Deno.test(
  "renderDripTrayPrintEstimateScript is deterministic for the same inputs",
  () => {
    const b64 = "dGVzdA=="; // "test" in base64
    const name = "test-profile";
    const a = renderDripTrayPrintEstimateScript(b64, name);
    const b = renderDripTrayPrintEstimateScript(b64, name);
    assertEquals(a, b);
  },
);

Deno.test(
  "renderDripTrayPrintEstimateScript embeds the R2 30 mm Box and the profile export",
  () => {
    const b64 = "dGVzdA==";
    const name = "my-profile";
    const script = renderDripTrayPrintEstimateScript(b64, name);
    assertEquals(
      script.includes("Box(190, 135, 30"),
      true,
      "script must embed the DripTray plan geometry",
    );
    assertEquals(
      script.includes("/exports/my-profile.ini"),
      true,
      "script must write the profile to /exports",
    );
    assertEquals(
      script.includes(JSON.stringify(b64)),
      true,
      "script must embed the base64 profile content",
    );
  },
);

Deno.test("renderDripTrayPrintEstimateScript rejects an empty profileContentB64", () => {
  assertThrows(
    () => renderDripTrayPrintEstimateScript("", "my-profile"),
    TypeError,
    "non-empty base64",
  );
});

Deno.test(
  "renderDripTrayPrintEstimateScript rejects an invalid profileExportName",
  () => {
    assertThrows(
      () => renderDripTrayPrintEstimateScript("dGVzdA==", "bad name!"),
      TypeError,
      "alphanumeric",
    );
  },
);
