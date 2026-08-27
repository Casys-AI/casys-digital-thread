import { assertEquals, assertThrows } from "@std/assert";
import type { CalculixIsolatedExecutionProfile } from "../../../ports/out/fea/isolated-v3/calculix-isolated-execution-profile.ts";
import { EngineeringProjectCommandError } from "../../project/engineering-project-command-service.ts";
import type { CalculixIsolatedExecutionEvidence } from "../../../../domain/fea/isolated-v3/calculix-isolated-execution.ts";
import type { SealedStaticProofCapture } from "../../../../domain/fea/isolated-v3/sealed-static-proof-capture.ts";
import type { StaticProofPreparedEvidenceIdentity } from "../../../../domain/fea/isolated-v3/static-proof-identity.ts";
import type { ResolvedCalculixIsolatedStaticStructuralAction } from "../../../../domain/compile/rop/resolved-operation-plan-v2.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import {
  assertCompletedIsolatedStaticProofProjectBinding,
  assertCompletedIsolatedStaticProofProjectReference,
  assertCompletedIsolatedStaticProofSnapshot,
  assertIsolatedCanonicalStepBytes,
  assertIsolatedStaticProofAttemptMatches,
  assertIsolatedStaticProofCrossAttests,
  assertIsolatedStaticProofEvidenceMatches,
  assertIsolatedStaticProofProfileBinding,
  exactIsolatedStaticProofEvidenceRefs,
  isolatedStaticProofLocalOperation,
  isolatedStaticProofPreparedIdentity,
  requireCompletedIsolatedStaticProofRunWal,
  requireCompletedIsolatedStaticProofWal,
  requireIsolatedStaticStructuralAction,
} from "./completed-replay-verification.ts";

const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "project:desk-lamp-dl04";
const RUN_ID = "run-fea-3";
const EXECUTION_RUN_ID = "calculix-isolated-abc";
const REQUEST_ID = "request:calculix-local-1";
const PROOF_CASE = "desk-lamp-dl04-arm-cantilever";

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

const PROOF_FP = fp("1".repeat(64));
const GEOM_FP = fp("2".repeat(64));
const STEP_FP = fp("3".repeat(64));
const REQ_FP = fp("4".repeat(64));
const BUNDLE_FP = fp("5".repeat(64));
const PLAN_FP = fp("6".repeat(64));
const PROFILE_FP = fp("7".repeat(64));

function prepared(): StaticProofPreparedEvidenceIdentity {
  return isolatedStaticProofPreparedIdentity({
    projectId: PROJECT_ID,
    agentRunId: RUN_ID,
    executionRunId: EXECUTION_RUN_ID,
    bundle: {
      fingerprint: BUNDLE_FP,
      manifest: { proofFingerprint: PROOF_FP },
    },
    profileFingerprint: PROFILE_FP,
    planFingerprint: PLAN_FP,
    requestId: REQUEST_ID,
    stepByteCount: 128,
    stepSha256: STEP_FP.digest,
  });
}

function action(
  overrides: Partial<ResolvedCalculixIsolatedStaticStructuralAction> = {},
): ResolvedCalculixIsolatedStaticStructuralAction {
  return {
    kind: "isolated-static-structural-analysis",
    executor: {
      id: "casys-local-microsandbox",
      contract: { id: "calculix-static-proof-v1", version: "1.0.0" },
      profileFingerprint: PROFILE_FP,
    },
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
    requestId: REQUEST_ID,
    input: {
      proofCase: { id: PROOF_CASE, fingerprint: PROOF_FP },
    },
    ...overrides,
  } as ResolvedCalculixIsolatedStaticStructuralAction;
}

function profile(
  digest = PROFILE_FP.digest,
): CalculixIsolatedExecutionProfile {
  return {
    profileFingerprint: fp(digest),
    lowering: { id: "calculix.static.abaqus-deck", version: "1.0" },
  } as CalculixIsolatedExecutionProfile;
}

