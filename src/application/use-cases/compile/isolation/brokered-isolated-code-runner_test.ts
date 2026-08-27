import { assertEquals, assertThrows } from "@std/assert";
import type {
  EphemeralExecutionBackend,
  EphemeralExecutionBackendRequest,
  EphemeralExecutionDestruction,
  EphemeralExecutionReport,
  EphemeralOutputInventoryEntry,
} from "../../../ports/out/compile/isolation/ephemeral-execution-backend.ts";
import type {
  IsolatedOutputCasObject,
  IsolatedOutputCasSink,
  IsolatedOutputCasWriteReceipt,
  IsolatedOutputPublicationResolution,
  StagedIsolatedOutputBatch,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  createIsolatedOutputProducerGenerationAdvance,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  type IsolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  type IsolatedCodeRuntimeAttestation,
  type IsolatedOutputProducerGenerationAdvance,
  type IsolatedOutputProducerGenerationAdvanceInput,
  type IsolatedOutputPublicationRef,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  IsolatedCodeExecutionRejectedError,
  IsolatedCodeOutputValidationRejectedError,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import {
  BrokeredIsolatedCodeRunner,
  BrokeredIsolatedCodeRunnerError,
  type BrokeredIsolatedCodeRunnerErrorCode,
} from "./brokered-isolated-code-runner.ts";

const encoder = new TextEncoder();
const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

const PROFILE = { id: "build123d-source", version: "1.0" } as const;
const POLICY = {
  id: "kernel-isolated-no-network",
  version: "1.0",
  fingerprint: { algorithm: "sha256" as const, digest: B },
};
const RUNTIME: IsolatedCodeRuntimeAttestation = {
  isolationClass: "kernel-isolated",
  imageDigest: { algorithm: "sha256", digest: A },
  requestedLimits: {
    maxWallTimeMs: 1_000,
    maxCpuTimeMs: 500,
    maxMemoryBytes: 64_000_000,
    maxProcesses: 4,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    maxOutputFileBytes: 32,
    maxOutputTotalBytes: 48,
  },
  limitAssurance: {
    maxWallTimeMs: "backend-attested",
    maxCpuTimeMs: "unattested",
    maxMemoryBytes: "backend-attested",
    maxProcesses: "unattested",
    maxStdoutBytes: "broker-observed-cap",
    maxStderrBytes: "broker-observed-cap",
    maxOutputFileBytes: "broker-observed-cap",
    maxOutputTotalBytes: "broker-observed-cap",
  },
};

interface FakeLease {
  readonly id: string;
}

interface FakeBackendOptions {
  readonly report?: unknown;
  readonly inventory?: readonly EphemeralOutputInventoryEntry<string>[];
  readonly bytes?: ReadonlyMap<string, Uint8Array>;
  readonly destroy?: EphemeralExecutionDestruction;
  readonly destroyByRunId?: EphemeralExecutionDestruction;
  readonly createError?: Error;
  readonly executeError?: Error;
  readonly readError?: Error;
  readonly destroyError?: Error;
  readonly destroyByRunIdError?: Error;
  readonly events?: string[];
}

class FakeBackend implements EphemeralExecutionBackend<FakeLease, string> {
  readonly #options: FakeBackendOptions;
  createCalls = 0;
  destroyByRunIdCalls = 0;
  executeCalls = 0;
  inventoryCalls = 0;
  readCalls = 0;
  destroyCalls = 0;
  readonly readBounds: number[] = [];
  readonly allocatedRunIds = new Set<string>();
  lastRequest?: EphemeralExecutionBackendRequest;

  constructor(options: FakeBackendOptions) {
    this.#options = options;
  }

  create(request: EphemeralExecutionBackendRequest): Promise<FakeLease> {
    this.createCalls += 1;
    this.lastRequest = request;
    this.allocatedRunIds.add(request.runId);
    if (this.#options.createError) return Promise.reject(this.#options.createError);
    return Promise.resolve({ id: `lease-${this.createCalls}` });
  }

  destroyByRunId(runId: string): Promise<EphemeralExecutionDestruction> {
    this.destroyByRunIdCalls += 1;
    this.allocatedRunIds.delete(runId);
    if (this.#options.destroyByRunIdError) {
      return Promise.reject(this.#options.destroyByRunIdError);
    }
    return Promise.resolve(
      this.#options.destroyByRunId ?? {
        status: "proven",
        runId,
        proofFingerprint: { algorithm: "sha256", digest: C },
      },
    );
  }

  execute(_lease: FakeLease): Promise<EphemeralExecutionReport> {
    this.executeCalls += 1;
    if (this.#options.executeError) return Promise.reject(this.#options.executeError);
    return Promise.resolve(
      (this.#options.report ?? reportFixture()) as EphemeralExecutionReport,
    );
  }

  inventory(
    _lease: FakeLease,
  ): Promise<readonly EphemeralOutputInventoryEntry<string>[]> {
    this.inventoryCalls += 1;
    return Promise.resolve(this.#options.inventory ?? []);
  }

  readOutput(
    _lease: FakeLease,
    handle: string,
    maximumBytesToRead: number,
  ): Promise<Uint8Array> {
    this.readCalls += 1;
    this.readBounds.push(maximumBytesToRead);
    if (this.#options.readError) return Promise.reject(this.#options.readError);
    const bytes = this.#options.bytes?.get(handle);
    if (!bytes) return Promise.reject(new Error("missing fake bytes"));
    return Promise.resolve(bytes);
  }

  destroy(_lease: FakeLease): Promise<EphemeralExecutionDestruction> {
    this.destroyCalls += 1;
    this.#options.events?.push("destroy");
    if (this.#options.destroyError) return Promise.reject(this.#options.destroyError);
    this.allocatedRunIds.delete(this.lastRequest!.runId);
    return Promise.resolve(
      this.#options.destroy ?? {
        status: "proven",
        runId: this.lastRequest!.runId,
        proofFingerprint: { algorithm: "sha256", digest: C },
      },
    );
  }
}

class FakeCas implements IsolatedOutputCasSink<string> {
  readonly published = new Map<string, Uint8Array>();
  readonly staged = new Map<string, Map<string, Uint8Array>>();
  stageCalls = 0;
  readStagedCalls = 0;
  commitCalls = 0;
  resolveCalls = 0;
  abortCalls = 0;
  abortByRunIdCalls = 0;
  events?: string[];
  writeReceipt?: (
    object: IsolatedOutputCasObject,
  ) => IsolatedOutputCasWriteReceipt;
  reread?: (casUri: string, stored: Uint8Array) => Uint8Array;
  stageError?: Error;
  commitError?: Error;
  commitAfterPersistError?: Error;
  commitResolution?: "not-published" | "outcome-unknown";
  resolveError?: Error;
  abortError?: Error;
  abortByRunIdError?: Error;
  stageAfterPersistError?: Error;
  stagedBatchOverride?: (
    batch: string,
    runId: string,
    producerGeneration: 0 | 1,
    receipts: readonly IsolatedOutputCasWriteReceipt[],
  ) => unknown;
  readonly runIdByBatch = new Map<string, string>();
  publication?: IsolatedCodeExecutionReceiptRecord;

  stageBatch(
    objects: readonly IsolatedOutputCasObject[],
  ): Promise<StagedIsolatedOutputBatch<string>> {
    this.stageCalls += 1;
    this.events?.push("stage");
    if (this.stageError) return Promise.reject(this.stageError);
    const batch = `batch-${this.stageCalls}`;
    const staged = new Map<string, Uint8Array>();
    const receipts = objects.map((object) => {
      const uri = `casys://isolated-output/sha256/${object.sha256}`;
      staged.set(uri, Uint8Array.from(object.bytes));
      return this.writeReceipt?.(object) ?? {
        role: object.role,
        casUri: uri,
        byteCount: object.byteCount,
        sha256: object.sha256,
      };
    });
    this.staged.set(batch, staged);
    const runId = objects[0]!.runId;
    const producerGeneration = objects[0]!.producerGeneration;
    this.runIdByBatch.set(batch, runId);
    if (this.stageAfterPersistError) {
      return Promise.reject(this.stageAfterPersistError);
    }
    return Promise.resolve(
      (this.stagedBatchOverride?.(
        batch,
        runId,
        producerGeneration,
        receipts,
      ) ?? {
        batch,
        runId,
        producerGeneration,
        receipts,
      }) as StagedIsolatedOutputBatch<string>,
    );
  }

  readStaged(batch: string, casUri: string): Promise<Uint8Array> {
    this.readStagedCalls += 1;
    const stored = this.staged.get(batch)?.get(casUri);
    if (!stored) return Promise.reject(new Error("missing fake CAS object"));
    return Promise.resolve(this.reread?.(casUri, stored) ?? Uint8Array.from(stored));
  }

  commit(
    batch: string,
    receipt: IsolatedCodeExecutionReceiptRecord,
  ): Promise<IsolatedOutputPublicationResolution> {
    this.commitCalls += 1;
    this.events?.push("commit");
    if (this.commitError) return Promise.reject(this.commitError);
    if (this.commitResolution) {
      return Promise.resolve({
        status: this.commitResolution,
        ref: receipt.publication.ref,
      });
    }
    const staged = this.staged.get(batch)!;
    for (const [uri, bytes] of staged) this.published.set(uri, bytes);
    this.publication = receipt;
    this.staged.delete(batch);
    if (this.commitAfterPersistError) {
      return Promise.reject(this.commitAfterPersistError);
    }
    return Promise.resolve({
      status: "published",
      ref: receipt.publication.ref,
      receipt,
    });
  }

  resolvePublication(
    ref: IsolatedOutputPublicationRef,
  ): Promise<IsolatedOutputPublicationResolution> {
    this.resolveCalls += 1;
    if (this.resolveError) return Promise.reject(this.resolveError);
    if (!this.publication) {
      return Promise.resolve({ status: "not-published", ref });
    }
    return Promise.resolve({
      status: "published",
      ref: this.publication.publication.ref,
      receipt: this.publication,
    });
  }

  abort(batch: string): Promise<void> {
    this.abortCalls += 1;
    if (this.abortError) return Promise.reject(this.abortError);
    this.staged.delete(batch);
    this.runIdByBatch.delete(batch);
    return Promise.resolve();
  }

  abortByRunId(runId: string, _producerGeneration: 0 | 1): Promise<void> {
    this.abortByRunIdCalls += 1;
    if (this.abortByRunIdError) return Promise.reject(this.abortByRunIdError);
    for (const [batch, stagedRunId] of this.runIdByBatch) {
      if (stagedRunId === runId) {
        this.staged.delete(batch);
        this.runIdByBatch.delete(batch);
      }
    }
    return Promise.resolve();
  }

  advanceProducerGeneration(
    input: IsolatedOutputProducerGenerationAdvanceInput,
  ): Promise<IsolatedOutputProducerGenerationAdvance> {
    return createIsolatedOutputProducerGenerationAdvance(input);
  }
}

Deno.test("broker returns deterministic closed receipts only after cleanup and CAS reread", async () => {
  const scenario = await happyScenario();
  const validations: string[] = [];
  const runner = runnerFor(scenario.backend, scenario.cas, {
    validateOutput: (declaration) => {
      validations.push(declaration.role);
    },
  });

  const first = await runner.run(scenario.request);
  const repeated = await runner.run(scenario.request);

  assertEquals(first.fingerprint, repeated.fingerprint);
  assertEquals(first.outputs.map((output) => output.role), ["geometry", "mesh"]);
  assertEquals(first.outputs[0]?.bytes.copy(), encoder.encode("STEP"));
  assertEquals(first.logs.stdout.byteCount, 3);
  assertEquals(first.runtime.limitAssurance.maxCpuTimeMs, "unattested");
  assertEquals(first.destruction.status, "proven");
  assertEquals(validations, ["geometry", "mesh", "geometry", "mesh"]);
  assertEquals(scenario.backend.destroyCalls, 2);
  assertEquals(scenario.backend.readBounds, [32, 32, 32, 32]);
  assertEquals(scenario.cas.stageCalls, 2);
  assertEquals(scenario.cas.readStagedCalls, 4);
  assertEquals(scenario.cas.commitCalls, 2);
  assertEquals("handle" in first.outputs[0]!, false);
  assertEquals("path" in first.outputs[0]!, false);
  assertEquals(scenario.events, [
    "destroy",
    "stage",
    "commit",
    "destroy",
    "stage",
    "commit",
  ]);
});

Deno.test("broker executes a second registered profile without Build123d semantics", async () => {
  const profile = { id: "equation-language-fixture", version: "2.0.0" } as const;
  const outputManifest = [{
    role: "compiled-equation-model",
    basename: "model.ir.json",
    mediaType: "application/json",
    format: "equation-ir",
  }] as const;
  const source = encoder.encode("model GenericEquation = x + 1\n");
  const output = encoder.encode('{"equation":"x + 1"}');
  const backend = new FakeBackend({
    inventory: [{
      handle: "equation-ir-handle",
      basename: outputManifest[0].basename,
      kind: "file",
      claimedByteCount: output.byteLength,
      claimedSha256: await fingerprintResourceBytes(output),
    }],
    bytes: new Map([["equation-ir-handle", output]]),
  });
  const cas = new FakeCas();
  const validatedRoles: string[] = [];
  const runner = new BrokeredIsolatedCodeRunner({
    backend,
    cas,
    profile,
    maximumSourceBytes: 4_096,
    outputManifest,
    policy: POLICY,
    runtime: RUNTIME,
    minimumDestructionAssurance: "proven",
    validateOutput: (declaration, bytes) => {
      validatedRoles.push(declaration.role);
      assertEquals(bytes, output);
    },
  });

  const receipt = await runner.run({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: "run:equation-language-001",
    producerGeneration: 0,
    profile,
    source: {
      bytes: source,
      sha256: await fingerprintResourceBytes(source),
    },
    policy: POLICY,
    outputs: outputManifest,
  });

  assertEquals(receipt.profile, profile);
  assertEquals(
    receipt.outputs.map((item) => ({
      role: item.role,
      basename: item.basename,
      mediaType: item.mediaType,
      format: item.format,
    })),
    [...outputManifest],
  );
  assertEquals(backend.lastRequest?.profile, profile);
  assertEquals(validatedRoles, ["compiled-equation-model"]);
  assertEquals(cas.commitCalls, 1);
});

Deno.test("broker rejects backend hash and size claims before any CAS publication", async () => {
  for (const tamper of ["hash", "size"] as const) {
    const scenario = await happyScenario();
    const first = scenario.inventory[0]!;
    const inventory = [{
      ...first,
      ...(tamper === "hash"
        ? { claimedSha256: A }
        : { claimedByteCount: first.claimedByteCount + 1 }),
    }, ...scenario.inventory.slice(1)];
    const backend = new FakeBackend({
      inventory,
      bytes: scenario.bytes,
    });
    const cas = new FakeCas();

    await expectCode(
      () => runnerFor(backend, cas).run(scenario.request),
      "output_integrity_failed",
    );
    assertEquals(backend.destroyCalls, 1);
    assertEquals(cas.stageCalls, 0);
  }
});

Deno.test("broker treats the output manifest as a code-owned profile contract", async () => {
  const scenario = await happyScenario();
  const request = {
    ...scenario.request,
    outputs: [{
      ...scenario.request.outputs[0]!,
      basename: "agent-selected.step",
    }, scenario.request.outputs[1]!],
  };

  await expectCode(
    () => runnerFor(scenario.backend, scenario.cas).run(request),
    "output_manifest_mismatch",
  );
  assertEquals(scenario.backend.createCalls, 0);
  assertEquals(scenario.cas.stageCalls, 0);
});

Deno.test("broker rejects source bytes above the code-owned cap before backend creation", async () => {
  const scenario = await happyScenario();
  const error = await captureCode(
    () =>
      runnerFor(scenario.backend, scenario.cas, {
        maximumSourceBytes: scenario.request.source.bytes.byteLength - 1,
      }).run(scenario.request),
    "invalid_request",
  );

  assertEquals(
    error.message,
    "The isolated execution request failed exact validation.",
  );
  assertEquals(scenario.backend.createCalls, 0);
  assertEquals(scenario.backend.destroyByRunIdCalls, 0);
  assertEquals(scenario.cas.stageCalls, 0);
});

Deno.test("source cap uses intrinsic Uint8Array slots and rejects proxies before copy or hash", async () => {
  const scenario = await happyScenario();
  class HiddenLengthBytes extends Uint8Array {
    override get byteLength(): number {
      return 1;
    }
  }
  const hidden = new HiddenLengthBytes(2_048);
  hidden.fill(7);
  const hiddenSha256 = await fingerprintResourceBytes(new Uint8Array(hidden.buffer));
  const hiddenRequest = {
    ...scenario.request,
    source: { bytes: hidden, sha256: hiddenSha256 },
  };

  await expectCode(
    () =>
      runnerFor(scenario.backend, scenario.cas, { maximumSourceBytes: 4 }).run(
        hiddenRequest,
      ),
    "invalid_request",
  );
  await expectCode(
    () =>
      runnerFor(scenario.backend, scenario.cas, { maximumSourceBytes: 4 }).run({
        ...scenario.request,
        source: {
          bytes: new Proxy(new Uint8Array([1]), {}) as Uint8Array,
          sha256: A,
        },
      }),
    "invalid_request",
  );
  assertEquals(scenario.backend.createCalls, 0);
  assertEquals(scenario.cas.stageCalls, 0);
});

Deno.test("request source and bytes accessors are each read once", async () => {
  const scenario = await happyScenario();
  let sourceReads = 0;
  let bytesReads = 0;
  const source = Object.defineProperties({}, {
    bytes: {
      enumerable: true,
      get: () => {
        bytesReads += 1;
        return sourceReads === 1
          ? Uint8Array.from(scenario.request.source.bytes)
          : new Uint8Array(300_000);
      },
    },
    sha256: {
      enumerable: true,
      value: scenario.request.source.sha256,
    },
  });
  const request = Object.defineProperty(
    { ...scenario.request },
    "source",
    {
      enumerable: true,
      get: () => {
        sourceReads += 1;
        return source;
      },
    },
  );

  await runnerFor(scenario.backend, scenario.cas).run(request);

  assertEquals(sourceReads, 1);
  assertEquals(bytesReads, 1);
});

Deno.test("broker rejects missing, extra, and duplicate inventory entries atomically", async () => {
  const scenario = await happyScenario();
  const variants = [
    scenario.inventory.slice(0, 1),
    [...scenario.inventory, {
      handle: "extra",
      basename: "extra.txt",
      kind: "file" as const,
      claimedByteCount: 0,
      claimedSha256: await fingerprintResourceBytes(new Uint8Array()),
    }],
    [...scenario.inventory, {
      ...scenario.inventory[0]!,
      handle: "duplicate",
    }],
  ];

  for (const inventory of variants) {
    const backend = new FakeBackend({ inventory, bytes: scenario.bytes });
    const cas = new FakeCas();
    await expectCode(
      () => runnerFor(backend, cas).run(scenario.request),
      "output_manifest_mismatch",
    );
    assertEquals(backend.destroyCalls, 1);
    assertEquals(cas.stageCalls, 0);
  }
});

Deno.test("broker rejects traversal names and every non-regular output kind with cleanup", async () => {
  const scenario = await happyScenario();
  const traversal = new FakeBackend({
    inventory: [{
      ...scenario.inventory[0]!,
      basename: "../result.step",
    }, scenario.inventory[1]!],
    bytes: scenario.bytes,
  });

  await expectCode(
    () => runnerFor(traversal, new FakeCas()).run(scenario.request),
    "backend_contract_violation",
  );
  assertEquals(traversal.destroyCalls, 1);
  for (
    const kind of [
      "symlink",
      "hardlink",
      "directory",
      "device",
      "socket",
      "other",
    ] as const
  ) {
    const backend = new FakeBackend({
      inventory: [{ ...scenario.inventory[0]!, kind }, scenario.inventory[1]!],
      bytes: scenario.bytes,
    });
    await expectCode(
      () => runnerFor(backend, new FakeCas()).run(scenario.request),
      "output_manifest_mismatch",
    );
    assertEquals(backend.destroyCalls, 1);
  }
});

Deno.test("broker observes stdout and stderr caps and cleans up malformed reports", async () => {
  const scenario = await happyScenario();
  for (const stream of ["stdout", "stderr"] as const) {
    const report = reportFixture();
    const backend = new FakeBackend({
      report: {
        ...report,
        logs: {
          ...report.logs,
          [stream]: {
            bytes: encoder.encode("x".repeat(1_025)),
            truncated: true,
          },
        },
      },
      inventory: scenario.inventory,
      bytes: scenario.bytes,
    });

    await expectCode(
      () => runnerFor(backend, new FakeCas()).run(scenario.request),
      "backend_contract_violation",
    );
    assertEquals(backend.destroyCalls, 1);
  }
});

Deno.test("all backend and CAS byte seams use intrinsic lengths before copying", async () => {
  class HiddenLengthBytes extends Uint8Array {
    override get byteLength(): number {
      return 1;
    }
  }

  const logScenario = await happyScenario();
  const oversizedLog = new HiddenLengthBytes(1_025);
  const logReport = reportFixture();
  const logBackend = new FakeBackend({
    report: {
      ...logReport,
      logs: {
        ...logReport.logs,
        stdout: { bytes: oversizedLog, truncated: true },
      },
    },
    inventory: logScenario.inventory,
    bytes: logScenario.bytes,
  });
  await expectCode(
    () => runnerFor(logBackend, new FakeCas()).run(logScenario.request),
    "backend_contract_violation",
  );
  assertEquals(logBackend.destroyCalls, 1);

  const outputScenario = await happyScenario();
  const oversizedOutput = new HiddenLengthBytes(33);
  oversizedOutput.fill(9);
  const first = outputScenario.inventory[0]!;
  const outputBackend = new FakeBackend({
    inventory: [{
      ...first,
      claimedByteCount: 33,
      claimedSha256: await fingerprintResourceBytes(
        new Uint8Array(oversizedOutput.buffer),
      ),
    }, ...outputScenario.inventory.slice(1)],
    bytes: new Map([
      ...outputScenario.bytes,
      [first.handle, oversizedOutput] as const,
    ]),
  });
  await expectCode(
    () => runnerFor(outputBackend, new FakeCas()).run(outputScenario.request),
    "output_quota_exceeded",
  );
  assertEquals(outputBackend.destroyCalls, 1);

  const casScenario = await happyScenario();
  const oversizedReread = new HiddenLengthBytes(5);
  oversizedReread.fill(4);
  casScenario.cas.reread = () => oversizedReread;
  await expectCode(
    () => runnerFor(casScenario.backend, casScenario.cas).run(casScenario.request),
    "cas_integrity_failed",
  );
  assertEquals(casScenario.cas.abortCalls, 1);
  assertEquals(casScenario.cas.commitCalls, 0);
  assertEquals(casScenario.cas.staged.size, 0);
});

Deno.test("broker compares requested ceilings and assurance exactly to backend attestation", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    report: reportFixture({
      ...RUNTIME,
      limitAssurance: {
        ...RUNTIME.limitAssurance,
        maxCpuTimeMs: "backend-attested",
      },
    }),
    inventory: scenario.inventory,
    bytes: scenario.bytes,
  });

  await expectCode(
    () => runnerFor(backend, new FakeCas()).run(scenario.request),
    "backend_contract_violation",
  );
  assertEquals(backend.destroyCalls, 1);
});

Deno.test("broker never claims to observe CPU memory process or wall-time caps", () => {
  const invalidRuntime = {
    ...RUNTIME,
    limitAssurance: {
      ...RUNTIME.limitAssurance,
      maxCpuTimeMs: "broker-observed-cap" as const,
    },
  };

  assertThrows(
    () =>
      runnerFor(new FakeBackend({}), new FakeCas(), {
        runtime: invalidRuntime,
      }),
    TypeError,
    "does not observe",
  );
});

Deno.test("broker enforces per-file and total output caps over observed bytes", async () => {
  const scenario = await happyScenario();
  const large = encoder.encode("x".repeat(33));
  const largeBackend = new FakeBackend({
    inventory: [{
      ...scenario.inventory[0]!,
      claimedByteCount: large.byteLength,
      claimedSha256: await fingerprintResourceBytes(large),
    }, scenario.inventory[1]!],
    bytes: new Map([...scenario.bytes, [scenario.inventory[0]!.handle, large]]),
  });
  await expectCode(
    () => runnerFor(largeBackend, new FakeCas()).run(scenario.request),
    "output_quota_exceeded",
  );

  const totalRuntime = {
    ...RUNTIME,
    requestedLimits: {
      ...RUNTIME.requestedLimits,
      maxOutputFileBytes: 4,
      maxOutputTotalBytes: 7,
    },
  };
  const totalBackend = new FakeBackend({
    report: reportFixture(totalRuntime),
    inventory: scenario.inventory,
    bytes: scenario.bytes,
  });
  await expectCode(
    () =>
      runnerFor(totalBackend, new FakeCas(), { runtime: totalRuntime }).run(
        scenario.request,
      ),
    "output_quota_exceeded",
  );
  assertEquals(largeBackend.destroyCalls, 1);
  assertEquals(totalBackend.destroyCalls, 1);
});

Deno.test("broker exposes a safe public terminal when a code-owned output validator rejects", async () => {
  const scenario = await happyScenario();
  const capability = { handle: "PRIVATE_VALIDATOR_HANDLE_9c21" };
  const validatorFailure = privateFailure(
    "PRIVATE_VALIDATOR_PATH_/tmp/sandbox/result.step",
    capability,
  );
  const runner = runnerFor(scenario.backend, scenario.cas, {
    validateOutput: () => {
      throw validatorFailure;
    },
  });

  let observed: unknown;
  try {
    await runner.run(scenario.request);
  } catch (error) {
    observed = error;
  }
  assertEquals(observed instanceof IsolatedCodeOutputValidationRejectedError, true);
  assertEquals(observed instanceof IsolatedCodeExecutionRejectedError, false);
  assertEquals(observed instanceof BrokeredIsolatedCodeRunnerError, false);
  const error = observed as IsolatedCodeOutputValidationRejectedError;
  const step = scenario.bytes.get("step-handle")!;
  assertEquals(error.code, "output_validation_rejected");
  assertEquals(error.observation, {
    role: "geometry",
    byteCount: step.byteLength,
    sha256: await fingerprintResourceBytes(step),
  });
  assertEquals(error.destruction.status, "proven");
  assertEquals(error.destruction.runId, scenario.request.runId);
  assertEquals(error.cause, undefined);
  assertEquals("bytes" in error, false);
  assertEquals("bytes" in error.observation, false);
  assertEquals("handle" in error, false);
  assertEquals("path" in error, false);
  assertEquals("lease" in error, false);
  const publicText = [
    error.message,
    JSON.stringify(error.observation),
    error.stack ?? "",
  ].join("\n");
  assertEquals(publicText.includes("invalid STEP"), false);
  assertEquals(publicText.includes("PRIVATE_VALIDATOR_PATH_"), false);
  assertEquals(publicText.includes("PRIVATE_VALIDATOR_HANDLE_"), false);
  assertEquals(publicText.includes("step-handle"), false);
  assertEquals(scenario.backend.executeCalls, 1);
  assertEquals(scenario.backend.destroyCalls, 1);
  assertEquals(scenario.cas.stageCalls, 0);
  assertEquals(scenario.cas.commitCalls, 0);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("lost destroy acknowledgement recovers by run id before CAS publication", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    destroyError: new Error("backend cleanup failed"),
  });
  const cas = new FakeCas();

  const receipt = await runnerFor(backend, cas).run(scenario.request);

  assertEquals(receipt.destruction.status, "proven");
  assertEquals(backend.destroyCalls, 1);
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(cas.stageCalls, 1);
  assertEquals(cas.commitCalls, 1);
});

Deno.test("failed destroy recovery remains fail-closed and releases no CAS output", async () => {
  const scenario = await happyScenario();
  const initialCapability = { lease: "PRIVATE_DESTROY_LEASE_6b60" };
  const recoveryCapability = { run: "PRIVATE_REAPER_RUN_f287" };
  const initialFailure = privateFailure(
    "PRIVATE_DESTROY_PATH_b476",
    initialCapability,
  );
  const recoveryFailure = privateFailure(
    "PRIVATE_REAPER_PATH_8f98",
    recoveryCapability,
  );
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    destroyError: initialFailure,
    destroyByRunIdError: recoveryFailure,
  });
  const cas = new FakeCas();

  const error = await captureCode(
    () => runnerFor(backend, cas).run(scenario.request),
    "infrastructure_failure",
  );

  for (
    const [privateError, capability, secrets] of [
      [
        initialFailure,
        initialCapability,
        ["PRIVATE_DESTROY_PATH_b476", "PRIVATE_DESTROY_LEASE_6b60"],
      ],
      [
        recoveryFailure,
        recoveryCapability,
        ["PRIVATE_REAPER_PATH_8f98", "PRIVATE_REAPER_RUN_f287"],
      ],
    ] as const
  ) {
    assertOpaquePublicError(
      error,
      "Ephemeral environment destruction was not proven; no receipt or output is released.",
      privateError,
      capability,
      secrets,
    );
  }
  assertEquals(backend.destroyCalls, 1);
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(cas.stageCalls, 0);
});

