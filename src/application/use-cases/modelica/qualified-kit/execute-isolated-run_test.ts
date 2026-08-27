import { assertEquals, assertRejects } from "@std/assert";
import {
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  type PreparedModelicaIsolatedInputBundle,
  validateModelicaIsolatedInputBundle,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import {
  FixedModelicaIsolatedExecutionProfileCatalog,
} from "../../../../adapters/modelica/qualified-kit/execution-profile.ts";
import {
  MODELICA_QUALIFIED_MODEL_SOURCE,
  MODELICA_QUALIFIED_SCENARIO_SOURCE,
} from "../../../../adapters/modelica/qualified-kit/kit-v1/run.ts";
import { FileModelicaIsolatedExecutionAttemptStore } from "../../../../adapters/modelica/qualified-kit/attempt-store.ts";
import { FileModelicaIsolatedExecutionCaptureStore } from "../../../../adapters/modelica/qualified-kit/isolated-execution-evidence.ts";
import { FileEngineeringProjectRunLease } from "../../../../adapters/shared/stores/file-engineering-project-run-lease.ts";
import type { ModelicaIsolatedExecutionAttemptStore } from "../../../ports/out/modelica/isolated-execution-attempt-store.ts";
import type { ModelicaIsolatedExecutionCaptureStore } from "../../../ports/out/modelica/isolated-execution-evidence-store.ts";
import type {
  ModelicaIsolatedExecutionProfile,
  ModelicaIsolatedExecutionProfileCatalog,
} from "../../../ports/out/modelica/isolated-execution-profile.ts";
import type { IsolatedCodeExecutionRequest } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputProducerGenerationAdvance,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  validateIsolatedCodeExecutionRequest,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { IsolatedCodeOutputValidationRejectedError } from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  ExecuteIsolatedModelicaRun,
  IsolatedQualifiedModelicaOutputValidationRejectedError,
  ModelicaIsolatedExecutionOutcomeUnknownError,
  ModelicaIsolatedExecutionProfileUnqualifiedError,
} from "./execute-isolated-run.ts";

const DIGEST = "a".repeat(64);
const ENCODER = new TextEncoder();

Deno.test("pending Modelica qualification blocks before WAL, runner, recovery or CAS", async () => {
  const calls = {
    runner: 0,
    recovery: 0,
    publication: 0,
    wal: 0,
    capture: 0,
  };
  const execute = new ExecuteIsolatedModelicaRun({
    profiles: new FixedModelicaIsolatedExecutionProfileCatalog({
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
    }),
    qualifications: { reopenQualified: () => Promise.resolve(undefined) },
    lease: {
      withLease: () => Promise.reject(new Error("lease must remain inert")),
    },
    runner: {
      run() {
        calls.runner += 1;
        return Promise.reject(new Error("runner must remain inert"));
      },
    },
    recovery: {
      destroyByRunId() {
        calls.recovery += 1;
        return Promise.reject(new Error("recovery must remain inert"));
      },
      advanceProducerGeneration() {
        calls.recovery += 1;
        return Promise.reject(new Error("recovery must remain inert"));
      },
    },
    publications: {
      resolvePublicationByRunId() {
        calls.publication += 1;
        return Promise.reject(new Error("publication lookup must remain inert"));
      },
      readReceipt() {
        calls.publication += 1;
        return Promise.reject(new Error("receipt lookup must remain inert"));
      },
      readPublishedObject() {
        calls.publication += 1;
        return Promise.reject(new Error("object lookup must remain inert"));
      },
    },
    attempts: inertAttemptStore(calls),
    captures: inertCaptureStore(calls),
  });

  await assertRejects(
    () =>
      execute.execute({
        projectId: "project-1",
        agentRunId: "agent-run-1",
        reviewedRunFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
        bundle: {} as PreparedModelicaIsolatedInputBundle,
        preparedAt: "2026-08-14T00:00:00.000Z",
      }),
    ModelicaIsolatedExecutionProfileUnqualifiedError,
    "no exact-image OpenModelica smoke qualification",
  );
  assertEquals(calls, {
    runner: 0,
    recovery: 0,
    publication: 0,
    wal: 0,
    capture: 0,
  });
});

