import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.14";
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
