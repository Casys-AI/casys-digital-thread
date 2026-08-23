import {
  assertEquals,
  assertFalse,
  assertRejects,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import type { OwnedSidecarHandle } from "../control-plane/contracts.ts";
import {
  CONFIG_DIGEST_PATTERN,
  WORKBENCH_ACCESS_HEADER,
  WORKBENCH_HANDSHAKE_SCHEMA,
  WORKBENCH_HEALTH_SCHEMA,
  WORKBENCH_INSPECT_SCHEMA,
  WORKBENCH_MARKER_SCHEMA,
  WORKBENCH_VERSION,
} from "./contracts.ts";
import {
  parseWorkbenchHandshake,
  parseWorkbenchInspect,
  WorkbenchHost,
  WorkbenchTerminationUnresolvedError,
} from "./host.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const TOKEN = "a".repeat(64);
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";

Deno.test("Workbench host starts one owned helper and returns a separate sanitized projection", async () => {
  const world = new WorkbenchWorld();
  const host = new WorkbenchHost(world.options());
  const [first, second] = await Promise.all([host.start(), host.start()]);
  assertEquals(world.spawns, 1);
  assertEquals(first, second);
  assertEquals(first.projection, {
    lifecycle: "owned-ready",
    version: WORKBENCH_VERSION,
  });
  assertEquals(first.session?.accessToken, TOKEN);
  const rendererText = JSON.stringify(first.projection);
  assertFalse(rendererText.includes(TOKEN));
  assertFalse(rendererText.includes("127.0.0.1"));
  assertFalse(rendererText.includes(LAUNCH_ID));

  await host.stop();
  await host.stop();
  assertEquals(world.child?.stdinClosed, true);
  assertEquals(world.child?.signals, []);
});

Deno.test("Workbench host reconnects exact persisted identity without adopting or stopping it", async () => {
  const world = new WorkbenchWorld("reconnected");
  const host = new WorkbenchHost(world.options());
  const result = await host.start();
  assertEquals(world.spawns, 0);
  assertEquals(result.projection.lifecycle, "reconnected-ready");
  await host.stop();
  assertEquals(world.externalStopped, false);
});

Deno.test("Workbench host rejects a listener without marker authority", async () => {
  const world = new WorkbenchWorld("foreign");
  const result = await new WorkbenchHost(world.options()).start();
  assertEquals(world.spawns, 0);
  assertEquals(result.projection, {
    lifecycle: "recovery-required",
    recoveryCode: "listener-conflict",
  });
  assertEquals(result.session, undefined);
});

Deno.test("Workbench host does not spawn when listener absence is ambiguous", async () => {
  const world = new WorkbenchWorld("ambiguous");
  const result = await new WorkbenchHost(world.options()).start();
  assertEquals(world.spawns, 0);
  assertEquals(result.projection, {
    lifecycle: "recovery-required",
    recoveryCode: "probe-failed",
  });
});

Deno.test("Workbench host keeps an absent packaged artifact unavailable without spawning", async () => {
  let spawns = 0;
  const result = await new WorkbenchHost({
    ports: {
      fetch: () => Promise.reject(new Error("must not probe")),
      createLaunchId: () => LAUNCH_ID,
      runInspect: () => Promise.reject(new Deno.errors.NotFound("missing helper")),
      spawn: () => {
        spawns += 1;
        throw new Error("must not spawn");
      },
    },
  }).start();
  assertEquals(spawns, 0);
  assertEquals(result.projection, {
    lifecycle: "unavailable",
    recoveryCode: "helper-unavailable",
  });
});

Deno.test("Workbench host escalates only its retained child through SIGKILL", async () => {
  const world = new WorkbenchWorld("stubborn");
  const host = new WorkbenchHost(world.options());
  assertEquals((await host.start()).projection.lifecycle, "owned-ready");
  await host.stop();
  assertEquals(world.child?.stdinClosed, true);
  assertEquals(world.child?.signals, ["SIGTERM", "SIGKILL"]);
});

Deno.test("Workbench host retains an owned child until terminal status is proved", async () => {
  const world = new WorkbenchWorld("ignores-first-sigkill");
  const host = new WorkbenchHost(world.options());
  assertEquals((await host.start()).projection.lifecycle, "owned-ready");

  await assertRejects(
    () => host.stop(),
    WorkbenchTerminationUnresolvedError,
    "termination remains unresolved",
  );
  assertEquals(world.child?.signals, ["SIGTERM", "SIGKILL"]);
  assertEquals((await host.start()).projection, {
    lifecycle: "recovery-required",
    recoveryCode: "termination-unresolved",
  });
  assertEquals(world.spawns, 1);

  await host.stop();
  assertEquals(world.child?.signals, [
    "SIGTERM",
    "SIGKILL",
    "SIGTERM",
    "SIGKILL",
  ]);
});

Deno.test("Workbench startup failure surfaces and retains unresolved termination", async () => {
  const world = new WorkbenchWorld("startup-ignores-first-sigkill");
  const host = new WorkbenchHost(world.options());
  assertEquals((await host.start()).projection, {
    lifecycle: "recovery-required",
    recoveryCode: "termination-unresolved",
  });
  assertEquals(world.child?.signals, ["SIGTERM", "SIGKILL"]);

  await host.stop();
  assertEquals(world.child?.signals, [
    "SIGTERM",
    "SIGKILL",
    "SIGTERM",
    "SIGKILL",
  ]);
});

Deno.test("Workbench host parsers reject extra or incomplete capability fields", () => {
  const inspect = JSON.parse(new WorkbenchWorld().inspect()) as Record<string, unknown>;
  assertEquals(
    parseWorkbenchInspect(JSON.stringify(inspect)).configuration,
    "verified",
  );
  assertThrows(
    () => parseWorkbenchInspect(JSON.stringify({ ...inspect, endpoint: "leak" })),
    TypeError,
    "unsupported fields",
  );
  assertThrows(
    () => parseWorkbenchInspect(JSON.stringify({ ...inspect, marker: marker() })),
    TypeError,
    "incomplete",
  );
  const handshake = JSON.parse(handshakeText()) as Record<string, unknown>;
  assertEquals(parseWorkbenchHandshake(JSON.stringify(handshake)).launchId, LAUNCH_ID);
  assertThrows(
    () => parseWorkbenchHandshake(JSON.stringify({ ...handshake, pid: 42 })),
    TypeError,
    "unsupported fields",
  );
  assertEquals(CONFIG_DIGEST_PATTERN.test(DIGEST), true);
});

type Mode =
  | "empty"
  | "reconnected"
  | "foreign"
  | "stubborn"
  | "ignores-first-sigkill"
  | "startup-ignores-first-sigkill"
  | "ambiguous";

class WorkbenchWorld {
  spawns = 0;
  listening = false;
  externalStopped = false;
  child: FakeChild | undefined;

  constructor(readonly mode: Mode = "empty") {
    this.listening = mode === "reconnected" || mode === "foreign";
  }

  options() {
    return {
      ports: {
        fetch: this.fetch,
        createLaunchId: () => LAUNCH_ID,
        runInspect: () => Promise.resolve(this.inspect()),
        spawn: () => this.spawn(),
      },
      handshakeTimeoutMs: 30,
      probeTimeoutMs: 30,
      stopTimeoutMs: 5,
    };
  }

  inspect(): string {
    const reconnected = this.mode === "reconnected";
    return JSON.stringify({
      schema: WORKBENCH_INSPECT_SCHEMA,
      version: WORKBENCH_VERSION,
      configuration: "verified",
      configDigest: DIGEST,
      lock: reconnected ? "held" : "free",
      marker: reconnected ? marker() : null,
      ...(reconnected ? { accessToken: TOKEN } : {}),
    });
  }

  fetch: typeof fetch = (_input, init) => {
    if (this.mode === "ambiguous") {
      return Promise.reject(new DOMException("timed out", "AbortError"));
    }
    if (!this.listening) {
      return Promise.reject(new Deno.errors.ConnectionRefused("connection refused"));
    }
    const token = new Headers(init?.headers).get(WORKBENCH_ACCESS_HEADER);
    if (token !== TOKEN) {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return Promise.resolve(Response.json({
      schema: WORKBENCH_HEALTH_SCHEMA,
      status: "ok",
      version: WORKBENCH_VERSION,
      launchId: LAUNCH_ID,
      configDigest: DIGEST,
      workspaceId: "primary",
    }));
  };

  spawn(): OwnedSidecarHandle {
    this.spawns += 1;
    this.listening = true;
    this.child = new FakeChild(
      this.mode === "startup-ignores-first-sigkill" ? "{}\n" : `${handshakeText()}\n`,
      this.mode === "stubborn" ? 1 : this.mode === "ignores-first-sigkill" ||
          this.mode === "startup-ignores-first-sigkill"
        ? 2
        : 0,
      () => {
        this.listening = false;
      },
    );
    return this.child;
  }
}

class FakeChild implements OwnedSidecarHandle {
  stdinClosed = false;
  signals: Deno.Signal[] = [];
  readonly stdout: ReadableStream<Uint8Array>;
  readonly status: Promise<Deno.CommandStatus>;
  #resolve: ((value: Deno.CommandStatus) => void) | undefined;
  #settled = false;
  #sigkills = 0;

  constructor(
    handshake: string,
    readonly requiredSigkills: number,
    readonly onExit: () => void,
  ) {
    this.stdout = new Response(handshake).body!;
    this.status = new Promise((resolve) => {
      this.#resolve = resolve;
    });
  }

  closeStdin(): void {
    this.stdinClosed = true;
    if (this.requiredSigkills === 0) {
      this.finish({ success: true, code: 0, signal: null });
    }
  }

  kill(signo: Deno.Signal): void {
    this.signals.push(signo);
    if (signo === "SIGKILL") this.#sigkills += 1;
    if (
      this.requiredSigkills === 0 ||
      (signo === "SIGKILL" && this.#sigkills >= this.requiredSigkills)
    ) {
      this.finish({ success: false, code: 1, signal: signo });
    }
  }

  private finish(status: Deno.CommandStatus): void {
    if (this.#settled) return;
    this.#settled = true;
    this.onExit();
    this.#resolve?.(status);
  }
}

function marker() {
  return {
    schema: WORKBENCH_MARKER_SCHEMA,
    version: WORKBENCH_VERSION,
    launchId: LAUNCH_ID,
    pid: 4242,
    configDigest: DIGEST,
    tokenDigest: DIGEST,
    startedAt: "2026-08-23T00:00:00.000Z",
  };
}

function handshakeText(): string {
  return JSON.stringify({
    schema: WORKBENCH_HANDSHAKE_SCHEMA,
    status: "ready",
    version: WORKBENCH_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
    accessToken: TOKEN,
  });
}
