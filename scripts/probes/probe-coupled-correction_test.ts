/**
 * Unit tests for the coupled-correction probe composition logic.
 *
 * Tests target the PURE functions exported from probe-coupled-correction.ts :
 *   - deriveSizeZBound
 *   - normalizeValue
 *   - composeCoupledSystem
 *   - parseValidityBounds
 *   - parseOracleConstraints
 *
 * Fixture data is copied from the real extractions performed on 2026-08-05
 * (sensitivity-study capture, oracle requirements capture, SysON constraint
 * extract output). No network calls are made.
 *
 * Per CLAUDE.md convention: test names are invariant phrases, @std/assert only.
 */

import { assertEquals, assertThrows } from "@std/assert";
import {
  composeCoupledSystem,
  deriveSizeZBound,
  normalizeValue,
} from "../../src/domain/analysis/coupled-correction-math.ts";
import {
  ORACLE_FEATURE_TO_SENSITIVITY_METRIC,
  parseOracleConstraints,
  parseValidityBounds,
} from "./probe-coupled-correction.ts";

// ---------------------------------------------------------------------------
// Fixtures — copied from real extraction 2026-08-05
// ---------------------------------------------------------------------------

/**
 * Validity bounds as returned by syson_constraint_extract on
 * DripTraySensitivityRelations (element e0c2725f-…, editingContext 07578aa5-…).
 */
const FIXTURE_VALIDITY_BOUNDS_EXTRACT = {
  constraints: [
    {
      id: "sizeZ_validity_lower-fake",
      name: "sizeZ_validity_lower",
      sourceId: "sizeZ_validity_lower-fake",
      expression: {
        kind: "binary",
        op: ">=",
        left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
        right: { kind: "literal", value: 29, unit: "mm" },
      },
    },
    {
      id: "sizeZ_validity_upper-fake",
      name: "sizeZ_validity_upper",
      sourceId: "sizeZ_validity_upper-fake",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["sizeZ_base_mm"] },
        right: { kind: "literal", value: 31, unit: "mm" },
      },
    },
  ],
};

/**
 * Oracle constraints as returned by syson_constraint_extract on
 * DripTrayMechanicalRequirements (element 113e40f7-…, editingContext 07578aa5-…).
 * Feature paths are the SysML attribute names inserted by the oracle-requirements run.
 * Displacement in mm, von Mises in Pa (as stored by SysON).
 *
 * NOTE: SysON uses camelCase attribute names ("maximumDisplacementMm",
 * "maximumVonMisesPa") while the sensitivity study uses snake_case metric ids
 * ("assembly_max_displacement", "assembly_max_von_mises"). The probe bridges
 * these via ORACLE_FEATURE_TO_SENSITIVITY_METRIC.
 */
const FIXTURE_ORACLE_EXTRACT = {
  constraints: [
    {
      id: "e20363c3-6b43-4fbd-98b2-c4f72fdb8b6b",
      name: "drip_tray_max_displacement_limit",
      sourceId: "e20363c3-6b43-4fbd-98b2-c4f72fdb8b6b",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["maximumDisplacementMm"] },
        right: { kind: "literal", value: 1, unit: "mm" },
      },
    },
    {
      id: "604fc986-662c-4a0f-9519-51b26b927c91",
      name: "drip_tray_max_von_mises_limit",
      sourceId: "604fc986-662c-4a0f-9519-51b26b927c91",
      expression: {
        kind: "binary",
        op: "<=",
        left: { kind: "ref", featurePath: ["maximumVonMisesPa"] },
        right: { kind: "literal", value: 20000000, unit: "Pa" },
      },
    },
  ],
};

/** Base metrics from sensitivity-study capture (2026-08-05, run at z0 = 30 mm). */
const FIXTURE_BASE_METRICS = {
  assembly_max_displacement: { value: 0.08528957185789164, unit: "mm" },
  assembly_max_von_mises: { value: 0.47810711748071366, unit: "MPa" },
};

/** Derivatives from sensitivity-study capture (step h = 1 mm, forward-difference). */
const FIXTURE_DERIVATIVES = [
  { metric: "assembly_max_displacement", value: -0.00801800268471424, unit: "mm/mm" },
  { metric: "assembly_max_von_mises", value: -0.036042088238638414, unit: "MPa/mm" },
];

const FIXTURE_Z0 = 30;
const FIXTURE_STEP = 1;
const FIXTURE_PARAM_UNIT = "mm";

// ---------------------------------------------------------------------------
// deriveSizeZBound — negative k, <= requirement
// ---------------------------------------------------------------------------

