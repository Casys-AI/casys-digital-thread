/**
 * Probe: coupled-correction — z3 sur le système linéarisé couplé DripTray.
 *
 * DIAGNOSTIC ONLY — aucune écriture, aucune révision de projet, aucun appel
 * projet (project_change_append / queue / execute).
 *
 * Lit depuis les captures CAS réelles (state/local/) et depuis le modèle SysON
 * vivant les données du système couplé :
 *   - bornes de voisinage (DripTraySensitivityRelations, syson_constraint_extract)
 *   - exigences oracle (DripTrayMechanicalRequirements, syson_constraint_extract)
 *   - u0 et k (sensitivity-study capture, fichier CAS)
 *
 * Compose le système linéarisé u(z) = u0 + k·(z − z0) et pose à z3 deux
 * questions :
 *
 *   SAT  — existe-t-il z dans [z0−step, z0+step] tel que toutes les
 *           exigences soient satisfaites ? → sat avec VALEUR de z exploitable.
 *   UNSAT — même question avec une limite de déplacement resserrée au delà
 *           du voisinage déclaré → unsat avec conflict set.
 *
 * Toutes les valeurs numériques (u0, k, bornes, seuils) viennent de l'extraction
 * du modèle réel. Aucune constante n'est recopiée en dur. Les identifiants SysON
 * (editingContextId, elementId) sont lus depuis les captures CAS, comme le fait
 * la sonde existante probe-constraint-solver.ts.
 *
 * Budget MCP : 4 appels (2 × syson_constraint_extract + 2 × syson_constraint_solve).
 */

import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../src/adapters/http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_SYSON_ENDPOINT = "http://127.0.0.1:3009/mcp";
const DEFAULT_CAPTURES_DIR = "state/local";

/**
 * Server-fixed mapping from oracle SysML feature-path names to sensitivity-study
 * metric ids.
 *
 * WHY THIS EXISTS — the oracle requirements element (DripTrayMechanicalRequirements)
 * uses SysML-idiomatic camelCase attribute names (e.g. "maximumDisplacementMm"),
 * while the sensitivity study records derivatives under provider-native snake_case
 * keys (e.g. "assembly_max_displacement"). The two naming conventions cannot be
 * aligned at insertion time without re-encoding one or the other; this explicit
 * table is the join key used by the generic correction mechanism.
 *
 * This table is a first-class component of the correction-loop contract.
 * When a new oracle metric is added, a matching sensitivity derivative metric
 * must be registered here before the coupled probe can use it.
 */
export const ORACLE_FEATURE_TO_SENSITIVITY_METRIC: ReadonlyMap<string, string> =
  new Map([
    ["maximumDisplacementMm", "assembly_max_displacement"],
    ["maximumVonMisesPa", "assembly_max_von_mises"],
  ]);

// ---------------------------------------------------------------------------
// Types — captures CAS
// ---------------------------------------------------------------------------

export interface SensitivityRelationsCapture {
  readonly editingContextId: string;
  readonly elementId: string;
  readonly partDefName: string;
}

export interface OracleRequirementsCapture {
  readonly editingContextId: string;
  readonly elementId: string;
}

export interface SensitivityStudyCapture {
  readonly domain: {
    readonly base: number;
    readonly step: number;
    readonly parameterUnit: string;
  };
  readonly base: {
    readonly metrics: Record<string, { readonly value: number; readonly unit: string }>;
  };
  readonly derivatives: ReadonlyArray<{
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }>;
}

// ---------------------------------------------------------------------------
// Types — extracted SysON constraints
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
// Types — z3 constraint AST (inline format expected by syson_constraint_solve)
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
// Types — probe result
// ---------------------------------------------------------------------------

export type Z3Result =
  | {
    readonly status: "sat";
    readonly model: Record<string, unknown>;
    readonly objectiveValue?: unknown;
  }
  | { readonly status: "unsat"; readonly conflict: readonly string[] }
  | { readonly status: "error"; readonly message: string };

export interface ProbeCoupledCorrectionResult {
  readonly probe: "coupled-correction";
  readonly endpoint: string;
  readonly captures: {
    readonly sensitivityRelationsElementId: string;
    readonly oracleElementId: string;
    readonly editingContextId: string;
  };
  readonly extractedValidityBounds: readonly ExtractedBound[];
  readonly extractedOracleRequirements: readonly ExtractedRequirement[];
  readonly coupledSystem: {
    readonly z0_mm: number;
    readonly step_mm: number;
    readonly satConstraints: readonly Z3Constraint[];
    readonly unsatConstraints: readonly Z3Constraint[];
    readonly tightLimitDisplacement_mm: number;
    readonly rationale: string;
  };
  readonly satCase: Z3Result;
  readonly unsatCase: Z3Result;
}

