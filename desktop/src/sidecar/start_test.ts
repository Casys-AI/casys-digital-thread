import { assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import {
  closedWorkspaceRoot,
  CONTROL_PLANE_HEALTH_URL,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  EXACT_DISCOVER_SERVER_INFO,
  EXACT_HEALTH,
  HANDSHAKE_SCHEMA,
  SidecarFailure,
} from "./contracts.ts";
import { createLifecycleIdentity } from "./lifecycle-tool.ts";
import { acquireWorkspaceLock } from "./lock.ts";
import { parseLaunchMarker } from "./marker.ts";
import { startControlPlane } from "./start.ts";

const LAUNCH_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const FLEET = '{"version":1}\n';
const FIXTURE = '{"id":"bracket-demo"}\n';
const PROFILE = "macos-application-support" as const;

function workspace(launchCwd: string): string {
  return closedWorkspaceRoot(launchCwd, PROFILE);
}

async function tempDir(prefix: string): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir({ prefix }));
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
  });
}

function readyFetchFor(identity: ReturnType<typeof createLifecycleIdentity>) {
  return (input: string, init?: RequestInit): Promise<Response> => {
    if (input === CONTROL_PLANE_HEALTH_URL) {
      return Promise.resolve(jsonResponse(EXACT_HEALTH));
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      method?: string;
      params?: { name?: string };
    };
    if (body.method === "server/discover") {
      return Promise.resolve(jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete", serverInfo: EXACT_DISCOVER_SERVER_INFO },
      }));
    }
    if (
      body.method === "tools/call" && body.params?.name === DESKTOP_LIFECYCLE_TOOL_NAME
    ) {
      return Promise.resolve(jsonResponse({
        jsonrpc: "2.0",
        id: 1,
        result: { resultType: "complete", structuredContent: identity },
      }));
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  };
}

function closedStdin(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function hangingStdin(): { stream: ReadableStream<Uint8Array>; close: () => void } {
  let close = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      close = () => controller.close();
    },
  });
  return { stream, close };
}

Deno.test("startControlPlane writes a handshake only after readiness and deletes the marker on stdin EOF", async () => {
  const launchCwd = await tempDir("casys-start-");
  const lines: string[] = [];
  let created = 0;
  let shutdowns = 0;
  let markerVisibleDuringShutdown = false;
  const stdin = hangingStdin();

  const started = startControlPlane({
    launchId: LAUNCH_ID,
    launchCwd,
    layoutProfile: PROFILE,
    pid: 77,
    now: () => new Date("2026-08-22T06:00:00.000Z"),
    assets: { fleetText: FLEET, fixtureText: FIXTURE },
    createServer: (prepared) => {
      created += 1;
      assertEquals(prepared.launchId, LAUNCH_ID);
      assertEquals(prepared.mrtrSigningKey.length, 64);
      return Promise.resolve({
        shutdown: async () => {
          shutdowns += 1;
          markerVisibleDuringShutdown = (await Deno.stat(
            `${workspace(launchCwd)}/runtime/owner.json`,
          )).isFile;
        },
      });
    },
    lifeline: {
      stdin: stdin.stream,
      listenSignals: () => () => {},
    },
    fetchImpl: async (input, init) => {
      const workspaceRoot = workspace(launchCwd);
      const identity = createLifecycleIdentity(
        LAUNCH_ID,
        JSON.parse(
          await Deno.readTextFile(`${workspaceRoot}/config/desktop-runtime.json`),
        )
          .configDigest,
      );
      return await readyFetchFor(identity)(input, init);
    },
    stdout: (line) => lines.push(line),
    stderr: () => {},
    chdir: () => {},
  });

  await waitUntil(() => lines.length === 1);
  const handshake = JSON.parse(lines[0]);
  assertEquals(handshake.schema, HANDSHAKE_SCHEMA);
  assertEquals(handshake.launchId, LAUNCH_ID);
  const marker = parseLaunchMarker(
    await Deno.readTextFile(`${workspace(launchCwd)}/runtime/owner.json`),
  );
  assertEquals(marker.launchId, LAUNCH_ID);
  assertEquals(marker.pid, 77);
  stdin.close();
  await started;
  assertEquals(created, 1);
  assertEquals(shutdowns, 1);
  assertEquals(markerVisibleDuringShutdown, true);
  await assertRejects(
    () => Deno.stat(`${workspace(launchCwd)}/runtime/owner.json`),
    Deno.errors.NotFound,
  );
});

