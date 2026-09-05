import { assertEquals, assertThrows } from "@std/assert";
import {
  computeSensitivities,
  type SensitivityFiniteDifferenceCase,
  type SensitivityMetricMeasurement,
} from "./sensitivity-study.ts";

const CASE: SensitivityFiniteDifferenceCase = {
  baseValue: { value: 30, unit: "mm" },
  step: { value: 1, unit: "mm" },
  metrics: [
    { id: "assembly_max_displacement", unit: "mm" },
    { id: "assembly_max_von_mises", unit: "MPa" },
  ],
};

function baseMap(): Map<string, SensitivityMetricMeasurement> {
  return new Map([
    ["assembly_max_displacement", { value: 0.5, unit: "mm" }],
    ["assembly_max_von_mises", { value: 10, unit: "MPa" }],
  ]);
}

function steppedMap(): Map<string, SensitivityMetricMeasurement> {
  return new Map([
    ["assembly_max_displacement", { value: 1.5, unit: "mm" }],
    ["assembly_max_von_mises", { value: 8, unit: "MPa" }],
  ]);
}

Deno.test("computeSensitivities derives reviewed local slopes without runtime identity", () => {
  const result = computeSensitivities(CASE, baseMap(), steppedMap());

  assertEquals(result.domain, { base: 30, step: 1, parameterUnit: "mm" });
  assertEquals(result.derivatives, [
    { metric: "assembly_max_displacement", value: 1, unit: "mm/mm" },
    { metric: "assembly_max_von_mises", value: -2, unit: "MPa/mm" },
  ]);
});

Deno.test("computeSensitivities freezes its derived observations", () => {
  const result = computeSensitivities(CASE, baseMap(), steppedMap());
  assertEquals(Object.isFrozen(result), true);
  assertEquals(Object.isFrozen(result.derivatives), true);
});

Deno.test("computeSensitivities rejects a dimension mismatch", () => {
  const wrongBase = baseMap();
  wrongBase.set("assembly_max_displacement", { value: 0.5, unit: "MPa" });
  assertThrows(
    () => computeSensitivities(CASE, wrongBase, steppedMap()),
    TypeError,
    "unit mismatch",
  );
});

Deno.test("computeSensitivities rejects incomplete captured measurements", () => {
  const incomplete = baseMap();
  incomplete.delete("assembly_max_displacement");
  assertThrows(
    () => computeSensitivities(CASE, incomplete, steppedMap()),
    TypeError,
    "base measurement not found",
  );
});
