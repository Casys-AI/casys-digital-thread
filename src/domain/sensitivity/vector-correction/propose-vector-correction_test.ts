/**
 * Invariant tests for proposeVectorCorrection.
 *
 * Neighborhood fixtures use the living formula
 * [min(base, base+step), max(base, base+step)].
 * The historical R16 interval [29, 31] is not a validity neighborhood.
 */

import { assertEquals, assertMatch } from "@std/assert";
import {
  CORRECTION_PROPOSAL_SCHEMA,
  type CorrectionProposal,
  proposeVectorCorrection,
  type UnresolvedCorrection,
} from "./propose-vector-correction.ts";
import type { SensitivityEdge } from "../edges/sensitivity-edge.ts";
import type {
  EvaluationComparison,
  RequirementEvaluation,
} from "../../thread/thread-snapshot.ts";

const REAL_RUN_ID = "run:cm01-drip-tray-sensitivity-2026-08-05";
const CAPTURED_AT = "2026-08-05T08:05:27.351Z";
const BASE_MM = 30;
const STEP_MM = 1;
const LOWER_MM = Math.min(BASE_MM, BASE_MM + STEP_MM);
const UPPER_MM = Math.max(BASE_MM, BASE_MM + STEP_MM);

function livingNeighborhood(
  metric: string,
): SensitivityEdge["driver"]["validityNeighborhood"] {
  return Object.freeze({
    lower: Object.freeze({ value: LOWER_MM, unit: "mm" }),
    upper: Object.freeze({ value: UPPER_MM, unit: "mm" }),
    lowerConstraintName: `${metric}_validity_lower`,
    upperConstraintName: `${metric}_validity_upper`,
  });
}

const DISPLACEMENT_EDGE: SensitivityEdge = Object.freeze({
  schemaVersion: "sensitivity-edge/1.0",
  driver: Object.freeze({
    sysmlAttrName: "sizeZ_for_assembly_max_displacement",
    unit: "mm",
    basePoint: Object.freeze({ value: BASE_MM, unit: "mm" }),
    validityNeighborhood: livingNeighborhood("assembly_max_displacement"),
  }),
  response: Object.freeze({
    metric: "assembly_max_displacement",
    sysmlAttrName: "d_assembly_max_displacement_mm_per_mm",
    unit: "mm/mm",
  }),
  derivative: Object.freeze({ value: -0.00801800268471424, unit: "mm/mm" }),
  provenance: Object.freeze({ runId: REAL_RUN_ID, capturedAt: CAPTURED_AT }),
});

const VON_MISES_EDGE: SensitivityEdge = Object.freeze({
  schemaVersion: "sensitivity-edge/1.0",
  driver: Object.freeze({
    sysmlAttrName: "sizeZ_for_assembly_max_von_mises",
    unit: "mm",
    basePoint: Object.freeze({ value: BASE_MM, unit: "mm" }),
    validityNeighborhood: livingNeighborhood("assembly_max_von_mises"),
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

function propose(
  evaluation: RequirementEvaluation,
  edges: readonly SensitivityEdge[],
  currentDriverValue: { readonly value: number; readonly unit: string },
  metricId: string,
  actualResponse: { readonly value: number; readonly unit: string },
) {
  return proposeVectorCorrection({
    evaluation,
    edges,
    currentDriverValue,
    metricId,
    actualResponse,
  });
}

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
    const result = propose(
      evaluation,
      ALL_EDGES,
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.004, unit: "mm" },
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
    const result = propose(
      evaluation,
      ALL_EDGES,
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.004, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "evaluation-not-failed");
  },
);

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
      evidenceArtifactIds: [],
      message: "Fails without comparison",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-05T10:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    };
    const result = propose(
      evaluation,
      ALL_EDGES,
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.004, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "evaluation-missing-comparison");
  },
);

Deno.test(
  "proposeVectorCorrection returns no-applicable-edge when no edge matches the metricId",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      ALL_EDGES,
      { value: BASE_MM, unit: "mm" },
      "unknown_metric_id",
      { value: 1.5, unit: "mm" },
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
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.5, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "no-applicable-edge");
  },
);

Deno.test(
  "proposeVectorCorrection n'essaie pas une deuxième arête : une métrique ambiguë est ambiguous-edge",
  () => {
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
    const comparison: EvaluationComparison = {
      observationId: "obs:ambiguous",
      actual: { value: 1.004, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [edgeTight, DISPLACEMENT_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.004, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "ambiguous-edge");
  },
);

Deno.test(
  "proposeVectorCorrection returns incompatible-units when normalizedUnit produces a derivative mismatch",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 25_000_000, unit: "Pa" },
      operator: "<=",
      limit: { value: 20_000_000, unit: "Pa" },
      normalizedUnit: "Pa",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 25_000_000, unit: "Pa" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "incompatible-units");
    assertMatch(result.detail, /mm\/mm/);
    assertMatch(result.detail, /Pa\/mm/);
  },
);

Deno.test(
  "proposeVectorCorrection returns incompatible-units when currentDriverValue.unit differs from the edge driver",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:test",
      actual: { value: 1.004, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: BASE_MM, unit: "in" },
      "assembly_max_displacement",
      { value: 1.004, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "incompatible-units");
  },
);

Deno.test(
  "une unité hors table reste incompatible-units",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:vm",
      actual: { value: 20.02, unit: "MPa" },
      operator: "<=",
      limit: { value: 20_000_000, unit: "Pa" },
      normalizedUnit: "Pa",
    };
    const result = propose(
      failingEvaluation(comparison),
      [VON_MISES_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_von_mises",
      { value: 20.02, unit: "MPa" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "incompatible-units");
  },
);

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
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [zeroDerivativeEdge],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.5, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "zero-derivative");
    assertMatch(result.detail, /derivative value 0/);
  },
);