Deno.test("startControlPlane removes its marker and releases its lock after an HTTP shutdown failure", async () => {
  const launchCwd = await tempDir("casys-start-shutdown-error-");
  const lines: string[] = [];
  let identity: ReturnType<typeof createLifecycleIdentity> | undefined;

  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 77,
        now: () => new Date("2026-08-22T06:00:00.000Z"),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: (prepared) => {
          identity = prepared.identity;
          return Promise.resolve({
            shutdown: () => Promise.reject(new Error("shutdown failed")),
          });
        },
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        fetchImpl: (input, init) => readyFetchFor(identity!)(input, init),
        stdout: (line) => lines.push(line),
        stderr: () => {},
        chdir: () => {},
      }),
    Error,
    "shutdown failed",
  );

  assertEquals(lines.length, 1);
  await assertRejects(
    () => Deno.lstat(`${workspace(launchCwd)}/runtime/owner.json`),
    Deno.errors.NotFound,
  );
  const reacquired = await acquireWorkspaceLock(workspace(launchCwd));
  await reacquired.release();
});

Deno.test("startControlPlane does not write a marker when HTTP bind fails", async () => {
  const launchCwd = await tempDir("casys-start-bind-");
  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => Promise.reject(new Error("address already in use")),
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        fetchImpl: () => Promise.resolve(new Response("no")),
        stdout: () => {
          throw new Error("handshake must not be written");
        },
        stderr: () => {},
        chdir: () => {},
      }),
    Error,
    "address already in use",
  );
  await assertRejects(
    () => Deno.stat(`${workspace(launchCwd)}/runtime/owner.json`),
    Deno.errors.NotFound,
  );
});

Deno.test("startControlPlane fails closed when the workspace lock is already held", async () => {
  const launchCwd = await tempDir("casys-start-lock-");
  await Deno.mkdir(`${workspace(launchCwd)}/runtime`, { recursive: true });
  const lock = await acquireWorkspaceLock(workspace(launchCwd));
  let created = 0;
  try {
    await assertRejects(
      () =>
        startControlPlane({
          launchId: LAUNCH_ID,
          launchCwd,
          layoutProfile: PROFILE,
          pid: 1,
          now: () => new Date(),
          assets: { fleetText: FLEET, fixtureText: FIXTURE },
          createServer: () => {
            created += 1;
            return Promise.resolve({ shutdown: () => Promise.resolve() });
          },
          lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
          stdout: () => {},
          stderr: () => {},
          chdir: () => {},
        }),
      SidecarFailure,
      "already holds",
    );
    assertEquals(created, 0);
    await assertRejects(
      () => Deno.stat(`${workspace(launchCwd)}/secrets/mrtr-signing-key`),
      Deno.errors.NotFound,
    );
  } finally {
    await lock.release();
  }
});

Deno.test("startControlPlane does not adopt or overwrite a mismatched packaged asset", async () => {
  const launchCwd = await tempDir("casys-start-mismatch-");
  await Deno.mkdir(`${workspace(launchCwd)}/config`, { recursive: true });
  await Deno.writeTextFile(
    `${workspace(launchCwd)}/config/mcp-fleet.json`,
    '{"tampered":true}\n',
  );
  let created = 0;
  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => {
          created += 1;
          return Promise.resolve({ shutdown: () => Promise.resolve() });
        },
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "were not replaced",
  );
  assertEquals(created, 0);
  assertEquals(
    await Deno.readTextFile(`${workspace(launchCwd)}/config/mcp-fleet.json`),
    '{"tampered":true}\n',
  );
});

Deno.test("startControlPlane rejects a stale marker before materializing assets", async () => {
  const launchCwd = await tempDir("casys-start-stale-");
  const markerPath = `${workspace(launchCwd)}/runtime/owner.json`;
  await Deno.mkdir(`${workspace(launchCwd)}/runtime`, { recursive: true });
  await Deno.writeTextFile(markerPath, "stale-marker\n");
  let created = 0;
  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => {
          created += 1;
          return Promise.resolve({ shutdown: () => Promise.resolve() });
        },
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "already exists",
  );
  assertEquals(created, 0);
  assertEquals(await Deno.readTextFile(markerPath), "stale-marker\n");
  await assertRejects(
    () => Deno.stat(`${workspace(launchCwd)}/config/mcp-fleet.json`),
    Deno.errors.NotFound,
  );
});

