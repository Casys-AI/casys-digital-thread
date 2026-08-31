import { assertEquals, assertThrows } from "@std/assert";
import {
  canonicalStaticMechanicalEvaluationCloseoutCaptureText,
  validateStaticMechanicalEvaluationCloseoutCapture,
} from "./static-mechanical-evaluation-closeout-capture.ts";

const DIGESTS = ["a", "b", "c", "d", "e"].map((value) => value.repeat(64));

function capture() {
  const [basis, step, proof, execution, evaluation] = DIGESTS;
  const admission = {
    schemaVersion: "evaluation-closeout-admission/1.0" as const,
    family: "static-mechanical" as const,
    consequence: "reject" as const,
    rejectionDisposition: "mechanical-review-required" as const,
    projectId: "project-static",
    subjectId: "subject-static",
    basis: {
      snapshotId: "thread-static-r4",
      revision: 4,
      fingerprint: { algorithm: "sha256" as const, digest: basis! },
    },
    canonicalStep: identity("canonical-step", step!, "run-cad"),
    sealedProof: identity("sealed-proof", proof!, "run-proof"),
    executionEvidence: identity("execution-evidence", execution!, "run-fea"),
    evaluationCapture: identity("evaluation-capture", evaluation!, "run-fea"),
    criteria: [{
      proofCriterionId: "criterion-stress",
      evaluationId: "evaluation-stress",
      status: "fail" as const,
      evidenceArtifactId: "evaluation-capture",
    }],
    proofLimitations: {
      proofScope: "recorded-static-scope",
      evidenceBoundary: "sealed-local-evidence-only",
      cadEngineeringBoundary: {
        designIntent: "partial" as const,
        editableCad: "reconstructed" as const,
        manufacturability: "not-established" as const,
        limitations: ["boundary-a", "boundary-b"],
      },
    },
    limits: {
      engineCalls: "none" as const,
      sysonCalls: "none" as const,
      l4PassIsNotL5: true as const,
      rejectionGrants: "none" as const,
    },
  };
  return {
    schemaVersion: "evaluation-closeout-capture/1.0" as const,
    kind: "static-mechanical-evaluation-closeout" as const,
    operation: {
      id: "decide.reject-evaluation-closeout" as const,
      version: "1" as const,
    },
    trustedRunId: "run-closeout",
    decisionId: "decision-closeout",
    sealedAt: "2026-08-22T00:00:00.000Z",
    admission,
    inputs: {
      canonicalStep: admission.canonicalStep,
      sealedProof: admission.sealedProof,
      executionEvidence: admission.executionEvidence,
      evaluationCapture: admission.evaluationCapture,
    },
    proofLimitations: admission.proofLimitations,
    limits: admission.limits,
  };
}

function identity(id: string, digest: string, producerRunId: string) {
  return {
    id,
    fingerprint: { algorithm: "sha256" as const, digest },
    producerRunId,
  };
}

Deno.test("static-mechanical closeout capture is canonical, exhaustive, and provider-free", () => {
  const validated = validateStaticMechanicalEvaluationCloseoutCapture(capture());
  const text = canonicalStaticMechanicalEvaluationCloseoutCaptureText(validated);
  assertEquals(canonicalStaticMechanicalEvaluationCloseoutCaptureText(validated), text);
  assertEquals(
    Object.keys(validated.inputs),
    ["canonicalStep", "sealedProof", "executionEvidence", "evaluationCapture"],
  );
  assertEquals(validated.limits, {
    engineCalls: "none",
    sysonCalls: "none",
    l4PassIsNotL5: true,
    rejectionGrants: "none",
  });
  assertEquals(text.includes("provider"), false);
  assertEquals(text.includes('engineCalls":"none'), true);
});

Deno.test("static-mechanical closeout capture rejects a proof-limitation mismatch", () => {
  const original = capture();
  const altered = {
    ...original,
    proofLimitations: {
      ...original.proofLimitations,
      cadEngineeringBoundary: {
        ...original.proofLimitations.cadEngineeringBoundary,
        limitations: ["other-boundary", "boundary-b"],
      },
    },
  };
  assertThrows(
    () => validateStaticMechanicalEvaluationCloseoutCapture(altered),
    TypeError,
    "must equal the signed sealed-proof boundary",
  );
});

Deno.test("static-mechanical closeout capture rejects a provider envelope or a correction grant", () => {
  const provider = {
    ...capture(),
    provider: { tool: "forbidden" },
  };
  assertThrows(
    () => validateStaticMechanicalEvaluationCloseoutCapture(provider),
    TypeError,
    "unsupported field provider",
  );
  const grants = structuredClone(capture());
  (grants.limits as { rejectionGrants: string }).rejectionGrants = "correction";
  assertThrows(
    () => validateStaticMechanicalEvaluationCloseoutCapture(grants),
    TypeError,
    "rejectionGrants",
  );
});
