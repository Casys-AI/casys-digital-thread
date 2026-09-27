import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type { CommandRunner } from "../../../src/adapters/shared/docker-observer.ts";
import { loadToolRuntimeIntent, ToolRuntimeIntentCorruptError } from "./intent.ts";
import {
  hostComposeDocument,
  type PreparationDeps,
  prepareToolRuntime,
  type ToolRuntimePlan,
} from "./preparation.ts";

const DIGEST = "a".repeat(64);
const IMAGE_REF = `ghcr.io/casys-ai/mcp-build123d@sha256:${DIGEST}`;

const READY_VERSION = JSON.stringify({
  Client: { Version: "29.6.1" },
  Server: { Version: "29.7.2", Os: "linux", Arch: "arm64" },
});

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
}

type RunnerHandler = (
  command: string,
  args: string[],
) => { success: boolean; code: number; stdout: string; stderr: string };

function scriptRunner(
  handler: RunnerHandler,
  recorded: RecordedCall[],
): CommandRunner {
  return {
    run: (command, args) => {
      recorded.push({ command, args: [...args] });
      return Promise.resolve(handler(command, args));
    },
  };
}

function readyHandler(): RunnerHandler {
  return (command, args) => {
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
    if (command === "docker" && args[0] === "pull") {
      return { success: true, code: 0, stdout: "Status: Downloaded", stderr: "" };
    }
    if (command === "docker" && args[0] === "image") {
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify({
          RepoDigests: [IMAGE_REF],
          Architecture: "arm64",
        }),
        stderr: "",
      };
    }
    if (command === "docker" && args[0] === "ps") {
      return { success: true, code: 0, stdout: "", stderr: "" };
    }
    if (command === "docker" && args[0] === "compose") {
      return { success: true, code: 0, stdout: "started", stderr: "" };
    }
    throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function readyFetch(): typeof fetch {
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
        result: { resultType: "complete", tools: [{ name: "t_one" }] },
      });
    }
    if (body.method === "resources/list") {
      return jsonResponse({ result: { resultType: "complete", resources: [] } });
    }
    if (body.method === "tools/call") {
      return jsonResponse({
        jsonrpc: "2.0",
        id: body.id,
        result: { resultType: "complete", structuredContent: { ok: true } },
      });
    }
    throw new Error(`unexpected fetch: ${target} ${JSON.stringify(body)}`);
  };
  return ((url: string | URL | Request, init?: RequestInit) =>
    Promise.resolve().then(() => respond(url, init))) as typeof fetch;
}

function testPlan(workdir: string): ToolRuntimePlan {
  return {
    toolId: "build123d-test",
    displayName: "Build123d test",
    imageRef: IMAGE_REF,
    providerVersion: "0.7.0-test",
    platform: "linux/arm64",
    projectName: "casys-host-test",
    serviceName: "mcp-test",
    hostPort: 3999,
    containerPort: 3014,
    volumeName: "casys-host-test-exports",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    healthUrl: "http://127.0.0.1:3999/health",
    expectedTools: ["t_one"],
    smoke: {
      tool: "t_one",
      args: {},
      timeoutMs: 5_000,
      verify: (result) =>
        (result.structuredContent as Record<string, unknown>).ok === true
          ? undefined
          : "smoke result not ok",
    },
    readinessTimeoutMs: 10_000,
    workdir,
    macOSInstall: {
      dmgUrl: "https://desktop.docker.com/mac/main/arm64/Docker.dmg",
      expectedAuthority: "Developer ID Application: Docker Inc.",
      daemonWaitMs: 10_000,
    },
  };
}

