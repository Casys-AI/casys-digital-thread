import { assertEquals, assertThrows } from "@std/assert";
import {
  CORRECTION_PROPOSAL_CAPTURE_GRANTS,
  validateVectorCorrectionCapture,
} from "./vector-correction-capture.ts";

Deno.test("a correction-proposal capture requires grants: none as an exactRecord field", () => {
  const digest = "a".repeat(64);
  const capture = {
    schemaVersion: "correction-proposal-capture/1.0",
    kind: "correction-proposal",
    grants: CORRECTION_PROPOSAL_CAPTURE_GRANTS,
    operation: { id: "design.apply-vector-correction", version: "1" },
    trustedRunId: "run.vector",
    decisionId: "decision.vector",
    sealedAt: "2026-08-15T00:00:00.000Z",
    proposal: {
      schemaVersion: "correction-proposal/1.0",
      studyCapture: {
        artifactId: `sensitivity-study-${digest}`,
        fingerprint: { algorithm: "sha256", digest },
      },
      evaluationId: "eval.fail",
      metricId: "assembly_max_displacement",
      driver: {
        current: { value: 50, unit: "mm" },
        proposed: { value: 50.5, unit: "mm" },
        delta: { value: 0.5, unit: "mm" },
      },
      actual: { value: 1.004, unit: "mm" },
      limit: { value: 1, unit: "mm" },
      predicted: { value: 1, unit: "mm" },
      derivative: { value: -0.008, unit: "mm/mm" },
      neighborhood: {
        lower: { value: 50, unit: "mm" },
        upper: { value: 51, unit: "mm" },
      },
      unitTransformation: "identity",
      caseDigest: "b".repeat(64),
      formula: "u_proposed ≈ u_actual + k × (z_proposed − z_current)",
    },
    studyCapture: {
      id: `sensitivity-study-${digest}`,
      fingerprint: { algorithm: "sha256", digest },
      uri: `casys://sensitivity-study-capture/sha256/${digest}`,
    },
    evaluation: { id: "eval.fail" },
  };
  const validated = validateVectorCorrectionCapture(capture);
  assertEquals(validated.grants, "none");
  assertThrows(
    () => validateVectorCorrectionCapture({ ...capture, grants: "admission" }),
    TypeError,
    "none",
  );
});
