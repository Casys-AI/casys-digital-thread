/**
 * Tests for proposeVectorCorrection and buildCorrectionMrtrProposal.
 *
 * Fixture values are copied from the real R16 sensitivity-study capture:
 *   state/local/sensitivity-study-captures/
 *   bacc1c4ef2c0154ca71e72bf4e517290ce2c30aedb4702f724c3cf89d2cadc7e.json
 *
 * Derivatives:
 *   assembly_max_displacement: k = -0.00801800268471424  mm/mm  at z0 = 30 mm
 *   assembly_max_von_mises:    k = -0.036042088238638414 MPa/mm at z0 = 30 mm
 *
 * Validity neighborhood (from the 1 mm step): [29, 31] mm.
 *
 * All tests go through the public API; no internal state is inspected.
 */

import { assertEquals, assertMatch } from "@std/assert";
import {
  buildCorrectionMrtrProposal,
  CORRECTION_PROPOSAL_SCHEMA,
  type CorrectionProposal,
  proposeVectorCorrection,
  type UnresolvedCorrection,
} from "./propose-vector-correction.ts";
import type { SensitivityEdge } from "./sensitivity-edge.ts";
import type {
  EvaluationComparison,
  RequirementEvaluation,
} from "../thread/thread-snapshot.ts";

// ---------------------------------------------------------------------------
// Shared fixtures — copied from the real R16 capture
// ---------------------------------------------------------------------------

const REAL_RUN_ID = "run:cm01-drip-tray-sensitivity-2026-08-05";
const CAPTURED_AT = "2026-08-05T08:05:27.351Z";

/**
 * Displacement sensitivity edge from the real R16 capture.
 * k = -0.00801800268471424 mm/mm at z0 = 30 mm, validity [29, 31] mm.
 */
const DISPLACEMENT_EDGE: SensitivityEdge = Object.freeze({
  schemaVersion: "sensitivity-edge/1.0",
  driver: Object.freeze({
    sysmlAttrName: "sizeZ_for_assembly_max_displacement",
    unit: "mm",
    basePoint: Object.freeze({ value: 30, unit: "mm" }),
    validityNeighborhood: Object.freeze({
      lower: Object.freeze({ value: 29, unit: "mm" }),
      upper: Object.freeze({ value: 31, unit: "mm" }),
      lowerConstraintName: "assembly_max_displacement_validity_lower",
      upperConstraintName: "assembly_max_displacement_validity_upper",
    }),
  }),
  response: Object.freeze({
    metric: "assembly_max_displacement",
    sysmlAttrName: "d_assembly_max_displacement_mm_per_mm",
    unit: "mm/mm",
  }),
  derivative: Object.freeze({ value: -0.00801800268471424, unit: "mm/mm" }),
  provenance: Object.freeze({ runId: REAL_RUN_ID, capturedAt: CAPTURED_AT }),
});

/**
 * Von-Mises sensitivity edge from the real R16 capture.
 * k = -0.036042088238638414 MPa/mm at z0 = 30 mm, validity [29, 31] mm.
 */
const VON_MISES_EDGE: SensitivityEdge = Object.freeze({
  schemaVersion: "sensitivity-edge/1.0",
  driver: Object.freeze({
    sysmlAttrName: "sizeZ_for_assembly_max_von_mises",
    unit: "mm",
    basePoint: Object.freeze({ value: 30, unit: "mm" }),
    validityNeighborhood: Object.freeze({
      lower: Object.freeze({ value: 29, unit: "mm" }),
      upper: Object.freeze({ value: 31, unit: "mm" }),
      lowerConstraintName: "assembly_max_von_mises_validity_lower",
      upperConstraintName: "assembly_max_von_mises_validity_upper",
    }),
  }),
  response: Object.freeze({
    metric: "assembly_max_von_mises",
    sysmlAttrName: "d_assembly_max_von_mises_MPa_per_mm",
    unit: "MPa/mm",
  }),
  derivative: Object.freeze({ value: -0.036042088238638414, unit: "MPa/mm" }),
  provenance: Object.freeze({ runId: REAL_RUN_ID, capturedAt: CAPTURED_AT }),
});