Deno.test("backend execution failure still destroys its lease exactly once", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    executeError: new Error("runtime disconnected"),
  });
  const cas = new FakeCas();

  await expectCode(
    () => runnerFor(backend, cas).run(scenario.request),
    "infrastructure_failure",
  );
  assertEquals(backend.destroyCalls, 1);
  assertEquals(cas.stageCalls, 0);
});

Deno.test("create rejection reaps a possibly allocated environment exactly once by run id", async () => {
  const scenario = await happyScenario();
  const capability = { containerHandle: "PRIVATE_CREATE_CAPABILITY_7d38" };
  const backendFailure = privateFailure(
    "PRIVATE_CREATE_PATH_1f95",
    capability,
  );
  const recoveryCapability = {
    cleanupHandle: "PRIVATE_RECOVERY_CAPABILITY_18bb",
  };
  const recoveryFailure = privateFailure(
    "PRIVATE_RECOVERY_PATH_bf12",
    recoveryCapability,
  );
  const backend = new FakeBackend({
    createError: backendFailure,
    destroyByRunIdError: recoveryFailure,
  });
  const cas = new FakeCas();

  const error = await captureCode(
    () => runnerFor(backend, cas).run(scenario.request),
    "infrastructure_failure",
  );

  assertOpaquePublicError(
    error,
    "The ephemeral execution environment could not be created.",
    backendFailure,
    capability,
    ["PRIVATE_CREATE_PATH_1f95", "PRIVATE_CREATE_CAPABILITY_7d38"],
  );
  assertOpaquePublicError(
    error,
    "The ephemeral execution environment could not be created.",
    recoveryFailure,
    recoveryCapability,
    ["PRIVATE_RECOVERY_PATH_bf12", "PRIVATE_RECOVERY_CAPABILITY_18bb"],
  );
  assertEquals(backend.createCalls, 1);
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(backend.destroyCalls, 0);
  assertEquals(backend.allocatedRunIds.size, 0);
  assertEquals(cas.stageCalls, 0);
});

