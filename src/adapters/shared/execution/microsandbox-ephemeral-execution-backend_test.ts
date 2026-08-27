import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import type { EphemeralExecutionBackendRequest } from "../../../application/ports/out/compile/isolation/ephemeral-execution-backend.ts";
import type {
  IsolatedCodeExecutionLimits,
  IsolatedCodeOutputDeclaration,
  IsolatedCodePolicyRef,
  IsolatedCodeRuntimeAttestation,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { MICROSANDBOX_LOCAL_ISOLATION_CLASS } from "../../../domain/compile/isolation/local-isolation-runtime.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  assertMicrosandboxNativeEnvironment,
  type MicrosandboxCreateRequest,
  MicrosandboxEphemeralExecutionBackend,
  type MicrosandboxEphemeralExecutionBackendOptions,
  type MicrosandboxExecEvent,
  type MicrosandboxExecHandle,
  type MicrosandboxFileSystem,
  type MicrosandboxFsEntry,
  type MicrosandboxKnownSandbox,
  type MicrosandboxSdk,
  type MicrosandboxSession,
} from "./microsandbox-ephemeral-execution-backend.ts";

const encoder = new TextEncoder();
const IMAGE_DIGEST = "1".repeat(64);
const IMAGE_REFERENCE = `casys/test-worker@sha256:${IMAGE_DIGEST}`;
const PROFILE = Object.freeze({ id: "test-python-v1", version: "1.0.0" });
const POLICY: IsolatedCodePolicyRef = Object.freeze({
  id: "deny-all-test-v1",
  version: "1.0.0",
  fingerprint: Object.freeze({
    algorithm: "sha256" as const,
    digest: "2".repeat(64),
  }),
});
const OUTPUTS: readonly IsolatedCodeOutputDeclaration[] = Object.freeze([
  Object.freeze({
    role: "result",
    basename: "result.bin",
    mediaType: "application/octet-stream",
    format: "binary",
  }),
]);
const LIMITS: IsolatedCodeExecutionLimits = Object.freeze({
  maxWallTimeMs: 15,
  maxCpuTimeMs: 1_000,
  maxMemoryBytes: 64 * 1_048_576,
  maxProcesses: 4,
  maxStdoutBytes: 16,
  maxStderrBytes: 16,
  maxOutputFileBytes: 32,
  maxOutputTotalBytes: 32,
});
const RUNTIME: IsolatedCodeRuntimeAttestation = Object.freeze({
  isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  imageDigest: Object.freeze({ algorithm: "sha256" as const, digest: IMAGE_DIGEST }),
  requestedLimits: LIMITS,
  limitAssurance: Object.freeze({
    maxWallTimeMs: "backend-attested" as const,
    maxCpuTimeMs: "unattested" as const,
    maxMemoryBytes: "backend-attested" as const,
    maxProcesses: "unattested" as const,
    maxStdoutBytes: "broker-observed-cap" as const,
    maxStderrBytes: "broker-observed-cap" as const,
    maxOutputFileBytes: "broker-observed-cap" as const,
    maxOutputTotalBytes: "broker-observed-cap" as const,
  }),
});
const QUIESCENCE_BYTES = encoder.encode(
  '{"schemaVersion":"casys-test-worker-quiescence/1.0","status":"descendants-killed-and-reaped"}\n',
);
const RUN_ID = "run:microsandbox-test-001";
const RUN_LABEL = "io.casys.execution-run";
const PROFILE_LABEL = "io.casys.execution-profile";