function proofCapture(): SealedStaticProofCapture {
  return {
    trustedRunId: "run-seal",
    case: {
      id: PROOF_CASE,
      project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
      expectedCadArtifact: { sha256: STEP_FP.digest, bytes: 128 },
    },
    geometry: { id: "geometry-a", fingerprint: GEOM_FP, producerRunId: "run-geom" },
    requirements: { id: "req-a", fingerprint: REQ_FP, producerRunId: "run-req" },
    step: {
      id: "step-a",
      fingerprint: STEP_FP,
      producerRunId: "run-geom",
      bytes: 128,
    },
  } as SealedStaticProofCapture;
}

function artifact(
  id: string,
  fingerprint: ContentFingerprint,
  producerRunId: string,
  extra: Partial<ThreadArtifact> = {},
): ThreadArtifact {
  return {
    id,
    fingerprint,
    producer: {
      serverId: extra.producer?.serverId ?? "digital-thread",
      tool: extra.producer?.tool ?? "verify.seal-proof-case@1",
      runId: producerRunId,
    },
    inputArtifactIds: extra.inputArtifactIds ?? [],
    ...extra,
  } as ThreadArtifact;
}

function evidence(
  overrides: Record<string, unknown> = {},
): CalculixIsolatedExecutionEvidence {
  const expected = prepared();
  return {
    projectId: expected.projectId,
    agentRunId: expected.agentRunId,
    executionRunId: expected.executionRunId,
    bundleFingerprint: expected.bundleFingerprint,
    proofFingerprint: expected.proofFingerprint,
    executionProfileFingerprint: expected.executionProfileFingerprint,
    authority: { resolvedOperationPlanFingerprint: expected.planFingerprint },
    result: {
      requestId: expected.requestId,
      inputArtifact: {
        byteCount: expected.stepByteCount,
        sha256: expected.stepSha256,
      },
    },
    receipt: {
      runId: expected.executionRunId,
      sourceSha256: expected.bundleFingerprint.digest,
    },
    ...overrides,
  } as unknown as CalculixIsolatedExecutionEvidence;
}

function localArtifacts(runId: string) {
  return [
    ...Array.from({ length: 9 }, (_, index) => ({
      id: `out-${index}`,
      name: `Local CalculiX role.${index}`,
      producer: {
        serverId: "digital-thread",
        tool: "verify.run-fea-static-proof@3",
        runId,
      },
    })),
    {
      id: "evidence-a",
      name: "Isolated local CalculiX execution evidence",
      producer: {
        serverId: "digital-thread",
        tool: "verify.run-fea-static-proof@3",
        runId,
      },
    },
    {
      id: "eval-a",
      name: "SysON evaluation of isolated CalculiX evidence",
      producer: {
        serverId: "digital-thread",
        tool: "verify.run-fea-static-proof@3",
        runId,
      },
    },
  ];
}

function snapshot(runId = RUN_ID): ThreadSnapshot {
  return {
    id: "snap-static-proof",
    revision: 7,
    subject: { id: SUBJECT_ID },
    artifacts: localArtifacts(runId),
  } as unknown as ThreadSnapshot;
}

function snapshotRef(value: ThreadSnapshot) {
  return {
    snapshotId: value.id,
    revision: value.revision,
    subjectId: value.subject.id,
  };
}

function evidenceRefs(value: ThreadSnapshot, runId = RUN_ID) {
  return exactIsolatedStaticProofEvidenceRefs(value, runId);
}

function projectFor(value: ThreadSnapshot): EngineeringProjectSnapshot {
  const refs = evidenceRefs(value);
  return {
    project: { id: PROJECT_ID },
    threadSnapshots: [snapshotRef(value)],
    agentRuns: [{
      id: RUN_ID,
      workItemId: "work-fea",
      status: "completed",
      resultSnapshot: snapshotRef(value),
      evidenceRefs: refs,
    }],
    workItems: [{
      id: "work-fea",
      status: "completed",
      evidenceRefs: refs,
    }],
  } as unknown as EngineeringProjectSnapshot;
}

