/**
 * Generic FEA oracle adapter — the unique translation layer between the
 * mechanical proof-case schema and syson_constraint_evaluate.
 *
 * WHY this boundary exists: MechanicalRequirement carries two distinct
 * identities that must never be confused.
 *
 *   metric  — the enum kind ("maximum-displacement",
 *             "maximum-von-mises-stress").  It selects the CalculiX output
 *             field and the native unit, but is NOT the SysON featurePath.
 *
 *   feature — the SysON element attribute name stored in the model (e.g.
 *             "drip_tray_max_displacement").  It is the left-hand
 *             featurePath that syson_constraint_evaluate joins when it
 *             evaluates the constraint against the declared values.
 *
 * Mixing the two produces a constraint the oracle cannot resolve (unresolved
 * or error), because the featurePath must match the SysML attribute name, not
 * the metric kind string.  This module is the only place where that
 * projection happens; every caller obtains the correct OracleRequirement
 * without knowing the internal distinction.
 *
 * Reuses parseOracleOutcome from cm01-drip-tray-mechanical-oracle — it is
 * the only module that may own the oracle response parse.  Do not copy it.
 *
 * UNIT CONVENTION
 *   CalculiX reports: maxDisplacement in mm, maxVonMises in MPa.
 *   The proof declares limits in mm (displacement) and Pa (von Mises).
 *   SysON converts units internally when calling syson_constraint_evaluate —
 *   confirmed by probe on 2026-08-04 (Pa and MPa round-trip documented in
 *   cm01-drip-tray-mechanical-oracle.ts).  Local arithmetic is intentionally
 *   absent: the oracle is the sole authority on the verdict.
 */

import type {
  RequirementEvaluation,
  RequirementEvaluationStatus,
  ThreadFreshness,
} from "../../domain/thread/thread-snapshot.ts";
import {
  buildConstraintAst,
  type OracleRequirement,
} from "../../domain/analysis/proof-case.ts";
import type { MechanicalRequirement } from "../../domain/analysis/mechanical-proof-case.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import {
  type ParsedOracleResult,
  parseOracleOutcome,
} from "./cm01-drip-tray-mechanical-oracle.ts";

// ---------------------------------------------------------------------------
// FEA_METRIC_TO_CALCULIX — closed mapping: metric kind → CalculiX field
// ---------------------------------------------------------------------------

/**
 * CalculiX output field name and its native unit for one FEA metric kind.
 *
 * The two entries are the only metrics the generic FEA path supports.
 * Any metric absent from the map causes buildOracleValues to throw
 * fail-closed; no default exists.
 */
export interface FeaCalculixFieldMapping {
  /** Field name in FeaSolverMetrics (the parsed CalculiX result). */
  readonly field: "maxDisplacement" | "maxVonMises";
  /** Native unit reported by CalculiX for this field. */
  readonly unit: "mm" | "MPa";
}

/**
 * Closed mapping from MechanicalRequirement.metric to the CalculiX output
 * field and its native unit.
 *
 * exactRecord semantics: exactly two known metrics — any other value is
 * rejected at runtime by buildOracleValues.  Adding a new metric requires
 * a live probe confirming the CalculiX field name and unit before this map
 * is extended.
 */
export const FEA_METRIC_TO_CALCULIX: ReadonlyMap<
  MechanicalRequirement["metric"],
  FeaCalculixFieldMapping
> = new Map([
  ["maximum-displacement", { field: "maxDisplacement", unit: "mm" }],
  ["maximum-von-mises-stress", { field: "maxVonMises", unit: "MPa" }],
]);

// ---------------------------------------------------------------------------
// projectProofRequirementToOracle — the critical projection
// ---------------------------------------------------------------------------

/**
 * Project one MechanicalRequirement to an OracleRequirement suitable for
 * syson_constraint_evaluate.
 *
 * THE CRITICAL PROJECTION: OracleRequirement.metric receives req.feature,
 * never req.metric.  req.feature is the SysON element attribute name (the
 * featurePath used by buildConstraintAst's left.featurePath).  req.metric
 * is the enum kind string ("maximum-displacement") which is NOT a SysON
 * path.  Passing req.metric here would produce a constraint the oracle
 * cannot resolve against any model element.
 *
 * The limit is forwarded verbatim: the proof declares von Mises limits in Pa
 * (SysML base unit); CalculiX reports MPa.  SysON converts internally when
 * it evaluates the constraint — unit conversion is the oracle's
 * responsibility, not ours.
 */