const ALL_EDGES: readonly SensitivityEdge[] = [DISPLACEMENT_EDGE, VON_MISES_EDGE];

/** Build a minimal failing RequirementEvaluation with a given comparison. */
function failingEvaluation(
  comparison: EvaluationComparison,
): RequirementEvaluation {
  return {
    id: "eval:test",
    name: "Test evaluation",
    requirementId: "req:test",
    observationIds: ["obs:test"],
    status: "fail",
    evaluatedAt: "2026-08-05T10:00:00.000Z",
    evaluator: { serverId: "test", tool: "test", runId: "test" },
    comparison,
    evidenceArtifactIds: [],
    message: "Test failure",
    freshness: {
      status: "fresh",
      changedAt: "2026-08-05T10:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Guard: evaluation-not-failed
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns evaluation-not-failed when evaluation status is pass",
  () => {
    const evaluation: RequirementEvaluation = {
      id: "eval:pass",
      name: "Passing evaluation",
      requirementId: "req:test",
      observationIds: [],
      status: "pass",
      evaluatedAt: "2026-08-05T10:00:00.000Z",
      evaluator: { serverId: "test", tool: "test", runId: "test" },
      evidenceArtifactIds: [],
      message: "Passes",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-05T10:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const result = proposeVectorCorrection(
      evaluation,
      ALL_EDGES,
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "evaluation-not-failed");
  },
);

Deno.test(
  "proposeVectorCorrection returns evaluation-not-failed when evaluation status is unresolved",
  () => {
    const evaluation: RequirementEvaluation = {
      id: "eval:unresolved",
      name: "Unresolved evaluation",
      requirementId: "req:test",
      observationIds: [],
      status: "unresolved",
      evaluatedAt: "2026-08-05T10:00:00.000Z",
      evaluator: { serverId: "test", tool: "test", runId: "test" },
      evidenceArtifactIds: [],
      message: "Unresolved",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-05T10:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const result = proposeVectorCorrection(
      evaluation,
      ALL_EDGES,
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "evaluation-not-failed");
  },
);

// ---------------------------------------------------------------------------
// Guard: evaluation-missing-comparison
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns evaluation-missing-comparison when comparison is absent",
  () => {
    const evaluation: RequirementEvaluation = {
      id: "eval:no-comparison",
      name: "No comparison",
      requirementId: "req:test",
      observationIds: [],
      status: "fail",
      evaluatedAt: "2026-08-05T10:00:00.000Z",
      evaluator: { serverId: "test", tool: "test", runId: "test" },
      // comparison intentionally absent
      evidenceArtifactIds: [],
      message: "Fails without comparison",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-05T10:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const result = proposeVectorCorrection(
      evaluation,
      ALL_EDGES,
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "evaluation-missing-comparison");
  },
);

// ---------------------------------------------------------------------------
// Guard: no-applicable-edge (no matching metric)
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns no-applicable-edge when no edge matches the metricId",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm/mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      ALL_EDGES,
      { value: 28, unit: "mm" },
      "unknown_metric_id",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "no-applicable-edge");
    assertMatch(result.detail, /unknown_metric_id/);
  },
);

Deno.test(
  "proposeVectorCorrection returns no-applicable-edge when edge array is empty",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm/mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "no-applicable-edge");
  },
);

// ---------------------------------------------------------------------------
// Guard: incompatible-units
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns incompatible-units when normalizedUnit produces a derivative mismatch",
  () => {
    // The displacement edge has derivative.unit = "mm/mm". If we claim
    // normalizedUnit = "Pa" (Pa/mm ≠ mm/mm), unit compatibility fails.
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 25_000_000, unit: "Pa" },
      operator: "<=",
      limit: { value: 20_000_000, unit: "Pa" },
      // normalizedUnit = "Pa" → expected derivative = "Pa/mm" ≠ "mm/mm"
      normalizedUnit: "Pa",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "incompatible-units");
    // Detail must mention the mismatch
    assertMatch(result.detail, /mm\/mm/);
    assertMatch(result.detail, /Pa\/mm/);
  },
);