Deno.test("backend and CAS failures expose stable errors without raw causes or capabilities", async () => {
  const scenarios = await Promise.all([
    privateBackendFailureScenario("execute"),
    privateBackendFailureScenario("read"),
    privateBackendFailureScenario("destroy"),
    privateBackendAccessorFailureScenario(),
    privateBackendStructuralFailureScenario(),
    privateCasFailureScenario(),
  ]);

  for (const scenario of scenarios) {
    const error = await captureCode(
      scenario.action,
      scenario.code,
    );
    assertOpaquePublicError(
      error,
      scenario.message,
      scenario.privateError,
      scenario.capability,
      scenario.secretFragments,
    );
  }
});

Deno.test("strict cleanup policy refuses acknowledgement-only destruction", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    destroy: {
      status: "acknowledged-unattested",
      runId: "run:compile-001",
      acknowledgementFingerprint: { algorithm: "sha256", digest: C },
    },
    destroyByRunId: {
      status: "acknowledged-unattested",
      runId: "run:compile-001",
      acknowledgementFingerprint: { algorithm: "sha256", digest: C },
    },
  });
  const cas = new FakeCas();

  await expectCode(
    () => runnerFor(backend, cas).run(scenario.request),
    "infrastructure_failure",
  );
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(cas.stageCalls, 0);
});