Deno.test("Microsandbox native loading admits only version check one and its exact code-owned configuration", () => {
  const forbidden = [
    "NAPI_RS_NATIVE_LIBRARY_PATH",
    "NAPI_RS_FORCE_WASI",
    "NAPI_RS_WASI_FLAVOR",
    "MSB_PATH",
    "MSB_LIBKRUNFW_PATH",
    "MSB_CONFIG_PATH",
    "MSB_HOME",
    "MSB_BACKEND",
    "MSB_API_URL",
    "MSB_API_KEY",
    "MSB_PROFILE",
  ] as const;

  assertMicrosandboxNativeEnvironment({});
  assertMicrosandboxNativeEnvironment({ NAPI_RS_ENFORCE_VERSION_CHECK: "1" });
  for (const name of forbidden) {
    assertThrows(
      () => assertMicrosandboxNativeEnvironment({ [name]: "" }),
      Error,
      name,
    );
  }
  assertThrows(
    () => assertMicrosandboxNativeEnvironment({ NAPI_RS_ENFORCE_VERSION_CHECK: "0" }),
    Error,
    "must equal 1",
  );

  const codeOwnedConfigurationPath = "/code-owned/microsandbox-local.json";
  assertMicrosandboxNativeEnvironment(
    { MSB_CONFIG_PATH: codeOwnedConfigurationPath },
    codeOwnedConfigurationPath,
  );
  assertThrows(
    () =>
      assertMicrosandboxNativeEnvironment(
        { MSB_CONFIG_PATH: "/ambient/microsandbox.json" },
        codeOwnedConfigurationPath,
      ),
    Error,
    "MSB_CONFIG_PATH",
  );
});

Deno.test("Microsandbox creation fixes the local image configuration and copies only admitted source bytes", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const request = await requestFor(backend);
  const lease = await backend.create(request);
  const runDigest = await sha256HexText(RUN_ID);
  const expectedName = `casys-${runDigest.slice(0, 48)}`;

  assertEquals(sdk.localAssertions, 1);
  assertEquals(sdk.inspectedReferences, [IMAGE_REFERENCE]);
  assertEquals(sdk.createRequests, [{
    name: expectedName,
    imageReference: IMAGE_REFERENCE,
    labels: {
      [RUN_LABEL]: runDigest,
      [PROFILE_LABEL]: `${PROFILE.id}@${PROFILE.version}`,
      "io.casys.producer-generation": "0",
    },
    cpus: 1,
    memoryMiB: 64,
    rootDiskMiB: 256,
    workdir: "/work",
    user: "0:0",
    maxDurationSeconds: 1,
    maxProcesses: 4,
    maxOpenFiles: 64,
  }]);
  assertEquals(lease.session.name, expectedName);
  assertEquals(sdk.createdSessions[0]?.fileSystemValue.writes, [{
    path: "/work/source.py",
    bytes: request.source.bytes,
  }]);
});

Deno.test("Microsandbox attests a shared image entrypoint while executing a distinct fixed command", async () => {
  const imageEntrypoint = [
    "/usr/local/bin/deno",
    "run",
    "/opt/casys/profiles/qualified-kit/run.ts",
  ];
  const sdk = new FakeMicrosandboxSdk({
    imageEntrypoint,
    nextExecHandle: FakeExecHandle.completed([{ kind: "exited", code: 23 }]),
  });
  const backend = backendFor(sdk, { expectedImageEntrypoint: imageEntrypoint });
  const lease = await backend.create(await requestFor(backend));

  assertEquals((await backend.execute(lease)).termination, {
    kind: "exited",
    exitCode: 23,
    signal: null,
  });
  assertEquals(sdk.createdSessions[0]?.executeCalls, [{
    executable: "/usr/local/bin/python3",
    args: ["-I", "-B", "/opt/casys/run.py"],
    cwd: "/work",
    user: "0:0",
    maxProcesses: 4,
    maxOpenFiles: 64,
  }]);
});