function attempt(evidenceSha256?: string) {
  const expected = prepared();
  const base = {
    projectId: expected.projectId,
    runId: expected.agentRunId,
    planSha256: expected.planFingerprint.digest,
    executionRunId: expected.executionRunId,
    bundleSha256: expected.bundleFingerprint.digest,
    profileSha256: expected.executionProfileFingerprint.digest,
    status: "prepared" as const,
  };
  return evidenceSha256 === undefined
    ? base
    : { ...base, status: "completed" as const, evidenceSha256 };
}

function invalidTransition(
  fn: () => unknown,
  message: string,
): EngineeringProjectCommandError {
  const error = assertThrows(fn, EngineeringProjectCommandError, message);
  assertEquals(error.code, "invalid_transition");
  return error;
}

Deno.test("isolated static proof identity accepts exact projected proof, STEP, profile, evidence and WAL", () => {
  const expected = prepared();
  requireIsolatedStaticStructuralAction(action());
  assertIsolatedStaticProofProfileBinding(action(), profile());
  assertIsolatedStaticProofCrossAttests({
    projectId: PROJECT_ID,
    subjectId: SUBJECT_ID,
    action: action(),
    proof: proofCapture(),
    proofArtifact: artifact("fea-proof-a", PROOF_FP, "run-seal", {
      inputArtifactIds: ["geometry-a", "req-a", "step-a"],
    }),
    step: artifact("step-a", STEP_FP, "run-geom"),
    geometry: artifact("geometry-a", GEOM_FP, "run-geom"),
    requirements: artifact("req-a", REQ_FP, "run-req"),
  });
  assertIsolatedCanonicalStepBytes({
    stepByteLength: 128,
    sourceByteCount: 128,
    proofStepBytes: 128,
    stepSha256: STEP_FP.digest,
    geometryDigest: STEP_FP.digest,
  });
  assertIsolatedStaticProofEvidenceMatches(evidence(), expected);
  assertIsolatedStaticProofAttemptMatches(attempt("e".repeat(64)), expected);
  assertEquals(
    isolatedStaticProofLocalOperation(RUN_ID),
    {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: RUN_ID,
    },
  );
});

Deno.test("isolated static proof identity refuses a foreign action, profile, STEP or proof attestation", () => {
  invalidTransition(
    () =>
      requireIsolatedStaticStructuralAction(
        {
          kind: "recorded-static-structural-analysis",
        } as unknown as Parameters<typeof requireIsolatedStaticStructuralAction>[0],
      ),
    "The resolved plan action is not the isolated local CalculiX action.",
  );
  invalidTransition(
    () => assertIsolatedStaticProofProfileBinding(action(), profile("f".repeat(64))),
    "does not bind the exact active local profile",
  );
  invalidTransition(
    () =>
      assertIsolatedCanonicalStepBytes({
        stepByteLength: 64,
        sourceByteCount: 128,
        proofStepBytes: 128,
        stepSha256: STEP_FP.digest,
        geometryDigest: STEP_FP.digest,
      }),
    "Canonical STEP bytes do not match",
  );
  invalidTransition(
    () =>
      assertIsolatedStaticProofCrossAttests({
        projectId: "other-project",
        subjectId: SUBJECT_ID,
        action: action(),
        proof: proofCapture(),
        proofArtifact: artifact("fea-proof-a", PROOF_FP, "run-seal", {
          inputArtifactIds: ["geometry-a", "req-a", "step-a"],
        }),
        step: artifact("step-a", STEP_FP, "run-geom"),
        geometry: artifact("geometry-a", GEOM_FP, "run-geom"),
        requirements: artifact("req-a", REQ_FP, "run-req"),
      }),
    "do not cross-attest",
  );
});

