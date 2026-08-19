import { assertEquals } from "@std/assert";
import {
  resolveVectorCorrectionOrigin,
  sensitivityBaseObservationId,
  VECTOR_CORRECTION_UNLINKED_LABEL,
} from "./vector-correction-origin.ts";
import type {
  RequirementEvaluation,
  ThreadObservation,
  TracedRequirement,
} from "../../thread/thread-snapshot.ts";

const DIGEST = "a".repeat(64);
const METRIC = "assembly_max_displacement";
const OBS_ID = sensitivityBaseObservationId(METRIC, DIGEST);
const AT = "2026-08-15T00:00:00.000Z";

const study = {
  digest: DIGEST,
  baseValue: { value: 30, unit: "mm" },
  metrics: [{ id: METRIC, unit: "mm" }],
  baseMeasurements: [{ metric: METRIC, value: 1.004, unit: "mm" }],
};

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function requirement(): TracedRequirement {
  return {
    id: "req:disp",
    name: "Displacement",
    statement: "Stay under 1 mm",
    version: "1",
    criterion: { metric: METRIC, operator: "<=", limit: { value: 1, unit: "mm" } },
    trace: {
      sourceArtifactId: "artifact.req",
      elementId: "el.req",
      targetArtifactIds: [],
    },
    freshness: fresh(),
  };
}

function observation(): ThreadObservation {
  return {
    id: OBS_ID,
    name: `${METRIC} at base`,
    metric: METRIC,
    quantity: { value: 1.004, unit: "mm" },
    source: {
      operation: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run.s",
      },
      artifactIds: [`sensitivity-study-${DIGEST}`],
      capturedAt: AT,
    },
    freshness: fresh(),
  };
}

function evaluation(
  overrides: Partial<RequirementEvaluation> = {},
): RequirementEvaluation {
  return {
    id: "eval:fail",
    name: "Failing displacement",
    requirementId: "req:disp",
    observationIds: [OBS_ID],
    status: "fail",
    evaluatedAt: AT,
    evaluator: { serverId: "test", tool: "test", runId: "test" },
    comparison: {
      observationId: OBS_ID,
      actual: { value: 1.004, unit: "mm" },
      operator: "<=",
      limit: { value: 1, unit: "mm" },
      normalizedUnit: "mm",
    },
    evidenceArtifactIds: [],
    message: "Fails",
    freshness: fresh(),
    ...overrides,
  };
}

Deno.test("resolveVectorCorrectionOrigin uses the study-base measurement as u_actual and baseValue as z_current", () => {
  const result = resolveVectorCorrectionOrigin({
    evaluation: evaluation(),
    requirement: requirement(),
    observations: [observation()],
    study,
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.metricId, METRIC);
  assertEquals(result.actual, { value: 1.004, unit: "mm" });
  assertEquals(result.currentDriver, { value: 30, unit: "mm" });
  assertEquals(result.observationId, OBS_ID);
});

Deno.test("resolveVectorCorrectionOrigin is UNLINKED when the evaluation does not cite the study-base observation", () => {
  const result = resolveVectorCorrectionOrigin({
    evaluation: evaluation({
      observationIds: ["obs:proof"],
      comparison: {
        observationId: "obs:proof",
        actual: { value: 1.2, unit: "mm" },
        operator: "<=",
        limit: { value: 1, unit: "mm" },
        normalizedUnit: "mm",
      },
    }),
    requirement: requirement(),
    observations: [observation()],
    study,
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason, "evaluation-unlinked");
  assertEquals(result.label, VECTOR_CORRECTION_UNLINKED_LABEL);
});

Deno.test("resolveVectorCorrectionOrigin is UNLINKED when the cited quantity is not Object.is-equal to the study-base measurement", () => {
  const result = resolveVectorCorrectionOrigin({
    evaluation: evaluation(),
    requirement: requirement(),
    observations: [{
      ...observation(),
      quantity: { value: 1.0040000001, unit: "mm" },
    }],
    study,
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason, "evaluation-unlinked");
  assertEquals(result.label, VECTOR_CORRECTION_UNLINKED_LABEL);
});

Deno.test("resolveVectorCorrectionOrigin refuses a stale evaluation", () => {
  const result = resolveVectorCorrectionOrigin({
    evaluation: evaluation({
      freshness: {
        status: "stale",
        changedAt: AT,
        reason: "superseded",
        invalidatedByChangeIds: ["change.1"],
      },
    }),
    requirement: requirement(),
    observations: [observation()],
    study,
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason, "evaluation-not-fresh");
});