Deno.test("Microsandbox still rejects a shared image whose entrypoint differs from its exact declared identity", async () => {
  const sdk = new FakeMicrosandboxSdk({
    imageEntrypoint: [
      "/usr/local/bin/deno",
      "run",
      "/opt/casys/profiles/qualified-kit/run.ts",
    ],
  });
  const backend = backendFor(sdk, {
    expectedImageEntrypoint: [
      "/usr/local/bin/deno",
      "run",
      "/opt/casys/profiles/another-kit/run.ts",
    ],
  });
  const request = await requestFor(backend);

  await assertRejects(
    () => backend.create(request),
    Error,
    "cached local OCI image",
  );
  assertEquals(sdk.createRequests, []);
});

Deno.test("Microsandbox creation rejects a source whose declared digest does not match its bytes", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const request = await requestFor(backend);

  await assertRejects(
    () =>
      backend.create({
        ...request,
        source: { ...request.source, sha256: "f".repeat(64) },
      }),
    Error,
    "source",
  );
  assertEquals(sdk.inspectedReferences, []);
  assertEquals(sdk.createRequests, []);
});

Deno.test("Microsandbox host timeout bounds a kill acknowledgement that never resolves", async () => {
  const handle = FakeExecHandle.blockedUntilKilled({
    hangKillAcknowledgement: true,
  });
  const sdk = new FakeMicrosandboxSdk({ nextExecHandle: handle });
  const backend = backendFor(sdk);
  const lease = await backend.create(await requestFor(backend));

  const report = await withTestDeadline(backend.execute(lease), 1_600);

  assertEquals(report.termination, {
    kind: "timed-out",
    exitCode: null,
    signal: null,
  });
  assertEquals(handle.killCalls, 1);
  assertEquals(handle.waitCalls, 0);
  assert(handle.disposed);
});

Deno.test("Microsandbox execution rejects undefined and unknown native events before waiting", async () => {
  for (
    const event of [
      undefined,
      { kind: "failed", message: "native failure" },
      { kind: "stdin_error", message: "native stdin failure" },
    ]
  ) {
    const handle = FakeExecHandle.unsafe([event]);
    const sdk = new FakeMicrosandboxSdk({ nextExecHandle: handle });
    const backend = backendFor(sdk);
    const lease = await backend.create(await requestFor(backend));

    await assertRejects(
      () => backend.execute(lease),
      Error,
      "invalid execution event",
    );
    assertEquals(handle.waitCalls, 0);
  }
});

Deno.test("Microsandbox success trusts exact quiescence and image-owned log captures before exposing outputs", async () => {
  const handle = FakeExecHandle.completed([
    { kind: "started", pid: 41 },
    { kind: "stdout", data: encoder.encode("untrusted-stream") },
    { kind: "exited", code: 0 },
  ]);
  const sdk = new FakeMicrosandboxSdk({ nextExecHandle: handle });
  const backend = backendFor(sdk);
  const lease = await backend.create(await requestFor(backend));
  const fileSystem = sdk.createdSessions[0]!.fileSystemValue;
  fileSystem.setFile("/run/casys/quiesced.json", QUIESCENCE_BYTES, 0o400);
  fileSystem.setFile("/run/casys/stdout.bin", encoder.encode("captured-out"), 0o400);
  fileSystem.setFile("/run/casys/stderr.bin", encoder.encode("captured-err"), 0o400);
  fileSystem.setFile("/out/result.bin", new Uint8Array([1, 2, 3]), 0o400);

  const report = await backend.execute(lease);
  const inventory = await backend.inventory(lease);

  assertEquals(report.termination, { kind: "exited", exitCode: 0, signal: null });
  assertEquals(report.logs.stdout, {
    bytes: encoder.encode("captured-out"),
    truncated: false,
  });
  assertEquals(report.logs.stderr, {
    bytes: encoder.encode("captured-err"),
    truncated: false,
  });
  assertEquals(sdk.createdSessions[0]?.executeCalls, [{
    executable: "/usr/local/bin/python3",
    args: ["-I", "-B", "/opt/casys/run.py"],
    cwd: "/work",
    user: "0:0",
    maxProcesses: 4,
    maxOpenFiles: 64,
  }]);
  assertEquals(inventory, [{
    handle: "/out/result.bin",
    basename: "result.bin",
    kind: "file",
    claimedByteCount: 3,
    claimedSha256: await fingerprintResourceBytes(new Uint8Array([1, 2, 3])),
  }]);
  assertEquals(handle.waitCalls, 0);
});

