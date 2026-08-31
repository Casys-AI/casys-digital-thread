import { assertEquals } from "@std/assert";
import { validateElectricalObservationMethodSheet } from "./observation-method-sheet.ts";
import { validElectricalObservationMethodSheet } from "../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  encodeElectricalObservationMethodSheetSealParameters,
  parseElectricalObservationMethodSheetSealParameters,
  VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION,
} from "./observation-method-sheet-proposal.ts";

Deno.test(
  "electrical method sheet MRTR parameters round-trip identities without provider args",
  async () => {
    const sheet = validateElectricalObservationMethodSheet(
      validElectricalObservationMethodSheet(),
    );
    const parameters = await encodeElectricalObservationMethodSheetSealParameters(
      sheet,
    );
    assertEquals(
      `${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.id}@${VERIFY_SEAL_ELECTRICAL_OBSERVATION_METHOD_SHEET_OPERATION.version}`,
      "verify.seal-electrical-observation-method-sheet@1",
    );
    for (const parameter of parameters) {
      const encoded = JSON.stringify(parameter);
      assertEquals(encoded.includes("provider"), false);
      assertEquals(encoded.includes("ngspice"), false);
      assertEquals(encoded.includes('"args"'), false);
      assertEquals(encoded.includes("syson"), false);
    }
    const parsed = parseElectricalObservationMethodSheetSealParameters(parameters);
    assertEquals(parsed.sheetId, sheet.id);
    assertEquals(parsed.projectId, sheet.project.id);
    assertEquals(parsed.sealDecisionId, sheet.review.sealDecisionId);
    const again = parseElectricalObservationMethodSheetSealParameters(parameters);
    assertEquals(again, parsed);
  },
);

Deno.test("electrical method sheet MRTR grammar refuses an extra parameter", async () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const parameters = [
    ...(await encodeElectricalObservationMethodSheetSealParameters(sheet)),
    { key: "electrical.methodSheet.provider", label: "Provider", value: "ngspice" },
  ];
  const error = throws(() =>
    parseElectricalObservationMethodSheetSealParameters(parameters)
  );
  assertEquals(error.message.includes("exactly"), true);
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
