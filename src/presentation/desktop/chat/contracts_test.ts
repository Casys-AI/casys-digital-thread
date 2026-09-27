import { assertEquals, assertThrows } from "@std/assert";
import {
  DESKTOP_CHAT_PROTOCOL,
  isChatOpaqueId,
  isChatViewerToolName,
  isChatViewerUiUri,
  parseChatCommandRequest,
  parseChatSnapshotDto,
  parseChatViewerAppFetchRequest,
  parseChatViewerAppFetchResponse,
  parseChatViewerArguments,
  parseChatViewerJson,
} from "./contracts.ts";

function conversation(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "conv-1",
    kind: "standalone",
    title: "Standalone",
    status: "idle",
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    messages: [],
    viewers: [],
    ...overrides,
  };
}

function snapshotWith(
  ...conversations: ReadonlyArray<Record<string, unknown>>
): Record<string, unknown> {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    host: "ready",
    conversations: [...conversations],
    connectableMcps: [],
  };
}

Deno.test("snapshot accepts a standalone conversation without a projectId", () => {
  const parsed = parseChatSnapshotDto(snapshotWith(conversation()));
  assertEquals(parsed.conversations.length, 1);
  assertEquals(parsed.conversations[0]?.kind, "standalone");
});

Deno.test("snapshot accepts a project conversation with a valid projectId", () => {
  const parsed = parseChatSnapshotDto(
    snapshotWith(
      conversation({
        kind: "project",
        projectId: "proj-123",
        title: "proj-123",
      }),
    ),
  );
  assertEquals(parsed.conversations[0]?.projectId, "proj-123");
});

Deno.test("snapshot rejects a standalone conversation carrying a projectId", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(conversation({ projectId: "proj-123" })),
      ),
    TypeError,
    "standalone conversation must not have a projectId",
  );
});

Deno.test("snapshot rejects a project conversation without a projectId", () => {
  assertThrows(
    () => parseChatSnapshotDto(snapshotWith(conversation({ kind: "project" }))),
    TypeError,
    "project conversation requires a projectId",
  );
});

Deno.test("snapshot rejects a projectId outside the closed identifier contract", () => {
  assertThrows(
    () =>
      parseChatSnapshotDto(
        snapshotWith(
          conversation({ kind: "project", projectId: "not a project!" }),
        ),
      ),
    TypeError,
    "projectId must be an explicit Casys project identifier",
  );
});

const VIEWER_FINGERPRINT = `sha256:${"ab".repeat(32)}`;

Deno.test("viewer App fetch request pins server, uri, and fingerprint", () => {
  const parsed = parseChatViewerAppFetchRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-1",
    server: "build123d",
    uri: "ui://build123d/results-viewer",
    fingerprint: VIEWER_FINGERPRINT,
  });
  assertEquals(parsed.server, "build123d");
  assertEquals(parsed.uri, "ui://build123d/results-viewer");
  assertEquals(parsed.fingerprint, VIEWER_FINGERPRINT);
});

Deno.test("viewer App fetch request refuses non-ui URIs", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-app-2",
        server: "build123d",
        uri: "https://example.com/app.html",
        fingerprint: VIEWER_FINGERPRINT,
      }),
    TypeError,
    "viewer App URI is invalid",
  );
});

Deno.test("viewer App fetch response carries base64 bytes on success", () => {
  const parsed = parseChatViewerAppFetchResponse({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-1",
    ok: true,
    app: {
      uri: "ui://build123d/results-viewer",
      mimeType: "text/html;profile=mcp-app",
      bytes: 4,
      fingerprint: VIEWER_FINGERPRINT,
      encoding: "base64",
      data: "PGI+",
    },
  });
  assertEquals(parsed.ok, true);
  assertEquals(parsed.app?.bytes, 4);
  assertEquals(parsed.app?.data, "PGI+");
});

Deno.test("viewer resource-read accepts server-scoped artifact URIs", () => {
  const parsed = parseChatCommandRequest({
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-read-1",
    command: "viewer.resource-read",
    conversationId: "conversation:1",
    toolCallId: "tool-call-1",
    uri: "casys://build123d/artifacts/abc123.glb",
  });
  if (parsed.command !== "viewer.resource-read") throw new Error("wrong branch");
  assertEquals(parsed.uri, "casys://build123d/artifacts/abc123.glb");
  assertThrows(
    () =>
      parseChatCommandRequest({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-read-2",
        command: "viewer.resource-read",
        conversationId: "conversation:1",
        toolCallId: "tool-call-1",
        uri: "https://example.com/evil.glb",
      }),
    TypeError,
    "viewer resource URI is invalid",
  );
});

