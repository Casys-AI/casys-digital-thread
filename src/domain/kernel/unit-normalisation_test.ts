import { assertEquals } from "@std/assert";
import { SUPPORTED_ORACLE_UNITS } from "./proof-case.ts";
import { normaliseThreshold, UNIT_NORMALISATION } from "./unit-normalisation.ts";

Deno.test(
  "unit normalisation table targets only admitted oracle units at load time",
  () => {
    for (const [sourceUnit, entry] of UNIT_NORMALISATION) {
      const isAdmitted = SUPPORTED_ORACLE_UNITS.includes(entry.targetUnit);
      assertEquals(
        isAdmitted,
        true,
        `Entry "${sourceUnit}" → "${entry.targetUnit}" (label "${entry.label}") ` +
          `targets a unit that is not in SUPPORTED_ORACLE_UNITS. ` +
          `Run the probe and add the unit to UNIT_TO_SYSML_TYPE before declaring this entry.`,
      );
    }
  },
);

Deno.test("MPa-to-Pa applies exact multiplicative rescale of 1e6", () => {
  const mpa = UNIT_NORMALISATION.get("MPa");
  assertEquals(mpa?.targetUnit, "Pa");
  assertEquals(mpa?.label, "MPa-to-Pa");
  // Typical stress budget: 90 MPa = 90 000 000 Pa.
  assertEquals(mpa?.apply(90), 90_000_000);
  // Zero-crossing must be preserved (multiplicative, not affine).
  assertEquals(mpa?.apply(0), 0);
  // Fractional inputs round-trip exactly with IEEE 754.
  assertEquals(mpa?.apply(0.5), 500_000);
});

Deno.test("normaliseThreshold rescales MPa and names the transformation", () => {
  const result = normaliseThreshold(90, "MPa");
  assertEquals(result.value, 90_000_000);
  assertEquals(result.unit, "Pa");
  assertEquals(result.transformation, "MPa-to-Pa");
});

Deno.test("normaliseThreshold returns identity for a natively-admitted unit", () => {
  // Pa is already admitted — no rescaling needed.
  const result = normaliseThreshold(90_000_000, "Pa");
  assertEquals(result.value, 90_000_000);
  assertEquals(result.unit, "Pa");
  assertEquals(result.transformation, "identity");
});

Deno.test(
  "normaliseThreshold returns identity for an unknown unit rather than silently coercing",
  () => {
    // psi has no admitted target and no normalisation entry.
    const result = normaliseThreshold(14.5, "psi");
    assertEquals(result.value, 14.5);
    assertEquals(result.unit, "psi");
    assertEquals(result.transformation, "identity");
  },
);

/**
 * Affine-safety guard: prove that a table of plain multiplier would break
 * temperature conversion.  This test documents the invariant without requiring
 * a live degC entry — it verifies the maths that the code comment warns about.
 */
Deno.test(
  "affine transform (degC→K) cannot be expressed as a coefficient without data loss",
  () => {
    const valueInDegC = 22;
    const expectedKelvin = 295.15; // 22 + 273.15

    // A multiplicative-only table would use the constant as a factor,
    // producing 273.15 * 22 = 6009.3 — wildly wrong.
    const wrongMultiplicativeResult = 273.15 * valueInDegC;
    assertEquals(wrongMultiplicativeResult !== expectedKelvin, true);

    // The correct affine function adds the offset, not multiplies.
    const affineApply = (v: number) => v + 273.15;
    assertEquals(affineApply(valueInDegC), expectedKelvin);

    // Zero-crossing distinguishes affine from multiplicative: 0 °C ≠ 0 K.
    assertEquals(affineApply(0), 273.15);
    // A multiplier-based table would give 0 * factor = 0 — silently wrong.
    assertEquals(0 * 273.15, 0);
  },
);

/**
 * Structural guard: attempting to register a normalisation targeting a unit
 * that is not in SUPPORTED_ORACLE_UNITS must throw at declaration time, not
 * silently succeed and later produce a bad parameter.
 *
 * We cannot call the internal `declareEntry` directly (it is not exported), so
 * we verify the invariant via the observable: the loaded UNIT_NORMALISATION
 * table has no entry targeting an unadmitted unit.
 */
