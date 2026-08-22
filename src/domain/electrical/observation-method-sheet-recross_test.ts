import { assertEquals, assertThrows } from "@std/assert";
import { validElectricalObservationMethodSheet } from "../../testing/electrical-observation-method-sheet-fixtures.ts";
import { validateElectricalObservationMethodSheet } from "./observation-method-sheet.ts";
import {
  ElectricalObservationMethodSheetRecrossError,
  recrossElectricalObservationMethodSheet,
} from "./observation-method-sheet-recross.ts";

const GATES = [
  { id: "success-criterion-node-voltage", kind: "success-criterion" as const },
  { id: "success-criterion-source-current", kind: "success-criterion" as const },
  {
    id: "verification-activity-source-power",
    kind: "verification-activity" as const,
  },
];

Deno.test("method sheet recross matches exact current brief gates", () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const recross = recrossElectricalObservationMethodSheet(sheet, GATES);
  assertEquals(recross.briefGates, "matched");
  assertEquals(recross.briefItemIds, [
    "success-criterion-node-voltage",
    "success-criterion-source-current",
    "verification-activity-source-power",
  ]);
  assertEquals(recross.nativeObservationNames, ["i(vsrc)", "v(n1)"]);
});

Deno.test("method sheet recross refuses a missing brief gate", () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  assertThrows(
    () => recrossElectricalObservationMethodSheet(sheet, GATES.slice(0, 1)),
    ElectricalObservationMethodSheetRecrossError,
    "unresolved",
  );
});

Deno.test("method sheet recross refuses a foreign project basis", () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  assertThrows(
    () =>
      recrossElectricalObservationMethodSheet(sheet, GATES, {
        projectId: "project.other",
        subjectId: sheet.subject.id,
        snapshotId: sheet.basis.snapshotId,
        revision: sheet.basis.revision,
        fingerprint: sheet.basis.fingerprint,
      }),
    ElectricalObservationMethodSheetRecrossError,
    "exact project Thread basis",
  );
});
