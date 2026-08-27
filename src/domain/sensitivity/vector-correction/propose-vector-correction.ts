/**
 * Pure domain function for proposing a linearized vector correction.
 *
 * NO I/O — this module is domain-only. No provider calls, no file reads, no
 * Deno.* APIs. Unit conversion is forbidden: `UNIT_NORMALISATION` is a
 * brief-compilation table and is not imported here.
 *
 * FORMULA — first-order linear inversion of one measured edge:
 *
 *   u(z) ≈ u_actual + k × (z − z_current)
 *   z* = z_current + (limit − u_actual) / k
 *
 * where `u_actual` is supplied by the caller as the study-base measurement
 * for the metric. The evaluation contributes only `status`, `operator` and
 * `limit`. Mixing a proof actual with a study slope is forbidden.
 *
 * INVARIANTS
 *   1. evaluation.status MUST equal "fail" → else "evaluation-not-failed".
 *   2. evaluation.comparison MUST be present → else "evaluation-missing-comparison".
 *   3. Exactly one edge matches metricId → else "no-applicable-edge" or
 *      "ambiguous-edge". There is no second-edge fallback.
 *   4. Units must already agree:
 *        actual.unit === comparison.normalizedUnit
 *        currentDriverValue.unit === edge.driver.unit
 *        edge.derivative.unit === `${normalizedUnit}/${driverUnit}`
 *      else "incompatible-units".
 *   5. k MUST be non-zero → else "zero-derivative".
 *   6. z_current MUST lie in the declared neighborhood → else "domain_exceeded".
 *   7. z* MUST lie in the same neighborhood → else "out-of-validity-neighborhood".
 *   8. The function never clamps, rounds, converts units, or guesses.
 */

import type { SensitivityEdge } from "../edges/sensitivity-edge.ts";
import type { RequirementEvaluation } from "../../thread/thread-snapshot.ts";

export const CORRECTION_PROPOSAL_SCHEMA = "correction-proposal/1.0" as const;

export type UnresolvedCorrectionReason =
  | "evaluation-not-failed"
  | "evaluation-missing-comparison"
  | "no-applicable-edge"
  | "ambiguous-edge"
  | "incompatible-units"
  | "zero-derivative"
  | "domain_exceeded"
  | "out-of-validity-neighborhood";

export interface UnresolvedCorrection {
  readonly status: "unresolved";
  readonly reason: UnresolvedCorrectionReason;
  readonly detail: string;
}

export interface CorrectionLinearizedJustification {
  readonly actualResponse: { readonly value: number; readonly unit: string };
  readonly currentDriver: { readonly value: number; readonly unit: string };
  readonly derivative: { readonly value: number; readonly unit: string };
  readonly formula: string;
  readonly predictedResponse: { readonly value: number; readonly unit: string };
}

export interface CorrectionProposal {
  readonly status: "proposed";
  readonly schemaVersion: typeof CORRECTION_PROPOSAL_SCHEMA;
  readonly edgeUsed: SensitivityEdge;
  readonly driverCurrent: { readonly value: number; readonly unit: string };
  readonly driverProposed: { readonly value: number; readonly unit: string };
  readonly driverDelta: { readonly value: number; readonly unit: string };
  readonly linearizedJustification: CorrectionLinearizedJustification;
}

export type CorrectionOutcome = CorrectionProposal | UnresolvedCorrection;

export interface ProposeVectorCorrectionInput {
  readonly evaluation: RequirementEvaluation;
  readonly edges: readonly SensitivityEdge[];
  readonly currentDriverValue: { readonly value: number; readonly unit: string };
  readonly metricId: string;
  readonly actualResponse: { readonly value: number; readonly unit: string };
}

/**
 * Propose a linearized driver correction for one failing evaluation and one
 * measured edge. The caller must already have sourced `actualResponse` from
 * the study-base measurement; this function does not read comparison.actual.
 */