Deno.test("destruction evidence must name the exact server-issued run", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    destroy: {
      status: "proven",
      runId: "run:different",
      proofFingerprint: { algorithm: "sha256", digest: C },
    },
    destroyByRunId: {
      status: "unproven",
      runId: "run:compile-001",
      reason: "Run-scoped recovery could not prove destruction.",
    },
  });
  const cas = new FakeCas();

  await expectCode(
    () => runnerFor(backend, cas).run(scenario.request),
    "infrastructure_failure",
  );
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(cas.stageCalls, 0);
});

Deno.test("acknowledgement-capable policy preserves the unattested cleanup label", async () => {
  const scenario = await happyScenario();
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    destroy: {
      status: "acknowledged-unattested",
      runId: "run:compile-001",
      acknowledgementFingerprint: { algorithm: "sha256", digest: C },
    },
  });
  const receipt = await runnerFor(backend, new FakeCas(), {
    minimumDestructionAssurance: "acknowledged-unattested",
  }).run(scenario.request);

  assertEquals(receipt.destruction.status, "acknowledged-unattested");
});

Deno.test("run-scoped recovery exposes only accepted destruction and never executes code", async () => {
  const backend = new FakeBackend({});
  const cas = new FakeCas();
  const runner = runnerFor(backend, cas);

  const destruction = await runner.destroyByRunId("run:recovery-001", 0);

  assertEquals(destruction, {
    status: "proven",
    runId: "run:recovery-001",
    proofFingerprint: { algorithm: "sha256", digest: C },
  });
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(cas.abortByRunIdCalls, 1);
  assertEquals(backend.createCalls, 0);
  assertEquals(backend.executeCalls, 0);
});