Deno.test("Microsandbox output reads preserve a zero-byte caller bound", async () => {
  const sdk = new FakeMicrosandboxSdk({
    nextExecHandle: FakeExecHandle.completed([{ kind: "exited", code: 0 }]),
  });
  const backend = backendFor(sdk);
  const lease = await backend.create(await requestFor(backend));
  const fileSystem = sdk.createdSessions[0]!.fileSystemValue;
  fileSystem.setFile("/run/casys/quiesced.json", QUIESCENCE_BYTES, 0o400);
  fileSystem.setFile("/run/casys/stdout.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/run/casys/stderr.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/out/result.bin", new Uint8Array(), 0o400);
  await backend.execute(lease);
  await backend.inventory(lease);

  assertEquals(await backend.readOutput(lease, "/out/result.bin", 0), new Uint8Array());

  fileSystem.setFile("/out/result.bin", new Uint8Array([1]), 0o400);
  await assertRejects(
    () => backend.readOutput(lease, "/out/result.bin", 0),
    Error,
    "exceeds its read bound",
  );
});

Deno.test("Microsandbox run recovery destroys only the deterministic name with exact configuration", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const runDigest = await sha256HexText(RUN_ID);
  const name = `casys-${runDigest.slice(0, 48)}`;
  const labels = {
    [RUN_LABEL]: runDigest,
    [PROFILE_LABEL]: `${PROFILE.id}@${PROFILE.version}`,
  };
  const known = sdk.installKnown(name, sandboxConfig(createRequest(name, labels)));

  const destruction = await backend.destroyByRunId(RUN_ID);

  assertEquals(destruction.status, "proven");
  assertEquals(sdk.getByNameCalls, [name, name]);
  assertEquals(known.killTimeouts, [5_000]);
  assertEquals(known.waitCalls, 1);
  assertEquals(known.removeCalls, 1);
  assertEquals(sdk.listLabelCalls, [labels, labels]);
});

Deno.test("Microsandbox run recovery refuses configuration label drift before killing", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const runDigest = await sha256HexText(RUN_ID);
  const name = `casys-${runDigest.slice(0, 48)}`;
  const labels = {
    [RUN_LABEL]: runDigest,
    [PROFILE_LABEL]: `${PROFILE.id}@${PROFILE.version}`,
  };
  const config = sandboxConfig(createRequest(name, labels));
  const known = sdk.installKnown(name, {
    ...config,
    labels: { ...config.labels, [PROFILE_LABEL]: "foreign@9.9.9" },
  });

  await assertRejects(
    () => backend.destroyByRunId(RUN_ID),
    Error,
    "label",
  );
  assertEquals(known.killTimeouts, []);
  assertEquals(known.removeCalls, 0);
});

Deno.test("Microsandbox run recovery refuses a foreign sandbox carrying the run labels", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const runDigest = await sha256HexText(RUN_ID);
  const labels = {
    [RUN_LABEL]: runDigest,
    [PROFILE_LABEL]: `${PROFILE.id}@${PROFILE.version}`,
  };
  const foreign = sdk.installKnown(
    "foreign-sandbox",
    sandboxConfig(createRequest("foreign-sandbox", labels)),
  );

  await assertRejects(
    () => backend.destroyByRunId(RUN_ID),
    Error,
    "foreign sandbox",
  );
  assertEquals(foreign.killTimeouts, []);
  assertEquals(foreign.removeCalls, 0);
});

