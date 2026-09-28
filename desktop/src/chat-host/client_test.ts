import { assertEquals, assertRejects, assertThrows } from "jsr:@std/assert@1.0.14";
import pins from "../../chat-runtime/pins.json" with { type: "json" };
import { CHAT_HOST_COMPONENT_VERSION } from "../../../src/presentation/desktop/chat/contracts.ts";
import { type ChatHostChild, ChatHostClient, validateAbsolutePath } from "./client.ts";
import { CHAT_HOST_IPC_PROTOCOL } from "./protocol.ts";

Deno.test("Chat Host path validation is platform-aware", () => {
  validateAbsolutePath("/opt/casys/chat-host", "executable", "Linux");
  validateAbsolutePath(
    "/Applications/Casys.app/Contents/Helpers/host",
    "executable",
    "macOS",
  );
  validateAbsolutePath(
    "C:\\Program Files\\Casys\\chat-host.exe",
    "executable",
    "Windows",
  );
  validateAbsolutePath(
    "\\\\server\\share\\Casys\\chat-host.exe",
    "executable",
    "Windows",
  );
  assertThrows(() => validateAbsolutePath("C:relative", "path", "Windows"));
  assertThrows(() =>
    validateAbsolutePath("C:\\Casys\\..\\host.exe", "path", "Windows")
  );
  assertThrows(() => validateAbsolutePath("relative/host", "path", "Linux"));
  assertThrows(() => validateAbsolutePath("/", "path", "Linux"));
  assertThrows(() => validateAbsolutePath("C:\\", "path", "Windows"));
});

Deno.test("Chat Host shutdown returns unresolved when status never settles", async () => {
  const signals: Deno.Signal[] = [];
  const ready = `${
    JSON.stringify({
      protocol: CHAT_HOST_IPC_PROTOCOL,
      type: "ready",
      pid: 42,
      chatHostVersion: CHAT_HOST_COMPONENT_VERSION,
      acpxCommit: pins.acpx.commit,
      adapterVersion: pins.adapter.version,
      nodeVersion: pins.nodeVersion,
      target: "darwin-arm64",
    })
  }\n`;
  const child: ChatHostChild = {
    stdin: new WritableStream<Uint8Array>(),
    stdout: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ready));
      },
    }),
    status: new Promise(() => undefined),
    kill(signal) {
      signals.push(signal);
    },
  };
  const client = await ChatHostClient.start({
    paths: {
      executable: "/Applications/Casys.app/Contents/Helpers/host",
      target: "darwin-arm64",
    },
    dataRoot: "/tmp/casys-chat-test",
    launchCwd: "/tmp",
    env: {},
    platform: "macOS",
    spawn: () => child,
    timeouts: {
      readyMs: 50,
      requestMs: 5,
      stopMs: 5,
      terminateMs: 5,
      killMs: 5,
      readerMs: 5,
    },
  });
  const result = await client.stop();
  assertEquals(result.status, "unresolved");
  assertEquals(signals, ["SIGTERM", "SIGKILL"]);
  const retry = await client.stop();
  assertEquals(retry.status, "unresolved");
  assertEquals(signals, ["SIGTERM", "SIGKILL", "SIGTERM", "SIGKILL"]);
});

function readyLine(): string {
  return `${
    JSON.stringify({
      protocol: CHAT_HOST_IPC_PROTOCOL,
      type: "ready",
      pid: 42,
      chatHostVersion: CHAT_HOST_COMPONENT_VERSION,
      acpxCommit: pins.acpx.commit,
      adapterVersion: pins.adapter.version,
      nodeVersion: pins.nodeVersion,
      target: "darwin-arm64",
    })
  }\n`;
}

