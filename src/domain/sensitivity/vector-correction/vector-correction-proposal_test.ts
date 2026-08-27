import { assertEquals, assertThrows } from "@std/assert";
import {
  encodeVectorCorrectionDecisionParameters,
  parseVectorCorrectionDecisionParameters,
  vectorCorrectionDecisionFromComputed,
  verifyVectorCorrectionParametersMatch,
} from "./vector-correction-proposal.ts";
import {
  type CorrectionProposal,
  proposeVectorCorrection,
} from "./propose-vector-correction.ts";
import type { SensitivityEdge } from "../edges/sensitivity-edge.ts";

const DIGEST = "a".repeat(64);
const CASE_DIGEST = "b".repeat(64);
const BASE_MM = 30;

const EDGE: SensitivityEdge = {
  schemaVersion: "sensitivity-edge/1.0",
  driver: {
    sysmlAttrName: "sizeZ_for_assembly_max_displacement",
    unit: "mm",
    basePoint: { value: BASE_MM, unit: "mm" },
    validityNeighborhood: {
      lower: { value: 30, unit: "mm" },
      upper: { value: 31, unit: "mm" },
      lowerConstraintName: "assembly_max_displacement_validity_lower",
      upperConstraintName: "assembly_max_displacement_validity_upper",
    },
  },
  response: {
    metric: "assembly_max_displacement",
    sysmlAttrName: "d_assembly_max_displacement_mm_per_mm",
    unit: "mm/mm",
  },
  derivative: { value: -0.008, unit: "mm/mm" },
  provenance: { runId: "run.study", capturedAt: "2026-08-15T00:00:00.000Z" },
};

function computedDecision() {
  const limit = 1;
  const actual = limit - EDGE.derivative.value * 0.5;
  const proposal = proposeVectorCorrection({
    evaluation: {
      id: "eval:fail",
      name: "Fail",
      requirementId: "req:disp",
      observationIds: ["obs"],
      status: "fail",
      evaluatedAt: "2026-08-15T00:00:00.000Z",
      evaluator: { serverId: "t", tool: "t", runId: "t" },
      comparison: {
        observationId: "obs",
        actual: { value: actual, unit: "mm" },
        operator: "<=",
        limit: { value: limit, unit: "mm" },
        normalizedUnit: "mm",
      },
      evidenceArtifactIds: [],
      message: "fail",
      freshness: {
        status: "fresh",
        changedAt: "2026-08-15T00:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    },
    edges: [EDGE],
    currentDriverValue: { value: BASE_MM, unit: "mm" },
    metricId: "assembly_max_displacement",
    actualResponse: { value: actual, unit: "mm" },
  }) as CorrectionProposal;
  return vectorCorrectionDecisionFromComputed({
    proposal,
    studyCapture: {
      artifactId: `sensitivity-study-${DIGEST}`,
      fingerprint: { algorithm: "sha256", digest: DIGEST },
    },
    evaluationId: "eval:fail",
    caseDigest: CASE_DIGEST,
    limit: { value: limit, unit: "mm" },
  });
}

Deno.test("vector-correction MRTR parameters round-trip exact identities and scalars", () => {
  const decision = computedDecision();
  const parameters = encodeVectorCorrectionDecisionParameters(decision);
  assertEquals(parseVectorCorrectionDecisionParameters(parameters), decision);
  assertEquals(parameters.length, 27);
  assertEquals(
    parameters[0]?.key,
    "design.vectorCorrection.schemaVersion",
  );
  assertEquals(
    parameters.find((item) => item.key === "design.vectorCorrection.unitTransformation")
      ?.value,
    "identity",
  );
});

Deno.test("vector-correction MRTR accepts the exact reused-result artifact id", () => {
  const decision = computedDecision();
  const reused = {
    ...decision,
    studyCapture: {
      ...decision.studyCapture,
      artifactId: `sensitivity-study-reuse-result-${DIGEST}`,
    },
  };
  const parameters = encodeVectorCorrectionDecisionParameters(reused);
  assertEquals(parseVectorCorrectionDecisionParameters(parameters), reused);
});

Deno.test("vector-correction grammar rejects a study artifact id that does not derive from its sha256", () => {
  const decision = computedDecision();
  assertThrows(() =>
    encodeVectorCorrectionDecisionParameters({
      ...decision,
      studyCapture: {
        ...decision.studyCapture,
        artifactId: `sensitivity-study-${"c".repeat(64)}`,
      },
    })
  );
});

Deno.test("vector-correction grammar rejects a non SHA-256 digest", () => {
  const parameters = encodeVectorCorrectionDecisionParameters(computedDecision())
    .map((parameter) =>
      parameter.key === "design.vectorCorrection.studyCapture.sha256"
        ? { ...parameter, value: "not-a-digest" }
        : parameter
    );
  assertThrows(
    () => parseVectorCorrectionDecisionParameters(parameters),
    TypeError,
    "SHA-256",
  );
});

Deno.test("vector-correction grammar rejects a missing, duplicate, or unexpected parameter", () => {
  const parameters = encodeVectorCorrectionDecisionParameters(computedDecision());
  assertThrows(() => parseVectorCorrectionDecisionParameters(parameters.slice(1)));
  assertThrows(() =>
    parseVectorCorrectionDecisionParameters([...parameters, parameters[0]!])
  );
  const duplicate = [...parameters];
  duplicate[1] = parameters[0]!;
  assertThrows(() => parseVectorCorrectionDecisionParameters(duplicate));
});

Deno.test("verifyVectorCorrectionParametersMatch is Object.is-strict on recomputed scalars", () => {
  const decision = computedDecision();
  verifyVectorCorrectionParametersMatch(decision, decision);
  assertThrows(
    () =>
      verifyVectorCorrectionParametersMatch(decision, {
        ...decision,
        driver: {
          ...decision.driver,
          proposed: { ...decision.driver.proposed, value: 30.5000000001 },
        },
      }),
    TypeError,
    "parameter_mismatch",
  );
});
