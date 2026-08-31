/**
 * Adversarial escape suite for the Microsandbox execution backend.
 *
 * Contract-level cases use an in-process SDK fake and cover the fail-closed
 * guards that the neighboring contract suite does not already pin. Live
 * microVM cases run only when MSB_LIVE_ADVERSARIAL=1: the guest script tries
 * to escape, and the test asserts that the attempt cannot become a successful
 * isolated execution. Cleanup is always attempted, including on failure.
 */

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
  createLocalMicrosandboxSdk,
  type MicrosandboxCreateRequest,
  MicrosandboxEphemeralExecutionBackend,
  type MicrosandboxEphemeralExecutionBackendOptions,
  type MicrosandboxExecEvent,
  type MicrosandboxExecHandle,
  type MicrosandboxFileSystem,
  type MicrosandboxFsEntry,
  type MicrosandboxKnownSandbox,
  type MicrosandboxLease,
  type MicrosandboxSdk,
  type MicrosandboxSession,
} from "./microsandbox-ephemeral-execution-backend.ts";

const encoder = new TextEncoder();
const LIVE = Deno.env.get("MSB_LIVE_ADVERSARIAL") === "1";
const IMAGE_DIGEST = "1".repeat(64);
const IMAGE_REFERENCE = `casys/test-worker@sha256:${IMAGE_DIGEST}`;
const LIVE_IMAGE_DIGEST =
  "0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8";
