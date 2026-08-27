import { assertEquals, assertThrows } from "@std/assert";
import {
  methodSheetWithDuplicateCriterionIds,
  methodSheetWithInjectedField,
  methodSheetWithNonFiniteThreshold,
  methodSheetWithNonHexFingerprint,
  methodSheetWithSharedBriefGate,
  methodSheetWithUnitMismatch,
  methodSheetWithUnknownNative,
  validElectricalObservationMethodSheet,
} from "../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  methodSheetNativeObservationNames,
  validateElectricalObservationMethodSheet,
} from "./observation-method-sheet.ts";

Deno.test(
  "electrical observation method sheet accepts closed generic criteria and fingerprints canonically",
  async () => {
    const sheet = validateElectricalObservationMethodSheet(
      validElectricalObservationMethodSheet(),
    );
    assertEquals(sheet.schemaVersion, "electrical-observation-method-sheet/1.0");
    assertEquals(sheet.criteria.length, 3);
    assertEquals(sheet.criteria[0]!.comparator, "<=");
    assertEquals(sheet.criteria[1]!.comparator, "between-inclusive");
    assertEquals(sheet.criteria[2]!.comparator, ">=");
    assertEquals(methodSheetNativeObservationNames(sheet), ["i(vsrc)", "v(n1)"]);
    const first = await fingerprintElectricalObservationMethodSheet(sheet);
    const again = await fingerprintElectricalObservationMethodSheet(
      validateElectricalObservationMethodSheet(
        validElectricalObservationMethodSheet(),
      ),
    );
    assertEquals(first, again);
  },
);

Deno.test("electrical observation method sheet rejects injected fields", () => {
  assertThrows(
    () => validateElectricalObservationMethodSheet(methodSheetWithInjectedField()),
    TypeError,
    "unsupported field",
  );
});

Deno.test("electrical observation method sheet rejects duplicate criterion ids", () => {
  assertThrows(
    () =>
      validateElectricalObservationMethodSheet(
        methodSheetWithDuplicateCriterionIds(),
      ),
    TypeError,
    "duplicates",
  );
});

Deno.test(
  "electrical observation method sheet allows several criteria on one brief gate",
  () => {
    const sheet = validateElectricalObservationMethodSheet(
      methodSheetWithSharedBriefGate(),
    );
    assertEquals(sheet.criteria.map((item) => item.briefItem.id), [
      sheet.criteria[0]!.briefItem.id,
      sheet.criteria[0]!.briefItem.id,
      sheet.criteria[0]!.briefItem.id,
    ]);
    assertEquals(new Set(sheet.criteria.map((item) => item.id)).size, 3);
  },
);

Deno.test(
  "electrical observation method sheet rejects an unchecked fingerprint digest",
  () => {
    assertThrows(
      () =>
        validateElectricalObservationMethodSheet(
          methodSheetWithNonHexFingerprint(),
        ),
      TypeError,
      "lowercase sha256 hex",
    );
  },
);

Deno.test("electrical observation method sheet rejects non-finite thresholds", () => {
  assertThrows(
    () =>
      validateElectricalObservationMethodSheet(
        methodSheetWithNonFiniteThreshold(),
      ),
    TypeError,
    "finite",
  );
});

Deno.test("electrical observation method sheet rejects unit mismatches", () => {
  assertThrows(
    () => validateElectricalObservationMethodSheet(methodSheetWithUnitMismatch()),
    TypeError,
    "does not match comparator unit",
  );
});

Deno.test("electrical observation method sheet rejects unknown native names", () => {
  assertThrows(
    () => validateElectricalObservationMethodSheet(methodSheetWithUnknownNative()),
    TypeError,
    "admitted ngspice native name",
  );
});