// ---------------------------------------------------------------------------
// Public options
// ---------------------------------------------------------------------------

export interface ProbeCoupledCorrectionOptions {
  readonly sysonEndpoint?: string;
  readonly capturesDir?: string;
  /** Test seam — omit in production; defaults to HttpMcpToolClient. */
  readonly client?: McpToolClient;
}

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
export interface CoupledSystemComposition {
  readonly z0_mm: number;
  readonly step_mm: number;
  readonly satConstraints: readonly Z3Constraint[];
  readonly unsatConstraints: readonly Z3Constraint[];
  readonly tightLimitDisplacement_mm: number;
  readonly rationale: string;
}

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

// ---------------------------------------------------------------------------
// Capture file helpers
// ---------------------------------------------------------------------------

async function readSingleCaptureJson(
  dir: string,
): Promise<Record<string, unknown>> {
  const entries: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      entries.push(entry.name);
    }
  }
  if (entries.length === 0) {
    throw new Error(`readSingleCaptureJson: no JSON file in "${dir}".`);
  }
  if (entries.length > 1) {
    throw new Error(
      `readSingleCaptureJson: expected exactly 1 JSON file in "${dir}", found ${entries.length}.`,
    );
  }
  const text = await Deno.readTextFile(`${dir}/${entries[0]!}`);
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`readSingleCaptureJson: "${dir}/${entries[0]}" is not an object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseSensitivityRelationsCapture(
  raw: Record<string, unknown>,
): SensitivityRelationsCapture {
  const editingContextId = raw.editingContextId;
  const elementId = raw.elementId;
  const partDefName = raw.partDefName;
  if (
    typeof editingContextId !== "string" || !editingContextId.trim() ||
    typeof elementId !== "string" || !elementId.trim() ||
    typeof partDefName !== "string" || !partDefName.trim()
  ) {
    throw new Error(
      "parseSensitivityRelationsCapture: missing editingContextId, elementId, or partDefName.",
    );
  }
  return { editingContextId, elementId, partDefName };
}

function parseOracleRequirementsCapture(
  raw: Record<string, unknown>,
): OracleRequirementsCapture {
  const editingContextId = raw.editingContextId;
  const elementId = raw.elementId;
  if (
    typeof editingContextId !== "string" || !editingContextId.trim() ||
    typeof elementId !== "string" || !elementId.trim()
  ) {
    throw new Error(
      "parseOracleRequirementsCapture: missing editingContextId or elementId.",
    );
  }
  return { editingContextId, elementId };
}

function parseSensitivityStudyCapture(
  raw: Record<string, unknown>,
): SensitivityStudyCapture {
  const domain = raw.domain;
  const base = raw.base;
  const derivatives = raw.derivatives;

  if (
    !domain || typeof domain !== "object" || Array.isArray(domain) ||
    !base || typeof base !== "object" || Array.isArray(base) ||
    !Array.isArray(derivatives)
  ) {
    throw new Error(
      "parseSensitivityStudyCapture: missing domain, base, or derivatives.",
    );
  }
  const d = domain as Record<string, unknown>;
  if (
    typeof d.base !== "number" || typeof d.step !== "number" ||
    typeof d.parameterUnit !== "string"
  ) {
    throw new Error(
      "parseSensitivityStudyCapture: domain missing base, step, or parameterUnit.",
    );
  }
  const b = base as Record<string, unknown>;
  if (!b.metrics || typeof b.metrics !== "object" || Array.isArray(b.metrics)) {
    throw new Error("parseSensitivityStudyCapture: base.metrics missing.");
  }

  return {
    domain: { base: d.base, step: d.step, parameterUnit: String(d.parameterUnit) },
    base: { metrics: b.metrics as Record<string, { value: number; unit: string }> },
    derivatives: derivatives as ReadonlyArray<{
      readonly metric: string;
      readonly value: number;
      readonly unit: string;
    }>,
  };
}

// ---------------------------------------------------------------------------
// SysON constraint extraction helpers
// ---------------------------------------------------------------------------

/**
 * Parse validity bounds from syson_constraint_extract output for the
 * DripTraySensitivityRelations element.
 *
 * Expects constraints in the format produced by the existing extractor
 * (bound.constraintName, bound.op, bound.boundValue, bound.boundUnit,
 * bound.paramAttrName = expression.left.featurePath[0]).
 */
export function parseValidityBounds(
  structuredContent: Record<string, unknown>,
): ExtractedBound[] {
  if (!Array.isArray(structuredContent.constraints)) {
    throw new Error(
      "parseValidityBounds: structuredContent.constraints is not an array.",
    );
  }
  return (structuredContent.constraints as unknown[]).map((raw, i) => {
    const item = asRecord(raw, `constraints[${i}]`);
    const expr = asRecord(item.expression, `constraints[${i}].expression`);
    const left = asRecord(expr.left, `constraints[${i}].expression.left`);
    const right = asRecord(expr.right, `constraints[${i}].expression.right`);
    const featurePath = left.featurePath;
    const paramAttrName = Array.isArray(featurePath) && featurePath.length > 0 &&
        typeof featurePath[0] === "string"
      ? featurePath[0]
      : undefined;
    if (!paramAttrName) {
      throw new Error(`constraints[${i}]: invalid featurePath.`);
    }
    const constraintName = typeof item.name === "string" && item.name.trim()
      ? item.name
      : `constraint_${i}`;
    const op = expr.op;
    if (op !== ">=" && op !== "<=") {
      throw new Error(`constraints[${i}]: unexpected op "${String(op)}".`);
    }
    if (typeof right.value !== "number" || typeof right.unit !== "string") {
      throw new Error(`constraints[${i}]: right.value or right.unit invalid.`);
    }
    return {
      constraintName,
      paramAttrName,
      op: op as ">=" | "<=",
      boundValue: right.value,
      boundUnit: right.unit,
    };
  });
}

/**
 * Parse oracle requirements from syson_constraint_extract output for the
 * DripTrayMechanicalRequirements element.
 */
export function parseOracleConstraints(
  structuredContent: Record<string, unknown>,
): ExtractedRequirement[] {
  if (!Array.isArray(structuredContent.constraints)) {
    throw new Error(
      "parseOracleConstraints: structuredContent.constraints is not an array.",
    );
  }
  return (structuredContent.constraints as unknown[]).map((raw, i) => {
    const item = asRecord(raw, `constraints[${i}]`);
    const expr = asRecord(item.expression, `constraints[${i}].expression`);
    const left = asRecord(expr.left, `constraints[${i}].expression.left`);
    const right = asRecord(expr.right, `constraints[${i}].expression.right`);
    const featurePath = left.featurePath;
    const metric = Array.isArray(featurePath) && featurePath.length > 0 &&
        typeof featurePath[0] === "string"
      ? featurePath[0]
      : undefined;
    if (!metric) {
      throw new Error(`constraints[${i}]: invalid featurePath.`);
    }
    const constraintName = typeof item.name === "string" && item.name.trim()
      ? item.name
      : `constraint_${i}`;
    const op = expr.op;
    if (op !== ">=" && op !== "<=") {
      throw new Error(`constraints[${i}]: unexpected op "${String(op)}".`);
    }
    if (typeof right.value !== "number" || typeof right.unit !== "string") {
      throw new Error(`constraints[${i}]: right.value or right.unit invalid.`);
    }
    return {
      name: constraintName,
      metric,
      op: op as ">=" | "<=",
      limitValue: right.value,
      limitUnit: right.unit,
    };
  });
}

// ---------------------------------------------------------------------------
// Z3 result parser (same pattern as probe-constraint-solver.ts)
// ---------------------------------------------------------------------------

function parseZ3Result(raw: Record<string, unknown>): Z3Result {
  const status = raw.status;
  if (status === "sat") {
    const model = raw.model;
    if (!isRecord(model)) {
      return { status: "error", message: "sat response missing model object" };
    }
    return { status: "sat", model, objectiveValue: raw.objectiveValue };
  }
  if (status === "unsat") {
    const conflict = raw.conflict;
    if (!Array.isArray(conflict)) {
      return { status: "error", message: "unsat response missing conflict array" };
    }
    const ids = conflict.filter((item): item is string => typeof item === "string");
    if (ids.length !== conflict.length) {
      return { status: "error", message: "unsat conflict contains non-string entries" };
    }
    return { status: "unsat", conflict: ids };
  }
  return {
    status: "error",
    message: `unexpected z3 status: ${JSON.stringify(status)}`,
  };
}

// ---------------------------------------------------------------------------
// Main probe function
// ---------------------------------------------------------------------------

/**
 * Run the coupled-correction probe and return a machine-readable result.
 *
 * The function is read-only on both the model and the capture stores.
 * It makes exactly 4 MCP calls (2 extractions + 2 solves).
 */
export async function probeCoupledCorrection(
  options: ProbeCoupledCorrectionOptions = {},
): Promise<ProbeCoupledCorrectionResult> {
  const endpoint = options.sysonEndpoint ?? DEFAULT_SYSON_ENDPOINT;
  const capturesDir = options.capturesDir ?? DEFAULT_CAPTURES_DIR;

  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });

  // ── Step 1: read captures from file store ─────────────────────────────────
  const sensRelCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/sensitivity-relations-seed-captures`,
  );
  const oracleCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/oracle-requirements-seed-captures`,
  );
  const sensitivityCaptureRaw = await readSingleCaptureJson(
    `${capturesDir}/sensitivity-study-captures`,
  );

  const sensRelCapture = parseSensitivityRelationsCapture(sensRelCaptureRaw);
  const oracleCapture = parseOracleRequirementsCapture(oracleCaptureRaw);
  const sensitivityCapture = parseSensitivityStudyCapture(sensitivityCaptureRaw);

  if (sensRelCapture.editingContextId !== oracleCapture.editingContextId) {
    throw new Error(
      `Editing context mismatch: sensitivity-relations uses "${sensRelCapture.editingContextId}" ` +
        `but oracle-requirements uses "${oracleCapture.editingContextId}". ` +
        "Both elements must belong to the same SysON project.",
    );
  }
  const editingContextId = sensRelCapture.editingContextId;

  // ── Step 2: extract validity bounds from live SysON model (MCP call #1) ───
  const validityExtract = await client.callTool({
    name: "syson_constraint_extract",
    arguments: {
      editing_context_id: editingContextId,
      element_id: sensRelCapture.elementId,
    },
  });
  const extractedValidityBounds = parseValidityBounds(
    validityExtract.structuredContent,
  );

  // ── Step 3: extract oracle requirements from live SysON model (MCP call #2)
  const oracleExtract = await client.callTool({
    name: "syson_constraint_extract",
    arguments: {
      editing_context_id: editingContextId,
      element_id: oracleCapture.elementId,
    },
  });
  const extractedOracleRequirements = parseOracleConstraints(
    oracleExtract.structuredContent,
  );

  // ── Step 4: compose the coupled system ────────────────────────────────────
  const composition = composeCoupledSystem(
    extractedValidityBounds,
    extractedOracleRequirements,
    sensitivityCapture.base.metrics,
    sensitivityCapture.derivatives,
    sensitivityCapture.domain.base,
    sensitivityCapture.domain.step,
    sensitivityCapture.domain.parameterUnit,
  );

  // ── Step 5: SAT case (MCP call #3) ────────────────────────────────────────
  let satCase: Z3Result;
  try {
    const satRaw = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: {
        constraints: composition.satConstraints,
        objective: {
          variable: extractedValidityBounds[0]?.paramAttrName ?? "sizeZ_base_mm",
          direction: "minimize",
        },
      },
    });
    satCase = parseZ3Result(satRaw);
  } catch (error) {
    satCase = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // ── Step 6: UNSAT case (MCP call #4) ──────────────────────────────────────
  let unsatCase: Z3Result;
  try {
    const unsatRaw = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: {
        constraints: composition.unsatConstraints,
        objective: {
          variable: extractedValidityBounds[0]?.paramAttrName ?? "sizeZ_base_mm",
          direction: "minimize",
        },
      },
    });
    unsatCase = parseZ3Result(unsatRaw);
  } catch (error) {
    unsatCase = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    probe: "coupled-correction",
    endpoint,
    captures: {
      sensitivityRelationsElementId: sensRelCapture.elementId,
      oracleElementId: oracleCapture.elementId,
      editingContextId,
    },
    extractedValidityBounds,
    extractedOracleRequirements,
    coupledSystem: {
      z0_mm: composition.z0_mm,
      step_mm: composition.step_mm,
      satConstraints: composition.satConstraints,
      unsatConstraints: composition.unsatConstraints,
      tightLimitDisplacement_mm: composition.tightLimitDisplacement_mm,
      rationale: composition.rationale,
    },
    satCase,
    unsatCase,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const result = await probeCoupledCorrection();
  console.log(JSON.stringify(result, null, 2));
  if (
    result.satCase.status !== "sat" ||
    result.unsatCase.status !== "unsat"
  ) {
    Deno.exitCode = 1;
  }
}
