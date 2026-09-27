import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  createMcpAppLiveHost,
  liveHostReadResources,
  MCP_APP_LIVE_HOST_PROTOCOL_VERSION,
  type McpAppLiveHostReadiness,
  type McpAppLiveHostSession,
} from "../../../src/ui/src/thread/mcp-app-live-host.ts";
import type { McpAppHostMessageEvent } from "../../../src/ui/src/thread/mcp-app-read-only-host.ts";

const SHA = "3e9464f9bbb0079d31004f09cfe376ba33b9ffe4b288e94176a304e9761e0fa8";

function session(
  overrides: Partial<McpAppLiveHostSession> = {},
): McpAppLiveHostSession {
  return {
    conversationId: "conversation:1",
    toolCallId: "tool-call-1",
    server: "build123d",
    tool: "build123d_export",
    toolInput: {},
    toolResult: { kind: "export" },
    serverTools: ["build123d_export"],
    readResources: [],
    ...overrides,
  };
}

Deno.test("liveHostReadResources registers versioned export artifacts", () => {
  assertEquals(
    liveHostReadResources({
      structuredContent: {
        kind: "export",
        files: [
          {
            format: "gltf",
            artifact: {
              schemaVersion: "build123d-export-artifact/1.0",
              uri: `casys://build123d/artifacts/${SHA}.glb`,
              format: "gltf",
              mimeType: "model/gltf-binary",
              bytes: 3408,
              sha256: SHA,
            },
          },
          {
            format: "gltf",
            artifact: {
              schemaVersion: "build123d-export-artifact/1.0",
              uri: `casys://build123d/artifacts/${SHA}.glb`,
              format: "gltf",
              mimeType: "model/gltf-binary",
              bytes: 3408,
              sha256: SHA,
            },
          },
        ],
      },
    }),
    [{
      uri: `casys://build123d/artifacts/${SHA}.glb`,
      mimeType: "model/gltf-binary",
      bytes: 3408,
      fingerprint: `sha256:${SHA}`,
    }],
  );
});

Deno.test("liveHostReadResources ignores foreign shapes without throwing", () => {
  assertEquals(liveHostReadResources(undefined), []);
  assertEquals(liveHostReadResources({ structuredContent: { files: "no" } }), []);
  assertEquals(
    liveHostReadResources({
      structuredContent: {
        files: [
          { artifact: { schemaVersion: "other/1.0", uri: "casys://x/y" } },
          {
            artifact: {
              schemaVersion: "build123d-export-artifact/1.0",
              uri: "https://example.com/evil.glb",
              mimeType: "model/gltf-binary",
              bytes: 8,
              sha256: SHA,
            },
          },
          {
            artifact: {
              schemaVersion: "build123d-export-artifact/1.0",
              uri: `casys://build123d/artifacts/${SHA}.glb`,
              mimeType: "model/gltf-binary",
              bytes: 8,
              sha256: "not-a-digest",
            },
          },
        ],
      },
    }),
    [],
  );
});

