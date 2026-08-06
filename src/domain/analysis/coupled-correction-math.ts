/**
 * Pure math for the coupled-correction linearised model.
 *
 * WHY THIS MODULE EXISTS — these three functions (normalizeValue,
 * deriveSizeZBound, composeCoupledSystem) are zero-I/O, no Deno.*, no fetch.
 * They must be accessible to src/adapters/executors/ without creating an
 * inverted scripts/ → src/ dependency. The types they depend on are
 * co-located here so executors can import a single module.
 *
 * Source: extracted from scripts/probes/probe-coupled-correction.ts (vague
 * organisation v2). The probe now imports from here; its adapter and I/O
 * helpers remain in scripts/.
 */

// ---------------------------------------------------------------------------
// Exported types — z3 constraint AST (inline format expected by
// syson_constraint_solve)
// ---------------------------------------------------------------------------

export interface Z3ConstraintLiteral {
  readonly kind: "literal";
  readonly value: number;
  readonly unit: string;
}

export interface Z3ConstraintRef {
  readonly kind: "ref";
  readonly featurePath: readonly string[];
}

export interface Z3ConstraintBinary {
  readonly kind: "binary";
  readonly op: ">=" | "<=";
  readonly left: Z3ConstraintRef;
  readonly right: Z3ConstraintLiteral;
}

export interface Z3Constraint {
  readonly id: string;
  readonly name: string;
  readonly sourceId: string;
  readonly expression: Z3ConstraintBinary;
}

// ---------------------------------------------------------------------------
// Exported types — extracted SysON constraints
// ---------------------------------------------------------------------------

export interface ExtractedBound {
  readonly constraintName: string;
  readonly paramAttrName: string;
  readonly op: ">=" | "<=";
  readonly boundValue: number;
  readonly boundUnit: string;
}

export interface ExtractedRequirement {
  readonly name: string;
  readonly metric: string;
  readonly op: ">=" | "<=";
  readonly limitValue: number;
  readonly limitUnit: string;
}

// ---------------------------------------------------------------------------
// Exported types — system composition result
// ---------------------------------------------------------------------------