// ---------------------------------------------------------------------------
// Guard: zero-derivative
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns zero-derivative when the derivative is zero",
  () => {
    const zeroDerivativeEdge: SensitivityEdge = {
      ...DISPLACEMENT_EDGE,
      derivative: { value: 0, unit: "mm/mm" },
    };
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm", // normalizedUnit is the response metric unit
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [zeroDerivativeEdge],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "zero-derivative");
    assertMatch(result.detail, /derivative value 0/);
  },
);

// ---------------------------------------------------------------------------
// Guard: out-of-validity-neighborhood
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection returns out-of-validity-neighborhood when z* exceeds upper bound",
  () => {
    // With k = -0.008 mm/mm and current = 28 mm, a huge failure that would
    // require z* >> 31 mm to correct.
    // actual = 9.5 mm (fails limit = 1 mm)
    // Δz = (1 - 9.5) / (-0.008018) ≈ 1059.9 mm → z* = 28 + 1059.9 >> 31
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 9.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm", // normalizedUnit is the response metric unit (mm for displacement)
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "out-of-validity-neighborhood");
    assertMatch(result.detail, /\[29, 31\]/);
  },
);

Deno.test(
  "proposeVectorCorrection returns out-of-validity-neighborhood when z* falls below lower bound",
  () => {
    // With k = +0.1 mm/mm (positive: increasing z increases response),
    // and actual > limit, we need to DECREASE z.
    // Δz = (1 - 1.5) / 0.1 = -5 mm → z* = 28 - 5 = 23 mm < 29 mm → outside
    const positiveEdge: SensitivityEdge = {
      ...DISPLACEMENT_EDGE,
      derivative: { value: 0.1, unit: "mm/mm" },
    };
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [positiveEdge],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "out-of-validity-neighborhood");
    assertMatch(result.detail, /\[29, 31\]/);
  },
);

// ---------------------------------------------------------------------------
// Happy path — displacement metric
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection produces a valid proposal for a displacement failure within the neighborhood",
  () => {
    // k = -0.00801800268471424 mm/mm, z_current = 30.0 mm, validity [29, 31]
    // Choose Δz = 0.5 mm → z* = 30.5 mm (well inside the neighborhood, not at boundary).
    // Landing exactly on a boundary (z* = 31.0) risks a floating-point overshoot of
    // ~7e-15, which would make the strict `> upper` guard reject an otherwise valid
    // proposal. Using 30.5 avoids that: any IEEE 754 error is ~6e-15, far from ±0.5 mm.
    //
    // Derivation (all arithmetic in domain module units):
    //   actual = limit - k × Δz_desired
    //          = 1.0 - (-0.008018...) × 0.5 = 1.004009... mm  (fails <= 1.0)
    //   delta  = (limit - actual) / k ≈ 0.5 mm
    //   z*     = 30.0 + 0.5 = 30.5 mm  ∈  [29, 31]
    const k = DISPLACEMENT_EDGE.derivative.value; // -0.00801800268471424
    const limitValue = 1.0;
    const deltaMm = 0.5;
    const actualValue = limitValue - k * deltaMm; // > limit → fails <=
    const comparison: EvaluationComparison = {
      observationId: "obs:disp",
      actual: { value: actualValue, unit: "mm" },
      operator: "<=",
      limit: { value: limitValue, unit: "mm" },
      // normalizedUnit is the response METRIC unit, not the derivative unit
      normalizedUnit: "mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 30.0, unit: "mm" },
      "assembly_max_displacement",
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    assertEquals(result.schemaVersion, CORRECTION_PROPOSAL_SCHEMA);
    assertEquals(result.edgeUsed.response.metric, "assembly_max_displacement");
    assertEquals(result.driverCurrent, { value: 30.0, unit: "mm" });
    assertEquals(result.driverDelta.unit, "mm");
    // z* ≈ 30.5 ∈ [29, 31] — tolerance for IEEE 754 round-trip
    assertEquals(result.driverProposed.unit, "mm");
    assertEquals(Math.abs(result.driverProposed.value - 30.5) < 1e-9, true);
    assertEquals(Math.abs(result.driverDelta.value - 0.5) < 1e-9, true);
    // Predicted response must equal the limit (exactly by construction)
    assertEquals(result.linearizedJustification.predictedResponse.unit, "mm");
    const predicted = result.linearizedJustification.predictedResponse.value;
    assertEquals(Math.abs(predicted - limitValue) < 1e-10, true);
    // Formula must be present
    assertMatch(result.linearizedJustification.formula, /u_proposed/);
  },
);

