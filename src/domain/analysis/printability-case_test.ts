import { assertEquals, assertThrows } from "@std/assert";
import { validatePrintabilityCheckCase } from "./printability-case.ts";

// ── Helpers ───────────────────────────────────────────────────────────────────

function validCaseInput() {
  return {
    schemaVersion: "printability-check-case/1.0",
    id: "generic-product-v1-support-bracket-fdm-v1",
    revision: 2,
    scope: "FDM printability check for the isolated support bracket.",
    evidenceBoundary: "Observations only; not a verdict or certification.",
    project: {
      id: "generic-product-v1",
      subjectId: "project:generic-product-v1",
    },
    target: { componentKey: "support-bracket" },
    thresholds: {
      minWallThicknessMm: { value: 1.2, unit: "mm" },
      maxOverhangAngleDeg: { value: 45.0, unit: "deg" },
      maxUnsupportedAreaMm2: { value: 600.0, unit: "mm2" },
    },
    meshSizeMm: { value: 2.0, unit: "mm" },
    buildDirection: [0, 0, 1],
    provider: {
      build123dTool: "build123d_export",
      thicknessTool: "dfm_check_min_thickness",
      overhangTool: "dfm_check_overhangs",
    },
    limitations: [
      "Thresholds are provisional FDM candidate values, not confirmed manufacturer data.",
      "This check covers only min wall thickness and max overhang angle.",
    ],
    provenance: {
      status: "provisional",
      note: "Thresholds sourced from typical FDM desktop-printer guidelines.",
    },
  };
}

// ── Test 1 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase accepts a valid case", () => {
  const result = validatePrintabilityCheckCase(validCaseInput());
  assertEquals(result.schemaVersion, "printability-check-case/1.0");
  assertEquals(result.id, "generic-product-v1-support-bracket-fdm-v1");
  assertEquals(result.revision, 2);
  assertEquals(result.thresholds.minWallThicknessMm, { value: 1.2, unit: "mm" });
  assertEquals(result.thresholds.maxOverhangAngleDeg, { value: 45.0, unit: "deg" });
  assertEquals(result.thresholds.maxUnsupportedAreaMm2, { value: 600.0, unit: "mm2" });
  assertEquals(result.meshSizeMm, { value: 2.0, unit: "mm" });
  assertEquals(result.buildDirection, [0, 0, 1]);
  assertEquals(result.provider.thicknessTool, "dfm_check_min_thickness");
  assertEquals(result.provider.overhangTool, "dfm_check_overhangs");
  assertEquals(result.provenance.status, "provisional");
});

// ── Test 2 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a case with an extra field", () => {
  const input = { ...validCaseInput(), extraField: "forbidden" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "extraField",
  );
});

// ── Test 3 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a case with a missing field", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  delete (input as any).thresholds;
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "thresholds",
  );
});

// ── Test 4 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a threshold missing its unit", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.thresholds.minWallThicknessMm as any) = { value: 1.2 };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "unit",
  );
});

// ── Test 5 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a threshold with the wrong unit literal", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.thresholds.minWallThicknessMm as any) = { value: 1.2, unit: "cm" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    '"mm"',
  );
});

// ── Test 6 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects overhang angle outside (0, 90)", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.thresholds.maxOverhangAngleDeg as any) = { value: 90, unit: "deg" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "(0, 90)",
  );
});

// ── Test 7 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a wrong schemaVersion", () => {
  const input = { ...validCaseInput(), schemaVersion: "wrong-schema/1.0" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "printability-check-case/1.0",
  );
});

// ── Test 8 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects an empty limitations array", () => {
  const input = { ...validCaseInput(), limitations: [] };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "must not be empty",
  );
});

// ── Test 9 ────────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a non-provisional provenance status", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.provenance as any) = { status: "confirmed", note: "Test." };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "provisional",
  );
});

// ── Test 10 ───────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects extra field in thresholds", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.thresholds as any).extraThreshold = { value: 0.1, unit: "mm" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "extraThreshold",
  );
});

// ── Test 11 ───────────────────────────────────────────────────────────────────

Deno.test(
  "validatePrintabilityCheckCase rejects a wrong provider tool name",
  () => {
    const input = validCaseInput();
    // deno-lint-ignore no-explicit-any
    (input.provider as any).thicknessTool = "dfm_check_thickness";
    assertThrows(
      () => validatePrintabilityCheckCase(input),
      TypeError,
      "dfm_check_min_thickness",
    );
  },
);

// ── Test 12 ───────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a case missing meshSizeMm", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  delete (input as any).meshSizeMm;
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "meshSizeMm",
  );
});

Deno.test("validatePrintabilityCheckCase rejects meshSizeMm with wrong unit", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).meshSizeMm = { value: 2.0, unit: "cm" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    '"mm"',
  );
});

Deno.test("validatePrintabilityCheckCase rejects meshSizeMm <= 0", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).meshSizeMm = { value: 0, unit: "mm" };
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "positive",
  );
});

// ── Test 13 ───────────────────────────────────────────────────────────────────

Deno.test("validatePrintabilityCheckCase rejects a case missing buildDirection", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  delete (input as any).buildDirection;
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "buildDirection",
  );
});

Deno.test("validatePrintabilityCheckCase rejects buildDirection with wrong length", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildDirection = [0, 1];
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "3",
  );
});

Deno.test("validatePrintabilityCheckCase rejects buildDirection with a non-finite element", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildDirection = [0, 0, Infinity];
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "finite",
  );
});

Deno.test("validatePrintabilityCheckCase rejects a null buildDirection", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildDirection = null;
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "3",
  );
});

Deno.test("validatePrintabilityCheckCase rejects a zero buildDirection", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input as any).buildDirection = [0, 0, 0];
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "zero vector",
  );
});

Deno.test("validatePrintabilityCheckCase rejects an extra provider field", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.provider as any).envelopeTool = "dfm_check_envelope";
  assertThrows(
    () => validatePrintabilityCheckCase(input),
    TypeError,
    "envelopeTool",
  );
});
