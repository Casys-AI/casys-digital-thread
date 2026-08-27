import { assertEquals, assertThrows } from "@std/assert";
import { validatePrintEstimateCase } from "./print-estimate-case.ts";

function validCaseInput(options?: { readonly withDensity?: boolean }) {
  const base = {
    schemaVersion: "print-estimate-case/1.0",
    id: "reviewed-fff-estimate-v1",
    revision: 1,
    scope: "FFF print-time-and-material estimate for the isolated component.",
    evidenceBoundary: "Observations only; not a cost quote, verdict, or certification.",
    project: {
      id: "reviewed-project-v1",
      subjectId: "project:reviewed-project-v1",
    },
    target: { componentKey: "support-bracket" },
    profile: {
      repoPath: "config/print-estimate-cases/reviewed-fff-0.2-pla.ini",
      exportName: "reviewed-fff-0.2-pla",
      sha256: "a".repeat(64),
      layerHeightMm: { value: 0.2, unit: "mm" },
      nozzleDiameterMm: { value: 0.4, unit: "mm" },
      material: "PLA",
    },
    provider: {
      build123dTool: "build123d_export",
      prusaslicerTool: "prusaslicer_estimate_fff",
    },
    limitations: [
      "Profile parameters are provisional engineering candidates.",
      "gcode_sha256 is an audit reference, not a deterministic attestation.",
    ],
    provenance: {
      status: "provisional",
      note: "Profile parameters are reviewed candidates, not supplier data.",
    },
  };
  if (options?.withDensity !== true) return base;
  return {
    ...base,
    filamentDensityGCm3: { value: 1.24, unit: "g/cm3" },
  };
}

Deno.test("validatePrintEstimateCase accepts a valid case without density", () => {
  const result = validatePrintEstimateCase(validCaseInput());
  assertEquals(result.schemaVersion, "print-estimate-case/1.0");
  assertEquals(result.id, "reviewed-fff-estimate-v1");
  assertEquals(result.profile.layerHeightMm, { value: 0.2, unit: "mm" });
  assertEquals(result.profile.nozzleDiameterMm, { value: 0.4, unit: "mm" });
  assertEquals(result.profile.sha256, "a".repeat(64));
  assertEquals(result.provider.prusaslicerTool, "prusaslicer_estimate_fff");
  assertEquals(result.filamentDensityGCm3, undefined);
  assertEquals(result.provenance.status, "provisional");
});

Deno.test("validatePrintEstimateCase accepts a valid case with density", () => {
  const result = validatePrintEstimateCase(validCaseInput({ withDensity: true }));
  assertEquals(result.filamentDensityGCm3, { value: 1.24, unit: "g/cm3" });
});

Deno.test("validatePrintEstimateCase rejects a case with an extra field", () => {
  const input = { ...validCaseInput(), extraField: "forbidden" };
  assertThrows(
    () => validatePrintEstimateCase(input),
    TypeError,
    "extraField",
  );
});

Deno.test("validatePrintEstimateCase rejects a malformed profile sha256", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.profile as any).sha256 = "not-a-digest";
  assertThrows(
    () => validatePrintEstimateCase(input),
    TypeError,
    "64-character lowercase hex",
  );
});

Deno.test("validatePrintEstimateCase rejects an illegal exportName", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.profile as any).exportName = "path/with/slash";
  assertThrows(
    () => validatePrintEstimateCase(input),
    TypeError,
    "exportName",
  );
});

Deno.test("validatePrintEstimateCase rejects a density with the wrong unit", () => {
  const input = validCaseInput({ withDensity: true });
  // deno-lint-ignore no-explicit-any
  (input as any).filamentDensityGCm3 = { value: 1.24, unit: "kg/m3" };
  assertThrows(
    () => validatePrintEstimateCase(input),
    TypeError,
    '"g/cm3"',
  );
});

Deno.test("validatePrintEstimateCase rejects a wrong provider tool name", () => {
  const input = validCaseInput();
  // deno-lint-ignore no-explicit-any
  (input.provider as any).prusaslicerTool = "prusaslicer_slice";
  assertThrows(
    () => validatePrintEstimateCase(input),
    TypeError,
    "prusaslicer_estimate_fff",
  );
});