Deno.test(
  "no entry in UNIT_NORMALISATION targets an unadmitted unit",
  () => {
    // K is now admitted (probe 2026-08-14); only truly unadmitted examples here.
    const UNADMITTED_EXAMPLES = ["degC", "MPa", "bar", "psi", "°C", "kPa"];
    for (const [, entry] of UNIT_NORMALISATION) {
      for (const bad of UNADMITTED_EXAMPLES) {
        if (!SUPPORTED_ORACLE_UNITS.includes(bad)) {
          assertEquals(
            entry.targetUnit !== bad,
            true,
            `Entry targets "${bad}", which is not admitted by SUPPORTED_ORACLE_UNITS.`,
          );
        }
      }
    }
  },
);

Deno.test("kN-to-N applies exact multiplicative rescale of 1e3", () => {
  const kn = UNIT_NORMALISATION.get("kN");
  assertEquals(kn?.targetUnit, "N");
  assertEquals(kn?.label, "kN-to-N");
  // Typical load: 2.5 kN = 2 500 N.
  assertEquals(kn?.apply(2.5), 2_500);
  // Zero-crossing preserved (multiplicative).
  assertEquals(kn?.apply(0), 0);
});

Deno.test("MJ-to-J applies exact multiplicative rescale of 1e6", () => {
  const mj = UNIT_NORMALISATION.get("MJ");
  assertEquals(mj?.targetUnit, "J");
  assertEquals(mj?.label, "MJ-to-J");
  assertEquals(mj?.apply(1), 1_000_000);
  assertEquals(mj?.apply(0), 0);
});

Deno.test("kJ-to-J applies exact multiplicative rescale of 1e3", () => {
  const kj = UNIT_NORMALISATION.get("kJ");
  assertEquals(kj?.targetUnit, "J");
  assertEquals(kj?.label, "kJ-to-J");
  assertEquals(kj?.apply(100), 100_000);
  assertEquals(kj?.apply(0), 0);
});

Deno.test("bar-to-Pa applies exact multiplicative rescale of 1e5", () => {
  const bar = UNIT_NORMALISATION.get("bar");
  assertEquals(bar?.targetUnit, "Pa");
  assertEquals(bar?.label, "bar-to-Pa");
  // Typical: 1.5 bar = 150 000 Pa.
  assertEquals(bar?.apply(1.5), 150_000);
  assertEquals(bar?.apply(0), 0);
});

Deno.test(
  "degC-to-K applies affine offset +273.15 — mandatory: 0 °C → 273.15 K, not 0",
  () => {
    const degC = UNIT_NORMALISATION.get("degC");
    assertEquals(degC?.targetUnit, "K");
    assertEquals(degC?.label, "degC-to-K");
    // Boundary: 0 °C must map to 273.15 K, never 0 K (multiplicative would give 0).
    assertEquals(degC?.apply(0), 273.15);
    // Typical room temperature: 22 °C → 295.15 K.
    assertEquals(degC?.apply(22), 295.15);
    // Negative temperatures remain valid (affine).
    assertEquals(degC?.apply(-273.15), 0);
  },
);

Deno.test("normaliseThreshold rescales degC to K and names the transformation", () => {
  const result = normaliseThreshold(22, "degC");
  assertEquals(result.value, 295.15);
  assertEquals(result.unit, "K");
  assertEquals(result.transformation, "degC-to-K");
});

Deno.test("normaliseThreshold rescales kN to N and names the transformation", () => {
  const result = normaliseThreshold(2.5, "kN");
  assertEquals(result.value, 2_500);
  assertEquals(result.unit, "N");
  assertEquals(result.transformation, "kN-to-N");
});

Deno.test("normaliseThreshold rescales bar to Pa and names the transformation", () => {
  const result = normaliseThreshold(1.5, "bar");
  assertEquals(result.value, 150_000);
  assertEquals(result.unit, "Pa");
  assertEquals(result.transformation, "bar-to-Pa");
});
