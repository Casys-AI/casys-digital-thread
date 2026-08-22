import { assertEquals, assertFalse } from "jsr:@std/assert@1.0.14";
import {
  CONSOLE_SNAPSHOT_TOOL_NAME,
  CONTROL_PLANE_HANDSHAKE_SCHEMA,
  CONTROL_PLANE_HEALTH_URL,
  CONTROL_PLANE_INSPECT_SCHEMA,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_MARKER_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  MCP_PROTOCOL_VERSION,
  type OwnedSidecarHandle,
  type PackagedHelperCommand,
} from "./contracts.ts";
import { ControlPlaneHost } from "./host.ts";
import type { ControlPlaneHostOptions } from "./ports.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LAUNCH = "22222222-2222-4222-8222-222222222222";
const HELPER =
  "/Applications/CasysDigitalThread.app/Contents/Helpers/casys-control-plane";

Deno.test("start materializes a missing config once and returns the safe degraded projection", async () => {
  const world = new FakeWorld();
  const host = new ControlPlaneHost(world.options());
  const [first, second] = await Promise.all([
    host.startResult(),
    host.startResult(),
  ]);
  assertEquals(world.spawnCount, 1);
  assertEquals(first.projection.configuration, "verified");
  assertEquals(first.projection.lifecycle, "owned-ready");
  assertEquals(first.projection.controlPlaneVersion, CONTROL_PLANE_SERVER_VERSION);
  assertEquals(first.projection.providers, {
    state: "unavailable",
    total: 2,
    healthy: 0,
    drift: 0,
  });
  assertEquals(first.projection.persistedEvidence, "unavailable");
  assertEquals(first.renderer.status, "degraded");
  assertEquals(second, first);
  assertNoLeak(first);
});

Deno.test("a second host reconnects exact identity and never stops the first host child", async () => {
  const world = new FakeWorld();
  const owner = new ControlPlaneHost(world.options());
  const observer = new ControlPlaneHost(world.options());
  await owner.startResult();
  const reconnected = await observer.startResult();
  assertEquals(world.spawnCount, 1);
  assertEquals(reconnected.projection.lifecycle, "reconnected-ready");
  await observer.stop();
  assertEquals(world.listeningLaunchId, LAUNCH_ID);
  assertEquals(world.lastChild?.stdinClosed, false);
  assertEquals(world.lastChild?.signals, []);
  await owner.stop();
  assertEquals(world.listeningLaunchId, undefined);
  assertEquals(world.lastChild?.stdinClosed, true);
});

Deno.test("start never adopts or kills a listener with missing ownership evidence", async () => {
  const world = new FakeWorld();
  world.foreignWithoutMarker();
  const host = new ControlPlaneHost(world.options());
  const result = await host.startResult();
  assertEquals(world.spawnCount, 0);
  assertEquals(result.projection.lifecycle, "recovery-required");
  assertEquals(result.projection.recoveryCode, "foreign-listener");
  assertEquals("controlPlaneVersion" in result.projection, false);
  await host.stop();
  assertEquals(world.listeningLaunchId, OTHER_LAUNCH);
});

Deno.test("timeout is ambiguous and cannot authorize spawning", async () => {
  const world = new FakeWorld();
  world.probeFailure = "timeout";
  const host = new ControlPlaneHost(world.options());
  const result = await host.startResult();
  assertEquals(world.spawnCount, 0);
  assertEquals(result.projection.lifecycle, "recovery-required");
  assertEquals(result.projection.recoveryCode, "probe-failed");
});

Deno.test("stale marker and configuration mismatch both fail closed", async () => {
  const stale = new FakeWorld();
  stale.staleMarker();
  const staleResult = await new ControlPlaneHost(stale.options()).startResult();
  assertEquals(stale.spawnCount, 0);
  assertEquals(staleResult.projection.recoveryCode, "marker-invalid");

  const mismatch = new FakeWorld();
  mismatch.configuration = "mismatch";
  const mismatchResult = await new ControlPlaneHost(mismatch.options()).startResult();
  assertEquals(mismatch.spawnCount, 0);
  assertEquals(mismatchResult.projection.configuration, "mismatch");
  assertEquals(mismatchResult.projection.recoveryCode, "config-mismatch");
});

