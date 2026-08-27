import { assertEquals, assertThrows } from "@std/assert";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
  encodeStaticMechanicalEvaluationCloseoutAdmission,
  parseStaticMechanicalEvaluationCloseoutParameters,
  validateStaticMechanicalEvaluationCloseoutAdmission,
} from "./static-mechanical-evaluation-closeout-proposal.ts";

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const DIGEST_C = "c".repeat(64);
const DIGEST_D = "d".repeat(64);
const DIGEST_E = "e".repeat(64);

function admission(
  consequence: "accept" | "reject",
  status: "pass" | "fail" | "unresolved" | "error" = "pass",
) {
  return {
    schemaVersion: "evaluation-closeout-admission/1.0" as const,
    family: "static-mechanical" as const,
    consequence,
    rejectionDisposition: consequence === "accept" || status === "pass"
      ? "none" as const
      : "mechanical-review-required" as const,
    projectId: "project-static",
    subjectId: "subject-static",
    basis: {
      snapshotId: "thread-static-r4",
      revision: 4,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST_A },
    },
    canonicalStep: identity("canonical-step", DIGEST_B, "run-cad"),
    sealedProof: identity("sealed-proof", DIGEST_C, "run-proof"),
    executionEvidence: identity("execution-evidence", DIGEST_D, "run-fea"),
    evaluationCapture: identity("evaluation-capture", DIGEST_E, "run-fea"),
    criteria: [{
      proofCriterionId: "criterion-displacement",
      evaluationId: "evaluation-displacement",
      status,
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
}

function identity(id: string, digest: string, producerRunId: string) {
  return {
    id,
    fingerprint: { algorithm: "sha256" as const, digest },
    producerRunId,
  };
}

Deno.test(
  "static-mechanical closeout grammar is closed, ordered, and carries sealed proof limitations",
  () => {
    const value = validateStaticMechanicalEvaluationCloseoutAdmission(
      admission("accept"),
    );
    const parameters = encodeStaticMechanicalEvaluationCloseoutAdmission(value);
    assertEquals(
      `${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version}`,
      "decide.accept-evaluation-closeout@1",
    );
    assertEquals(
      `${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.id}@${DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION.version}`,
      "decide.reject-evaluation-closeout@1",
    );
    assertEquals(
      parameters.map((parameter) => parameter.key).slice(-6),
      [
        "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.0",
        "evaluation.closeout.proofLimitations.cadEngineeringBoundary.limitations.1",
        "evaluation.closeout.criteria.0.proofCriterionId",
        "evaluation.closeout.criteria.0.evaluationId",
        "evaluation.closeout.criteria.0.status",
        "evaluation.closeout.criteria.0.evidenceArtifactId",
      ],
    );
    assertEquals(
      parameters.some((parameter) =>
        parameter.key.includes("provider") || parameter.key.includes("tool") ||
        parameter.key.includes("args") || parameter.key.includes("uri") ||
        parameter.key.includes("threshold") || parameter.key.includes("result") ||
        parameter.key.endsWith(".limit")
      ),
      false,
    );
    assertEquals(
      parseStaticMechanicalEvaluationCloseoutParameters(
        parameters,
        DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
      ),
      value,
    );
  },
);

Deno.test("static-mechanical accept is rejected unless every declared L4 criterion is literal pass", () => {
  assertThrows(
    () =>
      validateStaticMechanicalEvaluationCloseoutAdmission(admission("accept", "fail")),
    TypeError,
    "literal pass",
  );
  const reject = validateStaticMechanicalEvaluationCloseoutAdmission(
    admission("reject", "unresolved"),
  );
  assertEquals(reject.rejectionDisposition, "mechanical-review-required");
  assertEquals(
    parseStaticMechanicalEvaluationCloseoutParameters(
      encodeStaticMechanicalEvaluationCloseoutAdmission(reject),
      DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
    ).consequence,
    "reject",
  );
});

Deno.test("static-mechanical closeout grammar rejects caller additions and malformed proof limits", () => {
  const parameters = [
    ...encodeStaticMechanicalEvaluationCloseoutAdmission(admission("accept")),
    { key: "evaluation.closeout.criteria.0.threshold", label: "Threshold", value: 1 },
  ];
  assertThrows(
    () =>
      parseStaticMechanicalEvaluationCloseoutParameters(
        parameters,
        DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
      ),
    TypeError,
    "exactly",
  );
  const altered = structuredClone(admission("reject"));
  altered.proofLimitations.cadEngineeringBoundary.limitations[1] = "boundary-a";
  assertThrows(
    () => validateStaticMechanicalEvaluationCloseoutAdmission(altered),
    TypeError,
    "must not duplicate",
  );
});