function testDeps(
  workdir: string,
  overrides: Partial<PreparationDeps> & {
    runner?: RunnerHandler;
    fetchImpl?: typeof fetch;
    recorded?: RecordedCall[];
  } = {},
): { deps: PreparationDeps; recorded: RecordedCall[] } {
  const recorded = overrides.recorded ?? [];
  const handler = overrides.runner ?? readyHandler();
  const runner = scriptRunner(handler, recorded);
  void workdir;
  return {
    deps: {
      probeRunner: runner,
      execRunner: runner,
      fetch: overrides.fetchImpl ?? readyFetch(),
      sleep: () => Promise.resolve(),
      now: () => "2026-09-27T12:00:00.000Z",
      platform: () => ({ os: "darwin", arch: "aarch64" }),
      ...Object.fromEntries(
        Object.entries(overrides).filter(([key]) =>
          !["runner", "fetchImpl", "recorded"].includes(key)
        ),
      ),
    } as PreparationDeps,
    recorded,
  };
}

function forbidsDangerousCommands(recorded: readonly RecordedCall[]): void {
  for (const call of recorded) {
    const argv = [call.command, ...call.args].join(" ");
    assert(
      !/\bprune\b/.test(argv),
      `forbidden prune command: ${argv}`,
    );
    assert(
      !(call.args.includes("down") ||
        call.args.includes("rm") && call.args.includes("-f")),
      `forbidden destructive command: ${argv}`,
    );
  }
}