Deno.test("concurrent starts serialize before MRTR key creation", async () => {
  const launchCwd = await tempDir("casys-start-concurrent-");
  const stdin = hangingStdin();
  const lines: string[] = [];
  const first = startControlPlane({
    launchId: LAUNCH_ID,
    launchCwd,
    layoutProfile: PROFILE,
    pid: 1,
    now: () => new Date("2026-08-22T06:00:00.000Z"),
    assets: { fleetText: FLEET, fixtureText: FIXTURE },
    createServer: () => Promise.resolve({ shutdown: () => Promise.resolve() }),
    lifeline: { stdin: stdin.stream, listenSignals: () => () => {} },
    fetchImpl: async (input, init) => {
      const receipt = JSON.parse(
        await Deno.readTextFile(
          `${workspace(launchCwd)}/config/desktop-runtime.json`,
        ),
      );
      return await readyFetchFor(
        createLifecycleIdentity(LAUNCH_ID, receipt.configDigest),
      )(input, init);
    },
    stdout: (line) => lines.push(line),
    stderr: () => {},
    chdir: () => {},
  });
  await waitUntil(() => lines.length === 1);
  const keyPath = `${workspace(launchCwd)}/secrets/mrtr-signing-key`;
  const key = await Deno.readTextFile(keyPath);
  let secondCreated = 0;
  await assertRejects(
    () =>
      startControlPlane({
        launchId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        launchCwd,
        layoutProfile: PROFILE,
        pid: 2,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => {
          secondCreated += 1;
          return Promise.resolve({ shutdown: () => Promise.resolve() });
        },
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "already holds",
  );
  assertEquals(secondCreated, 0);
  assertEquals(await Deno.readTextFile(keyPath), key);
  stdin.close();
  await first;
});

Deno.test("startControlPlane refuses a symlink escape before lock or asset writes", async () => {
  const launchCwd = await tempDir("casys-start-link-");
  const escape = await tempDir("casys-start-escape-");
  const escapedWorkspace = `${escape}/ai.casys.digital-thread/control-plane`;
  await Deno.mkdir(escapedWorkspace, { recursive: true });
  await Deno.symlink(
    `${escape}/ai.casys.digital-thread`,
    `${launchCwd}/ai.casys.digital-thread`,
  );
  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => Promise.resolve({ shutdown: () => Promise.resolve() }),
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "symlink",
  );
  assertEquals([...Deno.readDirSync(escapedWorkspace)].length, 0);
});

Deno.test("startControlPlane refuses a dangling product symlink without creating its target", async () => {
  const launchCwd = await tempDir("casys-start-dangling-");
  const escape = await tempDir("casys-start-dangling-target-");
  const target = `${escape}/ai.casys.digital-thread`;
  await Deno.symlink(target, `${launchCwd}/ai.casys.digital-thread`);

  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => Promise.resolve({ shutdown: () => Promise.resolve() }),
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "symlink",
  );
  await assertRejects(() => Deno.lstat(target), Deno.errors.NotFound);
});

Deno.test("startControlPlane walks internal directories before creating a missing symlink target", async () => {
  const launchCwd = await tempDir("casys-start-internal-link-");
  const escape = await tempDir("casys-start-internal-target-");
  const workspaceRoot = workspace(launchCwd);
  const target = `${escape}/state`;
  await Deno.mkdir(workspaceRoot, { recursive: true });
  await Deno.symlink(target, `${workspaceRoot}/state`);

  await assertRejects(
    () =>
      startControlPlane({
        launchId: LAUNCH_ID,
        launchCwd,
        layoutProfile: PROFILE,
        pid: 1,
        now: () => new Date(),
        assets: { fleetText: FLEET, fixtureText: FIXTURE },
        createServer: () => Promise.resolve({ shutdown: () => Promise.resolve() }),
        lifeline: { stdin: closedStdin(), listenSignals: () => () => {} },
        stdout: () => {},
        stderr: () => {},
        chdir: () => {},
      }),
    SidecarFailure,
    "symlink",
  );
  await assertRejects(() => Deno.lstat(target), Deno.errors.NotFound);
  await assertRejects(
    () => Deno.lstat(`${workspaceRoot}/config/mcp-fleet.json`),
    Deno.errors.NotFound,
  );
});

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for handshake");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
