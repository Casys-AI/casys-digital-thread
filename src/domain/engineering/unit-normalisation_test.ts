import { assertEquals, assertThrows } from "@std/assert";
import { SUPPORTED_ORACLE_UNITS } from "../analysis/proof-case.ts";
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
    const result = normaliseThreshold(22, "degC");
    // degC has no admitted target, so the value is passed through untouched.
    // A requirement with unit "degC" will then be rejected by the production
    // grammar (SUPPORTED_ORACLE_UNITS does not include degC), ensuring the
    // caller sees the right error rather than a silently wrong Pa value.
    assertEquals(result.value, 22);
    assertEquals(result.unit, "degC");
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
    const UNADMITTED_EXAMPLES = ["K", "degC", "MPa", "bar", "psi", "°C"];
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
