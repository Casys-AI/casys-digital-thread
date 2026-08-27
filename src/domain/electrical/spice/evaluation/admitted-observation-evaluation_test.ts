import { assertEquals } from "@std/assert";
import { validElectricalObservationMethodSheet } from "../../../../testing/electrical-observation-method-sheet-fixtures.ts";
import { validateElectricalObservationMethodSheet } from "../../observation-method-sheet.ts";
import {
  evaluateAdmittedSpiceObservations,
  overallStatus,
} from "./admitted-observation-evaluation.ts";

const NATIVES = [
  { name: "v(n1)", value: 3, unit: "V" as const },
  { name: "i(vsrc)", value: -2, unit: "A" as const },
  { name: "v(n2)", value: 8, unit: "V" as const },
];

Deno.test("all criteria must pass for overall pass and extra L3 natives are allowed", async () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const result = await evaluateAdmittedSpiceObservations(sheet, NATIVES);
  assertEquals(result.overall, "pass");
  assertEquals(result.evaluations.map((item) => item.status), [
    "pass",
    "pass",
    "pass",
  ]);
  assertEquals(
    result.evaluations.map((item) => item.actual?.value),
    [3, 2, 6],
  );
});

Deno.test("a failing comparator stays fail and never upgrades an unresolved gap", async () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const failing = await evaluateAdmittedSpiceObservations(sheet, [
    { name: "v(n1)", value: 9, unit: "V" },
    { name: "i(vsrc)", value: -2, unit: "A" },
  ]);
  assertEquals(failing.overall, "fail");
  assertEquals(failing.evaluations[0]!.status, "fail");

  const missing = await evaluateAdmittedSpiceObservations(sheet, [
    { name: "i(vsrc)", value: -2, unit: "A" },
  ]);
  assertEquals(missing.overall, "unresolved");
  assertEquals(missing.evaluations[0]!.status, "unresolved");
  assertEquals(overallStatus(["fail", "unresolved"]), "unresolved");
  assertEquals(overallStatus(["fail", "error"]), "error");
});

Deno.test("duplicate selected natives stay unresolved rather than aliased", async () => {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const result = await evaluateAdmittedSpiceObservations(sheet, [
    { name: "v(n1)", value: 3, unit: "V" },
    { name: "v(n1)", value: 1, unit: "V" },
    { name: "i(vsrc)", value: -2, unit: "A" },
  ]);
  assertEquals(result.overall, "unresolved");
  assertEquals(
    result.evaluations.filter((item) => item.status === "unresolved").length >= 1,
    true,
  );
});