/** Fake host: answers each IPC line from a script, records methods. */
function scriptedChild(
  respond: (
    method: string,
    payload: unknown,
  ) => { ok: boolean; payload?: unknown; error?: string },
): { child: ChatHostChild; methods: string[]; payloads: unknown[] } {
  const methods: string[] = [];
  const payloads: unknown[] = [];
  const encoder = new TextEncoder();
  const lines: Uint8Array[] = [encoder.encode(readyLine())];
  let puller: (() => void) | undefined;
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      const pump = () => {
        const next = lines.shift();
        if (next === undefined) {
          puller = pump;
          return;
        }
        controller.enqueue(next);
        queueMicrotask(pump);
      };
      pump();
    },
  });
  const stdin = new WritableStream<Uint8Array>({
    write(chunk) {
      const request = JSON.parse(new TextDecoder().decode(chunk)) as {
        requestId: string;
        method: string;
        payload?: unknown;
      };
      methods.push(request.method);
      payloads.push(request.payload);
      if (request.method === "shutdown") return;
      const answer = respond(request.method, request.payload);
      lines.push(
        encoder.encode(
          `${
            JSON.stringify({
              protocol: CHAT_HOST_IPC_PROTOCOL,
              requestId: request.requestId,
              ...answer,
            })
          }\n`,
        ),
      );
      puller?.();
      puller = undefined;
    },
  });
  return {
    child: {
      stdin,
      stdout,
      status: new Promise(() => undefined),
      kill: () => undefined,
    },
    methods,
    payloads,
  };
}

async function startScripted(
  respond: (
    method: string,
    payload: unknown,
  ) => { ok: boolean; payload?: unknown; error?: string },
): Promise<{ client: ChatHostClient; methods: string[]; payloads: unknown[] }> {
  const { child, methods, payloads } = scriptedChild(respond);
  const client = await ChatHostClient.start({
    paths: {
      executable: "/Applications/Casys.app/Contents/Helpers/host",
      target: "darwin-arm64",
    },
    dataRoot: "/tmp/casys-chat-test",
    launchCwd: "/tmp",
    env: {},
    platform: "macOS",
    spawn: () => child,
    timeouts: {
      readyMs: 500,
      requestMs: 500,
      stopMs: 5,
      terminateMs: 5,
      killMs: 5,
      readerMs: 5,
    },
  });
  return { client, methods, payloads };
}

Deno.test("mcp.ensure and mcp.release round-trip attachment directives", async () => {
  const { client, methods, payloads } = await startScripted((method) => {
    if (method === "mcp.ensure") return { ok: true, payload: { attached: true } };
    return { ok: true, payload: { released: true } };
  });
  const ensured = await client.mcpEnsure({
    mcpId: "build123d",
    mcpUrl: "http://127.0.0.1:45678/mcp",
    healthUrl: "http://127.0.0.1:45678/health",
  });
  assertEquals(ensured, { attached: true });
  const released = await client.mcpRelease("build123d");
  assertEquals(released, { released: true });
  assertEquals(methods, ["mcp.ensure", "mcp.release"]);
  assertEquals(payloads[0], {
    mcpId: "build123d",
    mcpUrl: "http://127.0.0.1:45678/mcp",
    healthUrl: "http://127.0.0.1:45678/health",
  });
  assertEquals(payloads[1], { mcpId: "build123d" });
});

Deno.test("mcp.ensure surfaces host refusals and malformed replies", async () => {
  const refused = await startScripted(() => ({ ok: false, error: "not connectable" }));
  await assertRejects(
    () =>
      refused.client.mcpEnsure({
        mcpId: "evil",
        mcpUrl: "http://127.0.0.1:1/mcp",
        healthUrl: "http://127.0.0.1:1/health",
      }),
    Error,
    "not connectable",
  );
  const malformed = await startScripted(() => ({
    ok: true,
    payload: { attached: "yes" },
  }));
  await assertRejects(
    () =>
      malformed.client.mcpEnsure({
        mcpId: "build123d",
        mcpUrl: "http://127.0.0.1:1/mcp",
        healthUrl: "http://127.0.0.1:1/health",
      }),
    TypeError,
    "mcp.ensure response is invalid",
  );
});
