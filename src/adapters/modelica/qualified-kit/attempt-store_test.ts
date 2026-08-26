import { assertEquals, assertRejects } from "@std/assert";
import type { ModelicaIsolatedExecutionAttemptIdentity } from "../../../application/ports/out/modelica/isolated-execution-attempt-store.ts";
import { createIsolatedOutputProducerGenerationAdvance } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { FixedModelicaIsolatedExecutionProfileCatalog } from "./execution-profile.ts";
import {
  FileModelicaIsolatedExecutionAttemptStore,
  ModelicaIsolatedExecutionAttemptIntegrityError,
} from "./attempt-store.ts";

const DIGEST = "a".repeat(64);
const PREPARED_AT = "2026-08-14T00:00:00.000Z";

Deno.test("Modelica WAL persists the fenced generation-zero cleanup before one generation-one dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-modelica-isolated-wal-" });
  try {
    const store = new FileModelicaIsolatedExecutionAttemptStore(directory);
    const identity = await attemptIdentity();
    const drift = structuredClone(identity) as unknown as {
      bundle: { selection: { modelId: string } };
    };
    drift.bundle.selection.modelId = "agent-selected-model";
    await assertRejects(
      () =>
        store.prepare(drift as ModelicaIsolatedExecutionAttemptIdentity, PREPARED_AT),
      ModelicaIsolatedExecutionAttemptIntegrityError,
      "code-owned Modelica qualified kit",
    );
    const prepared = await store.prepare(identity, PREPARED_AT);
    assertEquals(await store.prepare(identity, PREPARED_AT), prepared);

    const dispatching = await store.markDispatching({
      ...keyFor(prepared),
      dispatchedAt: PREPARED_AT,
    });
    assertEquals(dispatching.phase, "dispatching");
    if (dispatching.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(dispatching.dispatch, {
      dispatchCount: 1,
      producerGeneration: 0,
      dispatchedAt: PREPARED_AT,
    });

    assertEquals(
      await store.markDispatching({
        ...keyFor(dispatching),
        dispatchedAt: PREPARED_AT,
      }),
      dispatching,
    );
    await assertRejects(
      () =>
        store.markDispatching({
          ...keyFor(dispatching),
          dispatchedAt: "2026-08-14T00:00:01.000Z",
        }),
      ModelicaIsolatedExecutionAttemptIntegrityError,
      "out of order",
    );
    const destruction = {
      status: "proven" as const,
      runId: identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "8".repeat(64) },
    };
    const cleaned = await store.markGenerationZeroCleaned({
      ...keyFor(dispatching),
      destruction,
    });
    assertEquals(cleaned.phase, "generation-zero-cleaned");
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    const redispatching = await store.markRedispatching({
      ...keyFor(cleaned),
      advance,
      dispatchedAt: PREPARED_AT,
    });
    assertEquals(redispatching.phase, "dispatching");
    if (redispatching.phase !== "dispatching") throw new Error("unreachable");
    assertEquals(redispatching.dispatch, {
      dispatchCount: 2,
      producerGeneration: 1,
      dispatchedAt: PREPARED_AT,
    });
    assertEquals(redispatching.generationRecovery, {
      generationZeroDestruction: destruction,
      advance,
    });
    assertEquals(
      await store.markRedispatching({
        ...keyFor(redispatching),
        advance,
        dispatchedAt: PREPARED_AT,
      }),
      redispatching,
    );
    await assertRejects(
      () =>
        store.markRedispatching({
          ...keyFor(redispatching),
          advance,
          dispatchedAt: "2026-08-14T00:00:01.000Z",
        }),
      ModelicaIsolatedExecutionAttemptIntegrityError,
      "divergent",
    );
    assertEquals(
      await store.read(identity.projectId, identity.agentRunId),
      redispatching,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualified Modelica WAL persists a terminal output-validation rejection and refuses redispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-modelica-isolated-wal-" });
  try {
    const store = new FileModelicaIsolatedExecutionAttemptStore(directory);
    const identity = await attemptIdentity();
    const prepared = await store.prepare(identity, PREPARED_AT);
    const key = keyFor(prepared);
    await store.markDispatching({ ...key, dispatchedAt: PREPARED_AT });
    const observation = {
      role: "evidence",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    const destruction = {
      status: "proven" as const,
      runId: identity.executionRunId,
      proofFingerprint: { algorithm: "sha256" as const, digest: "d".repeat(64) },
    };
    const rejected = await store.markOutputValidationRejected({
      ...key,
      observation,
      destruction,
    });
    assertEquals(rejected.phase, "output-validation-rejected");
    const restarted = new FileModelicaIsolatedExecutionAttemptStore(directory);
    assertEquals(
      await restarted.read(identity.projectId, identity.agentRunId),
      rejected,
    );
    assertEquals(
      await restarted.markOutputValidationRejected({
        ...key,
        observation,
        destruction,
      }),
      rejected,
    );
    const advance = await createIsolatedOutputProducerGenerationAdvance({
      runId: identity.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
    });
    await assertRejects(
      () =>
        restarted.markRedispatching({
          ...key,
          advance,
          dispatchedAt: PREPARED_AT,
        }),
      ModelicaIsolatedExecutionAttemptIntegrityError,
    );
    await assertRejects(
      () =>
        restarted.markOutputValidationRejected({
          ...key,
          observation: { ...observation, role: "job.dat" },
          destruction,
        }),
      ModelicaIsolatedExecutionAttemptIntegrityError,
      "role is not registered",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function attemptIdentity(): Promise<ModelicaIsolatedExecutionAttemptIdentity> {
  const profile = await new FixedModelicaIsolatedExecutionProfileCatalog({
    imageReference: `ghcr.io/casys/modelica-runtime@sha256:${DIGEST}`,
    policy: {
      id: "modelica-local-no-network",
      version: "1.0.0",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    limits: {
      maxWallTimeMs: 120_000,
      maxCpuTimeMs: 120_000,
      maxMemoryBytes: 2 * 1024 * 1024 * 1024,
      maxProcesses: 32,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      maxOutputFileBytes: 16 * 1_048_576,
      maxOutputTotalBytes: 17 * 1_048_576,
    },
    engine: { name: "OpenModelica", version: "1.23", mslVersion: "4.0" },
  }).initial();
  const bundleFingerprint = { algorithm: "sha256" as const, digest: "d".repeat(64) };
  const executionRunId = "modelica-execution-run-1";
  const bundle = {
    schemaVersion: "modelica-isolated-input-bundle/1.0" as const,
    qualification: {
      caseSha256: "1".repeat(64),
      manifestSha256: "2".repeat(64),
      sourceCaptureSha256: "3".repeat(64),
    },
    selection: {
      modelId: "linear-thermal-ramp-v1",
      modelVersion: "0.1.0",
      scenarioId: "linear-ramp-nominal",
    },
    invocation: {
      modelName: "LinearThermalRamp",
      startTimeS: 0,
      stopTimeS: 2,
      numberOfIntervals: 20,
      solver: "dassl",
      timeoutMs: 1_000,
      parameters: [
        {
          id: "heating_rate",
          modelicaName: "heatingRate",
          inputValue: 1,
          inputUnit: "K/s",
          modelicaValue: 1,
          modelicaUnit: "K/s",
        },
        {
          id: "initial_temperature",
          modelicaName: "initialTemperature",
          inputValue: 20,
          inputUnit: "degC",
          modelicaValue: 20,
          modelicaUnit: "degC",
        },
      ],
      metrics: [{ id: "temperature_final", unit: "degC", required: true }],
    },
    method: profile.method,
    inputs: [
      {
        role: "model" as const,
        basename: "model.mo" as const,
        mediaType: "text/x-modelica" as const,
        byteCount: 372,
        sha256: "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6",
      },
      {
        role: "scenario" as const,
        basename: "scenario.json" as const,
        mediaType: "application/json" as const,
        byteCount: 312,
        sha256: "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e",
      },
    ],
    byteCount: 1_024,
    fingerprint: bundleFingerprint,
  };
  return {
    projectId: "project-1",
    agentRunId: "agent-run-1",
    executionRunId,
    reviewedRunFingerprint: { algorithm: "sha256", digest: "6".repeat(64) },
    bundle,
    executionProfile: profile,
    runtimeQualification: {
      schemaVersion: "modelica-microsandbox-qualification-reference/1.0",
      uri: `casys://modelica-microsandbox-qualification/sha256/${"4".repeat(64)}`,
      fingerprint: { algorithm: "sha256", digest: "4".repeat(64) },
      executionProfileFingerprint: profile.profileFingerprint,
    },
    isolatedRequest: {
      schemaVersion: "isolated-code-execution-request/1.0",
      runId: executionRunId,
      producerGeneration: 0,
      profile: profile.executionProfile,
      sourceSha256: bundleFingerprint.digest,
      policy: profile.isolationPolicy,
      outputs: profile.outputManifest,
    },
  };
}

function keyFor(value: {
  readonly projectId: string;
  readonly agentRunId: string;
  readonly executionRunId: string;
  readonly attemptFingerprint: {
    readonly algorithm: "sha256";
    readonly digest: string;
  };
}) {
  return {
    projectId: value.projectId,
    agentRunId: value.agentRunId,
    executionRunId: value.executionRunId,
    attemptFingerprint: value.attemptFingerprint,
  };
}
