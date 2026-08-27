import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  CONTROL_PLANE_HANDSHAKE_SCHEMA,
  CONTROL_PLANE_INSPECT_SCHEMA,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_MARKER_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
  HANDSHAKE_MAX_BYTES,
} from "./contracts.ts";
import {
  parseHandshake,
  parseHandshakeText,
  parseHealthDocument,
  parseInspect,
  parseInspectText,
  parseLifecycleIdentity,
  parseMarker,
  readBoundedHandshakeText,
} from "./parse.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";

const EXPECTED = {
  productIdentifier: "ai.casys.digital-thread" as const,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverName: "casys-digital-thread-console" as const,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
};

const HANDSHAKE_EXPECTED = {
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
  launchId: LAUNCH_ID,
  configDigest: DIGEST,
};

function inspect(overrides: Record<string, unknown> = {}) {
  return {
    schema: CONTROL_PLANE_INSPECT_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    expectedConfigDigest: DIGEST,
    configuration: "verified",
    marker: null,
    lock: "free",
    ...overrides,
  };
}

function marker(overrides: Record<string, unknown> = {}) {
  return {
    schema: CONTROL_PLANE_MARKER_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    pid: 4242,
    endpoint: CONTROL_PLANE_MCP_URL,
    configDigest: DIGEST,
    startedAt: "2026-08-22T10:00:00Z",
    ...overrides,
  };
}

function assertFailed(result: { ok: boolean; error?: { code: string } }, code: string) {
  if (result.ok) throw new Error(`expected failure ${code}`);
  assertEquals(result.error?.code, code);
}

Deno.test("parseMarker accepts the exact versioned marker", () => {
  const result = parseMarker(marker());
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.schema, CONTROL_PLANE_MARKER_SCHEMA);
  assertEquals(result.value.endpoint, CONTROL_PLANE_MCP_URL);
  assertEquals(result.value.launchId, LAUNCH_ID);
  assertEquals(Object.isFrozen(result.value), true);
});

Deno.test("parseMarker rejects missing, extra, and corrupt fields", () => {
  assertFailed(parseMarker(null), "marker.schema-invalid");
  assertFailed(parseMarker([]), "marker.schema-invalid");
  const missing = marker();
  delete (missing as { pid?: number }).pid;
  assertFailed(parseMarker(missing), "marker.schema-invalid");
  assertFailed(parseMarker(marker({ extra: true })), "marker.schema-invalid");
  assertFailed(
    parseMarker(marker({ schema: "casys-desktop-control-plane-marker/0.9" })),
    "marker.schema-invalid",
  );
});

Deno.test("parseMarker rejects aliases, non-loopback endpoints, and invalid pid", () => {
  assertFailed(
    parseMarker(marker({ productVersion: "latest" })),
    "marker.version-alias",
  );
  assertFailed(
    parseMarker(marker({ serverVersion: "canary" })),
    "marker.version-alias",
  );
  assertFailed(
    parseMarker(marker({ endpoint: "http://localhost:3020/mcp" })),
    "marker.endpoint-invalid",
  );
  assertFailed(
    parseMarker(marker({ endpoint: "http://127.0.0.1:3021/mcp" })),
    "marker.endpoint-invalid",
  );
  assertFailed(parseMarker(marker({ pid: 0 })), "marker.pid-invalid");
  assertFailed(parseMarker(marker({ pid: -3 })), "marker.pid-invalid");
  assertFailed(parseMarker(marker({ pid: 1.5 })), "marker.pid-invalid");
  assertFailed(parseMarker(marker({ pid: "4242" })), "marker.pid-invalid");
  assertFailed(
    parseMarker(marker({ launchId: "not-a-uuid" })),
    "marker.launch-id-invalid",
  );
  assertFailed(
    parseMarker(marker({ configDigest: "0123" })),
    "marker.digest-invalid",
  );
  assertFailed(
    parseMarker(marker({ startedAt: "2026-08-22 10:00:00" })),
    "marker.started-at-invalid",
  );
});

Deno.test("parseInspect accepts the exact configuration and ownership snapshot", () => {
  const result = parseInspect(inspect());
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.marker, null);
  assertEquals(result.value.lock, "free");
});