// ---------------------------------------------------------------------------
// Reproduction of the historical 28 mm → 30 mm correction
//
// The real sensitivity edge (k = -0.00801800268471424 mm/mm at z0 = 30 mm,
// validity [29, 31] mm) is used. We construct a synthetic failing evaluation
// at z_current = 28 mm with actual = 1 + k×(28-30) / 1 such that the
// correction formula yields exactly z* = 30 mm.
//
// Derivation:
//   z* = z_current + (limit - actual) / k
//   30 = 28 + (1 - actual) / k
//   2 = (1 - actual) / k
//   1 - actual = 2k = 2 × (-0.008018) = -0.016036
//   actual = 1 + 0.016036 = 1.016036... mm
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection reproduces the historical 28 mm to 30 mm correction from R16 edges",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value; // -0.00801800268471424
    const limitMm = 1.0;
    // We want z* = 30 mm from z_current = 28 mm → Δz = 2 mm.
    // From the formula: actual = limit - k × Δz = 1.0 - k × 2
    // (Δz = (limit - actual) / k  →  actual = limit - k × Δz)
    const deltaTargetMm = 2;
    const actualMm = limitMm - k * deltaTargetMm; // slightly above limit (fails <=)
    const comparison: EvaluationComparison = {
      observationId: "obs:historical",
      actual: { value: actualMm, unit: "mm" },
      operator: "<=",
      limit: { value: limitMm, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    // Proposed value must be approximately 30 mm (floating point tolerance).
    assertEquals(Math.abs(result.driverProposed.value - 30) < 1e-9, true);
    assertEquals(result.driverProposed.unit, "mm");
    // Delta must be approximately +2 mm.
    assertEquals(Math.abs(result.driverDelta.value - 2) < 1e-9, true);
    assertEquals(result.driverDelta.unit, "mm");
    // Current must be 28 mm.
    assertEquals(result.driverCurrent.value, 28);
    // z* ≈ 30 mm is within [29, 31].
    assertEquals(
      result.driverProposed.value >= 29 && result.driverProposed.value <= 31,
      true,
    );
    // Predicted response must be at the limit (1 mm).
    const predicted = result.linearizedJustification.predictedResponse.value;
    assertEquals(Math.abs(predicted - limitMm) < 1e-10, true);
    // Provenance must match the R16 capture.
    assertEquals(result.edgeUsed.provenance.runId, REAL_RUN_ID);
    assertEquals(result.edgeUsed.provenance.capturedAt, CAPTURED_AT);
  },
);

// ---------------------------------------------------------------------------
// Multiple edges — the function uses the first applicable one
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection uses the first applicable edge when multiple edges are supplied",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value;
    const limitMm = 1.0;
    const actualMm = limitMm - 2 * k; // correction target = z_current + 2 ≈ 30 mm
    const comparison: EvaluationComparison = {
      observationId: "obs:first",
      actual: { value: actualMm, unit: "mm" },
      operator: "<=",
      limit: { value: limitMm, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      // DISPLACEMENT_EDGE first, then VON_MISES_EDGE (different metric — ignored)
      ALL_EDGES,
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    assertEquals(result.edgeUsed.response.metric, "assembly_max_displacement");
  },
);