Deno.test("run-scoped recovery fails closed for invalid ids and insufficient assurance", async () => {
  const invalidBackend = new FakeBackend({});
  const invalidCas = new FakeCas();
  await expectCode(
    () => runnerFor(invalidBackend, invalidCas).destroyByRunId("latest/../run", 0),
    "invalid_request",
  );
  assertEquals(invalidBackend.destroyByRunIdCalls, 0);
  assertEquals(invalidCas.abortByRunIdCalls, 0);

  const unprovenBackend = new FakeBackend({
    destroyByRunId: {
      status: "unproven",
      runId: "run:recovery-002",
      reason: "Backend did not attest cleanup.",
    },
  });
  const unprovenCas = new FakeCas();
  await expectCode(
    () =>
      runnerFor(unprovenBackend, unprovenCas).destroyByRunId(
        "run:recovery-002",
        0,
      ),
    "infrastructure_failure",
  );
  assertEquals(unprovenBackend.destroyByRunIdCalls, 1);
  assertEquals(unprovenCas.abortByRunIdCalls, 1);
});

Deno.test("run-scoped recovery never authorizes retry while CAS staging cleanup is ambiguous", async () => {
  const backend = new FakeBackend({});
  const cas = new FakeCas();
  cas.abortByRunIdError = new Error("private staging cleanup failure");

  await expectCode(
    () => runnerFor(backend, cas).destroyByRunId("run:recovery-003", 0),
    "infrastructure_failure",
  );

  assertEquals(cas.abortByRunIdCalls, 1);
  assertEquals(backend.destroyByRunIdCalls, 1);
  assertEquals(backend.createCalls, 0);
});