export function projectProofRequirementToOracle(
  req: MechanicalRequirement,
): OracleRequirement {
  return {
    id: req.id,
    name: req.name,
    metric: req.feature,
    operator: req.operator,
    limit: req.limit,
  };
}

// ---------------------------------------------------------------------------
// FeaSolverMetrics — narrow input type consumed by buildOracleValues
// ---------------------------------------------------------------------------

/**
 * The two scalar results the generic FEA solver capture exposes.
 *
 * Field names match the "field" column of FEA_METRIC_TO_CALCULIX so that
 * buildOracleValues can index this interface without any secondary mapping.
 * The unit field is included so callers can validate it against the
 * expected native unit before passing the struct here.
 */
export interface FeaSolverMetrics {
  readonly maxDisplacement: { readonly value: number; readonly unit: string };
  readonly maxVonMises: { readonly value: number; readonly unit: string };
}

// ---------------------------------------------------------------------------
// buildOracleValues — index solver metrics by SysON featurePath
// ---------------------------------------------------------------------------

/**
 * Build the values map consumed by syson_constraint_evaluate.
 *
 * Keyed by req.feature (the SysON featurePath), not by req.metric.  The
 * oracle matches values to constraints by featurePath; indexing by the enum
 * kind would produce a map the oracle cannot join against any model element.
 *
 * Native CalculiX units are forwarded verbatim (mm for displacement, MPa for
 * von Mises).  SysON converts to match the constraint's declared limit unit.
 *
 * Fail-closed: a requirement whose metric is absent from FEA_METRIC_TO_CALCULIX
 * throws immediately.  Duplicate feature keys within one requirements list are
 * silently overwritten; callers are responsible for ensuring uniqueness (the
 * proof schema already rejects duplicates via rejectDuplicates).
 */
export function buildOracleValues(
  parsed: FeaSolverMetrics,
  requirements: readonly MechanicalRequirement[],
): Record<string, { readonly value: number; readonly unit: string }> {
  const values: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const req of requirements) {
    const mapping = FEA_METRIC_TO_CALCULIX.get(req.metric);
    if (mapping === undefined) {
      throw new Error(
        `fea-oracle-adapter: unsupported metric "${req.metric}" — ` +
          `only ${[...FEA_METRIC_TO_CALCULIX.keys()].join(", ")} are supported.`,
      );
    }
    values[req.feature] = { value: parsed[mapping.field].value, unit: mapping.unit };
  }
  return values;
}

// ---------------------------------------------------------------------------
// callFeaConstraintOracle — I/O entry point
// ---------------------------------------------------------------------------

/**
 * Call syson_constraint_evaluate with the projected requirements and the
 * pre-built values map.
 *
 * Uses buildConstraintAst (proof-case.ts) to build the AST nodes and
 * parseOracleOutcome (cm01-drip-tray-mechanical-oracle.ts) to parse the
 * response.  Neither is re-implemented here; this function assembles the
 * pieces without duplicating the logic.
 *
 * The values map must be keyed by req.feature (SysON featurePath) and carry
 * the native CalculiX unit.  Use buildOracleValues to produce it.
 */
export async function callFeaConstraintOracle(
  syson: McpToolClient,
  requirements: readonly MechanicalRequirement[],
  values: Record<string, { readonly value: number; readonly unit: string }>,
): Promise<ReadonlyMap<string, ParsedOracleResult>> {
  const oracleRequirements: OracleRequirement[] = requirements.map(
    projectProofRequirementToOracle,
  );
  const constraints = oracleRequirements.map(buildConstraintAst);
  const result = await syson.callTool({
    name: "syson_constraint_evaluate",
    arguments: { constraints, values },
  });
  return parseOracleOutcome(result.structuredContent, oracleRequirements);
}

// ---------------------------------------------------------------------------
// feaEvaluationsFromOracle — pure, no I/O
// ---------------------------------------------------------------------------

/**
 * Evaluation context shared across all evaluations in one verdict.
 *
 * verdictCaptureFp MUST be the full 64-hex SHA-256 digest of the verdict
 * capture envelope — never a prefix or a truncated form.  It is embedded in
 * every evaluation ID to make the set content-addressed: the same oracle
 * outcomes always produce the same evaluation IDs regardless of when they
 * are materialized.
 */