// ---------------------------------------------------------------------------
// Von-Mises edge happy path
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection produces a valid proposal for a von-Mises failure within the neighborhood",
  () => {
    // k = -0.036042088238638414 MPa/mm, z_current = 30.0, validity [29, 31]
    // To get z* = 30.5 mm (inside [29,31]):
    //   Δz = 0.5 mm
    //   actual = limit - k × Δz = 20 - (-0.036042) × 0.5 = 20 + 0.018021 = 20.018021 MPa
    const k = VON_MISES_EDGE.derivative.value;
    const limitMPa = 20.0; // MPa
    const deltaMm = 0.5;
    const actualMPa = limitMPa - k * deltaMm; // slightly above limit (fails <=)
    const comparison: EvaluationComparison = {
      observationId: "obs:vm",
      actual: { value: actualMPa, unit: "MPa" },
      operator: "<=",
      limit: { value: limitMPa, unit: "MPa" },
      // normalizedUnit is the response METRIC unit (MPa for stress, not the derivative unit MPa/mm)
      normalizedUnit: "MPa",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [VON_MISES_EDGE],
      { value: 30.0, unit: "mm" },
      "assembly_max_von_mises",
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    assertEquals(result.edgeUsed.response.metric, "assembly_max_von_mises");
    assertEquals(result.driverProposed.unit, "mm");
    // z* = 30 + 0.5 = 30.5 ∈ [29, 31]
    const proposedMm = result.driverProposed.value;
    assertEquals(Math.abs(proposedMm - 30.5) < 1e-10, true);
    // Predicted response at the limit
    const predicted = result.linearizedJustification.predictedResponse.value;
    assertEquals(Math.abs(predicted - limitMPa) < 1e-10, true);
  },
);

// ---------------------------------------------------------------------------
// buildCorrectionMrtrProposal
// ---------------------------------------------------------------------------

Deno.test(
  "buildCorrectionMrtrProposal produces a complete EngineeringDecisionProposal",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value;
    const limitMm = 1.0;
    const deltaTargetMm = 2;
    const actualMm = limitMm - k * deltaTargetMm;
    const comparison: EvaluationComparison = {
      observationId: "obs:mrtr",
      actual: { value: actualMm, unit: "mm" },
      operator: "<=",
      limit: { value: limitMm, unit: "mm" },
      normalizedUnit: "mm",
    };
    const correctionResult = proposeVectorCorrection(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as CorrectionProposal;
    assertEquals(correctionResult.status, "proposed");

    const mrtr = buildCorrectionMrtrProposal(correctionResult, {
      proposedAt: "2026-08-05T12:00:00.000Z",
      proposedBy: { id: "agent:casys", origin: "agent" },
    });

    // Summary must reference the metric and the current value
    assertMatch(mrtr.summary, /assembly_max_displacement/);
    assertMatch(mrtr.summary, /28/);

    // proposedAt and proposedBy must be stamped
    assertEquals(mrtr.proposedAt, "2026-08-05T12:00:00.000Z");
    assertEquals(mrtr.proposedBy.id, "agent:casys");

    // Parameters must include the key fields
    const paramKeys = mrtr.parameters.map((p) => p.key);
    assertEquals(paramKeys.includes("metricId"), true);
    assertEquals(paramKeys.includes("driverCurrentValue"), true);
    assertEquals(paramKeys.includes("driverProposedValue"), true);
    assertEquals(paramKeys.includes("driverDelta"), true);
    assertEquals(paramKeys.includes("derivative"), true);
    assertEquals(paramKeys.includes("neighborhoodLower"), true);
    assertEquals(paramKeys.includes("neighborhoodUpper"), true);
    assertEquals(paramKeys.includes("edgeProvenance"), true);

    // metricId parameter must have the correct value
    const metricParam = mrtr.parameters.find((p) => p.key === "metricId");
    assertEquals(metricParam?.value, "assembly_max_displacement");

    // driverCurrentValue must be 28 mm
    const currentParam = mrtr.parameters.find((p) => p.key === "driverCurrentValue");
    assertEquals(currentParam?.value, 28);
    assertEquals(currentParam?.unit, "mm");

    // driverProposedValue must be approximately 30 mm (floating point tolerance)
    const proposedParam = mrtr.parameters.find((p) => p.key === "driverProposedValue");
    assertEquals(
      typeof proposedParam?.value === "number" &&
        Math.abs(Number(proposedParam.value) - 30) < 1e-9,
      true,
    );
    assertEquals(proposedParam?.unit, "mm");

    // Neighborhood bounds must be 29 and 31
    const lowerParam = mrtr.parameters.find((p) => p.key === "neighborhoodLower");
    assertEquals(lowerParam?.value, 29);
    const upperParam = mrtr.parameters.find((p) => p.key === "neighborhoodUpper");
    assertEquals(upperParam?.value, 31);

    // Provenance must reference the real run
    const provenanceParam = mrtr.parameters.find((p) => p.key === "edgeProvenance");
    assertEquals(provenanceParam?.value, REAL_RUN_ID);
  },
);

