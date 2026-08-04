/**
 * Shared oracle helpers for the DripTray mechanical path.
 *
 * Consumed by three executors:
 *   - CoffeeMachineCm01V3MechanicalRunExecutor (V1/original path)
 *   - CoffeeMachineCm01V3MechanicalR2RunExecutor  (28 mm → 30 mm correction)
 *   - CoffeeMachineCm01V3MechanicalR3RunExecutor  (R3 recovery)
 * and the identity-recovery executor that re-materialises an existing capture.
 *
 * UNIT CONVENTION — run path: MPa for von Mises stress, mm for displacement.
 *
 * CalculiX reports both metrics in these units (field names in the capture schema:
 * `maximumVonMises.unit = "MPa"`, `maximumDisplacement.unit = "mm"`).  The proof
 * struct names its limit fields `maximumVonMisesMpa` and `maximumDisplacementMm`
 * to make the unit explicit at the type level.  `callDripTrayMechanicalOracle`
 * passes exactly these units to syson_constraint_evaluate.
 *
 * The SysON model may legitimately express the same von Mises limit in Pa
 * (20 MPa = 20 000 000 Pa) because SysML uses SI base units.  That value
 * only appears in model writes and the syson-requirements-extractor; it never
 * enters the run path.  Mixing Pa with the MPa run-path values is a hard error
 * caught by parseOracleOutcome before any numeric field is read.
 */

import type {
  RequirementEvaluation,
  RequirementEvaluationStatus,
  ThreadFreshness,
  ThreadOperationRef,
  TracedRequirement,
} from "../domain/thread-snapshot.ts";
import { buildConstraintAst, type OracleRequirement } from "../domain/proof-case.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Parsed oracle result — keyed by constraint ID in the result map
// ---------------------------------------------------------------------------

/**
 * Parsed verdict for a single constraint from syson_constraint_evaluate.
 *
 * Union type: callers must not read numeric fields when the oracle could not
 * determine a verdict.  Merging them into optional fields would silently
 * allow callers to use 0 as a default — forbidden under the AX "fail-fast"
 * principle.
 */
export type ParsedOracleResult =
  | {
    readonly status: "pass" | "fail";
    readonly computedValue: number;
    readonly threshold: number;
    readonly margin: number;
    readonly marginPercent: number;
    /** Normalised unit used by the oracle; equals the unit declared in OracleRequirement. */
    readonly unit: string;
  }
  | { readonly status: "error" | "unresolved" };

// ---------------------------------------------------------------------------
// evaluationFromOracle — pure, no I/O
// ---------------------------------------------------------------------------

/**
 * Build a RequirementEvaluation from an already-obtained oracle verdict.
 *
 * The oracle is the sole authority on the verdict (no local arithmetic).
 * For error / unresolved statuses, comparison is intentionally absent:
 * thread-snapshot-validation raises unexpected_comparison when comparison is
 * present for those statuses, so a non-null comparison would silently make
 * the snapshot fail validation.
 *
 * The unit guard is enforced by parseOracleOutcome upstream: if the oracle
 * returns a unit different from the one declared in OracleRequirement, the
 * response is rejected before this function is ever called.
 */
export function evaluationFromOracle(
  requirement: TracedRequirement,
  observation: { id: string; quantity: { value: number; unit: string } },
  oracleResult: ParsedOracleResult,
  evaluator: ThreadOperationRef,
  solveId: string,
  at: string,
  freshness: ThreadFreshness,
): RequirementEvaluation {
  const id = `${requirement.id}-evaluation`;
  const base = {
    id,
    name: `${requirement.name} evaluation`,
    requirementId: requirement.id,
    observationIds: [observation.id],
    status: oracleResult.status as RequirementEvaluationStatus,
    evaluatedAt: at,
    evaluator,
    evidenceArtifactIds: [solveId],
    freshness,
  };
  if (oracleResult.status === "pass" || oracleResult.status === "fail") {
    return {
      ...base,
      comparison: {
        observationId: observation.id,
        actual: { value: oracleResult.computedValue, unit: oracleResult.unit },
        operator: "<=",
        limit: { value: oracleResult.threshold, unit: oracleResult.unit },
        normalizedUnit: oracleResult.unit,
        margin: { value: oracleResult.margin, unit: oracleResult.unit },
      },
      message: oracleResult.status === "pass"
        ? "The observed value is within the reviewed concept limit."
        : "The observed value exceeds the reviewed concept limit.",
    };
  }
  return {
    ...base,
    message: oracleResult.status === "error"
      ? "The oracle returned an error evaluating this limit."
      : "The oracle could not resolve this limit evaluation.",
  };
}

// ---------------------------------------------------------------------------
// parseOracleOutcome — pure, no I/O
// ---------------------------------------------------------------------------

const ORACLE_STATUS_VALUES = new Set<string>(["pass", "fail", "error", "unresolved"]);

/**
 * Parse and validate the structuredContent returned by syson_constraint_evaluate.
 *
 * Fail-closed: any structural deviation, missing constraint, duplicate,
 * unit mismatch (oracle unit ≠ declared limit unit), or non-finite number
 * is a hard rejection thrown before any numeric field is consumed.
 *
 * The unit guard here is the replacement for the unit mismatch check that
 * previously lived in local evaluation() functions in the materializers:
 * it fires before any numeric field is read, ensuring that a Pa oracle
 * response is never silently treated as MPa.
 */