Deno.test("broker rejects a CAS claim or reread that diverges from observed bytes", async () => {
  const claimScenario = await happyScenario();
  claimScenario.cas.writeReceipt = (object) => ({
    role: object.role,
    casUri: `casys://isolated-output/sha256/${object.sha256}`,
    byteCount: object.byteCount + 1,
    sha256: object.sha256,
  });
  await expectCode(
    () =>
      runnerFor(claimScenario.backend, claimScenario.cas).run(claimScenario.request),
    "cas_integrity_failed",
  );
  assertEquals(claimScenario.backend.destroyCalls, 1);
  assertEquals(claimScenario.cas.abortCalls, 0);
  assertEquals(claimScenario.cas.abortByRunIdCalls, 1);
  assertEquals(claimScenario.cas.commitCalls, 0);
  assertEquals(claimScenario.cas.published.size, 0);

  const rereadScenario = await happyScenario();
  rereadScenario.cas.reread = () => encoder.encode("tampered");
  await expectCode(
    () =>
      runnerFor(rereadScenario.backend, rereadScenario.cas).run(
        rereadScenario.request,
      ),
    "cas_integrity_failed",
  );
  assertEquals(rereadScenario.backend.destroyCalls, 1);
  assertEquals(rereadScenario.cas.abortCalls, 1);
  assertEquals(rereadScenario.cas.commitCalls, 0);
  assertEquals(rereadScenario.cas.published.size, 0);
});

Deno.test("CAS stage ambiguity and hostile batch accessors clean up only by server run id", async () => {
  const rejectedScenario = await happyScenario();
  rejectedScenario.cas.stageAfterPersistError = privateFailure(
    "PRIVATE_STAGE_ACK_PATH_bda7",
    { batch: "PRIVATE_STAGE_ACK_CAPABILITY_ed0c" },
  );
  const rejectedError = await captureCode(
    () =>
      runnerFor(rejectedScenario.backend, rejectedScenario.cas).run(
        rejectedScenario.request,
      ),
    "cas_integrity_failed",
  );
  assertEquals(
    rejectedError.message,
    "The isolated output batch could not be staged atomically.",
  );
  assertEquals(rejectedScenario.cas.abortCalls, 0);
  assertEquals(rejectedScenario.cas.abortByRunIdCalls, 1);
  assertEquals(rejectedScenario.cas.staged.size, 0);
  assertEquals(rejectedScenario.cas.commitCalls, 0);
  assertEquals(rejectedScenario.cas.published.size, 0);

  const accessorScenario = await happyScenario();
  const capability = { batchHandle: "PRIVATE_BATCH_GETTER_CAP_1e29" };
  const accessorFailure = privateFailure(
    "PRIVATE_BATCH_GETTER_PATH_e6f1",
    capability,
  );
  accessorScenario.cas.stagedBatchOverride = (
    _batch,
    runId,
    producerGeneration,
    receipts,
  ) =>
    Object.defineProperties({}, {
      batch: {
        enumerable: true,
        get: () => {
          throw accessorFailure;
        },
      },
      runId: { enumerable: true, value: runId },
      producerGeneration: { enumerable: true, value: producerGeneration },
      receipts: { enumerable: true, value: receipts },
    });
  const accessorError = await captureCode(
    () =>
      runnerFor(accessorScenario.backend, accessorScenario.cas).run(
        accessorScenario.request,
      ),
    "cas_integrity_failed",
  );
  assertOpaquePublicError(
    accessorError,
    "The CAS staging receipt failed exact validation.",
    accessorFailure,
    capability,
    ["PRIVATE_BATCH_GETTER_CAP_1e29", "PRIVATE_BATCH_GETTER_PATH_e6f1"],
  );
  assertEquals(accessorScenario.cas.abortCalls, 0);
  assertEquals(accessorScenario.cas.abortByRunIdCalls, 1);
  assertEquals(accessorScenario.cas.staged.size, 0);
  assertEquals(accessorScenario.cas.commitCalls, 0);
  assertEquals(accessorScenario.cas.published.size, 0);
});