// ---------------------------------------------------------------------------
// Fallback: first edge fails out-of-validity-neighborhood, second edge applies
//
// Uses only valid SensitivityEdge fixtures (both pass validateSensitivityEdge).
// Scenario: edgeTight has [30.8, 31.0] neighborhood — the correction target of
// z* ≈ 30 mm falls below the lower bound 30.8 → out-of-validity-neighborhood.
// DISPLACEMENT_EDGE has [29, 31] — the same z* ≈ 30 mm is inside.
// The function must skip edgeTight and use DISPLACEMENT_EDGE.
// ---------------------------------------------------------------------------

Deno.test(
  "proposeVectorCorrection falls back to the second edge when the first has a too-tight validity neighborhood",
  () => {
    // A second displacement edge with a tight neighborhood [30.8, 31.0].
    // The correction from z_current = 28 mm targets z* ≈ 30 mm, which is
    // below 30.8 → out-of-validity-neighborhood for this edge.
    const edgeTight: SensitivityEdge = {
      ...DISPLACEMENT_EDGE,
      driver: {
        ...DISPLACEMENT_EDGE.driver,
        sysmlAttrName: "sizeZ_for_assembly_max_displacement_tight",
        validityNeighborhood: {
          lower: { value: 30.8, unit: "mm" },
          upper: { value: 31.0, unit: "mm" },
          lowerConstraintName: "disp_validity_tight_lower",
          upperConstraintName: "disp_validity_tight_upper",
        },
      },
      response: {
        ...DISPLACEMENT_EDGE.response,
        sysmlAttrName: "d_assembly_max_displacement_tight",
      },
    };
    // DISPLACEMENT_EDGE (wide neighborhood [29, 31]) is the fallback.
    const k = DISPLACEMENT_EDGE.derivative.value;
    const limitMm = 1.0;
    // actual set so z* = z_current + 2 ≈ 30 mm (inside [29,31], outside [30.8,31.0])
    const actualMm = limitMm - 2 * k;
    const comparison: EvaluationComparison = {
      observationId: "obs:fallback",
      actual: { value: actualMm, unit: "mm" },
      operator: "<=",
      limit: { value: limitMm, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = proposeVectorCorrection(
      failingEvaluation(comparison),
      [edgeTight, DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
    ) as CorrectionProposal;
    // Must succeed by falling back to DISPLACEMENT_EDGE
    assertEquals(result.status, "proposed");
    assertEquals(
      result.edgeUsed.driver.sysmlAttrName,
      "sizeZ_for_assembly_max_displacement",
    );
    // z* ≈ 30 mm inside [29, 31]
    assertEquals(Math.abs(result.driverProposed.value - 30) < 1e-9, true);
  },
);