export function parseOracleOutcome(
  content: Readonly<Record<string, unknown>>,
  requirements: readonly OracleRequirement[],
): ReadonlyMap<string, ParsedOracleResult> {
  if (!Array.isArray(content.results)) {
    throw new Error(
      "syson_constraint_evaluate: structuredContent.results must be an array.",
    );
  }
  const rows = content.results as unknown[];
  if (rows.length !== requirements.length) {
    throw new Error(
      `syson_constraint_evaluate: expected ${requirements.length} result(s), got ${rows.length}.`,
    );
  }
  const expectedIds = new Map(requirements.map((r) => [r.id, r]));
  const map = new Map<string, ParsedOracleResult>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error(`syson_constraint_evaluate: results[${i}] must be an object.`);
    }
    const item = row as Record<string, unknown>;
    const constraintId = item.constraintId;
    if (typeof constraintId !== "string" || !expectedIds.has(constraintId)) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].constraintId is unknown or missing.`,
      );
    }
    if (map.has(constraintId)) {
      throw new Error(
        `syson_constraint_evaluate: duplicate constraintId "${constraintId}" in results.`,
      );
    }
    const rawStatus = item.status;
    if (typeof rawStatus !== "string" || !ORACLE_STATUS_VALUES.has(rawStatus)) {
      throw new Error(
        `syson_constraint_evaluate: results[${i}].status must be pass|fail|error|unresolved.`,
      );
    }
    const status = rawStatus as "pass" | "fail" | "error" | "unresolved";
    if (status === "pass" || status === "fail") {
      const req = expectedIds.get(constraintId)!;
      if (item.unit !== req.limit.unit) {
        throw new Error(
          `syson_constraint_evaluate: results[${i}].unit must equal "${req.limit.unit}" ` +
            `(got "${item.unit}").`,
        );
      }
      map.set(constraintId, {
        status,
        computedValue: oracleNumber(item, "computedValue", i),
        threshold: oracleNumber(item, "threshold", i),
        margin: oracleNumber(item, "margin", i),
        marginPercent: oracleNumber(item, "marginPercent", i),
        unit: req.limit.unit,
      });
    } else {
      map.set(constraintId, { status });
    }
  }
  for (const id of expectedIds.keys()) {
    if (!map.has(id)) {
      throw new Error(
        `syson_constraint_evaluate: missing result for constraint "${id}".`,
      );
    }
  }
  return map;
}

function oracleNumber(
  item: Record<string, unknown>,
  field: string,
  index: number,
): number {
  const value = item[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `syson_constraint_evaluate: results[${index}].${field} must be a finite number.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// callDripTrayMechanicalOracle — I/O entry point
// ---------------------------------------------------------------------------

/**
 * Narrow input types: the oracle call needs only these four scalar values.
 * Callers extract them from their capture/proof types; neither type is
 * imported here to keep this module discipline-agnostic.
 */
export interface DripTrayMechanicalLimits {
  readonly maximumDisplacementMm: number;
  readonly maximumVonMisesMpa: number;
}

export interface DripTrayMechanicalMetrics {
  /** Value in mm, as reported by CalculiX and stored in the capture schema. */
  readonly displacementMm: number;
  /** Value in MPa, as reported by CalculiX and stored in the capture schema. */
  readonly vonMisesMpa: number;
}

/**
 * Call syson_constraint_evaluate with the two mechanical limits and the values
 * measured by CalculiX.  The oracle converts units internally and renders the
 * verdict; local arithmetic is intentionally absent.
 *
 * Constraint IDs equal the metric names so the mapping back to TracedRequirements
 * in the snapshot is unambiguous without any secondary index.
 *
 * Units sent: mm for displacement, MPa for von Mises stress.  See module-level
 * comment for the Pa/MPa convention.
 */
export async function callDripTrayMechanicalOracle(
  syson: McpToolClient,
  limits: DripTrayMechanicalLimits,
  metrics: DripTrayMechanicalMetrics,
): Promise<ReadonlyMap<string, ParsedOracleResult>> {
  const requirements: OracleRequirement[] = [
    {
      id: "assembly_max_displacement",
      name: "DripTray maximum displacement limit",
      metric: "assembly_max_displacement",
      operator: "<=",
      limit: { value: limits.maximumDisplacementMm, unit: "mm" },
    },
    {
      id: "assembly_max_von_mises",
      name: "DripTray maximum von Mises stress limit",
      metric: "assembly_max_von_mises",
      operator: "<=",
      limit: { value: limits.maximumVonMisesMpa, unit: "MPa" },
    },
  ];
  const constraints = requirements.map(buildConstraintAst);
  const values = {
    assembly_max_displacement: { value: metrics.displacementMm, unit: "mm" },
    assembly_max_von_mises: { value: metrics.vonMisesMpa, unit: "MPa" },
  };
  const result = await syson.callTool({
    name: "syson_constraint_evaluate",
    arguments: { constraints, values },
  });
  return parseOracleOutcome(result.structuredContent, requirements);
}