export interface FeaEvaluationContext {
  /** Full 64-hex SHA-256 of the verdict capture — used verbatim in IDs. */
  readonly verdictCaptureFp: string;
  readonly evaluatedAt: string;
  /** ID of the fea-verdict artifact that carries the oracle outcomes. */
  readonly evidenceArtifactId: string;
  /** observationIds[i] corresponds to requirements[i]. */
  readonly observationIds: readonly string[];
}

/**
 * Build RequirementEvaluation[] from already-obtained oracle outcomes.
 *
 * ID scheme: `${requirement.id}-evaluation-${verdictCaptureFp}` — the full
 * 64-hex digest is NEVER truncated.  Content-addressability means a re-run
 * that produces the same oracle outcomes emits identical evaluation IDs,
 * which the snapshot idempotency guard can detect without a secondary index.
 *
 * evaluator is always syson/syson_constraint_evaluate: the oracle is the
 * only authority on the verdict, and that authority lives in SysON.
 *
 * comparison is ABSENT for error and unresolved statuses.
 * thread-snapshot-validation raises unexpected_comparison when a comparison
 * is present on those statuses, making the snapshot unpublishable.  The
 * oracle explicitly could not determine a numeric verdict; emitting a
 * comparison would misrepresent the uncertainty.
 *
 * The function does not build violations or proposedActions — those belong
 * to the executor, which assembles the full thread extension and can apply
 * discipline-specific rationale.
 */
export function feaEvaluationsFromOracle(
  outcomes: ReadonlyMap<string, ParsedOracleResult>,
  requirements: readonly MechanicalRequirement[],
  context: FeaEvaluationContext,
): RequirementEvaluation[] {
  const { verdictCaptureFp, evaluatedAt, evidenceArtifactId, observationIds } = context;

  if (!/^[a-f0-9]{64}$/.test(verdictCaptureFp)) {
    throw new Error(
      "fea-oracle-adapter: verdictCaptureFp must be a 64-character lowercase hex digest." +
        ` Got "${verdictCaptureFp.slice(0, 12)}…" (length ${verdictCaptureFp.length}).`,
    );
  }

  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: evaluatedAt,
    invalidatedByChangeIds: [],
  };

  /**
   * evaluator.runId is set to evidenceArtifactId because the verdict capture
   * artifact uniquely identifies this specific oracle call session.  The
   * artifact ID is stable across re-materializations of the same capture.
   */
  const evaluator = {
    serverId: "syson",
    tool: "syson_constraint_evaluate",
    runId: evidenceArtifactId,
  };

  return requirements.map((req, index) => {
    const id = `${req.id}-evaluation-${verdictCaptureFp}`;
    const observationId = observationIds[index];
    if (observationId === undefined) {
      throw new Error(
        `fea-oracle-adapter: observationIds[${index}] is missing` +
          ` for requirement "${req.id}".`,
      );
    }
    const oracleResult = outcomes.get(req.id);
    if (oracleResult === undefined) {
      throw new Error(
        `fea-oracle-adapter: oracle outcome missing for requirement id "${req.id}".`,
      );
    }

    const status = oracleResult.status as RequirementEvaluationStatus;
    const base: RequirementEvaluation = {
      id,
      name: `${req.name} evaluation`,
      requirementId: req.id,
      observationIds: [observationId],
      status,
      evaluatedAt,
      evaluator,
      evidenceArtifactIds: [evidenceArtifactId],
      message: evaluationMessage(oracleResult),
      freshness,
    };

    if (oracleResult.status === "pass" || oracleResult.status === "fail") {
      return {
        ...base,
        comparison: {
          observationId,
          actual: { value: oracleResult.computedValue, unit: oracleResult.unit },
          operator: req.operator,
          limit: { value: oracleResult.threshold, unit: oracleResult.unit },
          normalizedUnit: oracleResult.unit,
          margin: { value: oracleResult.margin, unit: oracleResult.unit },
        },
      };
    }
    // error / unresolved: comparison intentionally absent — see module doc.
    return base;
  });
}

function evaluationMessage(result: ParsedOracleResult): string {
  switch (result.status) {
    case "pass":
      return "The observed value is within the reviewed concept limit.";
    case "fail":
      return "The observed value exceeds the reviewed concept limit.";
    case "error":
      return "The oracle returned an error evaluating this limit.";
    case "unresolved":
      return "The oracle could not resolve this limit evaluation.";
  }
}