Deno.test(
  "proposeVectorCorrection refuse domain_exceeded quand z_current est strictement hors du voisinage déclaré, et ne propose jamais",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value;
    const comparison: EvaluationComparison = {
      observationId: "obs:outside",
      actual: { value: 1.004, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.0 - k * 0.5, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "domain_exceeded");
  },
);

Deno.test(
  "proposeVectorCorrection refuse domain_exceeded pour le cas historique 28 mm avec une arête de base 30 mm et un pas de 1 mm",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value;
    const limitMm = 1.0;
    const actualMm = limitMm - k * 2;
    const comparison: EvaluationComparison = {
      observationId: "obs:historical",
      actual: { value: actualMm, unit: "mm" },
      operator: "<=",
      limit: { value: limitMm, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: 28, unit: "mm" },
      "assembly_max_displacement",
      { value: actualMm, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "domain_exceeded");
    assertMatch(result.detail, /\[30, 31\]/);
  },
);

Deno.test(
  "proposeVectorCorrection refuse out-of-validity-neighborhood quand z* sort de [min(base, base+step), max(base, base+step)], sans clamper",
  () => {
    const comparison: EvaluationComparison = {
      observationId: "obs:far",
      actual: { value: 9.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 9.5, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "out-of-validity-neighborhood");
    assertMatch(result.detail, /\[30, 31\]/);
  },
);

Deno.test(
  "proposeVectorCorrection returns out-of-validity-neighborhood when z* falls below lower bound",
  () => {
    const positiveEdge: SensitivityEdge = {
      ...DISPLACEMENT_EDGE,
      derivative: { value: 0.1, unit: "mm/mm" },
    };
    const comparison: EvaluationComparison = {
      observationId: "obs:below",
      actual: { value: 1.5, unit: "mm" },
      operator: "<=",
      limit: { value: 1.0, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [positiveEdge],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: 1.5, unit: "mm" },
    ) as UnresolvedCorrection;
    assertEquals(result.status, "unresolved");
    assertEquals(result.reason, "out-of-validity-neighborhood");
    assertMatch(result.detail, /\[30, 31\]/);
  },
);

Deno.test(
  "proposeVectorCorrection n'accepte une proposition que si z_current et z* sont dans le voisinage, avec unités sur chaque scalaire",
  () => {
    const k = DISPLACEMENT_EDGE.derivative.value;
    const limitValue = 1.0;
    const deltaMm = 0.5;
    const actualValue = limitValue - k * deltaMm;
    const comparison: EvaluationComparison = {
      observationId: "obs:disp",
      actual: { value: actualValue, unit: "mm" },
      operator: "<=",
      limit: { value: limitValue, unit: "mm" },
      normalizedUnit: "mm",
    };
    const result = propose(
      failingEvaluation(comparison),
      [DISPLACEMENT_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_displacement",
      { value: actualValue, unit: "mm" },
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    assertEquals(result.schemaVersion, CORRECTION_PROPOSAL_SCHEMA);
    assertEquals(result.edgeUsed.response.metric, "assembly_max_displacement");
    assertEquals(result.driverCurrent, { value: BASE_MM, unit: "mm" });
    assertEquals(result.driverDelta.unit, "mm");
    assertEquals(result.driverProposed.unit, "mm");
    assertEquals(Math.abs(result.driverProposed.value - 30.5) < 1e-9, true);
    assertEquals(Math.abs(result.driverDelta.value - 0.5) < 1e-9, true);
    assertEquals(
      result.driverProposed.value >= LOWER_MM &&
        result.driverProposed.value <= UPPER_MM,
      true,
    );
    assertEquals(result.linearizedJustification.predictedResponse.unit, "mm");
    const predicted = result.linearizedJustification.predictedResponse.value;
    assertEquals(Math.abs(predicted - limitValue) < 1e-10, true);
    assertMatch(result.linearizedJustification.formula, /u_proposed/);
    assertEquals(result.linearizedJustification.actualResponse.unit, "mm");
    assertEquals(result.linearizedJustification.currentDriver.unit, "mm");
    assertEquals(result.linearizedJustification.derivative.unit, "mm/mm");
  },
);

Deno.test(
  "proposeVectorCorrection produces a valid proposal for a von-Mises failure within the neighborhood",
  () => {
    const k = VON_MISES_EDGE.derivative.value;
    const limitMPa = 20.0;
    const deltaMm = 0.5;
    const actualMPa = limitMPa - k * deltaMm;
    const comparison: EvaluationComparison = {
      observationId: "obs:vm",
      actual: { value: actualMPa, unit: "MPa" },
      operator: "<=",
      limit: { value: limitMPa, unit: "MPa" },
      normalizedUnit: "MPa",
    };
    const result = propose(
      failingEvaluation(comparison),
      [VON_MISES_EDGE],
      { value: BASE_MM, unit: "mm" },
      "assembly_max_von_mises",
      { value: actualMPa, unit: "MPa" },
    ) as CorrectionProposal;
    assertEquals(result.status, "proposed");
    assertEquals(result.edgeUsed.response.metric, "assembly_max_von_mises");
    assertEquals(result.driverProposed.unit, "mm");
    const proposedMm = result.driverProposed.value;
    assertEquals(Math.abs(proposedMm - 30.5) < 1e-10, true);
    const predicted = result.linearizedJustification.predictedResponse.value;
    assertEquals(Math.abs(predicted - limitMPa) < 1e-10, true);
  },
);