Deno.test("live host handshakes, delivers the exact result, and gates tools", async () => {
  const posted: unknown[] = [];
  const readiness: McpAppLiveHostReadiness[] = [];
  const target = {
    postMessage: (message: unknown) => void posted.push(message),
  };
  const toolCalls: Array<{ name: string; args: unknown }> = [];
  const readCalls: string[] = [];
  const host = createMcpAppLiveHost({
    target,
    session: session(),
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    delegates: {
      callTool: (name, args) => {
        toolCalls.push({ name, args });
        return Promise.resolve({ ok: true });
      },
      readResource: (uri) => {
        readCalls.push(uri);
        return Promise.resolve({
          uri,
          mimeType: "model/gltf-binary",
          bytes: 3,
          encoding: "base64",
          data: "Z2xi",
          source: "live",
        });
      },
    },
    onReadiness: (event) => void readiness.push(event),
  });
  const message = (data: unknown): McpAppHostMessageEvent => ({
    source: target,
    origin: "null",
    data,
  });

  // Foreign sources and origins are ignored.
  assertEquals(
    host.handleMessage({ source: {}, origin: "null", data: {} }),
    false,
  );
  assertEquals(
    host.handleMessage({ source: target, origin: "https://x", data: {} }),
    false,
  );

  // Wrong protocol generation is refused.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: { appInfo: {}, appCapabilities: {}, protocolVersion: "1999-01-01" },
    })),
    true,
  );
  assertEquals(
    (posted[0] as { error: { code: number } }).error.code,
    -32602,
  );

  // Exact handshake succeeds and advertises no authority capability.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 2,
      method: "ui/initialize",
      params: {
        appInfo: { name: "any", version: "9" },
        appCapabilities: {},
        protocolVersion: MCP_APP_LIVE_HOST_PROTOCOL_VERSION,
      },
    })),
    true,
  );
  const initialized = posted[1] as {
    result: { protocolVersion: string; hostCapabilities: unknown };
  };
  assertEquals(initialized.result.protocolVersion, MCP_APP_LIVE_HOST_PROTOCOL_VERSION);
  assertEquals(initialized.result.hostCapabilities, {});

  // Initialized triggers the exact input-then-result delivery.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      method: "ui/notifications/initialized",
    })),
    true,
  );
  assertEquals(posted.length, 4);
  assertEquals(
    posted[2],
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-input",
      params: { arguments: {} },
    },
  );
  assertEquals(
    posted[3],
    {
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: { kind: "export" },
    },
  );
  assertEquals(readiness, [{ kind: "tool-result-delivered" }]);

  // Pinned tools delegate; foreign names fail closed without delegating.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "build123d_export", arguments: { a: 1 } },
    })),
    true,
  );
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(toolCalls, [{ name: "build123d_export", args: { a: 1 } }]);
  assertEquals(posted[4], { jsonrpc: "2.0", id: 3, result: { ok: true } });

  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "other_tool", arguments: {} },
    })),
    true,
  );
  assertEquals(
    (posted[5] as { error: { code: number } }).error.code,
    -32602,
  );
  assertEquals(toolCalls.length, 1);

  // resources/read delegates to the owning session and serves a blob.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 5,
      method: "resources/read",
      params: { uri: "casys://build123d/artifacts/abc.glb" },
    })),
    true,
  );
  await Promise.resolve();
  await Promise.resolve();
  assertEquals(readCalls, ["casys://build123d/artifacts/abc.glb"]);
  assertEquals(posted[6], {
    jsonrpc: "2.0",
    id: 5,
    result: {
      contents: [{
        uri: "casys://build123d/artifacts/abc.glb",
        mimeType: "model/gltf-binary",
        blob: "Z2xi",
      }],
    },
  });
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 6,
      method: "resources/read",
      params: {},
    })),
    true,
  );
  assertEquals(
    (posted[7] as { error: { code: number } }).error.code,
    -32602,
  );

  // Unimplemented authority methods fail with method-not-found.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/list",
      params: {},
    })),
    true,
  );
  assertEquals(
    (posted[8] as { error: { code: number } }).error.code,
    -32601,
  );

  // Size reports surface as frame-size readiness for inline sizing.
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: 300, height: 625 },
    })),
    true,
  );
  assertEquals(readiness[readiness.length - 1], {
    kind: "frame-size",
    width: 300,
    height: 625,
  });
  const before = readiness.length;
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      method: "ui/notifications/size-changed",
      params: { width: -1, height: 10_000 },
    })),
    true,
  );
  assertEquals(readiness.length, before);

  host.invalidate();
  assertEquals(
    host.handleMessage(message({ jsonrpc: "2.0", method: "ui/initialize" })),
    false,
  );
});

Deno.test("live host refuses delegate calls before initialize", () => {
  const posted: unknown[] = [];
  const target = {
    postMessage: (message: unknown) => void posted.push(message),
  };
  let delegated = 0;
  const host = createMcpAppLiveHost({
    target,
    session: session(),
    hostContext: { displayMode: "inline", availableDisplayModes: ["inline"] },
    delegates: {
      callTool: () => {
        delegated += 1;
        return Promise.resolve({ ok: true });
      },
      readResource: () => {
        delegated += 1;
        return Promise.reject(new Error("not used"));
      },
    },
  });
  const message = (data: unknown): McpAppHostMessageEvent => ({
    source: target,
    origin: "null",
    data,
  });
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "build123d_export", arguments: {} },
    })),
    true,
  );
  assertEquals(
    host.handleMessage(message({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/read",
      params: { uri: "casys://build123d/artifacts/abc.glb" },
    })),
    true,
  );
  assertEquals(
    (posted[0] as { error: { code: number } }).error.code,
    -32600,
  );
  assertEquals(
    (posted[1] as { error: { code: number } }).error.code,
    -32600,
  );
  assertEquals(delegated, 0);
});