Deno.test("deriveSizeZBound returns lower bound on sizeZ when k < 0 and requirement is <=", () => {
  // u0 = 0.08529 mm, k = -0.008018 mm/mm, z0 = 30 mm, limit = 1 mm, op = "<="
  // Expected: z >= 30 + (1 - 0.08529) / (-0.008018) ≈ -84.07 mm
  const result = deriveSizeZBound({
    u0: 0.08528957185789164,
    k: -0.00801800268471424,
    z0: 30,
    limit: 1,
    reqOp: "<=",
  });
  assertEquals(result.op, ">=");
  // The bound should be well below 29 mm (trivially satisfied in validity domain).
  if (result.bound > 29) {
    throw new Error(`deriveSizeZBound bound ${result.bound} should be << 29.`);
  }
});

Deno.test("deriveSizeZBound returns lower bound above validity upper when limit is tight", () => {
  // tight_limit = u at z = 32 mm = 0.08529 + (-0.008018)*2 ≈ 0.06925 mm
  const tightLimit = 0.08528957185789164 + (-0.00801800268471424) * 2;
  const result = deriveSizeZBound({
    u0: 0.08528957185789164,
    k: -0.00801800268471424,
    z0: 30,
    limit: tightLimit,
    reqOp: "<=",
  });
  assertEquals(result.op, ">=");
  // The bound must exceed the validity upper bound of 31 mm.
  if (result.bound <= 31) {
    throw new Error(
      `deriveSizeZBound bound ${result.bound} should be > 31 mm for UNSAT case.`,
    );
  }
});

Deno.test("deriveSizeZBound throws when k = 0", () => {
  assertThrows(
    () => deriveSizeZBound({ u0: 0.5, k: 0, z0: 30, limit: 1, reqOp: "<=" }),
    Error,
    "k = 0",
  );
});

Deno.test("deriveSizeZBound returns upper bound on sizeZ when k > 0 and requirement is <=", () => {
  // Positive k: increasing z increases u. For u(z) <= limit, need z small.
  const result = deriveSizeZBound({
    u0: 0.5,
    k: 0.01,
    z0: 30,
    limit: 1,
    reqOp: "<=",
  });
  assertEquals(result.op, "<=");
  // z <= z0 + (limit - u0) / k = 30 + (1 - 0.5) / 0.01 = 30 + 50 = 80
  assertEquals(result.bound, 80);
});

// ---------------------------------------------------------------------------
// normalizeValue
// ---------------------------------------------------------------------------

Deno.test("normalizeValue converts Pa to MPa by dividing by 1e6", () => {
  assertEquals(normalizeValue(20000000, "Pa", "MPa"), 20);
});

Deno.test("normalizeValue is identity for same unit", () => {
  assertEquals(normalizeValue(1, "mm", "mm"), 1);
});

Deno.test("normalizeValue throws for unknown fromUnit", () => {
  assertThrows(
    () => normalizeValue(1, "kg", "MPa"),
    Error,
  );
});

Deno.test("normalizeValue throws for unknown conversion pair", () => {
  assertThrows(
    () => normalizeValue(1, "mm", "MPa"),
    Error,
  );
});

// ---------------------------------------------------------------------------
// parseValidityBounds
// ---------------------------------------------------------------------------

Deno.test("parseValidityBounds extracts lower and upper bounds from fixture", () => {
  const bounds = parseValidityBounds(FIXTURE_VALIDITY_BOUNDS_EXTRACT);
  assertEquals(bounds.length, 2);
  const lower = bounds.find((b) => b.op === ">=");
  const upper = bounds.find((b) => b.op === "<=");
  if (!lower || !upper) throw new Error("Missing bound operators");
  assertEquals(lower.boundValue, 29);
  assertEquals(lower.boundUnit, "mm");
  assertEquals(lower.paramAttrName, "sizeZ_base_mm");
  assertEquals(upper.boundValue, 31);
  assertEquals(upper.boundUnit, "mm");
});

Deno.test("parseValidityBounds throws when constraints is not an array", () => {
  assertThrows(
    () => parseValidityBounds({ constraints: "bad" }),
    Error,
  );
});

// ---------------------------------------------------------------------------
// parseOracleConstraints
// ---------------------------------------------------------------------------

Deno.test("parseOracleConstraints extracts displacement and von Mises requirements with SysML feature paths", () => {
  const reqs = parseOracleConstraints(FIXTURE_ORACLE_EXTRACT);
  assertEquals(reqs.length, 2);
  // SysON uses camelCase attribute names as feature paths.
  const disp = reqs.find((r) => r.metric === "maximumDisplacementMm");
  const vm = reqs.find((r) => r.metric === "maximumVonMisesPa");
  if (!disp || !vm) throw new Error("Missing requirement metrics");
  assertEquals(disp.op, "<=");
  assertEquals(disp.limitValue, 1);
  assertEquals(disp.limitUnit, "mm");
  assertEquals(vm.op, "<=");
  assertEquals(vm.limitValue, 20000000);
  assertEquals(vm.limitUnit, "Pa");
});