Deno.test("viewer App fetch response refuses malformed fingerprints", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse({
        protocol: DESKTOP_CHAT_PROTOCOL,
        requestId: "request-app-3",
        ok: true,
        app: {
          uri: "ui://build123d/results-viewer",
          mimeType: "text/html;profile=mcp-app",
          bytes: 4,
          fingerprint: "not-a-fingerprint",
          encoding: "base64",
          data: "PGI+",
        },
      }),
    TypeError,
    "viewer fingerprint is invalid",
  );
});

function viewerAppBytes(overrides: Record<string, unknown> = {}) {
  return {
    uri: "ui://build123d/results-viewer",
    mimeType: "text/html;profile=mcp-app",
    bytes: 4,
    fingerprint: VIEWER_FINGERPRINT,
    encoding: "base64",
    data: "PGI+",
    ...overrides,
  };
}

function viewerAppResponse(app: Record<string, unknown>) {
  return {
    protocol: DESKTOP_CHAT_PROTOCOL,
    requestId: "request-app-bounds",
    ok: true,
    app,
  };
}

Deno.test("viewer App fetch response drops smuggled sidecar fields", () => {
  const parsed = parseChatViewerAppFetchResponse(
    viewerAppResponse(viewerAppBytes({ evil: "smuggled", bytes: 4 })),
  );
  assertEquals(parsed.ok, true);
  assertEquals("evil" in (parsed.app ?? {}), false);
  assertEquals(Object.keys(parsed.app ?? {}).sort(), [
    "bytes",
    "data",
    "encoding",
    "fingerprint",
    "mimeType",
    "uri",
  ]);
});

Deno.test("viewer App fetch response enforces byte-count and payload caps", () => {
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse(
        viewerAppResponse(viewerAppBytes({ bytes: 8_388_609 })),
      ),
    TypeError,
    "viewer App bytes is invalid",
  );
  assertThrows(
    () =>
      parseChatViewerAppFetchResponse(
        viewerAppResponse(viewerAppBytes({ data: "QQ==".padEnd(12_000_001, "A") })),
      ),
    TypeError,
    "viewer App data is invalid",
  );
});

Deno.test("viewer JSON rejects deep, oversized, and overlarge payloads", () => {
  let deep: unknown = 0;
  for (let depth = 0; depth < 12; depth += 1) deep = [deep];
  assertThrows(() => parseChatViewerJson(deep), TypeError, "too deep");
  assertThrows(
    () => parseChatViewerJson("x".repeat(65_537)),
    TypeError,
    "oversized string",
  );
  const wide: Record<string, unknown> = {};
  for (let index = 0; index < 500; index += 1) {
    wide[`key-${index}`] = "y".repeat(2_500);
  }
  assertThrows(() => parseChatViewerJson(wide), TypeError, "too large");
});

Deno.test("viewer JSON rejects node floods past the bounded budget", () => {
  const flood: unknown[] = [];
  for (let index = 0; index < 21; index += 1) {
    flood.push(new Array<unknown>(1_000).fill(0));
  }
  assertThrows(() => parseChatViewerJson(flood), TypeError, "too many nodes");
});

Deno.test("viewer arguments require a bounded object record", () => {
  assertEquals(parseChatViewerArguments({ width: 12 }), { width: 12 });
  assertThrows(
    () => parseChatViewerArguments([["width", 12]]),
    TypeError,
    "viewer arguments must be an object",
  );
  assertThrows(
    () => parseChatViewerArguments("width=12"),
    TypeError,
    "viewer arguments must be an object",
  );
  assertThrows(
    () => parseChatViewerArguments({ blob: "z".repeat(65_537) }),
    TypeError,
    "oversized string",
  );
});

Deno.test("host filter predicates mirror the renderer shapes", () => {
  assertEquals(isChatViewerToolName("build123d_export"), true);
  assertEquals(isChatViewerToolName("a-b_c.d9"), true);
  assertEquals(isChatViewerToolName(""), false);
  assertEquals(isChatViewerToolName("evil tool/x"), false);
  assertEquals(isChatViewerToolName("x".repeat(129)), false);
  assertEquals(isChatViewerToolName(42), false);
  assertEquals(isChatOpaqueId("conversation:1"), true);
  assertEquals(isChatOpaqueId("a.b_c-d:e"), true);
  assertEquals(isChatOpaqueId(""), false);
  assertEquals(isChatOpaqueId("has space"), false);
  assertEquals(isChatOpaqueId("x".repeat(161)), false);
  assertEquals(isChatViewerUiUri("ui://build123d/results-viewer"), true);
  assertEquals(isChatViewerUiUri("https://example.com/x"), false);
  assertEquals(isChatViewerUiUri("ui://with space"), false);
  assertEquals(isChatViewerUiUri(`ui://${"x".repeat(500)}`), false);
});