Deno.test("preparation reaches ready on the reuse path", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-ready-" });
  try {
    const plan = await testPlan(workdir);
    const { deps, recorded } = await testDeps(workdir);
    const events: string[] = [];
    const outcome = await prepareToolRuntime(
      { ...deps, onEvent: (event) => events.push(`${event.step}:${event.status}`) },
      plan,
    );
    assertEquals(outcome.status, "ready");
    forbidsDangerousCommands(recorded);
    const intent = await loadToolRuntimeIntent(workdir, plan.toolId);
    assert(intent !== undefined);
    for (const step of Object.values(intent.steps)) {
      assertEquals(step.status, "done");
    }
    const compose = await Deno.readTextFile(`${workdir}/compose.yml`);
    assert(compose.includes(IMAGE_REF));
    assert(compose.includes("casys.tool-runtime.owner"));
    assert(compose.includes("127.0.0.1:3999:3014"));
    assertEquals(
      events.filter((event) => event.endsWith(":done")).length,
      6,
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("preparation refuses a tag-pinned plan before acting", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-tag-" });
  try {
    const plan = await testPlan(workdir);
    const { deps, recorded } = await testDeps(workdir);
    const outcome = await prepareToolRuntime(deps, {
      ...plan,
      imageRef: "ghcr.io/casys-ai/mcp-build123d:latest",
    });
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "image-unverified");
    }
    assertEquals(recorded.length, 0);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("preparation stops on a stopped engine without auto-start", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-stopped-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    const { deps, recorded } = await testDeps(workdir, {
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          return {
            success: false,
            code: 1,
            stdout: JSON.stringify({ Client: { Version: "29.6.1" } }),
            stderr: "Cannot connect to the Docker daemon",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "engine-stopped");
    }
    assert(
      recorded.every((call) => call.command === "docker" && call.args[0] === "version"),
      "only detection probes may run",
    );
    const intent = await loadToolRuntimeIntent(workdir, plan.toolId);
    assertEquals(intent?.steps["ensure-engine"].status, "failed");
    assertEquals(intent?.steps["ensure-engine"].code, "engine-stopped");
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("preparation requires explicit install approval when absent", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-absent-" });
  try {
    const plan = await testPlan(workdir);
    const { deps } = await testDeps(workdir, {
      runner: () => ({
        success: false,
        code: -1,
        stdout: "",
        stderr: "Failed to spawn 'docker': No such file or directory (os error 2)",
      }),
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "install-approval-required");
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("absent engine installs through the approved macOS flow", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-install-" });
  try {
    const plan = await testPlan(workdir);
    let versionCalls = 0;
    const handler = readyHandler();
    const seen: string[] = [];
    const delegate = readyFetch();
    const fetchImpl = ((url: unknown, init?: unknown) => {
      if (String(url).endsWith(".dmg")) {
        seen.push(String(url));
        return Promise.resolve(new Response("dmg-bytes", { status: 200 }));
      }
      return (delegate as (u: unknown, i?: unknown) => Promise<Response>)(url, init);
    }) as typeof fetch;
    const { deps } = await testDeps(workdir, {
      fetchImpl,
      confirmInstall: () => Promise.resolve(true),
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          versionCalls++;
          // Engine appears only after the install completes (many probes later).
          if (versionCalls < 6) {
            return {
              success: false,
              code: -1,
              stdout: "",
              stderr:
                "Failed to spawn 'docker': No such file or directory (os error 2)",
            };
          }
        }
        if (command === "/usr/bin/codesign") {
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr:
              "Authority=Developer ID Application: Docker Inc.\nAuthority=Apple Root CA",
          };
        }
        if (command === "/usr/bin/hdiutil" && args[0] === "attach") {
          return {
            success: true,
            code: 0,
            stdout: "/dev/disk7\tApple_HFS\t/Volumes/Docker\n",
            stderr: "",
          };
        }
        if (command === "/usr/bin/hdiutil" && args[0] === "detach") {
          return { success: true, code: 0, stdout: "ejected", stderr: "" };
        }
        if (command === "/usr/bin/osascript") {
          assert(args.join(" ").includes("with administrator privileges"));
          assert(args.join(" ").includes("'/Volumes/Docker/Docker.app'"));
          return { success: true, code: 0, stdout: "", stderr: "" };
        }
        if (command === "/usr/bin/open") {
          return { success: true, code: 0, stdout: "", stderr: "" };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "ready");
    assertEquals(seen, ["https://desktop.docker.com/mac/main/arm64/Docker.dmg"]);
    // The downloaded bytes were staged for verified install.
    const dmg = await Deno.stat(`${workdir}/Docker.dmg`);
    assert(dmg.isFile);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("installer with the wrong signing authority fails closed", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-authority-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    const fetchImpl = (() =>
      Promise.resolve(
        new Response("evil-bytes", { status: 200 }),
      )) as typeof fetch;
    const { deps, recorded } = await testDeps(workdir, {
      fetchImpl,
      confirmInstall: () => Promise.resolve(true),
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          return {
            success: false,
            code: -1,
            stdout: "",
            stderr: "Failed to spawn 'docker': No such file or directory (os error 2)",
          };
        }
        if (command === "/usr/bin/codesign") {
          return {
            success: true,
            code: 0,
            stdout: "",
            stderr: "Authority=Developer ID Application: Someone Else\n",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "install-failed");
    }
    assert(
      recorded.every((call) => call.command !== "/usr/bin/hdiutil"),
      "unverified bytes must never mount",
    );
    assert(
      recorded.every((call) => call.command !== "/usr/bin/osascript"),
      "unverified bytes must never install",
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("absent engine on non-macOS has no install path", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-platform-" });
  try {
    const plan = await testPlan(workdir);
    const { deps } = await testDeps(workdir, {
      platform: () => ({ os: "linux", arch: "x86_64" }),
      confirmInstall: () => Promise.resolve(true),
      runner: () => ({
        success: false,
        code: -1,
        stdout: "",
        stderr: "Failed to spawn 'docker': No such file or directory (os error 2)",
      }),
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "install-unsupported-platform");
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("digest mismatch fails closed without fallback", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-digest-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    const { deps } = await testDeps(workdir, {
      runner: (command, args) => {
        if (command === "docker" && args[0] === "image") {
          return {
            success: true,
            code: 0,
            stdout: JSON.stringify({
              RepoDigests: [`ghcr.io/casys-ai/mcp-build123d@sha256:${"b".repeat(64)}`],
              Architecture: "arm64",
            }),
            stderr: "",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "image-unverified");
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("port conflict stops without touching foreign containers", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-port-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    const { deps, recorded } = await testDeps(workdir, {
      runner: (command, args) => {
        if (command === "docker" && args[0] === "compose" && args.includes("up")) {
          return {
            success: false,
            code: 1,
            stdout: "",
            stderr: "Error response from daemon: port is already allocated",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "port-conflict");
    }
    assert(
      recorded.every((call) =>
        !(call.args.includes("stop") || call.args.includes("rm") ||
          call.args.includes("kill"))
      ),
      "no stop/remove may run on conflict",
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("smoke timeout is uncertain and never auto-retried", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-smoke-" });
  try {
    const plan = await testPlan(workdir);
    let toolCalls = 0;
    const hanging: typeof fetch = (async (url, init) => {
      const target = String(url);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (!target.endsWith("/health") && body.method === "tools/call") {
        toolCalls++;
        await new Promise((resolve) => setTimeout(resolve, 200));
        return jsonResponse({
          jsonrpc: "2.0",
          id: body.id,
          result: { resultType: "complete", structuredContent: { ok: true } },
        });
      }
      return (readyFetch() as (u: unknown, i?: unknown) => Promise<Response>)(
        url,
        init,
      );
    }) as typeof fetch;
    const { deps } = await testDeps(workdir, {
      fetchImpl: hanging,
      sleep: () => Promise.resolve(),
    });
    const quick = { ...plan, smoke: { ...plan.smoke, timeoutMs: 20 } };
    const outcome = await prepareToolRuntime(deps, quick);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "smoke-uncertain");
    }
    assertEquals(toolCalls, 1);
    // Resume without the explicit flag replays the journaled refusal, no new call.
    const resumed = await prepareToolRuntime(deps, quick);
    assertEquals(resumed.status, "needs-action");
    if (resumed.status === "needs-action") {
      assertEquals(resumed.code, "smoke-uncertain");
    }
    assertEquals(toolCalls, 1);
    // Explicit operator retry runs exactly once more.
    const retried = await prepareToolRuntime(
      { ...deps, retryFailedSmoke: true },
      quick,
    );
    assertEquals(retried.status, "needs-action");
    assertEquals(toolCalls, 2);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("completed smoke is trusted on resume, never re-executed", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-resume-" });
  try {
    const plan = await testPlan(workdir);
    let toolCalls = 0;
    const counting = ((url, init) => {
      const target = String(url);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (!target.endsWith("/health") && body.method === "tools/call") toolCalls++;
      return (readyFetch() as (u: unknown, i?: unknown) => Promise<Response>)(
        url,
        init,
      );
    }) as typeof fetch;
    // Seed a fully-done intent, then add one owned running container.
    const { deps } = await testDeps(workdir, { fetchImpl: counting });
    const first = await prepareToolRuntime(deps, plan);
    assertEquals(first.status, "ready");
    assertEquals(toolCalls, 1);
    // Second run re-verifies cheaply; smoke must not execute again.
    const handler = readyHandler();
    const { deps: again } = await testDeps(workdir, {
      fetchImpl: counting,
      runner: (command, args) => {
        if (command === "docker" && args[0] === "ps") {
          return {
            success: true,
            code: 0,
            stdout: JSON.stringify({ ID: "abc", State: "running" }),
            stderr: "",
          };
        }
        return handler(command, args);
      },
    });
    const second = await prepareToolRuntime(again, plan);
    assertEquals(second.status, "ready");
    assertEquals(toolCalls, 1);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("interrupted steps resume instead of duplicating", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-interrupt-" });
  try {
    const plan = await testPlan(workdir);
    let pulls = 0;
    const handler = readyHandler();
    const flaky = (command: string, args: string[]) => {
      if (command === "docker" && args[0] === "pull") {
        pulls++;
        if (pulls === 1) {
          return { success: false, code: 1, stdout: "", stderr: "connection reset" };
        }
      }
      return handler(command, args);
    };
    const { deps } = await testDeps(workdir, { runner: flaky });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "ready");
    assertEquals(pulls, 2);
    const intent = await loadToolRuntimeIntent(workdir, plan.toolId);
    assertEquals(intent?.steps["acquire-image"].status, "done");
    assert((intent?.steps["acquire-image"].attempts ?? 0) >= 2);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("intent image mismatch refuses without acting", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-mismatch-" });
  try {
    const plan = await testPlan(workdir);
    const { deps, recorded } = await testDeps(workdir);
    const first = await prepareToolRuntime(deps, plan);
    assertEquals(first.status, "ready");
    recorded.length = 0;
    const outcome = await prepareToolRuntime(deps, {
      ...plan,
      imageRef: `ghcr.io/casys-ai/mcp-build123d@sha256:${"c".repeat(64)}`,
    });
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "intent-image-mismatch");
    }
    assertEquals(recorded.length, 0);
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("corrupt intent fails closed", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-corrupt-" });
  try {
    const plan = await testPlan(workdir);
    await Deno.writeTextFile(
      `${workdir}/tool-runtime-${plan.toolId}.intent.json`,
      "{not-json",
    );
    const { deps } = await testDeps(workdir);
    await assertRejects(
      () => prepareToolRuntime(deps, plan),
      ToolRuntimeIntentCorruptError,
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("readiness tools mismatch fails closed", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-tools-" });
  try {
    const plan = await testPlan(workdir);
    const base = readyFetch();
    const wrongTools = ((url, init) => {
      const target = String(url);
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
      if (!target.endsWith("/health") && body.method === "tools/list") {
        return Promise.resolve(
          jsonResponse({
            result: { resultType: "complete", tools: [{ name: "other_tool" }] },
          }),
        );
      }
      return (base as (u: unknown, i?: unknown) => Promise<Response>)(url, init);
    }) as typeof fetch;
    const { deps } = await testDeps(workdir, {
      fetchImpl: wrongTools,
      sleep: () => Promise.resolve(),
    });
    const outcome = await prepareToolRuntime(
      deps,
      { ...plan, readinessTimeoutMs: 0 },
    );
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "readiness-tools-mismatch");
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("host compose document is loopback, bounded, and owned", () => {
  const document = hostComposeDocument({
    toolId: "build123d",
    displayName: "Build123d",
    imageRef: IMAGE_REF,
    providerVersion: "0.7.0-test",
    platform: "linux/arm64",
    projectName: "casys-host-build123d",
    serviceName: "mcp-build123d",
    hostPort: 3014,
    containerPort: 3014,
    volumeName: "casys-host-build123d-exports",
    mcpUrl: "http://127.0.0.1:3014/mcp",
    healthUrl: "http://127.0.0.1:3014/health",
    expectedTools: ["build123d_execute"],
    smoke: {
      tool: "build123d_execute",
      args: {},
      timeoutMs: 1,
      verify: () => undefined,
    },
    readinessTimeoutMs: 1,
    workdir: "/tmp",
  });
  assert(document.includes(`image: "${IMAGE_REF}"`));
  assert(document.includes("127.0.0.1:3014:3014"));
  assert(document.includes("casys.tool-runtime.owner"));
  assert(document.includes("mem_limit: 2g"));
  assert(document.includes("no-new-privileges:true"));
  assert(!document.includes("privileged"));
});

Deno.test("failed non-smoke steps retry with a fresh budget on re-run", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-retry-" });
  try {
    const plan = await testPlan(workdir);
    let pulls = 0;
    let failPull = true;
    const handler = readyHandler();
    const { deps } = await testDeps(workdir, {
      runner: (command, args) => {
        if (command === "docker" && args[0] === "pull") {
          pulls++;
          if (failPull) {
            return {
              success: false,
              code: 1,
              stdout: "",
              stderr: `denied: ${IMAGE_REF} not found`,
            };
          }
        }
        return handler(command, args);
      },
    });
    const first = await prepareToolRuntime(deps, plan);
    assertEquals(first.status, "needs-action");
    if (first.status === "needs-action") {
      assertEquals(first.code, "image-acquire-failed");
      assert(
        first.detail.includes("Build123d test"),
        "names the tool, not the image ref",
      );
      assert(!first.detail.includes(DIGEST), "no digest hex crosses");
    }
    assertEquals(pulls, 3);
    // Explicit re-run retries the failed step instead of refusing.
    failPull = false;
    const second = await prepareToolRuntime(deps, plan);
    assertEquals(second.status, "ready");
    assertEquals(pulls, 4);
    const intent = await loadToolRuntimeIntent(workdir, plan.toolId);
    assertEquals(intent?.steps["acquire-image"].status, "done");
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("port conflict detail and recovery name no port number", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-portstr-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    const { deps } = await testDeps(workdir, {
      runner: (command, args) => {
        if (command === "docker" && args[0] === "compose" && args.includes("up")) {
          return {
            success: false,
            code: 1,
            stdout: "",
            stderr: "Error response from daemon: port is already allocated",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "port-conflict");
      assert(!outcome.detail.includes(String(plan.hostPort)));
      assert(!outcome.recovery.includes(String(plan.hostPort)));
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("install re-observation of a stopped engine fails honestly", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-reobs-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    let versionCalls = 0;
    const { deps, recorded } = await testDeps(workdir, {
      confirmInstall: () => Promise.resolve(true),
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          versionCalls++;
          if (versionCalls <= 2) {
            return {
              success: false,
              code: -1,
              stdout: "",
              stderr: "Failed to spawn 'docker': No such file or directory",
            };
          }
          return {
            success: false,
            code: 1,
            stdout: JSON.stringify({ Client: { Version: "29.6.1" } }),
            stderr: "Cannot connect to the Docker daemon",
          };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "engine-stopped");
    }
    const intent = await loadToolRuntimeIntent(workdir, plan.toolId);
    assertEquals(intent?.steps["ensure-engine"].status, "failed");
    assert(
      recorded.every((call) => call.command !== "/usr/bin/codesign"),
      "no install work may run for a present engine",
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("install re-observation of an incompatible engine fails honestly", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-reobs2-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    let versionCalls = 0;
    const { deps } = await testDeps(workdir, {
      confirmInstall: () => Promise.resolve(true),
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          versionCalls++;
          if (versionCalls <= 2) {
            return {
              success: false,
              code: -1,
              stdout: "",
              stderr: "Failed to spawn 'docker': No such file or directory",
            };
          }
          return {
            success: true,
            code: 0,
            stdout: JSON.stringify({
              Client: { Version: "29.6.1" },
              Server: { Version: "29.7.2", Os: "windows", Arch: "amd64" },
            }),
            stderr: "",
          };
        }
        if (command === "docker" && args[0] === "compose" && args[1] === "version") {
          return { success: false, code: 1, stdout: "", stderr: "no plugin" };
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "needs-action");
    if (outcome.status === "needs-action") {
      assertEquals(outcome.code, "engine-incompatible");
    }
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});

Deno.test("install re-observation of a ready engine short-circuits", async () => {
  const workdir = await Deno.makeTempDir({ prefix: "tool-runtime-reobs3-" });
  try {
    const plan = await testPlan(workdir);
    const handler = readyHandler();
    let versionCalls = 0;
    const { deps, recorded } = await testDeps(workdir, {
      confirmInstall: () => Promise.resolve(true),
      runner: (command, args) => {
        if (command === "docker" && args[0] === "version") {
          versionCalls++;
          if (versionCalls <= 2) {
            return {
              success: false,
              code: -1,
              stdout: "",
              stderr: "Failed to spawn 'docker': No such file or directory",
            };
          }
        }
        return handler(command, args);
      },
    });
    const outcome = await prepareToolRuntime(deps, plan);
    assertEquals(outcome.status, "ready");
    assert(
      recorded.every((call) => call.command !== "/usr/bin/codesign"),
      "ready engine skips the installer",
    );
  } finally {
    await Deno.remove(workdir, { recursive: true });
  }
});