Deno.test("CAS abort rejection falls back to run-scoped cleanup", async () => {
  const scenario = await happyScenario();
  scenario.cas.reread = () => encoder.encode("tampered");
  scenario.cas.abortError = privateFailure(
    "PRIVATE_ABORT_ACK_PATH_1df9",
    { batch: "PRIVATE_ABORT_ACK_CAPABILITY_d239" },
  );

  const error = await captureCode(
    () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    "cas_integrity_failed",
  );

  assertEquals(
    error.message,
    "The CAS staged re-read does not match the observed output bytes.",
  );
  assertEquals(scenario.cas.abortCalls, 1);
  assertEquals(scenario.cas.abortByRunIdCalls, 1);
  assertEquals(scenario.cas.staged.size, 0);
  assertEquals(scenario.cas.commitCalls, 0);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("CAS commit failure aborts staging and leaves no partial publication", async () => {
  const scenario = await happyScenario();
  scenario.cas.commitError = new Error("atomic publish failed");

  await expectCode(
    () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    "cas_integrity_failed",
  );
  assertEquals(scenario.cas.stageCalls, 1);
  assertEquals(scenario.cas.commitCalls, 1);
  assertEquals(scenario.backend.executeCalls, 1);
  assertEquals(scenario.cas.resolveCalls, 1);
  assertEquals(scenario.cas.abortCalls, 1);
  assertEquals(scenario.cas.staged.size, 0);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("lost CAS commit acknowledgement resolves the exact marker without executing twice", async () => {
  const scenario = await happyScenario();
  scenario.cas.commitAfterPersistError = new Error("lost publication acknowledgement");

  const receipt = await runnerFor(scenario.backend, scenario.cas).run(
    scenario.request,
  );

  assertEquals(receipt.publication.status, "atomic-batch-published");
  assertEquals(scenario.backend.executeCalls, 1);
  assertEquals(scenario.cas.commitCalls, 1);
  assertEquals(scenario.cas.resolveCalls, 1);
  assertEquals(scenario.cas.abortCalls, 0);
  assertEquals(scenario.cas.published.size, 2);
});

Deno.test("persistent unknown CAS publication stays terminal and preserves staging", async () => {
  const scenario = await happyScenario();
  scenario.cas.commitResolution = "outcome-unknown";
  scenario.cas.resolveError = new Error("publication store unavailable");

  await expectCode(
    () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    "cas_publication_outcome_unknown",
  );

  assertEquals(scenario.backend.executeCalls, 1);
  assertEquals(scenario.cas.commitCalls, 1);
  assertEquals(scenario.cas.resolveCalls, 1);
  assertEquals(scenario.cas.abortCalls, 0);
  assertEquals(scenario.cas.abortByRunIdCalls, 0);
  assertEquals(scenario.cas.staged.size, 1);
});

Deno.test("a forged CAS contract error is rebuilt without its private capability", async () => {
  const scenario = await happyScenario();
  // Deliberately fake sentinel: the assertion proves no capability-bearing
  // value, even one supplied by a hostile backend, crosses the public error.
  const token = "fixture-batch-handle-sentinel";
  const path = "PRIVATE_FORGED_CAS_PATH_619c";
  const capability = { batchHandle: token, path };
  const privateError = new BrokeredIsolatedCodeRunnerError(
    "cas_integrity_failed",
    "The CAS staged re-read does not match the observed output bytes.",
  );
  Object.defineProperty(privateError, "cause", {
    enumerable: false,
    value: capability,
  });
  scenario.cas.commitError = privateError;

  const error = await captureCode(
    () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    "cas_integrity_failed",
  );
  assertOpaquePublicError(
    error,
    "The isolated output publication was proven absent; execution will not be repeated by this broker.",
    privateError,
    capability,
    [token, path],
  );
  assertEquals(scenario.cas.abortCalls, 1);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("broker destroys then throws a sanitized rejection diagnostic without outputs", async () => {
  const scenario = await happyScenario();
  const stderr = encoder.encode(
    "\x1b[31mMeshingError: Selection 'FIXED' matched no surface\x1b[0m\n",
  );
  scenario.backend = new FakeBackend({
    report: {
      runtime: RUNTIME,
      termination: { kind: "exited", exitCode: 1, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: stderr, truncated: false },
      },
    },
    events: scenario.events,
  });
  let observed: unknown;
  try {
    await runnerFor(scenario.backend, scenario.cas).run(scenario.request);
  } catch (error) {
    observed = error;
  }
  assertEquals(observed instanceof IsolatedCodeExecutionRejectedError, true);
  const error = observed as IsolatedCodeExecutionRejectedError;
  assertEquals(error.code, "execution_rejected");
  assertEquals(error.diagnostic.termination.exitCode, 1);
  assertEquals(
    error.diagnostic.logs.stderr.excerpt,
    "MeshingError: Selection 'FIXED' matched no surface\n",
  );
  assertEquals(
    error.diagnostic.logs.stderr.sha256,
    await fingerprintResourceBytes(stderr),
  );
  assertEquals(error.destruction.status, "proven");
  assertEquals(error.destruction.runId, scenario.request.runId);
  assertEquals("handle" in error, false);
  assertEquals("path" in error, false);
  assertEquals("lease" in error, false);
  const publicText = `${JSON.stringify(error.diagnostic)}\n${error.stack ?? ""}`;
  assertEquals(publicText.includes("step-handle"), false);
  assertEquals(publicText.includes("mesh-handle"), false);
  assertEquals(scenario.backend.executeCalls, 1);
  assertEquals(scenario.backend.destroyCalls, 1);
  assertEquals(scenario.backend.inventoryCalls, 0);
  assertEquals(scenario.backend.readCalls, 0);
  assertEquals(scenario.cas.stageCalls, 0);
  assertEquals(scenario.cas.commitCalls, 0);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("broker timed-out termination is a known rejection after proven destroy", async () => {
  const scenario = await happyScenario();
  scenario.backend = new FakeBackend({
    report: {
      runtime: RUNTIME,
      termination: { kind: "timed-out", exitCode: null, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: encoder.encode("wall clock exceeded\n"), truncated: false },
      },
    },
  });
  const error = await runnerFor(scenario.backend, scenario.cas).run(
    scenario.request,
  ).then(() => undefined, (failure) => failure);
  assertEquals(error instanceof IsolatedCodeExecutionRejectedError, true);
  assertEquals(
    (error as IsolatedCodeExecutionRejectedError).diagnostic.termination.kind,
    "timed-out",
  );
  assertEquals(scenario.backend.destroyCalls, 1);
  assertEquals(scenario.cas.published.size, 0);
});

Deno.test("unproven destroy after a rejected execution stays infrastructure-failure", async () => {
  const scenario = await happyScenario();
  scenario.backend = new FakeBackend({
    report: {
      runtime: RUNTIME,
      termination: { kind: "exited", exitCode: 1, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: encoder.encode("solver failed\n"), truncated: false },
      },
    },
    destroyError: new Error("PRIVATE_LEASE_PATH_/tmp/sandbox"),
    destroyByRunIdError: new Error("PRIVATE_LEASE_PATH_/tmp/sandbox"),
  });
  const error = await captureCode(
    () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    "infrastructure_failure",
  );
  assertEquals(
    error.message,
    "Ephemeral environment destruction was not proven; no receipt or output is released.",
  );
  assertEquals(error instanceof IsolatedCodeExecutionRejectedError, false);
  assertEquals(`${error.stack ?? ""}`.includes("PRIVATE_LEASE_PATH_"), false);
});

Deno.test("broker production module imports only domain and application ports", async () => {
  const source = await Deno.readTextFile(
    new URL("./brokered-isolated-code-runner.ts", import.meta.url),
  );
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

  assertEquals(
    imports.some((specifier) =>
      specifier.includes("/adapters/") || specifier.includes("/providers/") ||
      specifier.includes("/tools/")
    ),
    false,
  );
});

async function happyScenario() {
  const request = await requestFixture();
  const step = encoder.encode("STEP");
  const mesh = encoder.encode("MESH");
  const bytes = new Map([
    ["step-handle", step],
    ["mesh-handle", mesh],
  ]);
  const inventory: readonly EphemeralOutputInventoryEntry<string>[] = [{
    handle: "mesh-handle",
    basename: "result.msh",
    kind: "file",
    claimedByteCount: mesh.byteLength,
    claimedSha256: await fingerprintResourceBytes(mesh),
  }, {
    handle: "step-handle",
    basename: "result.step",
    kind: "file",
    claimedByteCount: step.byteLength,
    claimedSha256: await fingerprintResourceBytes(step),
  }];
  const events: string[] = [];
  const backend = new FakeBackend({ inventory, bytes, events });
  const cas = new FakeCas();
  cas.events = events;
  return { request, inventory, bytes, backend, cas, events };
}

function runnerFor(
  backend: FakeBackend,
  cas: FakeCas,
  overrides: {
    readonly runtime?: IsolatedCodeRuntimeAttestation;
    readonly maximumSourceBytes?: number;
    readonly minimumDestructionAssurance?: "acknowledged-unattested" | "proven";
    readonly validateOutput?: (
      declaration: IsolatedCodeExecutionRequest["outputs"][number],
      bytes: Uint8Array,
    ) => void | Promise<void>;
  } = {},
): BrokeredIsolatedCodeRunner<FakeLease, string> {
  return new BrokeredIsolatedCodeRunner({
    backend,
    cas,
    profile: PROFILE,
    maximumSourceBytes: overrides.maximumSourceBytes ?? 262_144,
    outputManifest: requestOutputManifest(),
    policy: POLICY,
    runtime: overrides.runtime ?? RUNTIME,
    minimumDestructionAssurance: overrides.minimumDestructionAssurance ?? "proven",
    validateOutput: overrides.validateOutput ?? (() => undefined),
  });
}

function reportFixture(
  runtime: IsolatedCodeRuntimeAttestation = RUNTIME,
): EphemeralExecutionReport {
  return {
    runtime,
    termination: { kind: "exited", exitCode: 0, signal: null },
    logs: {
      stdout: { bytes: encoder.encode("ok\n"), truncated: false },
      stderr: { bytes: new Uint8Array(), truncated: false },
    },
  };
}

async function requestFixture(): Promise<IsolatedCodeExecutionRequest> {
  const source = encoder.encode("result = make_part()\n");
  return {
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId: "run:compile-001",
    producerGeneration: 0,
    profile: PROFILE,
    source: {
      bytes: source,
      sha256: await fingerprintResourceBytes(source),
    },
    policy: POLICY,
    outputs: requestOutputManifest(),
  };
}

function requestOutputManifest() {
  return [{
    role: "mesh",
    basename: "result.msh",
    mediaType: "application/vnd.gmsh",
    format: "gmsh",
  }, {
    role: "geometry",
    basename: "result.step",
    mediaType: "model/step",
    format: "step-ap242",
  }];
}

async function expectCode(
  action: () => Promise<unknown>,
  expected: BrokeredIsolatedCodeRunnerErrorCode,
): Promise<void> {
  await captureCode(action, expected);
}

async function captureCode(
  action: () => Promise<unknown>,
  expected: BrokeredIsolatedCodeRunnerErrorCode,
): Promise<BrokeredIsolatedCodeRunnerError> {
  let observed: unknown;
  try {
    await action();
  } catch (error) {
    observed = error;
  }
  assertEquals(observed instanceof BrokeredIsolatedCodeRunnerError, true);
  assertEquals((observed as BrokeredIsolatedCodeRunnerError).code, expected);
  return observed as BrokeredIsolatedCodeRunnerError;
}

function privateFailure(secret: string, capability: object): Error {
  const failure = new Error(secret);
  Object.defineProperty(failure, "cause", {
    value: capability,
    enumerable: false,
  });
  return failure;
}

function assertOpaquePublicError(
  error: BrokeredIsolatedCodeRunnerError,
  expectedMessage: string,
  privateError: Error,
  capability: object,
  secretFragments: readonly string[],
): void {
  assertEquals(error.message, expectedMessage);
  assertEquals(Object.prototype.hasOwnProperty.call(error, "cause"), false);
  assertEquals("cause" in error, false);
  const publicValues = Reflect.ownKeys(error).map((key) =>
    Object.getOwnPropertyDescriptor(error, key)?.value
  );
  assertEquals(publicValues.includes(privateError), false);
  assertEquals(publicValues.includes(capability), false);
  const publicText = `${String(error)}\n${error.stack ?? ""}`;
  for (const secret of secretFragments) {
    assertEquals(publicText.includes(secret), false);
  }
}

async function privateBackendFailureScenario(
  stage: "execute" | "read" | "destroy",
) {
  const scenario = await happyScenario();
  const token = `PRIVATE_${stage.toUpperCase()}_TOKEN_649a`;
  const path = `PRIVATE_${stage.toUpperCase()}_PATH_d043`;
  const capability = { handle: token, path };
  const privateError = privateFailure(path, capability);
  const backend = new FakeBackend({
    inventory: scenario.inventory,
    bytes: scenario.bytes,
    ...(stage === "execute" ? { executeError: privateError } : {}),
    ...(stage === "read" ? { readError: privateError } : {}),
    ...(stage === "destroy"
      ? { destroyError: privateError, destroyByRunIdError: privateError }
      : {}),
  });
  const cas = new FakeCas();
  return {
    action: () => runnerFor(backend, cas).run(scenario.request),
    code: "infrastructure_failure" as const,
    message: stage === "execute"
      ? "The isolated execution backend did not return a report."
      : stage === "read"
      ? "A declared isolated output could not be read."
      : "Ephemeral environment destruction was not proven; no receipt or output is released.",
    privateError,
    capability,
    secretFragments: [token, path],
  };
}

async function privateBackendAccessorFailureScenario() {
  const scenario = await happyScenario();
  const token = "PRIVATE_REPORT_GETTER_CAPABILITY_77fa";
  const path = "PRIVATE_REPORT_GETTER_PATH_05b4";
  const capability = { sandboxHandle: token, path };
  const privateError = privateFailure(path, capability);
  const report = Object.defineProperties({}, {
    runtime: {
      enumerable: true,
      get: () => {
        throw privateError;
      },
    },
    termination: { enumerable: true, value: reportFixture().termination },
    logs: { enumerable: true, value: reportFixture().logs },
  });
  const backend = new FakeBackend({
    report,
    inventory: scenario.inventory,
    bytes: scenario.bytes,
  });
  const cas = new FakeCas();
  return {
    action: () => runnerFor(backend, cas).run(scenario.request),
    code: "backend_contract_violation" as const,
    message: "The isolated execution backend returned an invalid result.",
    privateError,
    capability,
    secretFragments: [token, path],
  };
}

async function privateBackendStructuralFailureScenario() {
  const scenario = await happyScenario();
  const token = "PRIVATE_REPORT_FIELD_CAPABILITY_61d7";
  const path = "PRIVATE_REPORT_EXTRA_FIELD_PATH_1af9";
  const capability = { sandboxHandle: token, path };
  const privateError = privateFailure(path, capability);
  const backend = new FakeBackend({
    report: {
      ...reportFixture(),
      [path]: privateError,
    },
    inventory: scenario.inventory,
    bytes: scenario.bytes,
  });
  const cas = new FakeCas();
  return {
    action: () => runnerFor(backend, cas).run(scenario.request),
    code: "backend_contract_violation" as const,
    message: "The isolated execution backend returned an invalid result.",
    privateError,
    capability,
    secretFragments: [token, path],
  };
}

async function privateCasFailureScenario() {
  const scenario = await happyScenario();
  const token = "PRIVATE_CAS_BATCH_CAPABILITY_c2db";
  const path = "PRIVATE_CAS_STAGING_PATH_d3a7";
  const capability = { batchHandle: token, path };
  const privateError = privateFailure(path, capability);
  scenario.cas.stageError = privateError;
  return {
    action: () => runnerFor(scenario.backend, scenario.cas).run(scenario.request),
    code: "cas_integrity_failed" as const,
    message: "The isolated output batch could not be staged atomically.",
    privateError,
    capability,
    secretFragments: [token, path],
  };
}
