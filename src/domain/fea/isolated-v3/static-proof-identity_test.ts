import { assertEquals, assertThrows } from "@std/assert";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  assertCanonicalStepBytes,
  assertStaticProofAttemptMatches,
  assertStaticProofCrossAttests,
  assertStaticProofEvidenceMatches,
  type StaticProofAuthorityIdentity,
  type StaticProofCaseIdentity,
  type StaticProofDocumentIdentity,
  type StaticProofPreparedEvidenceIdentity,
} from "./static-proof-identity.ts";

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

const PROJECT = "desk-lamp-dl04";
const SUBJECT = "project:desk-lamp-dl04";
const PROOF_CASE = "desk-lamp-dl04-arm-cantilever";
const PROOF_FP = fp("1".repeat(64));
const GEOM_FP = fp("2".repeat(64));
const STEP_FP = fp("3".repeat(64));
const REQ_FP = fp("4".repeat(64));
const BUNDLE_FP = fp("5".repeat(64));
const PLAN_FP = fp("6".repeat(64));
const PROFILE_FP = fp("7".repeat(64));

function authority(): StaticProofAuthorityIdentity {
  return {
    projectId: PROJECT,
    subjectId: SUBJECT,
    actionProofCaseId: PROOF_CASE,
    actionProofCaseFingerprint: PROOF_FP,
    expectedProofProducerServerId: "digital-thread",
    expectedProofProducerTool: "verify.seal-proof-case@1",
  };
}

function proof(): StaticProofCaseIdentity {
  return {
    projectId: PROJECT,
    subjectId: SUBJECT,
    proofCaseId: PROOF_CASE,
    trustedRunId: "run-seal",
    expectedCadSha256: STEP_FP.digest,
    expectedCadBytes: 128,
    geometry: { id: "geometry-a", fingerprint: GEOM_FP, producerRunId: "run-geom" },
    requirements: { id: "req-a", fingerprint: REQ_FP, producerRunId: "run-req" },
    step: {
      id: "step-a",
      fingerprint: STEP_FP,
      producerRunId: "run-geom",
      bytes: 128,
    },
  };
}

function proofDocument(): StaticProofDocumentIdentity {
  return {
    id: "fea-proof-a",
    fingerprint: PROOF_FP,
    producerRunId: "run-seal",
    producerServerId: "digital-thread",
    producerTool: "verify.seal-proof-case@1",
    inputArtifactIds: ["geometry-a", "req-a", "step-a"],
  };
}

function prepared(): StaticProofPreparedEvidenceIdentity {
  return {
    projectId: PROJECT,
    agentRunId: "run-fea-3",
    executionRunId: "calculix-isolated-abc",
    bundleFingerprint: BUNDLE_FP,
    proofFingerprint: PROOF_FP,
    executionProfileFingerprint: PROFILE_FP,
    planFingerprint: PLAN_FP,
    requestId: "request:calculix-local-1",
    stepByteCount: 128,
    stepSha256: STEP_FP.digest,
  };
}

Deno.test("static proof identity accepts an exact projected cross-attestation", () => {
  assertStaticProofCrossAttests(
    authority(),
    proof(),
    proofDocument(),
    proof().step,
    proof().geometry,
    proof().requirements,
  );
});

Deno.test("static proof identity refuses a project mismatch", () => {
  assertThrows(
    () =>
      assertStaticProofCrossAttests(
        { ...authority(), projectId: "other-project" },
        proof(),
        proofDocument(),
        proof().step,
        proof().geometry,
        proof().requirements,
      ),
    TypeError,
    "do not cross-attest",
  );
});

Deno.test("static proof identity refuses a subject mismatch", () => {
  assertThrows(
    () =>
      assertStaticProofCrossAttests(
        { ...authority(), subjectId: "other-subject" },
        proof(),
        proofDocument(),
        proof().step,
        proof().geometry,
        proof().requirements,
      ),
    TypeError,
    "do not cross-attest",
  );
});

Deno.test("static proof identity refuses a proof fingerprint mismatch", () => {
  assertThrows(
    () =>
      assertStaticProofCrossAttests(
        authority(),
        proof(),
        { ...proofDocument(), fingerprint: fp("9".repeat(64)) },
        proof().step,
        proof().geometry,
        proof().requirements,
      ),
    TypeError,
    "do not cross-attest",
  );
});

Deno.test("static proof identity refuses a STEP producer-run mismatch", () => {
  assertThrows(
    () =>
      assertStaticProofCrossAttests(
        authority(),
        proof(),
        proofDocument(),
        { ...proof().step, producerRunId: "foreign-run" },
        proof().geometry,
        proof().requirements,
      ),
    TypeError,
    "do not cross-attest",
  );
});

Deno.test("static proof identity refuses a STEP byte-count mismatch", () => {
  assertThrows(
    () =>
      assertStaticProofCrossAttests(
        authority(),
        { ...proof(), expectedCadBytes: 64 },
        proofDocument(),
        proof().step,
        proof().geometry,
        proof().requirements,
      ),
    TypeError,
    "do not cross-attest",
  );
  assertThrows(
    () =>
      assertCanonicalStepBytes({
        stepByteLength: 64,
        sourceByteCount: 128,
        proofStepBytes: 128,
        stepSha256: STEP_FP.digest,
        geometryDigest: STEP_FP.digest,
      }),
    TypeError,
    "Canonical STEP bytes do not match",
  );
});

Deno.test("static proof identity refuses a run mismatch on evidence and WAL", () => {
  const expected = prepared();
  assertThrows(
    () =>
      assertStaticProofEvidenceMatches({
        ...expected,
        agentRunId: "other-run",
        receiptRunId: expected.executionRunId,
        receiptSourceSha256: expected.bundleFingerprint.digest,
        resultInputByteCount: expected.stepByteCount,
        resultInputSha256: expected.stepSha256,
      }, expected),
    TypeError,
    "does not cross-bind the exact plan",
  );
  assertThrows(
    () =>
      assertStaticProofAttemptMatches({
        projectId: expected.projectId,
        runId: "other-run",
        planSha256: expected.planFingerprint.digest,
        executionRunId: expected.executionRunId,
        bundleSha256: expected.bundleFingerprint.digest,
        profileSha256: expected.executionProfileFingerprint.digest,
        hasEvidenceSha256: true,
      }, expected),
    TypeError,
    "does not bind the exact completed plan",
  );
});

Deno.test("static proof identity accepts matching STEP bytes and evidence", () => {
  const expected = prepared();
  assertCanonicalStepBytes({
    stepByteLength: 128,
    sourceByteCount: 128,
    proofStepBytes: 128,
    stepSha256: STEP_FP.digest,
    geometryDigest: STEP_FP.digest,
  });
  assertStaticProofEvidenceMatches({
    ...expected,
    receiptRunId: expected.executionRunId,
    receiptSourceSha256: expected.bundleFingerprint.digest,
    resultInputByteCount: expected.stepByteCount,
    resultInputSha256: expected.stepSha256,
  }, expected);
  assertStaticProofAttemptMatches({
    projectId: expected.projectId,
    runId: expected.agentRunId,
    planSha256: expected.planFingerprint.digest,
    executionRunId: expected.executionRunId,
    bundleSha256: expected.bundleFingerprint.digest,
    profileSha256: expected.executionProfileFingerprint.digest,
    hasEvidenceSha256: true,
  }, expected);
  assertEquals(true, true);
});