Deno.test("parseInspect parses a nested marker strictly and rejects stop-by-pid", () => {
  const result = parseInspect(inspect({
    marker: marker(),
    lock: "held",
  }));
  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.value.marker?.pid, 4242);

  assertFailed(
    parseInspect(inspect({
      marker: null,
      lock: "free",
      stop: { pid: 4242 },
    })),
    "inspect.schema-invalid",
  );
  assertFailed(
    parseInspect(inspect({
      marker: marker({ endpoint: "http://127.0.0.1:80/mcp" }),
      lock: "held",
    })),
    "marker.endpoint-invalid",
  );
  assertFailed(
    parseInspectText("{"),
    "inspect.corrupt",
  );
});

Deno.test("parseHandshake accepts the bounded ready echo and rejects mismatches", () => {
  const body = {
    schema: CONTROL_PLANE_HANDSHAKE_SCHEMA,
    status: "ready",
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
  };
  const result = parseHandshake(body, HANDSHAKE_EXPECTED);
  assertEquals(result.ok, true);

  assertFailed(
    parseHandshake(
      { ...body, launchId: "22222222-2222-4222-8222-222222222222" },
      HANDSHAKE_EXPECTED,
    ),
    "handshake.mismatch",
  );
  assertFailed(
    parseHandshake({ ...body, extra: 1 }, HANDSHAKE_EXPECTED),
    "handshake.schema-invalid",
  );
  assertFailed(
    parseHandshake({ ...body, status: "starting" }, HANDSHAKE_EXPECTED),
    "handshake.status-invalid",
  );
});

Deno.test("parseHandshakeText rejects oversized stdout and trailing garbage", () => {
  const json = JSON.stringify({
    schema: CONTROL_PLANE_HANDSHAKE_SCHEMA,
    status: "ready",
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
  });
  const ok = parseHandshakeText(`${json}\n`, HANDSHAKE_EXPECTED);
  assertEquals(ok.ok, true);

  assertFailed(
    parseHandshakeText(`${json} trailing`, HANDSHAKE_EXPECTED),
    "handshake.corrupt",
  );
  assertFailed(
    parseHandshakeText(
      `${"x".repeat(HANDSHAKE_MAX_BYTES + 1)}`,
      HANDSHAKE_EXPECTED,
    ),
    "handshake.oversized",
  );
});

Deno.test("readBoundedHandshakeText reads one JSON object and fails closed on timeout or overflow", async () => {
  const json = JSON.stringify({
    schema: CONTROL_PLANE_HANDSHAKE_SCHEMA,
    status: "ready",
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
  });
  const streamed = await readBoundedHandshakeText(textStream(`${json}\n`));
  assertEquals(streamed.ok, true);
  if (streamed.ok) assertEquals(JSON.parse(streamed.value).launchId, LAUNCH_ID);

  const overflow = await readBoundedHandshakeText(
    textStream(`{${"0".repeat(HANDSHAKE_MAX_BYTES)}`),
    { maxBytes: 32 },
  );
  assertFailed(overflow, "handshake.oversized");
});

Deno.test("readBoundedHandshakeText returns timeout without throwing", async () => {
  const result = await readBoundedHandshakeText(neverStream(), { timeoutMs: 20 });
  assertFailed(result, "handshake.timeout");
});

Deno.test("parseLifecycleIdentity requires launch id and digest, not name alone", () => {
  const result = parseLifecycleIdentity({
    schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
  });
  assertEquals(result.ok, true);

  assertFailed(
    parseLifecycleIdentity({
      schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
      productVersion: CONTROL_PLANE_PRODUCT_VERSION,
      serverVersion: CONTROL_PLANE_SERVER_VERSION,
      launchId: LAUNCH_ID,
      configDigest: DIGEST,
      pid: 4242,
    }),
    "lifecycle.schema-invalid",
  );
});

Deno.test("parseHealthDocument requires the exact McpApp health triple", () => {
  const result = parseHealthDocument({
    status: "ok",
    server: "casys-digital-thread-console",
    version: CONTROL_PLANE_SERVER_VERSION,
  }, EXPECTED);
  assertEquals(result.ok, true);

  assertFailed(
    parseHealthDocument({
      status: "ok",
      server: "other-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    }, EXPECTED),
    "health.server-invalid",
  );
  assertFailed(
    parseHealthDocument({
      status: "ok",
      server: "casys-digital-thread-console",
      version: "0.1.0",
    }, EXPECTED),
    "health.mismatch",
  );
  assertFailed(
    parseHealthDocument({
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
      pid: 1,
    }, EXPECTED),
    "health.schema-invalid",
  );
});

function textStream(text: string): ReadableStream<Uint8Array> {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

function neverStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start() {
      // Intentionally never enqueues so the timeout path is exercised.
    },
  });
}