Deno.test("Microsandbox run recovery bounds a remove acknowledgement that never resolves", async () => {
  const sdk = new FakeMicrosandboxSdk();
  const backend = backendFor(sdk);
  const runDigest = await sha256HexText(RUN_ID);
  const name = `casys-${runDigest.slice(0, 48)}`;
  const labels = {
    [RUN_LABEL]: runDigest,
    [PROFILE_LABEL]: `${PROFILE.id}@${PROFILE.version}`,
  };
  const known = sdk.installKnown(
    name,
    sandboxConfig(createRequest(name, labels)),
    { hangRemoveAcknowledgement: true },
  );

  await assertRejects(
    () => withTestDeadline(backend.destroyByRunId(RUN_ID), 5_750),
    Error,
    "Operation deadline exceeded",
  );
  assertEquals(known.removeCalls, 1);
});

class FakeFileSystem implements MicrosandboxFileSystem {
  readonly files = new Map<
    string,
    { readonly bytes: Uint8Array; readonly mode: number; readonly kind: "file" }
  >();
  readonly writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];

  write(path: string, bytes: Uint8Array): Promise<void> {
    const copy = Uint8Array.from(bytes);
    this.writes.push({ path, bytes: copy });
    this.setFile(path, copy, 0o600);
    return Promise.resolve();
  }

  list(path: string): Promise<readonly MicrosandboxFsEntry[]> {
    const prefix = path === "/" ? "/" : `${path}/`;
    const entries: MicrosandboxFsEntry[] = [];
    for (const [candidate, file] of this.files) {
      if (!candidate.startsWith(prefix)) continue;
      const relative = candidate.slice(prefix.length);
      if (relative.length === 0 || relative.includes("/")) continue;
      entries.push({
        path: candidate,
        kind: file.kind,
        size: file.bytes.byteLength,
        mode: file.mode,
      });
    }
    return Promise.resolve(entries);
  }

  async *readChunks(path: string): AsyncIterable<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`missing fake file ${path}`);
    yield Uint8Array.from(file.bytes);
  }

  setFile(path: string, bytes: Uint8Array, mode: number): void {
    this.files.set(path, {
      bytes: Uint8Array.from(bytes),
      mode,
      kind: "file",
    });
  }
}

class FakeExecHandle implements MicrosandboxExecHandle {
  readonly #events: readonly unknown[];
  readonly #blocked: boolean;
  readonly #hangKillAcknowledgement: boolean;
  readonly #pending = Promise.withResolvers<MicrosandboxExecEvent | null>();
  #eventIndex = 0;
  #drained = false;
  killCalls = 0;
  waitCalls = 0;
  disposed = false;

  private constructor(
    events: readonly unknown[],
    blocked: boolean,
    hangKillAcknowledgement: boolean,
  ) {
    this.#events = [...events];
    this.#blocked = blocked;
    this.#hangKillAcknowledgement = hangKillAcknowledgement;
  }

  static completed(events: readonly MicrosandboxExecEvent[]): FakeExecHandle {
    return new FakeExecHandle(events, false, false);
  }

  static unsafe(events: readonly unknown[]): FakeExecHandle {
    return new FakeExecHandle(events, false, false);
  }

  static blockedUntilKilled(
    options: { readonly hangKillAcknowledgement?: boolean } = {},
  ): FakeExecHandle {
    return new FakeExecHandle(
      [],
      true,
      options.hangKillAcknowledgement ?? false,
    );
  }

  receive(): Promise<MicrosandboxExecEvent | null> {
    if (this.#eventIndex < this.#events.length) {
      const event = this.#events[this.#eventIndex++];
      return Promise.resolve(event as MicrosandboxExecEvent | null);
    }
    if (!this.#blocked || this.killCalls > 0) {
      this.#drained = true;
      return Promise.resolve(null);
    }
    return this.#pending.promise;
  }