Deno.test("isolated static proof identity refuses evidence or WAL that dropped the durable evidence digest", () => {
  const expected = prepared();
  invalidTransition(
    () =>
      assertIsolatedStaticProofEvidenceMatches(
        evidence({
          agentRunId: "other-run",
        }),
        expected,
      ),
    "does not cross-bind the exact plan",
  );
  invalidTransition(
    () => assertIsolatedStaticProofAttemptMatches(attempt(), expected),
    "does not bind the exact completed plan",
  );
});

Deno.test("completed isolated static proof replay binds the rematerialized snapshot, unique project reference and eleven evidence refs", () => {
  const rematerialized = snapshot();
  const persisted = snapshot();
  const completed = assertCompletedIsolatedStaticProofSnapshot({
    persisted,
    rematerialized,
    attemptSnapshot: snapshotRef(rematerialized),
    runId: RUN_ID,
  });
  assertEquals(completed.id, persisted.id);
  const project = projectFor(persisted);
  assertCompletedIsolatedStaticProofProjectReference(project, persisted);
  assertCompletedIsolatedStaticProofProjectBinding(project, RUN_ID, persisted);
  assertEquals(evidenceRefs(persisted).length, 11);
  const wal = requireCompletedIsolatedStaticProofRunWal({
    ...attempt("e".repeat(64)),
    status: "completed" as const,
    snapshot: snapshotRef(persisted),
  });
  assertEquals(wal.status, "completed");
  assertEquals(
    requireCompletedIsolatedStaticProofWal(wal).snapshot.snapshotId,
    persisted.id,
  );
});

Deno.test("completed isolated static proof replay refuses WAL, snapshot, project-reference or evidence-ref drift", () => {
  const rematerialized = snapshot();
  invalidTransition(
    () => requireCompletedIsolatedStaticProofRunWal(undefined),
    "no exact completed product WAL",
  );
  invalidTransition(
    () =>
      requireCompletedIsolatedStaticProofWal({
        ...attempt("e".repeat(64)),
        status: "evaluation-captured",
      }),
    "The isolated CalculiX product WAL is not complete.",
  );
  invalidTransition(
    () =>
      assertCompletedIsolatedStaticProofSnapshot({
        persisted: snapshot(),
        rematerialized,
        attemptSnapshot: { ...snapshotRef(rematerialized), revision: 1 },
        runId: RUN_ID,
      }),
    "The completed isolated CalculiX ThreadSnapshot is absent or divergent.",
  );
  const project = projectFor(rematerialized);
  invalidTransition(
    () =>
      assertCompletedIsolatedStaticProofProjectReference({
        ...project,
        threadSnapshots: [],
      } as EngineeringProjectSnapshot, rematerialized),
    "does not retain the exact isolated CalculiX snapshot reference",
  );
  invalidTransition(
    () =>
      assertCompletedIsolatedStaticProofProjectBinding(
        {
          ...project,
          agentRuns: project.agentRuns.map((run) =>
            run.id === RUN_ID
              ? {
                ...run,
                resultSnapshot: {
                  ...snapshotRef(rematerialized),
                  snapshotId: "snap-foreign",
                },
              }
              : run
          ),
        } as EngineeringProjectSnapshot,
        RUN_ID,
        rematerialized,
      ),
    "do not bind the exact isolated CalculiX snapshot and evidence refs",
  );
});

Deno.test("isolated static proof replay verification never names a runner, WAL mutation, CAS, clock or SysON client", async () => {
  const source = await Deno.readTextFile(
    new URL("./completed-replay-verification.ts", import.meta.url),
  );
  assertEquals(source.includes("IsolatedCodeRunner"), false);
  assertEquals(source.includes("markEvaluationDispatched"), false);
  assertEquals(source.includes("executeIsolated"), false);
  assertEquals(source.includes("snapshots.save"), false);
  assertEquals(source.includes("Date.now"), false);
  assertEquals(source.includes("new Date"), false);
  assertEquals(source.includes("callCapturedFeaConstraintOracle"), false);
  assertEquals(source.includes("McpToolClient"), false);
  assertEquals(source.includes("syson.callTool"), false);
});
