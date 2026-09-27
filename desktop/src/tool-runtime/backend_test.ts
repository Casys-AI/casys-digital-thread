import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type { CommandRunner } from "../../../src/adapters/shared/docker-observer.ts";
import { projectToolRuntimeStatus, ToolRuntimeHost } from "./backend.ts";
import { loadToolRuntimeIntent } from "./intent.ts";

const READY_VERSION = JSON.stringify({
  Client: { Version: "29.6.1" },
  Server: { Version: "29.7.2", Os: "linux", Arch: "arm64" },
});

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
}

function runner(
  handler: (
    command: string,
    args: string[],
  ) =>
    | { success: boolean; code: number; stdout: string; stderr: string }
    | Promise<{ success: boolean; code: number; stdout: string; stderr: string }>,
  recorded: RecordedCall[],
): CommandRunner {
  return {
    run: (command, args) => {
      recorded.push({ command, args: [...args] });
      return Promise.resolve(handler(command, args));
    },
  };
}

function versionHandler(
  command: string,
  args: string[],
): { success: boolean; code: number; stdout: string; stderr: string } {
  if (command === "docker" && args[0] === "version") {
    return { success: true, code: 0, stdout: READY_VERSION, stderr: "" };
  }
  if (command === "docker" && args[0] === "compose" && args[1] === "version") {
    return {
      success: true,
      code: 0,
      stdout: JSON.stringify({ version: "v2.39.2" }),
      stderr: "",
    };
  }
  if (command === "docker" && args[0] === "ps") {
    return { success: true, code: 0, stdout: "", stderr: "" };
  }
  if (command === "docker" && args[0] === "volume") {
    return { success: true, code: 0, stdout: "", stderr: "" };
  }
  if (command === "docker" && args[0] === "image") {
    return { success: false, code: 1, stdout: "", stderr: "No such image" };
  }
  throw new Error(`unexpected: ${command} ${args.join(" ")}`);
}

type TestHandler = (
  command: string,
  args: string[],
) =>
  | { success: boolean; code: number; stdout: string; stderr: string }
  | Promise<{ success: boolean; code: number; stdout: string; stderr: string }>;

async function hostWith(
  handler: TestHandler,
  options: {
    platform?: () => { os: string; arch: string };
    sleep?: (ms: number) => Promise<void>;
    fetch?: typeof fetch;
  } = {},
): Promise<{ host: ToolRuntimeHost; recorded: RecordedCall[]; directory: string }> {
  const directory = await Deno.makeTempDir({ prefix: "tool-runtime-host-" });
  const recorded: RecordedCall[] = [];
  const shared = runner(handler, recorded);
  const host = new ToolRuntimeHost({
    dataDirectory: directory,
    probeRunner: shared,
    execRunner: shared,
    sleep: options.sleep ?? (() => Promise.resolve()),
    now: () => "2026-09-27T12:00:00.000Z",
    platform: options.platform ?? (() => ({ os: "darwin", arch: "aarch64" })),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return { host, recorded, directory };
}

const BUILD123D_TOOLS = [
  "build123d_execute",
  "build123d_export",
  "build123d_observe_assembly_integrity",
  "build123d_project_2d",
];

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

/** Serves the fleet Build123d shape: health, discovery, tools, smoke. */
function build123dFetch(): typeof fetch {
  const respond = (url: string | URL | Request, init?: RequestInit): Response => {
    const target = String(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    if (target.endsWith("/health")) return new Response("ok", { status: 200 });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    if (body.method === "server/discover") {
      return jsonResponse({
        result: {
          resultType: "complete",
          serverInfo: { name: "mcp-build123d", version: "0.7.0" },
        },
      });
    }
    if (body.method === "tools/list") {
      return jsonResponse({
        result: {
          resultType: "complete",
          tools: BUILD123D_TOOLS.map((name) => ({ name })),
        },
      });
    }
    if (body.method === "resources/list") {
      return jsonResponse({ result: { resultType: "complete", resources: [] } });
    }
    if (body.method === "tools/call") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          resultType: "complete",
          structuredContent: {
            kind: "execution",
            metrics: { solids: 1, faces: 6, edges: 12, volume_mm3: 1000 },
          },
        },
      });
    }
    throw new Error(`unexpected fetch: ${target} ${JSON.stringify(body)}`);
  };
  return ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve().then(() => respond(url, init))) as typeof fetch;
}