export interface CoupledSystemComposition {
  readonly z0_mm: number;
  readonly step_mm: number;
  readonly satConstraints: readonly Z3Constraint[];
  readonly unsatConstraints: readonly Z3Constraint[];
  readonly tightLimitDisplacement_mm: number;
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Server-fixed mapping: oracle feature paths → sensitivity metric ids
//
// WHY THIS TABLE — the oracle requirements element (DripTrayMechanicalRequirements)
// uses SysML-idiomatic camelCase attribute names (e.g. "maximumDisplacementMm"),
// while the sensitivity study records derivatives under provider-native snake_case
// keys (e.g. "assembly_max_displacement"). This explicit map is the join key used
// by composeCoupledSystem. When a new oracle metric is added, a matching sensitivity
// derivative metric must be registered here.
// ---------------------------------------------------------------------------

export const ORACLE_FEATURE_TO_SENSITIVITY_METRIC: ReadonlyMap<string, string> =
  new Map([
    ["maximumDisplacementMm", "assembly_max_displacement"],
    ["maximumVonMisesPa", "assembly_max_von_mises"],
  ]);

// ---------------------------------------------------------------------------
// Unit conversion
// ---------------------------------------------------------------------------

/**
 * Minimal unit conversion for the units present in the DripTray coupled system.
 *
 * WHY EXPLICIT — a general unit parser is out of scope and unnecessary here.
 * The unit pairs are: oracle stores von Mises in "Pa", sensitivity study uses
 * "MPa". Converting Pa → MPa = /1e6. Only conversions that appear in this
 * specific system are registered; unknown pairs are hard errors (fail-closed).
 */
const UNIT_FACTORS: ReadonlyMap<string, ReadonlyMap<string, number>> = new Map([
  ["Pa", new Map([["Pa", 1], ["MPa", 1e-6]])],
  ["MPa", new Map([["MPa", 1], ["Pa", 1e6]])],
  ["mm", new Map([["mm", 1]])],
]);

export function normalizeValue(
  value: number,
  fromUnit: string,
  toUnit: string,
): number {
  if (fromUnit === toUnit) return value;
  const factors = UNIT_FACTORS.get(fromUnit);
  if (!factors) {
    throw new Error(
      `normalizeValue: fromUnit "${fromUnit}" has no registered conversion.`,
    );
  }
  const factor = factors.get(toUnit);
  if (factor === undefined) {
    throw new Error(
      `normalizeValue: no conversion from "${fromUnit}" to "${toUnit}".`,
    );
  }
  return value * factor;
}

// ---------------------------------------------------------------------------
// Derived bound computation
// ---------------------------------------------------------------------------

/**
 * Given the linearized model u(z) = u0 + k·(z − z0) and a requirement
 * u(z) op limit, derive the implied bound on z.
 *
 * Returns { op, bound } such that z must satisfy `z op bound` for the
 * requirement to be met. For k = 0, throws — no correction is possible.
 *
 * UNIT CONTRACT — u0, k, limit must already be in consistent units:
 *   u0 and limit in the metric unit, k in (metric unit)/(param unit),
 *   z0 and the returned bound in the param unit.
 */
export function deriveSizeZBound(params: {
  readonly u0: number;
  readonly k: number;
  readonly z0: number;
  readonly limit: number;
  readonly reqOp: ">=" | "<=";
}): { readonly op: ">=" | "<="; readonly bound: number } {
  const { u0, k, z0, limit, reqOp } = params;
  if (k === 0) {
    throw new Error("deriveSizeZBound: k = 0, no sensitivity to correct.");
  }
  // u(z) = u0 + k*(z-z0)
  // u(z) reqOp limit
  // k*(z-z0) reqOp (limit - u0)  [same reqOp so far]
  // If k > 0: divide without reversal → (z-z0) reqOp (limit-u0)/k → z reqOp z0+(limit-u0)/k
  // If k < 0: divide with reversal → (z-z0) ~reqOp (limit-u0)/k → z ~reqOp z0+(limit-u0)/k
  const offset = (limit - u0) / k;
  const threshold = z0 + offset;

  if (reqOp === "<=") {
    // u(z) <= limit
    return k < 0
      ? { op: ">=", bound: threshold } // k<0: increasing z satisfies the upper limit → z >= threshold
      : { op: "<=", bound: threshold }; // k>0: z must be small enough → z <= threshold
  } else {
    // u(z) >= limit
    return k < 0
      ? { op: "<=", bound: threshold } // k<0: z must be small enough → z <= threshold
      : { op: ">=", bound: threshold }; // k>0: increasing z reaches the lower limit → z >= threshold
  }
}

// ---------------------------------------------------------------------------
// Coupled system composition
// ---------------------------------------------------------------------------

/**
 * Build the two inline constraint sets for syson_constraint_solve.
 *
 * satConstraints  — validity bounds + all requirements expressed as sizeZ bounds.
 *                   All current measurements satisfy requirements in the domain,
 *                   so all derived bounds are well below the validity lower bound.
 *                   Minimize sizeZ → z3 returns the validity lower bound as the
 *                   optimal value.
 *
 * unsatConstraints — same validity bounds, but the displacement limit is replaced
 *                   by the "tight limit": the displacement that would require z one
 *                   step beyond the upper validity boundary. The derived sizeZ bound
 *                   (z >= z0 + 2·step) exceeds the validity upper bound (z <= z0 + step),
 *                   making the system UNSAT.
 *
 * WHY NO HARDCODED TIGHT LIMIT — the tight limit is computed from:
 *   tight_limit = u0_disp + k_disp · (step_upper + step)
 * where step_upper = validity_upper_bound - z0 and step is the study step.
 * This derives a value from the model data that is exactly one step beyond the
 * achievable minimum in the validity domain.
 */
export function composeCoupledSystem(
  validityBounds: readonly ExtractedBound[],
  oracleRequirements: readonly ExtractedRequirement[],
  baseMetrics: Record<string, { readonly value: number; readonly unit: string }>,
  derivatives: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }>,
  z0: number,
  step: number,
  paramUnit: string,
  /**
   * Optional custom mapping from oracle feature-path names to sensitivity metric ids.
   * Defaults to ORACLE_FEATURE_TO_SENSITIVITY_METRIC. Pass a custom map in tests
   * that use fixture oracle feature paths that match the sensitivity metric ids directly.
   */
  oracleToSensitivityMetric: ReadonlyMap<string, string> =
    ORACLE_FEATURE_TO_SENSITIVITY_METRIC,
): CoupledSystemComposition {
  // ── 1. Validity bounds as-is (from SysON model) ────────────────────────────
  const validityConstraints: Z3Constraint[] = validityBounds.map((b) => ({
    id: b.constraintName,
    name: b.constraintName,
    sourceId: b.constraintName,
    expression: {
      kind: "binary",
      op: b.op,
      left: { kind: "ref", featurePath: [b.paramAttrName] },
      right: { kind: "literal", value: b.boundValue, unit: b.boundUnit },
    },
  }));

  // Expect exactly one lower and one upper bound; find the upper for tight-limit math.
  const upperBound = validityBounds.find((b) => b.op === "<=");
  if (!upperBound) {
    throw new Error("composeCoupledSystem: no upper validity bound found.");
  }
  const lowerBound = validityBounds.find((b) => b.op === ">=");
  if (!lowerBound) {
    throw new Error("composeCoupledSystem: no lower validity bound found.");
  }

  // ── 2. Index derivatives by metric name ────────────────────────────────────
  const derivByMetric = new Map<string, { value: number; unit: string }>();
  for (const d of derivatives) {
    derivByMetric.set(d.metric, { value: d.value, unit: d.unit });
  }

  // ── 3. Index base metrics by name ──────────────────────────────────────────
  const baseByMetric = new Map<string, { value: number; unit: string }>();
  for (const [metric, mv] of Object.entries(baseMetrics)) {
    baseByMetric.set(metric, mv);
  }

  // ── 4. Derive bounds on sizeZ from each oracle requirement ─────────────────
  //
  // For each requirement (metric op limit [unit]):
  //   1. Find the derivative for the same metric.
  //   2. Parse the numerator unit from the derivative unit (e.g., "MPa/mm" → "MPa").
  //   3. Normalise the oracle limit and u0 to the derivative numerator unit.
  //   4. Call deriveSizeZBound to get the implied bound on sizeZ.
  //   5. Express it as a Z3Constraint literal in paramUnit.
  const satDerivedConstraints: Z3Constraint[] = [];
  let displacementDerived: {
    u0_mm: number;
    k_mm_per_mm: number;
    limit_mm: number;
    metric: string;
  } | undefined;

  for (const req of oracleRequirements) {
    // Resolve the sensitivity metric id: try direct match first (for tests with matching fixtures),
    // then fall back to the explicit oracle→sensitivity mapping table.
    const sensitivityMetric = derivByMetric.has(req.metric)
      ? req.metric
      : oracleToSensitivityMetric.get(req.metric);
    if (!sensitivityMetric) {
      throw new Error(
        `composeCoupledSystem: no derivative for oracle metric "${req.metric}". ` +
          `Register a mapping in ORACLE_FEATURE_TO_SENSITIVITY_METRIC.`,
      );
    }
    const deriv = derivByMetric.get(sensitivityMetric);
    if (!deriv) {
      throw new Error(
        `composeCoupledSystem: no derivative for oracle metric "${req.metric}".`,
      );
    }
    const base = baseByMetric.get(sensitivityMetric);
    if (!base) {
      throw new Error(
        `composeCoupledSystem: no base measurement for metric "${req.metric}" ` +
          `(sensitivity metric: "${sensitivityMetric}").`,
      );
    }

    // Parse numerator unit from derivative unit string (format: "numeratorUnit/paramUnit").
    const slashIdx = deriv.unit.indexOf("/");
    if (slashIdx < 0) {
      throw new Error(
        `composeCoupledSystem: derivative unit "${deriv.unit}" has no "/" separator.`,
      );
    }
    const numeratorUnit = deriv.unit.slice(0, slashIdx);
    const derivParamUnit = deriv.unit.slice(slashIdx + 1);
    if (derivParamUnit !== paramUnit) {
      throw new Error(
        `composeCoupledSystem: derivative paramUnit "${derivParamUnit}" ≠ ` +
          `declared paramUnit "${paramUnit}".`,
      );
    }

    // Normalise oracle limit and u0 to numeratorUnit.
    const limit_normalized = normalizeValue(
      req.limitValue,
      req.limitUnit,
      numeratorUnit,
    );
    const u0_normalized = normalizeValue(base.value, base.unit, numeratorUnit);

    const derived = deriveSizeZBound({
      u0: u0_normalized,
      k: deriv.value,
      z0,
      limit: limit_normalized,
      reqOp: req.op,
    });

    const constraintId = `derived_${req.metric}_${req.op === "<=" ? "lower" : "upper"}`;
    satDerivedConstraints.push({
      id: constraintId,
      name: constraintId,
      sourceId: constraintId,
      expression: {
        kind: "binary",
        op: derived.op,
        left: { kind: "ref", featurePath: [lowerBound.paramAttrName] },
        right: { kind: "literal", value: derived.bound, unit: paramUnit },
      },
    });

    // Keep displacement data for tight-limit computation.
    if (
      base.unit === "mm" || base.unit === numeratorUnit && numeratorUnit === "mm"
    ) {
      displacementDerived = {
        u0_mm: u0_normalized,
        k_mm_per_mm: deriv.value,
        limit_mm: limit_normalized,
        metric: req.metric,
      };
    }
  }

  if (!displacementDerived) {
    throw new Error(
      "composeCoupledSystem: could not identify the displacement metric (expected mm unit).",
    );
  }

  // ── 5. Compute tight limit for UNSAT case ──────────────────────────────────
  //
  // tight_limit = u(z_upper + step), where z_upper is the validity upper bound.
  // This is the displacement the structure would have one step beyond the domain —
  // it is strictly smaller than the achievable minimum in the domain (since k<0),
  // so requiring displacement ≤ tight_limit forces z > z_upper → UNSAT.
  const stepUpper = upperBound.boundValue - z0; // = step (e.g., 1 mm)
  const tightLimitDisplacement_mm = displacementDerived.u0_mm +
    displacementDerived.k_mm_per_mm * (stepUpper + step);

  const tightDerived = deriveSizeZBound({
    u0: displacementDerived.u0_mm,
    k: displacementDerived.k_mm_per_mm,
    z0,
    limit: tightLimitDisplacement_mm,
    reqOp: "<=",
  });
  const unsatDerivedId = `derived_${displacementDerived.metric}_tight_lower`;
  const unsatDerivedConstraint: Z3Constraint = {
    id: unsatDerivedId,
    name: unsatDerivedId,
    sourceId: unsatDerivedId,
    expression: {
      kind: "binary",
      op: tightDerived.op,
      left: { kind: "ref", featurePath: [lowerBound.paramAttrName] },
      right: { kind: "literal", value: tightDerived.bound, unit: paramUnit },
    },
  };

  const satConstraints: Z3Constraint[] = [
    ...validityConstraints,
    ...satDerivedConstraints,
  ];

  // UNSAT set: remove the original displacement derived constraint, add the tight one.
  const unsatConstraints: Z3Constraint[] = [
    ...validityConstraints,
    ...satDerivedConstraints.filter(
      (c) => c.id !== `derived_${displacementDerived!.metric}_lower`,
    ),
    unsatDerivedConstraint,
  ];

  const rationale =
    `SAT case: real requirements (disp ≤ ${displacementDerived.limit_mm} mm) ` +
    `trivially satisfied ∀ z ∈ [${lowerBound.boundValue}, ${upperBound.boundValue}] ${paramUnit}. ` +
    `UNSAT case: tight limit = ${tightLimitDisplacement_mm.toFixed(6)} mm ` +
    `(= u at z = ${upperBound.boundValue + step} mm, one step beyond the domain) ` +
    `requires z ≥ ${tightDerived.bound.toFixed(4)} mm > ` +
    `validity upper bound ${upperBound.boundValue} mm → contradiction.`;

  return {
    z0_mm: z0,
    step_mm: step,
    satConstraints,
    unsatConstraints,
    tightLimitDisplacement_mm,
    rationale,
  };
}
