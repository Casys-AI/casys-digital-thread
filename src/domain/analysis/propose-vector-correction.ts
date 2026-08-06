/**
 * Pure domain function for proposing a linearized vector correction.
 *
 * NO I/O — this module is domain-only. No provider calls, no file reads, no
 * Deno.* APIs.
 *
 * PROBLEM — given a failing RequirementEvaluation and a set of measured
 * SensitivityEdge records, produce a bounded correction proposal in driver
 * units that is guaranteed to stay inside the edge's declared validity
 * neighborhood.
 *
 * FORMULA — first-order linear inversion of the edge derivative:
 *
 *   u(z) ≈ u_actual + k × (z − z_current)
 *   z* = z_current + (limit − u_actual) / k
 *   Δz  = z* − z_current = (limit − u_actual) / k
 *
 * where:
 *   u_actual  = comparison.actual.value   (the current failing response)
 *   limit     = comparison.limit.value    (the requirement threshold)
 *   k         = edge.derivative.value     (∂response / ∂driver)
 *   z_current = currentDriverValue.value  (the driver at the failure point)
 *
 * INVARIANTS
 *   1. evaluation.status MUST equal "fail" → else "evaluation-not-failed".
 *   2. evaluation.comparison MUST be present → else "evaluation-missing-comparison".
 *   3. comparison.normalizedUnit MUST equal edge.response.unit → else
 *      "incompatible-units". Never compare bare numbers across units.
 *   4. edge.derivative.value MUST be non-zero → else "zero-derivative". A zero
 *      derivative means the driver has no measurable local effect on the
 *      metric; the edge cannot guide a correction.
 *   5. The proposed z* MUST lie within [edge.driver.validityNeighborhood.lower.value,
 *      edge.driver.validityNeighborhood.upper.value] → else
 *      "out-of-validity-neighborhood". Extrapolation is never silent.
 *   6. The caller supplies metricId explicitly; the function filters edges by
 *      response.metric. No hidden heuristics (#7 Explicit Over Implicit, AX).
 *   7. All proposal fields carry units; no bare scalar outputs.
 *   8. The function never clamps, rounds, or guesses. It returns a typed
 *      unresolved reason rather than a silent approximation.
 *
 * AUTHORITY — the proposal is presented to the human for consent. Nothing
 * here executes or schedules provider calls. The server owns the correction
 * sequence; the human decides.
 */

import type {
  EngineeringCommandActor,
  EngineeringDecisionProposal,
} from "./engineering-project.ts";
import type { SensitivityEdge } from "./sensitivity-edge.ts";
import type { RequirementEvaluation } from "./thread-snapshot.ts";

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const CORRECTION_PROPOSAL_SCHEMA = "correction-proposal/1.0" as const;

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/**
 * Typed reason for an unresolved correction.
 *
 * Each reason is machine-parseable (#4 Machine-Readable Errors, AX).
 */
export type UnresolvedCorrectionReason =
  /** The evaluation is not in "fail" status; no correction is needed. */
  | "evaluation-not-failed"
  /** The evaluation has no comparison; the actual response value is unavailable. */
  | "evaluation-missing-comparison"
  /**
   * No edge matches the requested metricId, OR no edge for that metric has
   * a unit compatible with the evaluation's normalizedUnit.
   */
  | "no-applicable-edge"
  /**
   * The edge response unit does not match the evaluation's normalizedUnit.
   * Units are values; comparing bare numbers across unit systems is forbidden.
   */
  | "incompatible-units"
  /**
   * The edge derivative is zero. The driver parameter has no measurable local
   * effect on the metric in the studied neighborhood; the edge cannot guide
   * a correction.
   *
   * NOTE — named "zero-derivative", NOT "wrong-sign". The linear-inversion
   * formula ∂z = (limit − actual) / k always points in the corrective direction
   * for any non-zero k, regardless of sign. There is no "wrong-sign" scenario;
   * only a zero derivative makes an edge inapplicable.
   */
  | "zero-derivative"
  /**
   * The first-order correction target z* falls outside the edge's declared
   * validity neighborhood [lower, upper]. The linearization is only locally
   * reliable; extrapolation beyond the neighborhood is not permitted.
   */
  | "out-of-validity-neighborhood";