Deno.test("status is read-only and reports never-prepared", async () => {
  const { host, recorded, directory } = await hostWith(versionHandler);
  try {
    const status = await host.status();
    assertEquals(status.engine.status, "ready");
    assertEquals(status.tools.length, 1);
    assertEquals(status.tools[0]?.toolId, "build123d");
    assertEquals(status.tools[0]?.state, "never-prepared");
    for (const call of recorded) {
      assert(call.command === "docker");
      assert(
        ["version", "compose", "ps", "volume", "image"].includes(
          call.args[0] as string,
        ),
      );
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("status reports corrupt intent without throwing", async () => {
  const { host, directory } = await hostWith(versionHandler);
  try {
    await Deno.mkdir(`${directory}/build123d`, { recursive: true });
    await Deno.writeTextFile(
      `${directory}/build123d/tool-runtime-build123d.intent.json`,
      "{broken",
    );
    const status = await host.status();
    assertEquals(status.tools[0]?.state, "needs-action");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("stop with nothing owned issues no stop", async () => {
  const { host, recorded, directory } = await hostWith(versionHandler);
  try {
    const outcome = await host.stop("build123d");
    assertEquals(outcome.status, "done");
    assert(recorded.every((call) => !call.args.includes("stop")));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("stop halts running owned containers by id", async () => {
  const { host, recorded, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      return {
        success: true,
        code: 0,
        stdout: [
          JSON.stringify({ ID: "aaa", State: "running" }),
          JSON.stringify({ ID: "bbb", State: "exited" }),
        ].join("\n"),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "stop") {
      return { success: true, code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.stop("build123d");
    assertEquals(outcome.status, "done");
    const stops = recorded.filter((call) => call.args[0] === "stop");
    assertEquals(stops.length, 1);
    assertEquals(stops[0]?.args[1], "aaa");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("stop refuses on unparsable observations", async () => {
  const { host, recorded, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      return { success: true, code: 0, stdout: "garbage{{", stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.stop("build123d");
    assertEquals(outcome.status, "needs-action");
    assert(recorded.every((call) => !call.args.includes("stop")));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("remove retains volumes and images", async () => {
  const { host, recorded, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ ID: "aaa", State: "running" }),
        stderr: "",
      };
    }
    if (command === "docker" && (args[0] === "stop" || args[0] === "rm")) {
      return { success: true, code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.remove("build123d");
    assertEquals(outcome.status, "done");
    for (const call of recorded) {
      assert(!call.args.includes("rmi"), "images retained");
      assert(
        !(call.args[0] === "volume" && call.args.includes("rm")),
        "volumes retained",
      );
      assert(!call.args.includes("prune"), "never prune");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("removeImage refuses when any container references the image", async () => {
  const { host, recorded, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      return { success: true, code: 0, stdout: "foreign-id\n", stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.removeImage("build123d");
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "foreign-use");
    }
    assert(recorded.every((call) => !call.args.includes("rmi")));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("removeImage removes the exact pin when unreferenced", async () => {
  const { host, recorded, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      return { success: true, code: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "rmi") {
      return { success: true, code: 0, stdout: "Untagged", stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.removeImage("build123d");
    assertEquals(outcome.status, "done");
    const rmis = recorded.filter((call) => call.args[0] === "rmi");
    assertEquals(rmis.length, 1);
    assert((rmis[0]?.args[1] ?? "").includes("@sha256:"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("update refuses tags and unknown tools fail closed", async () => {
  const { host, recorded, directory } = await hostWith(versionHandler);
  try {
    const outcome = await host.update(
      "build123d",
      "ghcr.io/casys-ai/mcp-build123d:v0.8.0",
    );
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "image-unverified");
    }
    assertEquals(recorded.length, 0);
    await assertRejects(() => host.prepare("unknown-tool"), TypeError);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("startEngine launches explicitly on darwin when stopped", async () => {
  let launched = false;
  const { host, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "version") {
      if (!launched) {
        return {
          success: false,
          code: 1,
          stdout: JSON.stringify({ Client: { Version: "29.6.1" } }),
          stderr: "Cannot connect to the Docker daemon",
        };
      }
      return { success: true, code: 0, stdout: READY_VERSION, stderr: "" };
    }
    if (command === "/usr/bin/open") {
      launched = true;
      return { success: true, code: 0, stdout: "", stderr: "" };
    }
    return versionHandler(command, args);
  });
  try {
    const outcome = await host.startEngine();
    assertEquals(outcome.status, "done");
    assertEquals(launched, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("startEngine is a no-op when already ready", async () => {
  const { host, recorded, directory } = await hostWith(versionHandler);
  try {
    const outcome = await host.startEngine();
    assertEquals(outcome.status, "done");
    assert(recorded.every((call) => call.command === "docker"));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("mutations serialize per tool through the exclusive gate", async () => {
  let concurrent = 0;
  let observedOverlap = false;
  const { host, directory } = await hostWith((command, args) => {
    if (command === "docker" && args[0] === "ps") {
      concurrent++;
      observedOverlap = observedOverlap || concurrent > 1;
      return new Promise((resolve) => {
        setTimeout(() => {
          concurrent--;
          resolve({ success: true, code: 0, stdout: "", stderr: "" });
        }, 20);
      });
    }
    return versionHandler(command, args);
  });
  try {
    // stop() lists owned containers; two concurrent stops must not overlap.
    const [first, second] = await Promise.all([
      host.stop("build123d"),
      host.stop("build123d"),
    ]);
    assertEquals(first.status, "done");
    assertEquals(second.status, "done");
    assertEquals(observedOverlap, false);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

const NEW_DIGEST = "b".repeat(64);
const NEW_REF = `ghcr.io/casys-ai/mcp-build123d@sha256:${NEW_DIGEST}`;

function updateHandler(options: {
  removed: { value: boolean };
  failStop: boolean;
}): TestHandler {
  const arch = Deno.build.arch === "aarch64" ? "arm64" : "amd64";
  return (command, args) => {
    if (command === "docker" && args[0] === "ps" && args.includes("-a")) {
      if (options.removed.value) {
        return { success: true, code: 0, stdout: "", stderr: "" };
      }
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({ ID: "aaa", State: "running" }),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "ps") {
      return { success: true, code: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "stop") {
      if (options.failStop) {
        return { success: false, code: 1, stdout: "", stderr: "daemon refused" };
      }
      return { success: true, code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "rm") {
      options.removed.value = true;
      return { success: true, code: 0, stdout: `${args[1]}\n`, stderr: "" };
    }
    if (command === "docker" && args[0] === "pull") {
      return { success: true, code: 0, stdout: "Status: Downloaded", stderr: "" };
    }
    if (command === "docker" && args[0] === "image") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({
          RepoDigests: [args[2]],
          Architecture: arch,
        }),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "compose" && args.includes("up")) {
      return { success: true, code: 0, stdout: "started", stderr: "" };
    }
    return versionHandler(command, args);
  };
}

Deno.test("update clears owned containers then prepares the new pin", async () => {
  const removed = { value: false };
  const { host, recorded, directory } = await hostWith(
    updateHandler({ removed, failStop: false }),
    { fetch: build123dFetch() },
  );
  try {
    const prepared = await host.prepare("build123d");
    assertEquals(prepared.status, "ready");
    const before = await loadToolRuntimeIntent(
      `${directory}/build123d`,
      "build123d",
    );
    assert(before !== undefined);
    assert(before.imageRef !== NEW_REF);
    const oldRef = before.imageRef;

    const outcome = await host.update("build123d", NEW_REF);
    assertEquals(outcome.status, "ready");

    const stops = recorded.filter((call) => call.args[0] === "stop");
    const rms = recorded.filter((call) => call.args[0] === "rm");
    assertEquals(stops.length, 1);
    assertEquals(stops[0]?.args[1], "aaa");
    assertEquals(rms.length, 1);
    assertEquals(rms[0]?.args[1], "aaa");
    const firstUp = recorded.findIndex((call) =>
      call.args[0] === "compose" && call.args.includes("up")
    );
    const lastStop = recorded.map((call) => call.args[0]).lastIndexOf("stop");
    const lastRm = recorded.map((call) => call.args[0]).lastIndexOf("rm");
    // Two compose ups ran (prepare + update); the update clearing precedes
    // the second one, so the new intent never covers the old container.
    const secondUp = recorded.findIndex((call, index) =>
      index > firstUp && call.args[0] === "compose" && call.args.includes("up")
    );
    assert(secondUp > lastStop && secondUp > lastRm);
    for (const call of recorded) {
      assert(!call.args.includes("rmi"), "images retained");
      assert(
        !(call.args[0] === "volume" && call.args.includes("rm")),
        "volumes retained",
      );
      assert(!call.args.includes("prune"), "never prune");
    }

    const compose = await Deno.readTextFile(`${directory}/build123d/compose.yml`);
    assert(compose.includes(NEW_DIGEST), "compose rewritten for the new pin");
    assert(!compose.includes(oldRef), "old pin gone from compose");
    const after = await loadToolRuntimeIntent(`${directory}/build123d`, "build123d");
    assertEquals(after?.imageRef, NEW_REF);
    const archived: string[] = [];
    for await (const entry of Deno.readDir(`${directory}/build123d`)) {
      if (entry.name.includes(".previous.")) archived.push(entry.name);
    }
    assertEquals(archived.length, 1);
    const archivedName = archived[0] as string;
    const previous = JSON.parse(
      await Deno.readTextFile(`${directory}/build123d/${archivedName}`),
    ) as { imageRef: string };
    assertEquals(previous.imageRef, oldRef);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("update keeps the old intent when clearing fails", async () => {
  const removed = { value: false };
  const { host, recorded, directory } = await hostWith(
    updateHandler({ removed, failStop: true }),
    { fetch: build123dFetch() },
  );
  try {
    // Seed the old intent without owned containers in the way.
    removed.value = true;
    const prepared = await host.prepare("build123d");
    assertEquals(prepared.status, "ready");
    removed.value = false;

    const outcome = await host.update("build123d", NEW_REF);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "update-blocked");
    }
    assert(recorded.some((call) => call.args[0] === "stop"));
    assert(recorded.every((call) => call.args[0] !== "rm"));
    const intent = await loadToolRuntimeIntent(`${directory}/build123d`, "build123d");
    assert(intent !== undefined && intent.imageRef !== NEW_REF);
    for await (const entry of Deno.readDir(`${directory}/build123d`)) {
      assert(!entry.name.includes(".previous."), "nothing archived on failure");
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("projection scrubs digests from renderer strings", () => {
  const digest = "c".repeat(64);
  const projection = projectToolRuntimeStatus({
    engine: {
      status: "ready",
      detail: `Engine ready sha256:${digest}`,
      binaryPresent: true,
      daemonReachable: true,
      reasons: [],
    },
    tools: [{
      toolId: "build123d",
      displayName: "Build123d",
      state: "needs-action",
      detail: `Could not pull repo@sha256:${digest}: denied`,
      ownedContainers: 0,
      ownedVolumes: [],
      recovery: `Inspect sha256:${digest} explicitly.`,
    }],
  });
  assert(!JSON.stringify(projection).includes(digest));
  assert(projection.tools[0]?.detail.includes("sha256:<digest>"));
  assert(projection.tools[0]?.recovery?.includes("sha256:<digest>"));
});