export function proposeVectorCorrection(
  input: ProposeVectorCorrectionInput,
): CorrectionOutcome {
  const {
    evaluation,
    edges,
    currentDriverValue,
    metricId,
    actualResponse,
  } = input;

  if (evaluation.status !== "fail") {
    return unresolved(
      "evaluation-not-failed",
      `Evaluation "${evaluation.id}" has status "${evaluation.status}"; ` +
        `correction is only applicable to a "fail" evaluation.`,
    );
  }

  const comparison = evaluation.comparison;
  if (comparison === undefined) {
    return unresolved(
      "evaluation-missing-comparison",
      `Evaluation "${evaluation.id}" has no comparison; ` +
        `the requirement limit is unavailable.`,
    );
  }

  const metricEdges = edges.filter((edge) => edge.response.metric === metricId);
  if (metricEdges.length === 0) {
    return unresolved(
      "no-applicable-edge",
      `No sensitivity edge found for metric "${metricId}". ` +
        `${edges.length} edge(s) supplied, none matches the requested metric.`,
    );
  }
  if (metricEdges.length !== 1) {
    return unresolved(
      "ambiguous-edge",
      `Metric "${metricId}" matches ${metricEdges.length} sensitivity edges. ` +
        `A correction requires exactly one edge; no fallback is attempted.`,
    );
  }

  const edge = metricEdges[0]!;
  const normalizedUnit = comparison.normalizedUnit;
  const driverUnit = edge.driver.unit;
  const expectedDerivativeUnit = `${normalizedUnit}/${driverUnit}`;

  if (
    currentDriverValue.unit !== driverUnit ||
    actualResponse.unit !== normalizedUnit ||
    comparison.limit.unit !== normalizedUnit ||
    edge.derivative.unit !== expectedDerivativeUnit ||
    edge.driver.validityNeighborhood.lower.unit !== driverUnit ||
    edge.driver.validityNeighborhood.upper.unit !== driverUnit
  ) {
    return unresolved(
      "incompatible-units",
      `Units do not already agree for metric "${metricId}" ` +
        `(actual="${actualResponse.unit}", normalizedUnit="${normalizedUnit}", ` +
        `driver="${currentDriverValue.unit}" vs "${driverUnit}", ` +
        `derivative="${edge.derivative.unit}", expected="${expectedDerivativeUnit}"). ` +
        `Unit conversion is forbidden; the edge is inapplicable.`,
    );
  }

  if (
    !Number.isFinite(actualResponse.value) || !Number.isFinite(comparison.limit.value)
  ) {
    return unresolved(
      "incompatible-units",
      `actualResponse.value and comparison.limit.value must be finite numbers.`,
    );
  }

  const k = edge.derivative.value;
  if (k === 0) {
    return unresolved(
      "zero-derivative",
      `Edge "${edge.driver.sysmlAttrName}" → "${edge.response.sysmlAttrName}" ` +
        `has derivative value 0. The driver has no measurable local effect on ` +
        `the metric in the studied neighborhood; the edge cannot guide a correction.`,
    );
  }

  const lower = edge.driver.validityNeighborhood.lower.value;
  const upper = edge.driver.validityNeighborhood.upper.value;
  if (
    !Number.isFinite(currentDriverValue.value) ||
    currentDriverValue.value < lower ||
    currentDriverValue.value > upper
  ) {
    return unresolved(
      "domain_exceeded",
      `Current driver value ${currentDriverValue.value} ${driverUnit} ` +
        `is outside the declared validity neighborhood ` +
        `[${lower}, ${upper}] ${driverUnit}. ` +
        `The application point is not in the measured edge domain.`,
    );
  }

  const actualValue = actualResponse.value;
  const limitValue = comparison.limit.value;
  const delta = (limitValue - actualValue) / k;
  const proposed = currentDriverValue.value + delta;

  if (proposed < lower || proposed > upper) {
    return unresolved(
      "out-of-validity-neighborhood",
      `Proposed driver value ${proposed} ${driverUnit} ` +
        `is outside the declared validity neighborhood ` +
        `[${lower}, ${upper}] ${driverUnit}. ` +
        `The linearization is only locally reliable; extrapolation is not permitted.`,
    );
  }

  const predictedResponse = actualValue + k * delta;
  const formula = `u_proposed ≈ u_actual + k × (z_proposed − z_current)` +
    ` = ${actualValue} + (${k}) × (${proposed} − ${currentDriverValue.value})` +
    ` = ${predictedResponse} ${normalizedUnit}`;

  return {
    status: "proposed",
    schemaVersion: CORRECTION_PROPOSAL_SCHEMA,
    edgeUsed: edge,
    driverCurrent: {
      value: currentDriverValue.value,
      unit: driverUnit,
    },
    driverProposed: { value: proposed, unit: driverUnit },
    driverDelta: { value: delta, unit: driverUnit },
    linearizedJustification: {
      actualResponse: { value: actualValue, unit: normalizedUnit },
      currentDriver: {
        value: currentDriverValue.value,
        unit: driverUnit,
      },
      derivative: {
        value: edge.derivative.value,
        unit: edge.derivative.unit,
      },
      formula,
      predictedResponse: { value: predictedResponse, unit: normalizedUnit },
    },
  };
}

function unresolved(
  reason: UnresolvedCorrectionReason,
  detail: string,
): UnresolvedCorrection {
  return { status: "unresolved", reason, detail };
}