/** Unresolved correction: no proposal can be computed from the given inputs. */
export interface UnresolvedCorrection {
  readonly status: "unresolved";
  readonly reason: UnresolvedCorrectionReason;
  /**
   * Human-readable detail without provider implementation data.
   * Machine consumers should branch on `reason`; this field is for logs.
   */
  readonly detail: string;
}

/**
 * Linearized correction justification.
 *
 * Shows the formula and predicted outcome so the reviewing human can
 * verify the arithmetic before approving.
 */
export interface CorrectionLinearizedJustification {
  /** The failing response value used as the local linearization origin. */
  readonly actualResponse: { readonly value: number; readonly unit: string };
  /** The driver value at the moment of the failing evaluation. */
  readonly currentDriver: { readonly value: number; readonly unit: string };
  /** The sensitivity derivative k = ∂response / ∂driver. */
  readonly derivative: { readonly value: number; readonly unit: string };
  /**
   * Human-readable formula that makes the arithmetic auditable.
   * Form: "u_proposed ≈ u_actual + k × (z_proposed − z_current)"
   */
  readonly formula: string;
  /** Predicted response at z*, by the linearization. Equals the limit exactly. */
  readonly predictedResponse: { readonly value: number; readonly unit: string };
}

/**
 * A bounded, linearized driver correction proposal.
 *
 * The proposal is presented to the human for MRTR consent.  Nothing here
 * executes a provider call or schedules a run.
 */
export interface CorrectionProposal {
  readonly status: "proposed";
  readonly schemaVersion: typeof CORRECTION_PROPOSAL_SCHEMA;
  /** The sensitivity edge that was used to compute the correction. */
  readonly edgeUsed: SensitivityEdge;
  /** The driver value at the time of the failing evaluation. */
  readonly driverCurrent: { readonly value: number; readonly unit: string };
  /**
   * The proposed driver value.
   * Guaranteed to lie within edge.driver.validityNeighborhood [lower, upper].
   */
  readonly driverProposed: { readonly value: number; readonly unit: string };
  /**
   * The signed correction delta: driverProposed − driverCurrent.
   * A positive delta means "increase the driver parameter."
   */
  readonly driverDelta: { readonly value: number; readonly unit: string };
  /** Arithmetic trace for human review before MRTR consent. */
  readonly linearizedJustification: CorrectionLinearizedJustification;
}

/** The function returns one of these two shapes. */
export type CorrectionOutcome = CorrectionProposal | UnresolvedCorrection;

// ---------------------------------------------------------------------------
// Public API — proposeVectorCorrection
// ---------------------------------------------------------------------------

/**
 * Propose a linearized driver correction for a failing requirement evaluation.
 *
 * The function tries each edge in the supplied list (in order) until it finds
 * one that is compatible and yields a z* within the validity neighborhood.
 * If no edge succeeds, it returns the most specific unresolved reason from the
 * last attempt.
 *
 * @param evaluation   The failing RequirementEvaluation from a ThreadSnapshot.
 * @param edges        SensitivityEdge[] for the same subject; caller pre-filters
 *                     by domain (e.g. all mechanical edges for a mechanical
 *                     failure). The function further filters by metricId.
 * @param currentDriverValue  The driver value at the failure point (e.g., the
 *                     DripTray size-z that produced the failing measurement).
 * @param metricId     The oracle metric id (e.g. "assembly_max_displacement")
 *                     that links the evaluation to edge.response.metric.
 */
