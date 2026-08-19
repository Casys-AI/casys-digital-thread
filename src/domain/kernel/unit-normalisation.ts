/**
 * Code-owned unit normalisation table for compilation-boundary rescaling.
 *
 * An entry exists here when the oracle (SysON) cannot carry a unit natively —
 * i.e. the round-trip probe (`deno task probe:requirement-units`) returned
 * `type_mismatch` or a similar failure — and the gap must be closed in code
 * rather than left for the agent to handle silently.
 *
 * WHY FUNCTIONS INSTEAD OF COEFFICIENTS — two transformation shapes exist in
 * physical unit systems: multiplicative (kPa → Pa: value × 1 000) and affine
 * (°C → K: value + 273.15). A table of plain numbers cannot represent the
 * affine case without silently treating the offset as a factor, which would
 * turn 22 °C into 0 K — precisely the class of silent-rescale bug this module
 * exists to prevent. Each entry therefore declares its transformation as a
 * named function whose body is explicit and testable.
 *
 * WHY THROW AT TABLE CONSTRUCTION — the guard that `targetUnit` must be in
 * `SUPPORTED_ORACLE_UNITS` fires when the module is loaded, not at the first
 * call. Any attempt to add an entry whose target the oracle cannot carry fails
 * immediately and loudly during development, before a malformed parameter
 * ever reaches the MRTR signing step.
 *
 * Adding a new entry requires:
 *   1. A live probe proving the targetUnit survives the SysON round-trip.
 *   2. A unit test that pins the emitted value for both a typical input and
 *      a boundary case (zero is mandatory for affine transforms).
 *   3. The corresponding label added to `UnitNormalisationLabel`.
 */

import { SUPPORTED_ORACLE_UNITS } from "./proof-case.ts";

/**
 * A declared, named transformation from one unit to a native oracle unit.
 * The `apply` function carries the exact conversion — no implicit coefficients.
 */
export type UnitNormalisationEntry<L extends string = string> = {
  readonly targetUnit: string;
  readonly label: L;
  /** Exact conversion function. Must be pure and total over all finite inputs. */
  readonly apply: (value: number) => number;
};

/** All normalisation labels that the compilation boundary currently declares. */
export type UnitNormalisationLabel =
  | "MPa-to-Pa"
  | "kN-to-N"
  | "MJ-to-J"
  | "kJ-to-J"
  | "bar-to-Pa"
  | "degC-to-K";

/**
 * Validate and register a single normalisation entry, throwing if the
 * `targetUnit` is not in the current `SUPPORTED_ORACLE_UNITS` list.
 *
 * Returning a tuple makes it directly usable as a `new Map([...])` argument
 * while keeping the guard inlined at the entry declaration site.
 */
function declareEntry<L extends UnitNormalisationLabel>(
  sourceUnit: string,
  entry: UnitNormalisationEntry<L>,
): [string, UnitNormalisationEntry<L>] {
  if (!SUPPORTED_ORACLE_UNITS.includes(entry.targetUnit)) {
    throw new Error(
      `Unit normalisation "${entry.label}" targets "${entry.targetUnit}", ` +
        `which is not in SUPPORTED_ORACLE_UNITS (${
          SUPPORTED_ORACLE_UNITS.join(", ")
        }). ` +
        `Run the probe and add the unit to UNIT_TO_SYSML_TYPE before adding an entry here.`,
    );
  }
  return [sourceUnit, entry];
}

/**
 * Code-owned map from a non-native unit string to its normalisation entry.
 *
 * Every entry's `targetUnit` is validated against `SUPPORTED_ORACLE_UNITS` at
 * module load time.  The guard fires before any call can proceed, so a bad
 * entry produces a loud startup failure rather than a silent wrong value.
 *
 * Currently declared:
 *   MPa  — refused by the 2026-08-14 probe (`type_mismatch`); converted to Pa
 *           by a factor-of-10⁶ multiplication.
 *   kN   — kN is not a SysON-native unit (probe 2026-08-14); converted to N
 *           (×1 000), which passed the probe.
 *   MJ   — MJ is not a SysON-native unit (probe 2026-08-14); converted to J
 *           (×1 000 000), which passed the probe.
 *   kJ   — kJ is not a SysON-native unit (probe 2026-08-14); converted to J
 *           (×1 000), which passed the probe.
 *   bar  — bar is not a SysON-native unit; converted to Pa (×100 000), which
 *           passed the 2026-08-04 probe.
 *   degC — first affine entry: K = degC + 273.15.  K passed the 2026-08-14
 *           probe.  The mandatory boundary test is apply(0) === 273.15 (not 0).
 */
export const UNIT_NORMALISATION: ReadonlyMap<
  string,
  UnitNormalisationEntry<UnitNormalisationLabel>
> = new Map<string, UnitNormalisationEntry<UnitNormalisationLabel>>([
  declareEntry("MPa", {
    targetUnit: "Pa",
    label: "MPa-to-Pa",
    /**
     * Exact multiplicative rescale: 1 MPa = 1 000 000 Pa.
     * This is NOT affine — the zero-crossing preserves zero (0 MPa → 0 Pa).
     */
    apply: (value: number) => value * 1_000_000,
  }),
  declareEntry("kN", {
    targetUnit: "N",
    label: "kN-to-N",
    /** 1 kN = 1 000 N — multiplicative, zero-crossing preserved. */
    apply: (value: number) => value * 1_000,
  }),
  declareEntry("MJ", {
    targetUnit: "J",
    label: "MJ-to-J",
    /** 1 MJ = 1 000 000 J — multiplicative, zero-crossing preserved. */
    apply: (value: number) => value * 1_000_000,
  }),
  declareEntry("kJ", {
    targetUnit: "J",
    label: "kJ-to-J",
    /** 1 kJ = 1 000 J — multiplicative, zero-crossing preserved. */
    apply: (value: number) => value * 1_000,
  }),
  declareEntry("bar", {
    targetUnit: "Pa",
    label: "bar-to-Pa",
    /** 1 bar = 100 000 Pa — multiplicative, zero-crossing preserved. */
    apply: (value: number) => value * 100_000,
  }),
  declareEntry("degC", {
    targetUnit: "K",
    label: "degC-to-K",
    /**
     * Affine offset: K = °C + 273.15.
     * This is NOT multiplicative — 0 °C maps to 273.15 K, not 0 K.
     * A table of plain coefficients would produce 0 × 273.15 = 0, which is
     * exactly the silent-rescale bug this function shape exists to prevent.
     */
    apply: (value: number) => value + 273.15,
  }),
]);

/**
 * Apply the normalisation for `unit`, or return the value and unit unchanged
 * with an `"identity"` label if no entry is registered.
 */
export function normaliseThreshold(
  value: number,
  unit: string,
): {
  readonly value: number;
  readonly unit: string;
  readonly transformation: UnitNormalisationLabel | "identity";
} {
  const entry = UNIT_NORMALISATION.get(unit);
  if (!entry) {
    return { value, unit, transformation: "identity" };
  }
  return {
    value: entry.apply(value),
    unit: entry.targetUnit,
    transformation: entry.label,
  };
}