  kill(): Promise<void> {
    this.killCalls += 1;
    this.#drained = true;
    this.#pending.resolve(null);
    if (this.#hangKillAcknowledgement) return new Promise(() => {});
    return Promise.resolve();
  }

  wait(): Promise<{ readonly code: number; readonly success: boolean }> {
    this.waitCalls += 1;
    if (this.#drained) {
      return Promise.reject(
        new Error("wait must not be called after the native event stream drained"),
      );
    }
    return Promise.resolve({
      code: this.killCalls > 0 ? 137 : 0,
      success: this.killCalls === 0,
    });
  }

  [Symbol.asyncDispose](): Promise<void> {
    this.disposed = true;
    return Promise.resolve();
  }
}

class FakeSession implements MicrosandboxSession {
  readonly ownsLifecycle = true;
  readonly fileSystemValue = new FakeFileSystem();
  readonly executeCalls: Array<{
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly user: string;
    readonly maxProcesses: number;
    readonly maxOpenFiles: number;
  }> = [];
  readonly killTimeouts: number[] = [];
  waitCalls = 0;
  removeCalls = 0;

  constructor(
    readonly name: string,
    readonly configValue: unknown,
    readonly execHandle: FakeExecHandle,
    readonly onRemove: () => void,
  ) {}

  config(): Promise<unknown> {
    return Promise.resolve(this.configValue);
  }

  fileSystem(): MicrosandboxFileSystem {
    return this.fileSystemValue;
  }

  executeStream(value: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly user: string;
    readonly maxProcesses: number;
    readonly maxOpenFiles: number;
  }): Promise<MicrosandboxExecHandle> {
    this.executeCalls.push({ ...value, args: [...value.args] });
    return Promise.resolve(this.execHandle);
  }

  killWithTimeout(timeoutMs: number): Promise<void> {
    this.killTimeouts.push(timeoutMs);
    return Promise.resolve();
  }

  waitUntilStopped(): Promise<void> {
    this.waitCalls += 1;
    return Promise.resolve();
  }

  remove(): Promise<void> {
    this.removeCalls += 1;
    this.onRemove();
    return Promise.resolve();
  }
}

class FakeKnownSandbox implements MicrosandboxKnownSandbox {
  readonly killTimeouts: number[] = [];
  waitCalls = 0;
  removeCalls = 0;

  constructor(
    readonly name: string,
    readonly configValue: unknown,
    readonly onRemove: () => void,
    readonly hangRemoveAcknowledgement = false,
  ) {}

  config(): unknown {
    return this.configValue;
  }

  killWithTimeout(timeoutMs: number): Promise<void> {
    this.killTimeouts.push(timeoutMs);
    return Promise.resolve();
  }

  waitUntilStopped(): Promise<void> {
    this.waitCalls += 1;
    return Promise.resolve();
  }

  remove(): Promise<void> {
    this.removeCalls += 1;
    if (this.hangRemoveAcknowledgement) return new Promise(() => {});
    this.onRemove();
    return Promise.resolve();
  }
}

class FakeMicrosandboxSdk implements MicrosandboxSdk {
  readonly inspectedReferences: string[] = [];
  readonly createRequests: MicrosandboxCreateRequest[] = [];
  readonly createdSessions: FakeSession[] = [];
  readonly listLabelCalls: Array<Readonly<Record<string, string>>> = [];
  readonly getByNameCalls: string[] = [];
  readonly #known = new Map<string, FakeKnownSandbox>();
  readonly #nextExecHandle: FakeExecHandle;
  readonly #imageEntrypoint: readonly string[];
  localAssertions = 0;

