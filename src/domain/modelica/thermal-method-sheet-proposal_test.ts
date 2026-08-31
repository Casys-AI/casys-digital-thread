import { assertEquals } from "@std/assert";
import { validateModelicaThermalMethodSheet } from "./thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  encodeThermalMethodSheetSealParameters,
  parseThermalMethodSheetSealParameters,
  VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION,
} from "./thermal-method-sheet-proposal.ts";

Deno.test(
  "thermal method sheet MRTR parameters round-trip identities without source bytes or provider args",
  async () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const parameters = await encodeThermalMethodSheetSealParameters(sheet);
    assertEquals(
      `${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_MODELICA_THERMAL_METHOD_SHEET_OPERATION.version}`,
      "verify.seal-modelica-thermal-method-sheet@1",
    );
    for (const parameter of parameters) {
      const encoded = JSON.stringify(parameter);
      assertEquals(encoded.includes("modelicaText"), false);
      assertEquals(encoded.includes('"provider"'), false);
      assertEquals(encoded.includes('.mo"'), false);
      assertEquals(encoded.includes('"args"'), false);
    }
    const parsed = parseThermalMethodSheetSealParameters(parameters);
    assertEquals(parsed.sheetId, sheet.id);
    assertEquals(parsed.projectId, sheet.project.id);
    assertEquals(parsed.model.moduleName, sheet.model.moduleName);
    assertEquals(parsed.sealDecisionId, sheet.review.sealDecisionId);
    const again = parseThermalMethodSheetSealParameters(parameters);
    assertEquals(again, parsed);
  },
);

Deno.test("thermal method sheet MRTR grammar refuses an extra parameter", async () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const parameters = [
    ...(await encodeThermalMethodSheetSealParameters(sheet)),
    { key: "thermal.methodSheet.provider", label: "Provider", value: "omc" },
  ];
  const error = throws(() => parseThermalMethodSheetSealParameters(parameters));
  assertEquals(error.message.includes("exactly"), true);
});

Deno.test("thermal method sheet MRTR grammar refuses a reordered key", async () => {
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  const parameters = [...(await encodeThermalMethodSheetSealParameters(sheet))];
  const first = parameters[0]!;
  parameters[0] = parameters[1]!;
  parameters[1] = first;
  const error = throws(() => parseThermalMethodSheetSealParameters(parameters));
  assertEquals(error.message.includes("must be"), true);
});

function throws(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
