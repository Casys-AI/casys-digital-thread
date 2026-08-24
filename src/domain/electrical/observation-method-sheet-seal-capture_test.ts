import { assertEquals, assertThrows } from "@std/assert";
import { ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA } from "./observation-method-sheet-proposal.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  electricalObservationMethodSheetUri,
  validateElectricalObservationMethodSheetSealCapture,
} from "./observation-method-sheet-seal-capture.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "./observation-method-sheet.ts";
import { validElectricalObservationMethodSheet } from "../../testing/electrical-observation-method-sheet-fixtures.ts";

Deno.test(
  "electrical method-sheet seal capture keeps identities and refuses a foreign operation",
  async () => {
    const sheet = validateElectricalObservationMethodSheet(
      validElectricalObservationMethodSheet(),
    );
    const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(
      sheet,
    );
    const capture = validateElectricalObservationMethodSheetSealCapture({
      schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
      kind: "electrical-observation-method-sheet-seal",
      operation: {
        id: "verify.seal-electrical-observation-method-sheet",
        version: "1",
      },
      trustedRunId: "run.seal-sheet",
      decisionId: sheet.review.sealDecisionId,
      sealedAt: "2026-08-21T12:00:00.000Z",
      admission: {
        schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
        sheetSchemaVersion: sheet.schemaVersion,
        sheetId: sheet.id,
        sheetFingerprint,
        projectId: sheet.project.id,
        subjectId: sheet.subject.id,
        basis: sheet.basis,
        sealDecisionId: sheet.review.sealDecisionId,
      },
      sheet: {
        id: sheet.id,
        fingerprint: sheetFingerprint,
        uri: electricalObservationMethodSheetUri(sheetFingerprint),
      },
      recross: {
        briefGates: "matched",
        briefItemIds: sheet.criteria.map((item) => item.briefItem.id),
        nativeObservationNames: ["v(n1)"],
      },
    });
    assertEquals(capture.sheet.id, sheet.id);
    assertEquals(capture.sheet.fingerprint, sheetFingerprint);
    assertEquals(capture.recross.briefGates, "matched");
    assertThrows(() =>
      validateElectricalObservationMethodSheetSealCapture({
        ...capture,
        operation: { id: "verify.run-ngspice", version: "1" },
      })
    );
    assertThrows(() =>
      validateElectricalObservationMethodSheetSealCapture({
        ...capture,
        directory: "state/local/electrical-observation-method-sheet-seals",
      })
    );
  },
);