  constructor(
    options: {
      readonly nextExecHandle?: FakeExecHandle;
      readonly imageEntrypoint?: readonly string[];
    } = {},
  ) {
    this.#nextExecHandle = options.nextExecHandle ?? FakeExecHandle.completed([
      { kind: "exited", code: 0 },
    ]);
    this.#imageEntrypoint = options.imageEntrypoint ?? [
      "/usr/local/bin/python3",
      "-I",
      "-B",
      "/opt/casys/run.py",
    ];
  }

  assertLocalBackend(): void {
    this.localAssertions += 1;
  }

  inspectImage(reference: string): Promise<{
    readonly reference: string;
    readonly manifestDigest: string;
    readonly architecture: string;
    readonly os: string;
    readonly user: string | null;
    readonly entrypoint: readonly string[] | null;
    readonly command: readonly string[] | null;
    readonly environment: Readonly<Record<string, string>>;
    readonly labels: Readonly<Record<string, string>>;
  }> {
    this.inspectedReferences.push(reference);
    return Promise.resolve({
      reference,
      manifestDigest: `sha256:${IMAGE_DIGEST}`,
      architecture: hostArchitecture(),
      os: "linux",
      user: "0:0",
      entrypoint: this.#imageEntrypoint,
      command: null,
      environment: {},
      labels: { [PROFILE_LABEL]: "image-owned-unversioned-profile" },
    });
  }

  create(request: MicrosandboxCreateRequest): Promise<MicrosandboxSession> {
    const captured: MicrosandboxCreateRequest = {
      ...request,
      labels: { ...request.labels },
    };
    this.createRequests.push(captured);
    const session = new FakeSession(
      request.name,
      sandboxConfig(captured, this.#imageEntrypoint),
      this.#nextExecHandle,
      () => this.#known.delete(request.name),
    );
    this.createdSessions.push(session);
    this.installKnown(
      request.name,
      sandboxConfig(captured, this.#imageEntrypoint),
    );
    return Promise.resolve(session);
  }

  listByLabels(
    labels: Readonly<Record<string, string>>,
  ): Promise<readonly MicrosandboxKnownSandbox[]> {
    this.listLabelCalls.push({ ...labels });
    return Promise.resolve([...this.#known.values()].filter((sandbox) => {
      const config = sandbox.config() as { readonly labels?: Record<string, string> };
      return Object.entries(labels).every(([key, value]) =>
        config.labels?.[key] === value
      );
    }));
  }

  getByName(name: string): Promise<MicrosandboxKnownSandbox | undefined> {
    this.getByNameCalls.push(name);
    return Promise.resolve(this.#known.get(name));
  }

  installKnown(
    name: string,
    config: unknown,
    options: { readonly hangRemoveAcknowledgement?: boolean } = {},
  ): FakeKnownSandbox {
    const known = new FakeKnownSandbox(
      name,
      config,
      () => this.#known.delete(name),
      options.hangRemoveAcknowledgement ?? false,
    );
    this.#known.set(name, known);
    return known;
  }
}

function backendFor(
  sdk: MicrosandboxSdk,
  overrides: Partial<MicrosandboxEphemeralExecutionBackendOptions> = {},
): MicrosandboxEphemeralExecutionBackend {
  const options: MicrosandboxEphemeralExecutionBackendOptions = {
    sdk,
    imageReference: IMAGE_REFERENCE,
    expectedImageUser: "0:0",
    executable: "/usr/local/bin/python3",
    args: ["-I", "-B", "/opt/casys/run.py"],
    workdir: "/work",
    sourcePath: "/work/source.py",
    outputDirectory: "/out",
    controlFiles: {
      quiescencePath: "/run/casys/quiesced.json",
      quiescenceBytes: QUIESCENCE_BYTES,
      stdoutPath: "/run/casys/stdout.bin",
      stderrPath: "/run/casys/stderr.bin",
    },
    profile: PROFILE,
    policy: POLICY,
    runtime: RUNTIME,
    outputManifest: OUTPUTS,
    cpus: 1,
    rootDiskMiB: 256,
    maxDurationMs: 1_000,
    maxOpenFiles: 64,
    supervisorUser: "0:0",
    ...overrides,
  };
  return new MicrosandboxEphemeralExecutionBackend(options);
}

async function requestFor(
  backend: MicrosandboxEphemeralExecutionBackend,
): Promise<EphemeralExecutionBackendRequest> {
  const source = encoder.encode("result = object()\n");
  return Object.freeze({
    runId: RUN_ID,
    producerGeneration: 0,
    profile: PROFILE,
    source: Object.freeze({
      bytes: Uint8Array.from(source),
      sha256: await fingerprintResourceBytes(source),
    }),
    policy: POLICY,
    outputs: OUTPUTS,
    runtime: backend.runtime,
  });
}

function createRequest(
  name: string,
  labels: Readonly<Record<string, string>>,
): MicrosandboxCreateRequest {
  return {
    name,
    imageReference: IMAGE_REFERENCE,
    labels: { ...labels },
    cpus: 1,
    memoryMiB: 64,
    rootDiskMiB: 256,
    workdir: "/work",
    user: "0:0",
    maxDurationSeconds: 1,
    maxProcesses: 4,
    maxOpenFiles: 64,
  };
}

function sandboxConfig(
  request: MicrosandboxCreateRequest,
  imageEntrypoint: readonly string[] = [
    "/usr/local/bin/python3",
    "-I",
    "-B",
    "/opt/casys/run.py",
  ],
) {
  return {
    name: request.name,
    image: {
      Oci: {
        reference: request.imageReference,
        rootDisk: { kind: "tmpfs", sizeMib: request.rootDiskMiB },
      },
    },
    resources: {
      cpus: request.cpus,
      memoryMib: request.memoryMiB,
      maxCpus: request.cpus,
      maxMemoryMib: request.memoryMiB,
    },
    runtime: {
      workdir: request.workdir,
      shell: null,
      scripts: {},
      entrypoint: [...imageEntrypoint],
      cmd: null,
      hostname: null,
      user: request.user,
      logLevel: null,
      metricsSampleIntervalMs: 1_000,
      disableMetricsSample: false,
    },
    env: [],
    labels: {
      [PROFILE_LABEL]: "image-owned-unversioned-profile",
      ...request.labels,
    },
    rlimits: [
      { resource: "Nproc", soft: request.maxProcesses, hard: request.maxProcesses },
      { resource: "Nofile", soft: request.maxOpenFiles, hard: request.maxOpenFiles },
    ],
    mounts: [{
      type: "Tmpfs",
      guest: "/tmp",
      sizeMib: Math.min(512, Math.max(1, Math.floor(request.memoryMiB / 4))),
      options: { readonly: false, noexec: false, nosuid: false, nodev: false },
    }],
    patches: [],
    network: {
      enabled: false,
      interface: {},
      ports: [],
      policy: { defaultEgress: "deny", defaultIngress: "deny", rules: [] },
      dns: { rebindProtection: true, nameservers: [], queryTimeoutMs: 5_000 },
      tls: {
        enabled: false,
        interceptedPorts: [443],
        bypass: [],
        verifyUpstream: true,
        blockQuicOnIntercept: true,
        upstreamCaCert: [],
        scopedUpstreamCaCert: [],
        scopedVerifyUpstream: [],
        interceptCa: { certPath: null, keyPath: null },
        cache: { capacity: 1_000, validityHours: 24 },
      },
      secrets: { secrets: [], onViolation: "block-and-log" },
      maxConnections: null,
      trustHostCas: false,
    },
    init: null,
    pullPolicy: "Never",
    securityProfile: "restricted",
    lifecycle: {
      ephemeral: false,
      maxDurationSecs: request.maxDurationSeconds,
      idleTimeoutSecs: null,
    },
    manifestDigest: `sha256:${IMAGE_DIGEST}`,
  };
}

function hostArchitecture(): string {
  if (Deno.build.arch === "aarch64") return "arm64";
  if (Deno.build.arch === "x86_64") return "amd64";
  throw new Error(`unsupported test architecture ${Deno.build.arch}`);
}

async function sha256HexText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function withTestDeadline<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<Value>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("test execution deadline exceeded")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