Deno.test("a cross-process start loser re-collects the exact winner as reconnected", async () => {
  const world = new FakeWorld();
  world.spawnBehavior = "race-loser";
  const host = new ControlPlaneHost(world.options());
  const result = await host.startResult();
  assertEquals(world.spawnCount, 1);
  assertEquals(result.projection.lifecycle, "reconnected-ready");
  assertEquals(world.listeningLaunchId, OTHER_LAUNCH);
  assertEquals(world.lastChild?.killed, false);
  await host.stop();
  assertEquals(world.listeningLaunchId, OTHER_LAUNCH);
});

Deno.test("a bad handshake stops only the spawned child and reports startup failure", async () => {
  const world = new FakeWorld();
  world.spawnBehavior = "bad-handshake";
  const host = new ControlPlaneHost(world.options());
  const result = await host.startResult();
  assertEquals(world.spawnCount, 1);
  assertEquals(world.lastChild?.stdinClosed, true);
  assertEquals(world.listeningLaunchId, undefined);
  assertEquals(result.projection.lifecycle, "recovery-required");
  assertEquals(result.projection.recoveryCode, "startup-failed");
});

Deno.test("stop escalates an owned child from EOF through SIGTERM to SIGKILL", async () => {
  const world = new FakeWorld();
  world.spawnBehavior = "stubborn-stop";
  const host = new ControlPlaneHost(world.options());
  await host.startResult();

  await host.stop();

  assertEquals(world.lastChild?.stdinClosed, true);
  assertEquals(world.lastChild?.signals, ["SIGTERM", "SIGKILL"]);
  assertEquals(world.listeningLaunchId, undefined);
});

Deno.test("stop returns after a bounded SIGKILL wait when child status never settles", async () => {
  const world = new FakeWorld();
  world.spawnBehavior = "unkillable-stop";
  const host = new ControlPlaneHost(world.options());
  await host.startResult();

  const startedAt = performance.now();
  await host.stop();

  assertEquals(performance.now() - startedAt < 500, true);
  assertEquals(world.lastChild?.signals, ["SIGTERM", "SIGKILL"]);
  assertEquals(world.listeningLaunchId, LAUNCH_ID);
});

Deno.test("console snapshot candidates never become verified evidence", async () => {
  const world = new FakeWorld();
  world.runCount = 2;
  world.demoRunCount = 1;
  world.fleetStatus = "degraded";
  world.healthy = 1;
  world.drift = 1;
  const result = await new ControlPlaneHost(world.options()).startResult();
  assertEquals(result.projection.persistedEvidence, "candidate-unverified");
  assertEquals(result.projection.providers, {
    state: "degraded",
    total: 2,
    healthy: 1,
    drift: 1,
  });
  assertEquals(result.renderer.projectEvidence.state, "unresolved");
});

type ConfigurationState = "verified" | "missing" | "mismatch" | "error";
type SpawnBehavior =
  | "normal"
  | "race-loser"
  | "bad-handshake"
  | "stubborn-stop"
  | "unkillable-stop";

interface FakeChildBehavior {
  readonly exited?: boolean;
  readonly ignoreEof?: boolean;
  readonly ignoreSigterm?: boolean;
  readonly ignoreSigkill?: boolean;
}

class FakeChild implements OwnedSidecarHandle {
  stdinClosed = false;
  killed = false;
  readonly signals: Deno.Signal[] = [];
  readonly stdout: ReadableStream<Uint8Array>;
  readonly status: Promise<Deno.CommandStatus>;
  #resolveStatus: ((status: Deno.CommandStatus) => void) | undefined;
  #onStop: () => void;
  #behavior: FakeChildBehavior;
  #settled = false;

  constructor(
    handshake: string,
    onStop: () => void,
    behavior: FakeChildBehavior = {},
  ) {
    this.#onStop = onStop;
    this.#behavior = behavior;
    if (behavior.exited) {
      this.#settled = true;
      this.status = Promise.resolve({ success: false, code: 1, signal: null });
    } else {
      this.status = new Promise((resolve) => {
        this.#resolveStatus = resolve;
      });
    }
    const encoded = new TextEncoder().encode(handshake);
    this.stdout = new ReadableStream({
      start(controller) {
        if (encoded.byteLength > 0) controller.enqueue(encoded);
        controller.close();
      },
    });
  }