Deno.test("qualification-authority-backed Modelica execution closes WAL, CAS outputs and capture, then replays without dispatch", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-execution-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    const outputs = await outputFixture(bundle);
    let receipt: Awaited<ReturnType<typeof receiptFixture>> | undefined;
    let runs = 0;
    let objectReads = 0;
    const attemptsDirectory = `${directory}/attempts`;
    const captureDirectory = `${directory}/captures`;
    const publications = {
      resolvePublicationByRunId: () =>
        Promise.reject(new Error("published run must not require run-key recovery")),
      readReceipt: () => Promise.resolve(receipt),
      readPublishedObject: (_ref: unknown, member: { readonly role: string }) => {
        objectReads += 1;
        return Promise.resolve(outputs.get(member.role)?.slice());
      },
    };
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: async (request) => {
          runs += 1;
          receipt = await receiptFixture(request, profile, outputs);
          return receipt;
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("unreachable")),
        advanceProducerGeneration: () => Promise.reject(new Error("unreachable")),
      },
      publications,
      attempts: new FileModelicaIsolatedExecutionAttemptStore(attemptsDirectory),
      captures: new FileModelicaIsolatedExecutionCaptureStore(captureDirectory),
    });
    const input = {
      projectId: "project-1",
      agentRunId: "agent-run-1",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "9".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    const first = await execute.execute(input);
    assertEquals(first.evidence.metrics, [{
      id: "temperature_final",
      value: 22,
      unit: "degC",
    }]);
    assertEquals(first.capture.receipt.fingerprint, first.receipt.fingerprint);
    assertEquals(runs, 1);
    assertEquals(objectReads, 4);

    const replay = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: { run: () => Promise.reject(new Error("must not redispatch")) },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not recover")),
      },
      publications,
      attempts: new FileModelicaIsolatedExecutionAttemptStore(attemptsDirectory),
      captures: new FileModelicaIsolatedExecutionCaptureStore(captureDirectory),
    });
    const reopened = await replay.execute(input);
    assertEquals(reopened.capture, first.capture);
    assertEquals(reopened.captureReference, first.captureReference);
    assertEquals(reopened.evidence, first.evidence);
    assertEquals(runs, 1);
    assertEquals(objectReads, 6);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("run-scoped lease serializes concurrent Modelica replay and dispatches once", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-concurrent-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    const outputs = await outputFixture(bundle);
    let receipt: Awaited<ReturnType<typeof receiptFixture>> | undefined;
    let runs = 0;
    let releaseRun!: () => void;
    let announceRun!: () => void;
    const runReleased = new Promise<void>((resolve) => releaseRun = resolve);
    const runStarted = new Promise<void>((resolve) => announceRun = resolve);
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: async (request) => {
          runs += 1;
          announceRun();
          await runReleased;
          receipt = await receiptFixture(request, profile, outputs);
          return receipt;
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not recover")),
      },
      publications: {
        resolvePublicationByRunId: () =>
          Promise.reject(new Error("must not resolve an active run")),
        readReceipt: () => Promise.resolve(receipt),
        readPublishedObject: (_ref, member) =>
          Promise.resolve(outputs.get(member.role)?.slice()),
      },
      attempts: new FileModelicaIsolatedExecutionAttemptStore(
        `${directory}/attempts`,
      ),
      captures: new FileModelicaIsolatedExecutionCaptureStore(
        `${directory}/captures`,
      ),
    });
    const input = {
      projectId: "project-concurrent",
      agentRunId: "agent-run-concurrent",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "5".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    const first = execute.execute(input);
    await runStarted;
    const second = execute.execute(input);
    await Promise.resolve();
    assertEquals(runs, 1);
    releaseRun();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    assertEquals(runs, 1);
    assertEquals(secondResult.captureReference, firstResult.captureReference);
    assertEquals(secondResult.evidence, firstResult.evidence);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica recovery quarantines an unknown publication without redispatch", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-unknown-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    let runs = 0;
    let recoveries = 0;
    let resolutions = 0;
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: () => {
          runs += 1;
          return Promise.reject(new Error("dispatch acknowledgement lost"));
        },
      },
      recovery: {
        destroyByRunId: () => {
          recoveries += 1;
          return Promise.reject(new Error("must not destroy an unknown run"));
        },
        advanceProducerGeneration: () => {
          recoveries += 1;
          return Promise.reject(new Error("must not advance an unknown run"));
        },
      },
      publications: {
        resolvePublicationByRunId: (runId, producerGeneration) => {
          resolutions += 1;
          return Promise.resolve({
            status: "outcome-unknown" as const,
            runId,
            producerGeneration,
          });
        },
        readReceipt: () => Promise.reject(new Error("unreachable")),
        readPublishedObject: () => Promise.reject(new Error("unreachable")),
      },
      attempts: new FileModelicaIsolatedExecutionAttemptStore(
        `${directory}/attempts`,
      ),
      captures: inertCaptureStore({ capture: 0 }),
    });
    const input = {
      projectId: "project-unknown",
      agentRunId: "agent-run-unknown",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "7".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    await assertRejects(
      () => execute.execute(input),
      ModelicaIsolatedExecutionOutcomeUnknownError,
      "outcome remains unknown",
    );
    await assertRejects(
      () => execute.execute(input),
      ModelicaIsolatedExecutionOutcomeUnknownError,
      "outcome remains unknown",
    );
    assertEquals(runs, 1);
    assertEquals(recoveries, 0);
    assertEquals(resolutions, 2);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica recovery durably closes generation zero, advances once, and publishes generation one", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-unpublished-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    const outputs = await outputFixture(bundle);
    let receipt: Awaited<ReturnType<typeof receiptFixture>> | undefined;
    const runs: number[] = [];
    const cleanups: number[] = [];
    let advances = 0;
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: async (request) => {
          runs.push(request.producerGeneration);
          if (request.producerGeneration === 0) {
            throw new Error("generation-zero dispatch acknowledgement lost");
          }
          receipt = await receiptFixture(request, profile, outputs);
          return receipt;
        },
      },
      recovery: {
        destroyByRunId: (runId, producerGeneration) => {
          cleanups.push(producerGeneration);
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: {
              algorithm: "sha256" as const,
              digest: "8".repeat(64),
            },
          });
        },
        advanceProducerGeneration: (input) => {
          advances += 1;
          return createIsolatedOutputProducerGenerationAdvance(input);
        },
      },
      publications: {
        resolvePublicationByRunId: (runId, producerGeneration) =>
          Promise.resolve({
            status: "not-published" as const,
            runId,
            producerGeneration,
          }),
        readReceipt: () => Promise.resolve(receipt),
        readPublishedObject: (_ref, member) =>
          Promise.resolve(outputs.get(member.role)?.slice()),
      },
      attempts: new FileModelicaIsolatedExecutionAttemptStore(
        `${directory}/attempts`,
      ),
      captures: new FileModelicaIsolatedExecutionCaptureStore(
        `${directory}/captures`,
      ),
    });
    const input = {
      projectId: "project-unpublished",
      agentRunId: "agent-run-unpublished",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "6".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    const first = await execute.execute(input);
    assertEquals(first.receipt.producerGeneration, 1);
    assertEquals(first.capture.generationRecovery?.advance, {
      schemaVersion: "isolated-output-producer-generation-advance/1.0",
      runId: first.executionRunId,
      closedGeneration: 0,
      nextGeneration: 1,
      fingerprint: first.capture.generationRecovery?.advance.fingerprint,
    });
    assertEquals(runs, [0, 1]);
    assertEquals(cleanups, [0]);
    assertEquals(advances, 1);

    const replay = await execute.execute(input);
    assertEquals(replay.captureReference, first.captureReference);
    assertEquals(runs, [0, 1]);
    assertEquals(cleanups, [0]);
    assertEquals(advances, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Modelica generation one failure is cleaned but never creates generation two", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-generation-one-failure-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    const runs: number[] = [];
    const cleanups: number[] = [];
    let advances = 0;
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: (request) => {
          runs.push(request.producerGeneration);
          return Promise.reject(new Error("dispatch acknowledgement lost"));
        },
      },
      recovery: {
        destroyByRunId: (runId, producerGeneration) => {
          cleanups.push(producerGeneration);
          return Promise.resolve({
            status: "proven" as const,
            runId,
            proofFingerprint: {
              algorithm: "sha256" as const,
              digest: producerGeneration === 0 ? "8".repeat(64) : "9".repeat(64),
            },
          });
        },
        advanceProducerGeneration: (input) => {
          advances += 1;
          return createIsolatedOutputProducerGenerationAdvance(input);
        },
      },
      publications: {
        resolvePublicationByRunId: (runId, producerGeneration) =>
          Promise.resolve({
            status: "not-published" as const,
            runId,
            producerGeneration,
          }),
        readReceipt: () => Promise.reject(new Error("unreachable")),
        readPublishedObject: () => Promise.reject(new Error("unreachable")),
      },
      attempts: new FileModelicaIsolatedExecutionAttemptStore(
        `${directory}/attempts`,
      ),
      captures: inertCaptureStore({ capture: 0 }),
    });
    const input = {
      projectId: "project-generation-one-failure",
      agentRunId: "agent-run-generation-one-failure",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "b".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    await assertRejects(
      () => execute.execute(input),
      ModelicaIsolatedExecutionOutcomeUnknownError,
      "no third dispatch is allowed",
    );
    await assertRejects(
      () => execute.execute(input),
      ModelicaIsolatedExecutionOutcomeUnknownError,
      "no third dispatch is allowed",
    );
    assertEquals(runs, [0, 1]);
    assertEquals(cleanups, [0, 1, 1]);
    assertEquals(advances, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("qualified Modelica persists an output-validation rejection and replays it without redispatch", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-modelica-isolated-execution-",
  });
  try {
    const profile = await profileFixture();
    const bundle = await preparedBundle(profile);
    const observation = {
      role: "evidence",
      byteCount: 32,
      sha256: "7".repeat(64),
    };
    let runs = 0;
    const attempts = new FileModelicaIsolatedExecutionAttemptStore(
      `${directory}/attempts`,
    );
    const execute = new ExecuteIsolatedModelicaRun({
      profiles: catalog(profile),
      qualifications: qualificationAuthority(profile),
      lease: new FileEngineeringProjectRunLease(`${directory}/leases`),
      runner: {
        run: (request) => {
          runs += 1;
          return Promise.reject(
            new IsolatedCodeOutputValidationRejectedError(observation, {
              status: "proven",
              runId: request.runId,
              proofFingerprint: {
                algorithm: "sha256",
                digest: "c".repeat(64),
              },
            }),
          );
        },
      },
      recovery: {
        destroyByRunId: () => Promise.reject(new Error("must not recover")),
        advanceProducerGeneration: () => Promise.reject(new Error("must not advance")),
      },
      publications: {
        resolvePublicationByRunId: () => Promise.reject(new Error("must not resolve")),
        readReceipt: () => Promise.reject(new Error("must not read receipt")),
        readPublishedObject: () => Promise.reject(new Error("must not read object")),
      },
      attempts,
      captures: new FileModelicaIsolatedExecutionCaptureStore(`${directory}/captures`),
    });
    const input = {
      projectId: "project-1",
      agentRunId: "agent-run-1",
      reviewedRunFingerprint: { algorithm: "sha256" as const, digest: "9".repeat(64) },
      bundle,
      preparedAt: "2026-08-14T00:00:00.000Z",
    };
    const first = await assertRejects(
      () => execute.execute(input),
      IsolatedQualifiedModelicaOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(first.observation, observation);
    assertEquals(runs, 1);
    assertEquals(
      (await attempts.read(input.projectId, input.agentRunId))?.phase,
      "output-validation-rejected",
    );
    const replay = await assertRejects(
      () => execute.execute(input),
      IsolatedQualifiedModelicaOutputValidationRejectedError,
      "no redispatch occurs",
    );
    assertEquals(replay.observation, first.observation);
    assertEquals(runs, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function inertAttemptStore(
  calls: { wal: number },
): ModelicaIsolatedExecutionAttemptStore {
  const inert = (): Promise<never> => {
    calls.wal += 1;
    return Promise.reject(new Error("WAL must remain inert"));
  };
  return {
    read: inert,
    prepare: inert,
    markDispatching: inert,
    markGenerationZeroCleaned: inert,
    markRedispatching: inert,
    markOutputPublished: inert,
    markEvidencePersisted: inert,
    markCompleted: inert,
    markOutputValidationRejected: inert,
  };
}

function inertCaptureStore(
  calls: { capture: number },
): ModelicaIsolatedExecutionCaptureStore {
  const inert = (): Promise<never> => {
    calls.capture += 1;
    return Promise.reject(new Error("capture store must remain inert"));
  };
  return {
    save: inert,
    read: inert,
    uriFor() {
      calls.capture += 1;
      throw new Error("capture store must remain inert");
    },
  };
}

async function profileFixture(): Promise<ModelicaIsolatedExecutionProfile> {
  return await new FixedModelicaIsolatedExecutionProfileCatalog({
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
      maxProcesses: 64,
      maxStdoutBytes: 1_048_576,
      maxStderrBytes: 1_048_576,
      maxOutputFileBytes: 16 * 1_048_576,
      maxOutputTotalBytes: 17 * 1_048_576,
    },
    engine: { name: "OpenModelica", version: "1.27.0", mslVersion: "4.1.0" },
  }).initial();
}

function catalog(
  profile: ModelicaIsolatedExecutionProfile,
): ModelicaIsolatedExecutionProfileCatalog {
  return {
    initial: () => Promise.resolve(profile),
    resolve: () => Promise.resolve(profile),
  };
}

function qualificationAuthority(profile: ModelicaIsolatedExecutionProfile) {
  const fingerprint = { algorithm: "sha256" as const, digest: "4".repeat(64) };
  return {
    reopenQualified: () =>
      Promise.resolve({
        schemaVersion: "modelica-microsandbox-qualification-reference/1.0" as const,
        uri: `casys://modelica-microsandbox-qualification/sha256/${fingerprint.digest}`,
        fingerprint,
        executionProfileFingerprint: profile.profileFingerprint,
      }),
  };
}

async function preparedBundle(
  profile: ModelicaIsolatedExecutionProfile,
): Promise<PreparedModelicaIsolatedInputBundle> {
  const document = await validateModelicaIsolatedInputBundle({
    schemaVersion: "modelica-isolated-input-bundle/1.0",
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
        role: "model",
        basename: "model.mo",
        mediaType: "text/x-modelica",
        byteCount: ENCODER.encode(MODELICA_QUALIFIED_MODEL_SOURCE).byteLength,
        sha256: "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6",
        text: MODELICA_QUALIFIED_MODEL_SOURCE,
      },
      {
        role: "scenario",
        basename: "scenario.json",
        mediaType: "application/json",
        byteCount: ENCODER.encode(MODELICA_QUALIFIED_SCENARIO_SOURCE).byteLength,
        sha256: "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e",
        text: MODELICA_QUALIFIED_SCENARIO_SOURCE,
      },
    ],
  });
  const text = deterministicJson(document);
  return Object.freeze({
    document,
    text,
    bytes: ENCODER.encode(text),
    fingerprint: await sha256Fingerprint(document),
  });
}

async function outputFixture(
  bundle: PreparedModelicaIsolatedInputBundle,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const rows = Array.from(
    { length: 21 },
    (_, index) => `${index / 10},${20 + index / 10}`,
  );
  const resultBytes = ENCODER.encode(
    `time,temperatureC\n${rows.join("\n")}\n`,
  );
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/1.0",
    inputBundleSha256: bundle.fingerprint.digest,
    status: "succeeded",
    method: bundle.document.method,
    resolvedParameters: bundle.document.invocation.parameters.map((parameter) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      value: parameter.inputValue,
      unit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    metrics: [{ id: "temperature_final", value: 22, unit: "degC" }],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [],
  };
  return new Map([
    ["evidence", ENCODER.encode(deterministicJson(evidence))],
    ["result", resultBytes],
  ]);
}

async function receiptFixture(
  request: IsolatedCodeExecutionRequest,
  profile: ModelicaIsolatedExecutionProfile,
  outputBytes: ReadonlyMap<string, Uint8Array>,
) {
  const outputs = await Promise.all(
    MODELICA_ISOLATED_OUTPUT_MANIFEST.map(async (declaration) => {
      const bytes = outputBytes.get(declaration.role)!;
      const sha256 = await fingerprintResourceBytes(bytes);
      return {
        ...declaration,
        bytes,
        byteCount: bytes.byteLength,
        sha256,
        casUri: `casys://isolated-output/sha256/${sha256}`,
      };
    }),
  );
  const publicationFingerprint = await fingerprintIsolatedOutputPublicationManifest(
    request.runId,
    request.producerGeneration,
    outputs.map(({ bytes: _bytes, ...output }) => output),
  );
  const validatedRequest = await validateIsolatedCodeExecutionRequest(request);
  return await createIsolatedCodeExecutionReceipt({
    request: validatedRequest,
    runtime: profile.runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: new Uint8Array(), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
    outputs,
    destruction: {
      status: "proven",
      runId: request.runId,
      proofFingerprint: { algorithm: "sha256", digest: "8".repeat(64) },
    },
    publication: await createIsolatedOutputPublicationRef(
      request.runId,
      request.producerGeneration,
      publicationFingerprint,
    ),
  });
}
