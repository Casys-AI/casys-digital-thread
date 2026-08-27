import { assertEquals, assertRejects } from "@std/assert";
import type { CalculixIsolatedExecutionAttemptIdentity } from "../../../application/ports/out/fea/isolated-v3/calculix-isolated-execution-attempt-store.ts";
import type { IsolatedCodeExecutionLimits } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createIsolatedCodeExecutionRejectionDiagnostic,
  createIsolatedOutputProducerGenerationAdvance,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { FixedCalculixIsolatedExecutionProfileCatalog } from "./fixed-calculix-isolated-execution-profile.ts";
import {
  CalculixIsolatedExecutionAttemptIntegrityError,
  FileCalculixIsolatedExecutionAttemptStore,
} from "./file-calculix-isolated-execution-attempt-store.ts";

const AT = "2026-08-14T04:00:00.000Z";

Deno.test("isolated CalculiX WAL persists one dispatch and one proven one-shot recovery", async () => {
  await withStore(async (store, directory) => {
    const identity = await attemptIdentity();
    const prepared = await store.prepare(identity);
    assertEquals(prepared.phase, "prepared");
    const dispatching = await store.markDispatching({
      ...key(prepared),
      dispatchedAt: AT,
    });
    assertEquals(dispatching.phase, "dispatching");
    assertEquals(
      dispatching.phase === "dispatching" && dispatching.dispatch.producerGeneration,
      0,
    );
    const restarted = new FileCalculixIsolatedExecutionAttemptStore(directory);
    const recovered = await restarted.read(identity.projectId, identity.agentRunId);
    assertEquals(recovered, dispatching);
    if (!recovered) throw new Error("missing WAL");

    const authorized = await restarted.authorizeRedispatch({
      ...key(recovered),
      recoveryDestruction: {
        status: "proven",
        runId: identity.executionRunId,
        proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      },
      generationAdvance: await createIsolatedOutputProducerGenerationAdvance({
        runId: identity.executionRunId,
        closedGeneration: 0,
        nextGeneration: 1,
      }),
    });
    assertEquals(
      authorized.phase === "dispatching" && authorized.dispatch.dispatchCount,
      2,
    );
    assertEquals(
      authorized.phase === "dispatching" && authorized.dispatch.producerGeneration,
      1,
    );
    const consumed = await restarted.consumeRedispatch(key(authorized));
    assertEquals(consumed.outcome, "consumed-now");
    const replay = await restarted.consumeRedispatch(key(authorized));
    assertEquals(replay.outcome, "already-consumed");
  });
});

Deno.test("isolated CalculiX WAL persists a terminal execution rejection and refuses redispatch", async () => {
  await withStore(async (store, directory) => {
    const identity = await attemptIdentity();
    const prepared = await store.prepare(identity);
    const dispatching = await store.markDispatching({
      ...key(prepared),
      dispatchedAt: AT,
    });
    const diagnostic = await rejectionDiagnostic();
    const destruction = {
      status: "proven" as const,
      runId: identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const rejected = await store.markExecutionRejected({
      ...key(dispatching),
      diagnostic,
      destruction,
    });
    assertEquals(rejected.phase, "execution-rejected");
    const restarted = new FileCalculixIsolatedExecutionAttemptStore(directory);
    const recovered = await restarted.read(identity.projectId, identity.agentRunId);
    assertEquals(recovered, rejected);
    const replayed = await restarted.markExecutionRejected({
      ...key(dispatching),
      diagnostic,
      destruction,
    });
    assertEquals(replayed, rejected);
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        restarted.authorizeRedispatch({
          ...key(dispatching),
          recoveryDestruction: {
            status: "proven",
            runId: identity.executionRunId,
            proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
          },
          generationAdvance,
        }),
      CalculixIsolatedExecutionAttemptIntegrityError,
      "Redispatch is possible only while dispatching",
    );
  });
});

