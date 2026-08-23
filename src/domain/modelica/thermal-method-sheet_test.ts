import { assertEquals } from "@std/assert";
import {
  duplicateSourceThermalMethodSheet,
  missingBindingThermalMethodSheet,
  missingSourceThermalMethodSheet,
  modelicaTextThermalMethodSheet,
  validThermalMethodSheetPlaceholder,
} from "../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  validateModelicaThermalMethodSheet,
} from "./thermal-method-sheet.ts";

Deno.test(
  "thermal method sheet accepts the placeholder fixture and fingerprints canonically",
  async () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    assertEquals(sheet.schemaVersion, MODELICA_THERMAL_METHOD_SHEET_SCHEMA);
    assertEquals(sheet.model.moduleName, "placeholder-module");
    const fingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
    assertEquals(fingerprint.algorithm, "sha256");
    assertEquals(fingerprint.digest.length, 64);
    const again = await fingerprintModelicaThermalMethodSheet(sheet);
    assertEquals(again.digest, fingerprint.digest);
  },
);

Deno.test("thermal method sheet refuses an extra field", () => {
  const error = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(modelicaTextThermalMethodSheet())
  );
  assertEquals(error.message.includes("modelicaText"), true);
});

Deno.test("thermal method sheet refuses duplicate source ids", () => {
  const error = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(duplicateSourceThermalMethodSheet())
  );
  assertEquals(error.message.includes("sources"), true);
});

Deno.test("thermal method sheet refuses a missing source list", () => {
  const error = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(missingSourceThermalMethodSheet())
  );
  assertEquals(error.message.includes("sources"), true);
});

Deno.test("thermal method sheet refuses a parameter without a binding", () => {
  const error = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(missingBindingThermalMethodSheet())
  );
  assertEquals(error.message.includes("binding"), true);
});

Deno.test("thermal method sheet refuses Modelica source text in the module name", () => {
  const input = validThermalMethodSheetPlaceholder();
  (input.model as Record<string, unknown>).moduleName = "Head.mo";
  const error = assertThrowsOn(() => validateModelicaThermalMethodSheet(input));
  assertEquals(error.message.includes("moduleName"), true);
});

Deno.test("thermal method sheet fingerprints change when identity changes", async () => {
  const left = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const input = validThermalMethodSheetPlaceholder();
  input.id = "placeholder-thermal-method-sheet-other";
  const right = validateModelicaThermalMethodSheet(input);
  const leftDigest = (await fingerprintModelicaThermalMethodSheet(left)).digest;
  const rightDigest = (await fingerprintModelicaThermalMethodSheet(right)).digest;
  assertEquals(leftDigest === rightDigest, false);
});

Deno.test("thermal method sheet refuses an unknown observation role", () => {
  const input = validThermalMethodSheetPlaceholder();
  (input.outputs as Record<string, unknown>[])[0]!.role = "mean";
  const error = assertThrowsOn(() => validateModelicaThermalMethodSheet(input));
  assertEquals(error.message.includes("role"), true);
});

Deno.test("thermal method sheet requires a signed requirementMetric on each output and binding", () => {
  const missing = validThermalMethodSheetPlaceholder();
  delete (missing.outputs as Record<string, unknown>[])[0]!.requirementMetric;
  const missingError = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(missing)
  );
  assertEquals(missingError.message.includes("requirementMetric"), true);

  const mismatched = validThermalMethodSheetPlaceholder();
  (mismatched.bindings as {
    outputRequirements: Array<Record<string, unknown>>;
  }).outputRequirements[0]!.requirementMetric = "other-metric";
  const mismatchError = assertThrowsOn(() =>
    validateModelicaThermalMethodSheet(mismatched)
  );
  assertEquals(mismatchError.message.includes("binding"), true);
});

Deno.test(
  "thermal method sheet fingerprints change when requirementMetric changes",
  async () => {
    const left = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const input = validThermalMethodSheetPlaceholder();
    (input.outputs as Record<string, unknown>[])[0]!.requirementMetric = "other-metric";
    (input.bindings as {
      outputRequirements: Array<Record<string, unknown>>;
    }).outputRequirements[0]!.requirementMetric = "other-metric";
    const right = validateModelicaThermalMethodSheet(input);
    const leftDigest = (await fingerprintModelicaThermalMethodSheet(left)).digest;
    const rightDigest = (await fingerprintModelicaThermalMethodSheet(right))
      .digest;
    assertEquals(leftDigest === rightDigest, false);
  },
);

function assertThrowsOn(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
