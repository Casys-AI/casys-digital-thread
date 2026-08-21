import { assertEquals, assertThrows } from "@std/assert";
import { validThermalMethodSheetPlaceholder } from "../../testing/modelica-thermal-method-sheet-fixtures.ts";
import { validateModelicaThermalMethodSheet } from "./thermal-method-sheet.ts";
import {
  recrossThermalMethodSheet,
  ThermalMethodSheetRecrossError,
} from "./thermal-method-sheet-recross.ts";

const SOURCE = {
  fingerprint: { algorithm: "sha256" as const, digest: "0".repeat(64) },
  role: "modelica-model" as const,
  language: "modelica" as const,
};

const SYSML = [
  { id: "placeholder-attribute-usage", kind: "AttributeUsage" },
  { id: "placeholder-requirement", kind: "RequirementUsage" },
];

Deno.test("thermal method sheet recross accepts exact source and SysML identities", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const recross = recrossThermalMethodSheet(sheet, SOURCE, SYSML);
  assertEquals(recross.sourceCapture, "matched");
  assertEquals(recross.attributeUsageIds, ["placeholder-attribute-usage"]);
  assertEquals(recross.requirementElementIds, ["placeholder-requirement"]);
});

Deno.test("thermal method sheet recross refuses an unavailable source capture", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () => recrossThermalMethodSheet(sheet, undefined, SYSML),
    ThermalMethodSheetRecrossError,
    "unavailable",
  );
  assertEquals(error.code, "source_unavailable");
});

Deno.test("thermal method sheet recross refuses a non-Modelica source capture", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () =>
      recrossThermalMethodSheet(sheet, {
        ...SOURCE,
        role: "modelica-model",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }, SYSML),
    ThermalMethodSheetRecrossError,
    "exact modelica-model identity",
  );
  assertEquals(error.code, "source_mismatch");
});

Deno.test("thermal method sheet recross refuses an unavailable SysML basis", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () => recrossThermalMethodSheet(sheet, SOURCE, undefined),
    ThermalMethodSheetRecrossError,
    "unavailable",
  );
  assertEquals(error.code, "sysml_unavailable");
});

Deno.test("thermal method sheet recross leaves a missing AttributeUsage unresolved", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () => recrossThermalMethodSheet(sheet, SOURCE, [SYSML[1]!]),
    ThermalMethodSheetRecrossError,
    "unresolved",
  );
  assertEquals(error.code, "sysml_unresolved");
});

Deno.test("thermal method sheet recross leaves a wrong-kind SysML identity unresolved", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () =>
      recrossThermalMethodSheet(sheet, SOURCE, [
        { id: "placeholder-attribute-usage", kind: "PartDefinition" },
        SYSML[1]!,
      ]),
    ThermalMethodSheetRecrossError,
    "unresolved",
  );
  assertEquals(error.code, "sysml_unresolved");
});

Deno.test("thermal method sheet recross leaves an ambiguous AttributeUsage unresolved", () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const error = assertThrows(
    () =>
      recrossThermalMethodSheet(sheet, SOURCE, [
        SYSML[0]!,
        { id: "placeholder-attribute-usage", kind: "AttributeUsage" },
        SYSML[1]!,
      ]),
    ThermalMethodSheetRecrossError,
    "unresolved",
  );
  assertEquals(error.code, "sysml_unresolved");
});

Deno.test("thermal method sheet recross refuses a project subject mismatch", () => {
  const input = validThermalMethodSheetPlaceholder();
  (input.project as { subjectId: string }).subjectId = "other-subject";
  const sheet = validateModelicaThermalMethodSheet(input);
  const error = assertThrows(
    () => recrossThermalMethodSheet(sheet, SOURCE, SYSML),
    ThermalMethodSheetRecrossError,
    "unresolved",
  );
  assertEquals(error.code, "identity_mismatch");
});
