import { assertEquals } from "@std/assert";
import type { ThreadViewerReadResource } from "../presentation/workbench/thread/viewer-sessions.ts";
import { MCP_APP_HOST_MAX_RESOURCE_BYTES } from "../presentation/workbench/thread/viewer-sessions.ts";
import {
  isMcpAppHostResourceReadRequest,
  MCP_APP_HOST_RESOURCE_READ_REQUEST,
  MCP_APP_HOST_RESOURCE_READ_SCHEMA,
  readMcpAppHostResource,
} from "./src/thread/mcp-app-resource-bridge.ts";

const BYTES = new TextEncoder().encode("exact recorded bytes");
const FINGERPRINT = await sha256Fingerprint(BYTES);
const RESOURCE: ThreadViewerReadResource = {
  uri: `/api/thread/viewer-apps/resources/${FINGERPRINT.slice("sha256:".length)}`,
  mimeType: "model/gltf-binary",
  bytes: BYTES.byteLength,
  fingerprint: FINGERPRINT,
};
const REQUEST = {
  schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
  type: MCP_APP_HOST_RESOURCE_READ_REQUEST,
  requestId: "build123d-resource-1",
  fingerprint: FINGERPRINT,
} as const;

Deno.test("MCP App resource bridge admits only the exact fingerprint request", () => {
  assertEquals(isMcpAppHostResourceReadRequest(REQUEST), true);
  for (
    const request of [
      { ...REQUEST, requestId: 1 },
      { ...REQUEST, requestId: "bad/request" },
      { ...REQUEST, fingerprint: FINGERPRINT.toUpperCase() },
      { ...REQUEST, uri: RESOURCE.uri },
      { ...REQUEST, providerEndpoint: "http://provider.internal/mcp" },
      { ...REQUEST, credentials: { token: "secret" } },
      { ...REQUEST, toolName: "render" },
      { ...REQUEST, args: {} },
      { ...REQUEST, maxBytes: RESOURCE.bytes },
    ]
  ) {
    assertEquals(isMcpAppHostResourceReadRequest(request), false);
  }
});

Deno.test("MCP App resource bridge GETs and re-attests one registered resource", async () => {
  let input: RequestInfo | URL | undefined;
  let init: RequestInit | undefined;
  const result = await readMcpAppHostResource(
    [RESOURCE],
    REQUEST,
    (nextInput, nextInit) => {
      input = nextInput;
      init = nextInit;
      return Promise.resolve(
        new Response(BYTES, {
          status: 200,
          headers: {
            "Content-Type": RESOURCE.mimeType,
            "Content-Length": String(RESOURCE.bytes),
          },
        }),
      );
    },
  );

  assertEquals(input, RESOURCE.uri);
  assertEquals(init, {
    method: "GET",
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    headers: { Accept: RESOURCE.mimeType },
  });
  assertEquals(result, {
    schemaVersion: MCP_APP_HOST_RESOURCE_READ_SCHEMA,
    type: "mcp-app-host.resource.read.result",
    requestId: REQUEST.requestId,
    fingerprint: FINGERPRINT,
    status: "available",
    resource: {
      ...RESOURCE,
      encoding: "base64",
      data: btoa("exact recorded bytes"),
    },
  });
});

Deno.test("MCP App resource bridge fails closed on missing or changed bytes", async () => {
  let calls = 0;
  const missing = await readMcpAppHostResource([], REQUEST, () => {
    calls += 1;
    return Promise.resolve(new Response());
  });
  assertEquals(missing.status, "unavailable");
  assertEquals(
    missing.status === "unavailable" && missing.reason,
    "not-registered",
  );
  assertEquals(calls, 0);

  const changed = await readMcpAppHostResource(
    [RESOURCE],
    REQUEST,
    () =>
      Promise.resolve(
        new Response("changed", {
          headers: {
            "Content-Type": RESOURCE.mimeType,
            "Content-Length": String("changed".length),
          },
        }),
      ),
  );
  assertEquals(changed.status, "unavailable");
  assertEquals(
    changed.status === "unavailable" && changed.reason,
    "identity-mismatch",
  );
});

Deno.test("MCP App resource bridge bounds chunked bodies without Content-Length", async () => {
  let cancelled = false;
  const oversizedResource: ThreadViewerReadResource = {
    ...RESOURCE,
    bytes: MCP_APP_HOST_MAX_RESOURCE_BYTES,
  };
  const oversizedRequest = {
    ...REQUEST,
    fingerprint: oversizedResource.fingerprint,
  };
  const chunk = new Uint8Array(MCP_APP_HOST_MAX_RESOURCE_BYTES / 2);
  const result = await readMcpAppHostResource(
    [oversizedResource],
    oversizedRequest,
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.enqueue(new Uint8Array([1]));
            },
            cancel() {
              cancelled = true;
            },
          }),
          {
            headers: { "Content-Type": RESOURCE.mimeType },
          },
        ),
      ),
  );
  assertEquals(result.status, "unavailable");
  assertEquals(
    result.status === "unavailable" && result.reason,
    "too-large",
  );
  assertEquals(cancelled, true);
});

Deno.test("MCP App resource bridge rejects false lengths before reading", async () => {
  for (
    const declaredLength of [
      String(RESOURCE.bytes - 1),
      String(RESOURCE.bytes + 1),
      String(MCP_APP_HOST_MAX_RESOURCE_BYTES + 1),
    ]
  ) {
    let bodyAccessCount = 0;
    const response = {
      ok: true,
      headers: new Headers({
        "Content-Type": RESOURCE.mimeType,
        "Content-Length": declaredLength,
      }),
      get body(): never {
        bodyAccessCount += 1;
        throw new Error("body must not be read");
      },
    } as unknown as Response;
    const result = await readMcpAppHostResource(
      [RESOURCE],
      REQUEST,
      () => Promise.resolve(response),
    );
    assertEquals(result.status, "unavailable");
    assertEquals(
      result.status === "unavailable" && result.reason,
      Number(declaredLength) > MCP_APP_HOST_MAX_RESOURCE_BYTES
        ? "too-large"
        : "identity-mismatch",
    );
    assertEquals(bodyAccessCount, 0);
  }
});

Deno.test("opaque App frame source-locks the bridge without same-origin sandboxing", async () => {
  const frame = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame.tsx", import.meta.url),
  );
  const host = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-read-only-host.ts", import.meta.url),
  );
  assertEquals(
    frame.includes('setAttribute("sandbox", "allow-scripts")'),
    true,
  );
  assertEquals(frame.includes("allow-same-origin"), false);
  assertEquals(host.includes('event.origin !== "null"'), true);
  assertEquals(host.includes("event.source !== options.target"), true);
  assertEquals(host.includes('options.target.postMessage(message, "*")'), true);
  assertEquals(frame.includes("callTool("), false);
  assertEquals(frame.includes("providerEndpoint"), false);
});

async function sha256Fingerprint(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return `sha256:${
    [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
  }`;
}