const LIVE_IMAGE_REFERENCE =
  `casys/build123d-microsandbox-worker@sha256:${LIVE_IMAGE_DIGEST}`;
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
const LIVE_OUTPUTS: readonly IsolatedCodeOutputDeclaration[] = Object.freeze([
  Object.freeze({
    role: "geometry",
    basename: "geometry.step",
    mediaType: "model/step",
    format: "step-ap214",
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
const LIVE_QUIESCENCE_BYTES = encoder.encode(
  '{"schemaVersion":"casys-build123d-worker-quiescence/1.0","status":"descendants-killed-and-reaped"}\n',
);
const RUN_ID = "run:microsandbox-escape-001";

Deno.test("Microsandbox creation refuses a post-create network policy that is not deny-all", async () => {
  const rewrites: ReadonlyArray<(config: SandboxConfig) => SandboxConfig> = [
    (config) => {
      const next = cloneConfig(config);
      next.network.enabled = true;
      return next;
    },
    (config) => {
      const next = cloneConfig(config);
      next.network.policy.defaultEgress = "allow";
      return next;
    },
    (config) => {
      const next = cloneConfig(config);
      next.network.policy.defaultIngress = "allow";
      return next;
    },
  ];

  for (const rewrite of rewrites) {
    const sdk = new FakeMicrosandboxSdk({ configRewrite: rewrite });
    const backend = backendFor(sdk);
    const request = await requestFor(backend);
    await assertRejects(
      () => backend.create(request),
      Error,
      rewrite === rewrites[0]
        ? "configuration drifted"
        : "network policy is not deny-all",
    );
    assertEquals(sdk.createdSessions[0]?.fileSystemValue.writes, []);
  }
});

Deno.test("Microsandbox creation refuses a persistent root disk or a host mount", async () => {
  const rewrites: ReadonlyArray<(config: SandboxConfig) => SandboxConfig> = [
    (config) => {
      const next = cloneConfig(config);
      next.image.Oci.rootDisk = {
        kind: "file",
        path: "/var/lib/msb/disk.img",
        sizeMib: next.image.Oci.rootDisk.sizeMib,
      };
      return next;
    },
    (config) => {
      const next = cloneConfig(config);
      next.mounts = [{
        type: "Bind",
        guest: "/host",
        host: "/Users/escape",
        options: {
          readonly: true,
          noexec: true,
          nosuid: true,
          nodev: true,
        },
      }];
      return next;
    },
  ];

  for (const rewrite of rewrites) {
    const sdk = new FakeMicrosandboxSdk({ configRewrite: rewrite });
    const backend = backendFor(sdk);
    const request = await requestFor(backend);
    await assertRejects(
      () => backend.create(request),
      Error,
      rewrite === rewrites[0] ? "configuration drifted" : "unsupported mount",
    );
    assertEquals(sdk.createdSessions[0]?.fileSystemValue.writes, []);
  }
});

Deno.test("Microsandbox execution refuses an output handle that escapes the declared directory", async () => {
  assertThrows(
    () =>
      backendFor(new FakeMicrosandboxSdk(), {
        outputDirectory: "/out/../etc",
      }),
    TypeError,
    "canonical absolute guest path",
  );
  assertThrows(
    () =>
      backendFor(new FakeMicrosandboxSdk(), {
        sourcePath: "/work/../etc/passwd",
      }),
    TypeError,
    "canonical absolute guest path",
  );

  const sdk = new FakeMicrosandboxSdk({
    nextExecHandle: FakeExecHandle.completed([{ kind: "exited", code: 0 }]),
  });
  const backend = backendFor(sdk);
  const lease = await backend.create(await requestFor(backend));
  const fileSystem = sdk.createdSessions[0]!.fileSystemValue;
  fileSystem.setFile("/run/casys/quiesced.json", QUIESCENCE_BYTES, 0o400);
  fileSystem.setFile("/run/casys/stdout.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/run/casys/stderr.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/out/result.bin", new Uint8Array([1, 2, 3]), 0o400);
  fileSystem.setFile(
    "/etc/passwd",
    encoder.encode("root:x:0:0:root:/root:/bin/sh\n"),
    0o400,
  );
  await backend.execute(lease);
  await backend.inventory(lease);

  await assertRejects(
    () => backend.readOutput(lease, "/out/../etc/passwd", 64),
    Error,
    "not declared",
  );
  await assertRejects(
    () => backend.readOutput(lease, "/etc/passwd", 64),
    Error,
    "not declared",
  );
  assertEquals(
    await backend.readOutput(lease, "/out/result.bin", 32),
    new Uint8Array([1, 2, 3]),
  );
});

Deno.test("Microsandbox inventory refuses an output whose listed size does not match the reread bytes", async () => {
  const sdk = new FakeMicrosandboxSdk({
    nextExecHandle: FakeExecHandle.completed([{ kind: "exited", code: 0 }]),
  });
  const backend = backendFor(sdk);
  const lease = await backend.create(await requestFor(backend));
  const fileSystem = sdk.createdSessions[0]!.fileSystemValue;
  fileSystem.setFile("/run/casys/quiesced.json", QUIESCENCE_BYTES, 0o400);
  fileSystem.setFile("/run/casys/stdout.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/run/casys/stderr.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/out/result.bin", new Uint8Array([1, 2, 3, 4]), 0o400);
  fileSystem.listedSizes.set("/out/result.bin", 3);
  await backend.execute(lease);

  await assertRejects(
    () => backend.inventory(lease),
    Error,
    "changed during inventory",
  );
});

Deno.test("Microsandbox execution refuses to expose outputs after a stdout or output-file cap overflow", async () => {
  const overflowingHandle = FakeExecHandle.completed([
    { kind: "started", pid: 7 },
    { kind: "stdout", data: encoder.encode("this-exceeds-sixteen") },
    { kind: "exited", code: 0 },
  ]);
  const streamSdk = new FakeMicrosandboxSdk({ nextExecHandle: overflowingHandle });
  const streamBackend = backendFor(streamSdk);
  const streamLease = await streamBackend.create(await requestFor(streamBackend));
  const streamReport = await streamBackend.execute(streamLease);

  assertEquals(streamReport.termination, {
    kind: "resource-limit",
    exitCode: null,
    signal: null,
  });
  await assertRejects(
    () => streamBackend.inventory(streamLease),
    Error,
    "before exact quiescence",
  );

  const fileSdk = new FakeMicrosandboxSdk({
    nextExecHandle: FakeExecHandle.completed([{ kind: "exited", code: 0 }]),
  });
  const fileBackend = backendFor(fileSdk);
  const fileLease = await fileBackend.create(await requestFor(fileBackend));
  const fileSystem = fileSdk.createdSessions[0]!.fileSystemValue;
  fileSystem.setFile("/run/casys/quiesced.json", QUIESCENCE_BYTES, 0o400);
  fileSystem.setFile("/run/casys/stdout.bin", new Uint8Array(), 0o400);
  fileSystem.setFile("/run/casys/stderr.bin", new Uint8Array(), 0o400);
  fileSystem.setFile(
    "/out/result.bin",
    new Uint8Array(LIMITS.maxOutputFileBytes + 1),
    0o400,
  );
  await fileBackend.execute(fileLease);

  await assertRejects(
    () => fileBackend.inventory(fileLease),
    Error,
    "exceeds its read bound",
  );
});

Deno.test({
  name: "Microsandbox live execution refuses guest network egress",
  ignore: !LIVE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const source = [
      "import socket",
      "try:",
      '    socket.create_connection(("1.1.1.1", 443), timeout=2).close()',
      "except OSError as error:",
      '    raise RuntimeError("network denied") from error',
      "from build123d import Box",
      "result = Box(10, 20, 30)",
      "",
    ].join("\n");
    await runLiveEscape(source, {}, async (report, backend, lease) => {
      assertEscapeDidNotSucceed(report);
      await assertInventoryRefused(backend, lease);
    });
  },
});

Deno.test({
  name: "Microsandbox live execution refuses host path and host environment disclosure",
  ignore: !LIVE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const token = crypto.randomUUID();
    const hostHome = Deno.env.get("HOME") ?? "";
    assert(hostHome.startsWith("/"), "live host HOME must be an absolute path");
    const canaryDirectory = await Deno.makeTempDir({
      prefix: "casys-msb-escape-canary-",
    });
    const canaryPath = `${canaryDirectory}/host-canary.txt`;
    const hostPasswd = await Deno.readTextFile("/etc/passwd");
    await Deno.writeTextFile(canaryPath, token);
    Deno.env.set("CASYS_ADVERSARIAL_SECRET", token);

    const source = [
      "import os",
      "from pathlib import Path",
      `token = ${JSON.stringify(token)}`,
      `canary = Path(${JSON.stringify(canaryPath)})`,
      `host_home = Path(${JSON.stringify(hostHome)})`,
      `host_passwd = ${JSON.stringify(hostPasswd)}`,
      "escaped = False",
      "try:",
      "    escaped = escaped or canary.read_text() == token",
      "except OSError:",
      "    pass",
      "try:",
      '    escaped = escaped or Path("/etc/passwd").read_text() == host_passwd',
      "except OSError:",
      "    pass",
      "try:",
      "    escaped = escaped or (host_home.is_dir() and any(host_home.iterdir()))",
      "except OSError:",
      "    pass",
      'escaped = escaped or os.environ.get("CASYS_ADVERSARIAL_SECRET") == token',
      'escaped = escaped or os.environ.get("HOME") == str(host_home)',
      // A successful disclosure must exit 0 so the run reads as a successful
      // isolated execution and assertEscapeDidNotSucceed fails. Raising in
      // both branches would make the test pass whether or not the guest saw
      // host state.
      "if not escaped:",
      '    raise RuntimeError("host disclosure denied")',
      "from build123d import Box",
      "result = Box(10, 20, 30)",
      "",
    ].join("\n");

    try {
      await runLiveEscape(source, {}, async (report, backend, lease) => {
        assertEscapeDidNotSucceed(report);
        await assertInventoryRefused(backend, lease);
      });
    } finally {
      Deno.env.delete("CASYS_ADVERSARIAL_SECRET");
      await Deno.remove(canaryDirectory, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: "Microsandbox live execution refuses a write onto the host filesystem",
  ignore: !LIVE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const probeDirectory = await Deno.makeTempDir({
      prefix: "casys-msb-escape-write-",
    });
    const probePath = `${probeDirectory}/written-from-guest`;
    const source = [
      "from pathlib import Path",
      `probe = Path(${JSON.stringify(probePath)})`,
      "try:",
      '    probe.write_text("escaped")',
      "except OSError as error:",
      '    raise RuntimeError("host write denied") from error',
      "from build123d import Box",
      "result = Box(10, 20, 30)",
      "",
    ].join("\n");

    try {
      await runLiveEscape(source, {}, async (report, backend, lease) => {
        assertEscapeDidNotSucceed(report);
        await assertInventoryRefused(backend, lease);
        await assertRejects(
          () => Deno.stat(probePath),
          Deno.errors.NotFound,
        );
      });
    } finally {
      await Deno.remove(probeDirectory, { recursive: true }).catch(() => undefined);
    }
  },
});

Deno.test({
  name: "Microsandbox live execution bounds a guest that exceeds the wall-time limit",
  ignore: !LIVE,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const source = [
      "import time",
      "time.sleep(30)",
      "from build123d import Box",
      "result = Box(10, 20, 30)",
      "",
    ].join("\n");
    await runLiveEscape(
      source,
      {
        maxWallTimeMs: 2_000,
        maxDurationMs: 8_000,
      },
      async (report, backend, lease) => {
        assertEquals(report.termination.kind, "timed-out");
        assertEscapeDidNotSucceed(report);
        await assertInventoryRefused(backend, lease);
      },
    );
  },
});

type ConfigRewrite = (config: SandboxConfig) => SandboxConfig;

interface SandboxConfig {
  name: string;
  image: {
    Oci: {
      reference: string;
      rootDisk: {
        kind: string;
        sizeMib: number;
        path?: string;
      };
    };
  };
  resources: {
    cpus: number;
    memoryMib: number;
    maxCpus: number;
    maxMemoryMib: number;
  };
  runtime: {
    workdir: string;
    shell: null;
    scripts: Record<string, never>;
    entrypoint: readonly string[];
    cmd: null;
    hostname: null;
    user: string;
    logLevel: null;
    metricsSampleIntervalMs: number;
    disableMetricsSample: boolean;
  };
  env: unknown[];
  labels: Record<string, string>;
  rlimits: Array<{ resource: string; soft: number; hard: number }>;
  mounts: Array<{
    type: string;
    guest: string;
    host?: string;
    sizeMib?: number;
    options: {
      readonly: boolean;
      noexec: boolean;
      nosuid: boolean;
      nodev: boolean;
    };
  }>;
  patches: unknown[];
  network: {
    enabled: boolean;
    interface: Record<string, never>;
    ports: unknown[];
    policy: {
      defaultEgress: string;
      defaultIngress: string;
      rules: unknown[];
    };
    dns: {
      rebindProtection: boolean;
      nameservers: unknown[];
      queryTimeoutMs: number;
    };
    tls: {
      enabled: boolean;
      interceptedPorts: number[];
      bypass: unknown[];
      verifyUpstream: boolean;
      blockQuicOnIntercept: boolean;
      upstreamCaCert: unknown[];
      scopedUpstreamCaCert: unknown[];
      scopedVerifyUpstream: unknown[];
      interceptCa: { certPath: null; keyPath: null };
      cache: { capacity: number; validityHours: number };
    };
    secrets: { secrets: unknown[]; onViolation: string };
    maxConnections: null;
    trustHostCas: boolean;
  };
  init: null;
  pullPolicy: string;
  securityProfile: string;
  lifecycle: {
    ephemeral: boolean;
    maxDurationSecs: number;
    idleTimeoutSecs: null;
  };
  manifestDigest: string;
}

class FakeFileSystem implements MicrosandboxFileSystem {
  readonly files = new Map<
    string,
    { readonly bytes: Uint8Array; readonly mode: number; readonly kind: "file" }
  >();
  readonly listedSizes = new Map<string, number>();
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
        size: this.listedSizes.get(candidate) ?? file.bytes.byteLength,
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
  readonly #events: readonly MicrosandboxExecEvent[];
  #eventIndex = 0;
  killCalls = 0;
  waitCalls = 0;
  disposed = false;

  private constructor(events: readonly MicrosandboxExecEvent[]) {
    this.#events = [...events];
  }

  static completed(events: readonly MicrosandboxExecEvent[]): FakeExecHandle {
    return new FakeExecHandle(events);
  }

  receive(): Promise<MicrosandboxExecEvent | null> {
    if (this.#eventIndex < this.#events.length) {
      return Promise.resolve(this.#events[this.#eventIndex++]!);
    }
    return Promise.resolve(null);
  }

  kill(): Promise<void> {
    this.killCalls += 1;
    return Promise.resolve();
  }

  wait(): Promise<{ readonly code: number; readonly success: boolean }> {
    this.waitCalls += 1;
    return Promise.resolve({ code: 0, success: true });
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

  constructor(
    readonly name: string,
    readonly configValue: SandboxConfig,
    readonly execHandle: FakeExecHandle,
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

  killWithTimeout(_timeoutMs: number): Promise<void> {
    return Promise.resolve();
  }

  waitUntilStopped(): Promise<void> {
    return Promise.resolve();
  }

  remove(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeMicrosandboxSdk implements MicrosandboxSdk {
  readonly createdSessions: FakeSession[] = [];
  readonly #nextExecHandle: FakeExecHandle;
  readonly #configRewrite?: ConfigRewrite;

  constructor(
    options: {
      readonly nextExecHandle?: FakeExecHandle;
      readonly configRewrite?: ConfigRewrite;
    } = {},
  ) {
    this.#nextExecHandle = options.nextExecHandle ?? FakeExecHandle.completed([
      { kind: "exited", code: 0 },
    ]);
    this.#configRewrite = options.configRewrite;
  }

  assertLocalBackend(): void {}

  removeExactCachedImage(_reference: string): Promise<void> {
    return Promise.reject(
      new Error("Exact cached-image removal is not used by ephemeral execution."),
    );
  }

  isImageNotFound(_error: unknown): boolean {
    return false;
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
    return Promise.resolve({
      reference,
      manifestDigest: `sha256:${IMAGE_DIGEST}`,
      architecture: hostArchitecture(),
      os: "linux",
      user: "0:0",
      entrypoint: ["/usr/local/bin/python3", "-I", "-B", "/opt/casys/run.py"],
      command: null,
      environment: {},
      labels: { "io.casys.execution-profile": "image-owned-unversioned-profile" },
    });
  }

  create(request: MicrosandboxCreateRequest): Promise<MicrosandboxSession> {
    const base = sandboxConfig(request);
    const session = new FakeSession(
      request.name,
      this.#configRewrite ? this.#configRewrite(base) : base,
      this.#nextExecHandle,
    );
    this.createdSessions.push(session);
    return Promise.resolve(session);
  }

  listByLabels(
    _labels: Readonly<Record<string, string>>,
  ): Promise<readonly MicrosandboxKnownSandbox[]> {
    return Promise.resolve([]);
  }

  getByName(_name: string): Promise<MicrosandboxKnownSandbox | undefined> {
    return Promise.resolve(undefined);
  }
}

function backendFor(
  sdk: MicrosandboxSdk,
  overrides: Partial<MicrosandboxEphemeralExecutionBackendOptions> = {},
): MicrosandboxEphemeralExecutionBackend {
  return new MicrosandboxEphemeralExecutionBackend({
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
    sdk,
  });
}

async function requestFor(
  backend: MicrosandboxEphemeralExecutionBackend,
  runId = RUN_ID,
  sourceText = "result = object()\n",
  outputs: readonly IsolatedCodeOutputDeclaration[] = OUTPUTS,
): Promise<EphemeralExecutionBackendRequest> {
  const source = encoder.encode(sourceText);
  return Object.freeze({
    runId,
    producerGeneration: 0,
    profile: PROFILE,
    source: Object.freeze({
      bytes: Uint8Array.from(source),
      sha256: await fingerprintResourceBytes(source),
    }),
    policy: POLICY,
    outputs,
    runtime: backend.runtime,
  });
}

function sandboxConfig(request: MicrosandboxCreateRequest): SandboxConfig {
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
      entrypoint: ["/usr/local/bin/python3", "-I", "-B", "/opt/casys/run.py"],
      cmd: null,
      hostname: null,
      user: request.user,
      logLevel: null,
      metricsSampleIntervalMs: 1_000,
      disableMetricsSample: false,
    },
    env: [],
    labels: {
      "io.casys.execution-profile": "image-owned-unversioned-profile",
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

function cloneConfig(config: SandboxConfig): SandboxConfig {
  return JSON.parse(JSON.stringify(config)) as SandboxConfig;
}

function hostArchitecture(): string {
  if (Deno.build.arch === "aarch64") return "arm64";
  if (Deno.build.arch === "x86_64") return "amd64";
  throw new Error(`unsupported test architecture ${Deno.build.arch}`);
}

function liveRuntime(
  limits: IsolatedCodeExecutionLimits,
): IsolatedCodeRuntimeAttestation {
  return Object.freeze({
    isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
    imageDigest: Object.freeze({
      algorithm: "sha256" as const,
      digest: LIVE_IMAGE_DIGEST,
    }),
    requestedLimits: limits,
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
}

function assertEscapeDidNotSucceed(
  report: {
    readonly termination: { readonly kind: string; readonly exitCode: number | null };
  },
): void {
  assert(
    report.termination.kind !== "exited" || report.termination.exitCode !== 0,
    "guest escape produced a successful isolated execution",
  );
}

async function assertInventoryRefused(
  backend: MicrosandboxEphemeralExecutionBackend,
  lease: MicrosandboxLease,
): Promise<void> {
  await assertRejects(
    () => backend.inventory(lease),
    Error,
    "before exact quiescence",
  );
}

async function runLiveEscape(
  sourceText: string,
  options: {
    readonly maxWallTimeMs?: number;
    readonly maxDurationMs?: number;
  },
  verify: (
    report: Awaited<ReturnType<MicrosandboxEphemeralExecutionBackend["execute"]>>,
    backend: MicrosandboxEphemeralExecutionBackend,
    lease: MicrosandboxLease,
  ) => Promise<void>,
): Promise<void> {
  const maxWallTimeMs = options.maxWallTimeMs ?? 30_000;
  const maxDurationMs = options.maxDurationMs ?? 45_000;
  const limits: IsolatedCodeExecutionLimits = Object.freeze({
    maxWallTimeMs,
    maxCpuTimeMs: 25_000,
    maxMemoryBytes: 1_024 * 1_048_576,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 128 * 1_048_576,
    maxOutputTotalBytes: 128 * 1_048_576,
  });
  const runId = `run:msb-escape.${crypto.randomUUID()}`;
  const sdk = await createLocalMicrosandboxSdk();
  const backend = new MicrosandboxEphemeralExecutionBackend({
    sdk,
    imageReference: LIVE_IMAGE_REFERENCE,
    expectedImageUser: "0:0",
    executable: "/usr/local/bin/python3",
    args: ["-I", "-B", "/opt/casys/bin/run-build123d.py"],
    workdir: "/work",
    sourcePath: "/input/source.py",
    outputDirectory: "/out",
    controlFiles: {
      quiescencePath: "/run/casys/quiesced.json",
      quiescenceBytes: LIVE_QUIESCENCE_BYTES,
      stdoutPath: "/run/casys/stdout.bin",
      stderrPath: "/run/casys/stderr.bin",
    },
    profile: PROFILE,
    policy: POLICY,
    runtime: liveRuntime(limits),
    outputManifest: LIVE_OUTPUTS,
    cpus: 1,
    rootDiskMiB: 1_024,
    maxDurationMs,
    maxOpenFiles: 128,
    supervisorUser: "0:0",
  });
  let lease: MicrosandboxLease | undefined;
  try {
    lease = await backend.create(
      await requestFor(backend, runId, sourceText, LIVE_OUTPUTS),
    );
    const report = await withTestDeadline(
      backend.execute(lease),
      maxDurationMs + 15_000,
    );
    await verify(report, backend, lease);
  } finally {
    try {
      if (lease !== undefined) await backend.destroy(lease);
    } catch {
      // Run-scoped recovery below is the fail-closed remainder.
    }
    await backend.destroyByRunId(runId).catch(() => undefined);
  }
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