Deno.test("isolated CalculiX WAL persists a terminal output-validation rejection and refuses redispatch", async () => {
  await withStore(async (store, directory) => {
    const identity = await attemptIdentity();
    const prepared = await store.prepare(identity);
    const dispatching = await store.markDispatching({
      ...key(prepared),
      dispatchedAt: AT,
    });
    const observation = {
      role: "job.dat",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const rejected = await store.markOutputValidationRejected({
      ...key(dispatching),
      observation,
      destruction,
    });
    assertEquals(rejected.phase, "output-validation-rejected");
    assertEquals(
      rejected.phase === "output-validation-rejected" &&
        rejected.outputValidationRejection.observation,
      observation,
    );
    const restarted = new FileCalculixIsolatedExecutionAttemptStore(directory);
    const recovered = await restarted.read(identity.projectId, identity.agentRunId);
    assertEquals(recovered, rejected);
    const replayed = await restarted.markOutputValidationRejected({
      ...key(dispatching),
      observation,
      destruction,
    });
    assertEquals(replayed, rejected);
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        restarted.authorizeRedispatch({
          ...key(dispatching),
          recoveryDestruction: {
            status: "proven",
            runId: identity.executionRunId,
            proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
          },
          generationAdvance,
        }),
      CalculixIsolatedExecutionAttemptIntegrityError,
      "Redispatch is possible only while dispatching",
    );
  });
});

Deno.test("isolated CalculiX WAL rejects a divergent proof or unproven cleanup", async () => {
  await withStore(async (store) => {
    const identity = await attemptIdentity();
    const prepared = await store.prepare(identity);
    await assertRejects(
      () =>
        store.prepare({
          ...identity,
          proofFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        }),
      CalculixIsolatedExecutionAttemptIntegrityError,
      "attempt key diverges",
    );
    const dispatching = await store.markDispatching({
      ...key(prepared),
      dispatchedAt: AT,
    });
    const generationAdvance = await createIsolatedOutputProducerGenerationAdvance({
      runId: identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        store.authorizeRedispatch({
          ...key(dispatching),
          recoveryDestruction: {
            status: "acknowledged-unattested" as "proven",
            runId: identity.executionRunId,
            proofFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
          },
          generationAdvance,
        }),
      TypeError,
      '$destruction.status must equal "proven"',
    );
  });
});

async function rejectionDiagnostic() {
  return await createIsolatedCodeExecutionRejectionDiagnostic({
    termination: { kind: "exited", exitCode: 1, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: {
        bytes: new TextEncoder().encode("MeshingError: empty NSET\n"),
        truncated: false,
      },
    },
    maximumLogBytes: { stdout: 1_024, stderr: 1_024 },
  });
}

async function attemptIdentity(): Promise<CalculixIsolatedExecutionAttemptIdentity> {
  const limits: IsolatedCodeExecutionLimits = {
    maxWallTimeMs: 180_000,
    maxCpuTimeMs: 160_000,
    maxMemoryBytes: 2 * 1_073_741_824,
    maxProcesses: 16,
    maxStdoutBytes: 1_048_576,
    maxStderrBytes: 1_048_576,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 256 * 1_048_576,
  };
  const digest = "a".repeat(64);
  const profile = await new FixedCalculixIsolatedExecutionProfileCatalog({
    imageReference: `ghcr.io/casys-ai/calculix-static@sha256:${digest}`,
    wrapperSha256: "b".repeat(64),
    policy: {
      id: "calculix-microsandbox-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits,
  }).initial();
  return {
    projectId: "project:calculix-local",
    agentRunId: "run:calculix-local",
    executionRunId: `calculix-local-${"1".repeat(64)}`,
    requestId: "request:calculix-local",
    startedAt: AT,
    resolvedOperationPlanFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
    proofFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
    step: { byteCount: 128, sha256: "4".repeat(64) },
    bundleFingerprint: { algorithm: "sha256", digest: "5".repeat(64) },
    profile,
  };
}

function key(value: {
  projectId: string;
  agentRunId: string;
  executionRunId: string;
  attemptFingerprint: { algorithm: "sha256"; digest: string };
}) {
  return {
    projectId: value.projectId,
    agentRunId: value.agentRunId,
    executionRunId: value.executionRunId,
    attemptFingerprint: value.attemptFingerprint,
  };
}

async function withStore(
  body: (
    store: FileCalculixIsolatedExecutionAttemptStore,
    directory: string,
  ) => Promise<void>,
) {
  const directory = await Deno.makeTempDir();
  try {
    await body(new FileCalculixIsolatedExecutionAttemptStore(directory), directory);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}