export function proposeVectorCorrection(
  evaluation: RequirementEvaluation,
  edges: readonly SensitivityEdge[],
  currentDriverValue: { readonly value: number; readonly unit: string },
  metricId: string,
): CorrectionOutcome {
  // Guard 1 — evaluation must be a confirmed failure.
  if (evaluation.status !== "fail") {
    return {
      status: "unresolved",
      reason: "evaluation-not-failed",
      detail: `Evaluation "${evaluation.id}" has status "${evaluation.status}"; ` +
        `correction is only applicable to a "fail" evaluation.`,
    };
  }

  // Guard 2 — must have a comparison to extract actual and limit.
  const comparison = evaluation.comparison;
  if (comparison === undefined) {
    return {
      status: "unresolved",
      reason: "evaluation-missing-comparison",
      detail: `Evaluation "${evaluation.id}" has no comparison; ` +
        `the actual response value is unavailable.`,
    };
  }

  // Guard 3 — current driver value must be a finite number.
  if (!Number.isFinite(currentDriverValue.value)) {
    return {
      status: "unresolved",
      reason: "no-applicable-edge",
      detail: `currentDriverValue.value must be a finite number.`,
    };
  }

  // Filter edges by the requested metric.
  const metricEdges = edges.filter((e) => e.response.metric === metricId);
  if (metricEdges.length === 0) {
    return {
      status: "unresolved",
      reason: "no-applicable-edge",
      detail: `No sensitivity edge found for metric "${metricId}". ` +
        `${edges.length} edge(s) supplied, none matches the requested metric.`,
    };
  }

  // The actual response and the requirement limit, both from the comparison.
  // comparison.actual and comparison.limit are already in normalizedUnit.
  const actualValue = comparison.actual.value;
  const limitValue = comparison.limit.value;
  const normalizedUnit = comparison.normalizedUnit;

  // Try each applicable edge in order.
  let lastReason: UnresolvedCorrectionReason = "no-applicable-edge";
  let lastDetail = "No applicable edge attempted.";

  for (const edge of metricEdges) {
    // Guard — unit compatibility. The derivative unit must equal
    // "<normalizedUnit>/<driverUnit>" for the formula to be dimensionally
    // sound. Example: normalizedUnit="mm", driverUnit="mm" → "mm/mm". Units
    // are values; bare-number comparison across unit systems is forbidden.
    const expectedDerivativeUnit = `${normalizedUnit}/${edge.driver.unit}`;
    if (edge.derivative.unit !== expectedDerivativeUnit) {
      lastReason = "incompatible-units";
      lastDetail = `Edge derivative unit "${edge.derivative.unit}" does not match ` +
        `expected "${expectedDerivativeUnit}" (normalizedUnit="${normalizedUnit}", ` +
        `driverUnit="${edge.driver.unit}"). Unit conversion is forbidden; ` +
        `the edge is inapplicable.`;
      continue;
    }

    const k = edge.derivative.value;

    // Guard — non-zero derivative.
    if (k === 0) {
      lastReason = "zero-derivative";
      lastDetail =
        `Edge "${edge.driver.sysmlAttrName}" → "${edge.response.sysmlAttrName}" ` +
        `has derivative value 0. The driver has no measurable local effect on ` +
        `the metric in the studied neighborhood; the edge cannot guide a correction.`;
      continue;
    }

    // First-order linear inversion:
    //   u(z) ≈ u_actual + k × (z - z_current)
    //   Setting u(z*) = limit:  z* = z_current + (limit - u_actual) / k
    const delta = (limitValue - actualValue) / k;
    const proposed = currentDriverValue.value + delta;

    // Guard — proposed value must be within the validity neighborhood.
    const lower = edge.driver.validityNeighborhood.lower.value;
    const upper = edge.driver.validityNeighborhood.upper.value;
    if (proposed < lower || proposed > upper) {
      lastReason = "out-of-validity-neighborhood";
      lastDetail = `Proposed driver value ${proposed} ${edge.driver.unit} ` +
        `is outside the declared validity neighborhood ` +
        `[${lower}, ${upper}] ${edge.driver.validityNeighborhood.lower.unit}. ` +
        `The linearization is only locally reliable; extrapolation is not permitted.`;
      continue;
    }

    // All guards passed — build the proposal.
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
        unit: currentDriverValue.unit,
      },
      driverProposed: { value: proposed, unit: edge.driver.unit },
      driverDelta: { value: delta, unit: edge.driver.unit },
      linearizedJustification: {
        actualResponse: { value: actualValue, unit: normalizedUnit },
        currentDriver: {
          value: currentDriverValue.value,
          unit: currentDriverValue.unit,
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

  // No edge succeeded.
  return { status: "unresolved", reason: lastReason, detail: lastDetail };
}

// ---------------------------------------------------------------------------
// MRTR proposal builder
// ---------------------------------------------------------------------------

/**
 * Convert a successful CorrectionProposal into the EngineeringDecisionProposal
 * DTO that the agent submits to the human operator for MRTR consent.
 *
 * The human sees the exact numeric values and units; approving this DTO is
 * the consent gate before the server-owned correction sequence may execute.
 *
 * This function never executes or schedules work — it only builds the DTO.
 */
export function buildCorrectionMrtrProposal(
  proposal: CorrectionProposal,
  options: {
    /** ISO UTC timestamp when the proposal is being presented. */
    readonly proposedAt: string;
    /** The agent or system presenting the proposal for human review. */
    readonly proposedBy: EngineeringCommandActor;
  },
): EngineeringDecisionProposal {
  const j = proposal.linearizedJustification;
  return {
    summary: `Apply linearized correction: ` +
      `${proposal.driverCurrent.value} ${proposal.driverCurrent.unit} → ` +
      `${proposal.driverProposed.value} ${proposal.driverProposed.unit} ` +
      `(Δ${
        proposal.driverDelta.value > 0 ? "+" : ""
      }${proposal.driverDelta.value} ${proposal.driverDelta.unit}) ` +
      `to reduce "${proposal.edgeUsed.response.metric}" from ` +
      `${j.actualResponse.value} to ${j.predictedResponse.value} ${j.actualResponse.unit}.`,
    parameters: [
      {
        key: "metricId",
        label: "Metric corrected",
        value: proposal.edgeUsed.response.metric,
      },
      {
        key: "driverSysmlAttr",
        label: "Driver SysML attribute",
        value: proposal.edgeUsed.driver.sysmlAttrName,
      },
      {
        key: "driverCurrentValue",
        label: "Current driver value",
        value: proposal.driverCurrent.value,
        unit: proposal.driverCurrent.unit,
      },
      {
        key: "driverProposedValue",
        label: "Proposed driver value",
        value: proposal.driverProposed.value,
        unit: proposal.driverProposed.unit,
      },
      {
        key: "driverDelta",
        label: "Correction delta",
        value: proposal.driverDelta.value,
        unit: proposal.driverDelta.unit,
      },
      {
        key: "actualResponse",
        label: "Failing measured response",
        value: j.actualResponse.value,
        unit: j.actualResponse.unit,
      },
      {
        key: "predictedResponse",
        label: "Predicted response after correction",
        value: j.predictedResponse.value,
        unit: j.predictedResponse.unit,
      },
      {
        key: "derivative",
        label: "Sensitivity derivative k",
        value: j.derivative.value,
        unit: j.derivative.unit,
      },
      {
        key: "neighborhoodLower",
        label: "Validity neighborhood lower bound",
        value: proposal.edgeUsed.driver.validityNeighborhood.lower.value,
        unit: proposal.edgeUsed.driver.validityNeighborhood.lower.unit,
      },
      {
        key: "neighborhoodUpper",
        label: "Validity neighborhood upper bound",
        value: proposal.edgeUsed.driver.validityNeighborhood.upper.value,
        unit: proposal.edgeUsed.driver.validityNeighborhood.upper.unit,
      },
      {
        key: "edgeProvenance",
        label: "Sensitivity edge measured at run",
        value: proposal.edgeUsed.provenance.runId,
      },
    ],
    proposedAt: options.proposedAt,
    proposedBy: options.proposedBy,
  };
}