  closeStdin(): void {
    this.stdinClosed = true;
    if (this.#behavior.ignoreEof) return;
    this.#finish({ success: true, code: 0, signal: null });
  }

  kill(signo: Deno.Signal): void {
    this.killed = true;
    this.signals.push(signo);
    if (signo === "SIGTERM" && this.#behavior.ignoreSigterm) return;
    if (signo === "SIGKILL" && this.#behavior.ignoreSigkill) return;
    this.#finish({ success: false, code: 1, signal: signo });
  }

  #finish(status: Deno.CommandStatus): void {
    if (this.#settled) return;
    this.#settled = true;
    this.#onStop();
    this.#resolveStatus?.(status);
  }
}

class FakeWorld {
  spawnCount = 0;
  lastChild: FakeChild | undefined;
  listeningLaunchId: string | undefined;
  markerLaunchId: string | undefined;
  lock: "held" | "free" | "unavailable" = "free";
  configuration: ConfigurationState = "missing";
  probeFailure: "timeout" | "network" | undefined;
  spawnBehavior: SpawnBehavior = "normal";
  fleetStatus: "healthy" | "degraded" | "unavailable" | "unknown" = "unavailable";
  total = 2;
  healthy = 0;
  drift = 0;
  runCount = 0;
  demoRunCount = 0;

  foreignWithoutMarker(): void {
    this.configuration = "verified";
    this.listeningLaunchId = OTHER_LAUNCH;
    this.markerLaunchId = undefined;
    this.lock = "free";
  }

  staleMarker(): void {
    this.configuration = "verified";
    this.markerLaunchId = OTHER_LAUNCH;
    this.lock = "held";
  }

  options(): ControlPlaneHostOptions {
    return {
      helperPath: HELPER,
      cwd: "/Users/ada/Library/Application Support",
      platform: "macOS",
      layoutProfile: "macos-application-support",
      relativeWorkspace: "ai.casys.digital-thread/control-plane",
      expected: {
        productIdentifier: "ai.casys.digital-thread",
        productVersion: CONTROL_PLANE_PRODUCT_VERSION,
        serverName: "casys-digital-thread-console",
        serverVersion: CONTROL_PLANE_SERVER_VERSION,
      },
      ports: {
        fetch: this.#fetch,
        spawn: (command) => this.#spawn(command),
        runInspect: (command) => this.#inspect(command),
        createLaunchId: () => LAUNCH_ID,
      },
      handshakeTimeoutMs: 50,
      probeTimeoutMs: 50,
      stopTimeoutMs: 10,
      raceRecoveryTimeoutMs: 10,
    };
  }

  #spawn(command: PackagedHelperCommand): OwnedSidecarHandle {
    assertEquals(command.args, [
      "start",
      "--layout-profile=macos-application-support",
      `--launch-id=${LAUNCH_ID}`,
    ]);
    assertEquals(command.env, {});
    assertEquals(command.stderr, "null");
    this.spawnCount += 1;

    if (this.spawnBehavior === "race-loser") {
      this.configuration = "verified";
      this.listeningLaunchId = OTHER_LAUNCH;
      this.markerLaunchId = OTHER_LAUNCH;
      this.lock = "held";
      const child = new FakeChild("", () => {}, { exited: true });
      this.lastChild = child;
      return child;
    }

    this.configuration = "verified";
    this.listeningLaunchId = LAUNCH_ID;
    this.markerLaunchId = LAUNCH_ID;
    this.lock = "held";
    const handshake = this.spawnBehavior === "bad-handshake"
      ? JSON.stringify({ schema: "wrong" })
      : JSON.stringify({
        schema: CONTROL_PLANE_HANDSHAKE_SCHEMA,
        status: "ready",
        productVersion: CONTROL_PLANE_PRODUCT_VERSION,
        serverVersion: CONTROL_PLANE_SERVER_VERSION,
        launchId: LAUNCH_ID,
        configDigest: DIGEST,
      });
    const child = new FakeChild(
      `${handshake}\n`,
      () => {
        if (this.listeningLaunchId === LAUNCH_ID) {
          this.listeningLaunchId = undefined;
          this.markerLaunchId = undefined;
          this.lock = "free";
        }
      },
      {
        ignoreEof: this.spawnBehavior === "stubborn-stop" ||
          this.spawnBehavior === "unkillable-stop",
        ignoreSigterm: this.spawnBehavior === "stubborn-stop" ||
          this.spawnBehavior === "unkillable-stop",
        ignoreSigkill: this.spawnBehavior === "unkillable-stop",
      },
    );
    this.lastChild = child;
    return child;
  }

  #inspect(command: PackagedHelperCommand): Promise<string> {
    assertEquals(command.args, [
      "inspect",
      "--layout-profile=macos-application-support",
    ]);
    return Promise.resolve(JSON.stringify({
      schema: CONTROL_PLANE_INSPECT_SCHEMA,
      productVersion: CONTROL_PLANE_PRODUCT_VERSION,
      serverVersion: CONTROL_PLANE_SERVER_VERSION,
      expectedConfigDigest: DIGEST,
      configuration: this.configuration,
      marker: this.markerLaunchId === undefined ? null : marker(this.markerLaunchId),
      lock: this.lock,
    }));
  }

  #fetch: typeof fetch = (input, init) => {
    if (this.probeFailure === "timeout") {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    }
    if (this.probeFailure === "network") {
      return Promise.reject(new TypeError("network changed"));
    }
    if (this.listeningLaunchId === undefined) {
      return Promise.reject(new TypeError("connection refused"));
    }
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url === CONTROL_PLANE_HEALTH_URL && method === "GET") {
      return Promise.resolve(Response.json({
        status: "ok",
        server: "casys-digital-thread-console",
        version: CONTROL_PLANE_SERVER_VERSION,
      }));
    }
    if (url !== CONTROL_PLANE_MCP_URL || method !== "POST") {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    if (body.method === "server/discover") {
      return Promise.resolve(rpc({
        resultType: "complete",
        supportedVersions: [MCP_PROTOCOL_VERSION],
        serverInfo: {
          name: "casys-digital-thread-console",
          version: CONTROL_PLANE_SERVER_VERSION,
        },
        capabilities: {},
      }));
    }
    if (body.method === "tools/list") {
      return Promise.resolve(rpc({
        resultType: "complete",
        tools: [
          { name: DESKTOP_LIFECYCLE_TOOL_NAME },
          { name: CONSOLE_SNAPSHOT_TOOL_NAME },
        ],
      }));
    }
    if (body.method === "tools/call") {
      const params = body.params as Record<string, unknown>;
      if (params.name === DESKTOP_LIFECYCLE_TOOL_NAME) {
        return Promise.resolve(rpc({
          resultType: "complete",
          structuredContent: {
            schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
            productVersion: CONTROL_PLANE_PRODUCT_VERSION,
            serverVersion: CONTROL_PLANE_SERVER_VERSION,
            launchId: this.listeningLaunchId,
            configDigest: DIGEST,
          },
        }));
      }
      if (params.name === CONSOLE_SNAPSHOT_TOOL_NAME) {
        return Promise.resolve(rpc({
          resultType: "complete",
          structuredContent: {
            fleet: {
              status: this.fleetStatus,
              counts: {
                total: this.total,
                healthy: this.healthy,
                degraded: this.fleetStatus === "degraded" ? 1 : 0,
                unavailable: this.fleetStatus === "unavailable" ? this.total : 0,
                unknown: this.fleetStatus === "unknown" ? this.total : 0,
                drift: this.drift,
              },
            },
            runs: {
              items: Array.from({ length: this.runCount }, (_, index) => ({
                id: `run-${index}`,
                source: index < this.demoRunCount ? "demo" : "recorded",
              })),
            },
          },
        }));
      }
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  };
}

function marker(launchId: string) {
  return {
    schema: CONTROL_PLANE_MARKER_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId,
    pid: 4242,
    endpoint: CONTROL_PLANE_MCP_URL,
    configDigest: DIGEST,
    startedAt: "2026-08-22T10:00:00Z",
  };
}

function rpc(result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: "2.0", id: 1, result });
}

function assertNoLeak(value: unknown): void {
  const text = JSON.stringify(value);
  for (
    const leak of [
      "/Users/ada",
      "127.0.0.1",
      CONTROL_PLANE_MCP_URL,
      "4242",
      LAUNCH_ID,
      HELPER,
      DIGEST,
    ]
  ) {
    assertFalse(text.includes(leak), `leaked ${leak}`);
  }
}