Deno.test("ORACLE_FEATURE_TO_SENSITIVITY_METRIC maps both DripTray metrics", () => {
  assertEquals(
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC.get("maximumDisplacementMm"),
    "assembly_max_displacement",
  );
  assertEquals(
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC.get("maximumVonMisesPa"),
    "assembly_max_von_mises",
  );
});

// ---------------------------------------------------------------------------
// composeCoupledSystem — full composition with fixture data
// ---------------------------------------------------------------------------

Deno.test("composeCoupledSystem SAT constraints include validity bounds and derived bounds", () => {
  const validityBounds = parseValidityBounds(FIXTURE_VALIDITY_BOUNDS_EXTRACT);
  const oracleReqs = parseOracleConstraints(FIXTURE_ORACLE_EXTRACT);

  const comp = composeCoupledSystem(
    validityBounds,
    oracleReqs,
    FIXTURE_BASE_METRICS,
    FIXTURE_DERIVATIVES,
    FIXTURE_Z0,
    FIXTURE_STEP,
    FIXTURE_PARAM_UNIT,
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC,
  );

  // SAT constraints: 2 validity + 2 derived (one per oracle requirement).
  assertEquals(comp.satConstraints.length, 4);

  // All derived bounds in SAT case must be < validity lower bound (29 mm)
  // — they are trivially satisfied throughout the domain.
  const validityLowerBound = 29;
  const derivedConstraints = comp.satConstraints.filter((c) =>
    c.id.startsWith("derived_")
  );
  for (const c of derivedConstraints) {
    if (c.expression.op === ">=") {
      if (c.expression.right.value >= validityLowerBound) {
        throw new Error(
          `SAT derived constraint "${c.id}" bound ${c.expression.right.value} ` +
            `should be < ${validityLowerBound} mm to be trivially satisfied.`,
        );
      }
    }
  }
});

Deno.test("composeCoupledSystem UNSAT constraints contain a tight bound above validity upper", () => {
  const validityBounds = parseValidityBounds(FIXTURE_VALIDITY_BOUNDS_EXTRACT);
  const oracleReqs = parseOracleConstraints(FIXTURE_ORACLE_EXTRACT);

  const comp = composeCoupledSystem(
    validityBounds,
    oracleReqs,
    FIXTURE_BASE_METRICS,
    FIXTURE_DERIVATIVES,
    FIXTURE_Z0,
    FIXTURE_STEP,
    FIXTURE_PARAM_UNIT,
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC,
  );

  const validityUpperBound = 31;

  // Find the tight constraint in unsatConstraints.
  const tightConstraint = comp.unsatConstraints.find((c) => c.id.includes("tight"));
  if (!tightConstraint) {
    throw new Error("UNSAT constraints must include a 'tight' constraint.");
  }
  // The tight bound must exceed the validity upper bound → contradiction with <= 31.
  if (
    tightConstraint.expression.op !== ">=" ||
    tightConstraint.expression.right.value <= validityUpperBound
  ) {
    throw new Error(
      `Tight constraint "${tightConstraint.id}" bound ` +
        `${tightConstraint.expression.right.value} must be > ${validityUpperBound} mm.`,
    );
  }
});

Deno.test("composeCoupledSystem tight limit is the displacement one step beyond the validity boundary", () => {
  const validityBounds = parseValidityBounds(FIXTURE_VALIDITY_BOUNDS_EXTRACT);
  const oracleReqs = parseOracleConstraints(FIXTURE_ORACLE_EXTRACT);

  const comp = composeCoupledSystem(
    validityBounds,
    oracleReqs,
    FIXTURE_BASE_METRICS,
    FIXTURE_DERIVATIVES,
    FIXTURE_Z0,
    FIXTURE_STEP,
    FIXTURE_PARAM_UNIT,
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC,
  );

  // tight_limit = u0 + k * (step_upper + step) = 0.08529 + (-0.008018) * 2
  const expected = 0.08528957185789164 + (-0.00801800268471424) * 2;
  const tol = 1e-10;
  if (Math.abs(comp.tightLimitDisplacement_mm - expected) > tol) {
    throw new Error(
      `Tight limit ${comp.tightLimitDisplacement_mm} ≠ expected ${expected}.`,
    );
  }
});

Deno.test("composeCoupledSystem throws when no derivative for an oracle metric", () => {
  const validityBounds = parseValidityBounds(FIXTURE_VALIDITY_BOUNDS_EXTRACT);
  const oracleReqs = parseOracleConstraints(FIXTURE_ORACLE_EXTRACT);

  assertThrows(
    () =>
      composeCoupledSystem(
        validityBounds,
        oracleReqs,
        FIXTURE_BASE_METRICS,
        [], // no derivatives
        FIXTURE_Z0,
        FIXTURE_STEP,
        FIXTURE_PARAM_UNIT,
        // Pass empty mapping → no resolution possible → throws
        new Map(),
      ),
    Error,
    "no derivative for oracle metric",
  );
});
