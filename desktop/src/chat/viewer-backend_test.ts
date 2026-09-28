import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1.0.14";
import type { ChatMcpServerConfig } from "./runtime-port.ts";
import {
  createRefusingViewerBackend,
  createRegistryViewerBackend,
  viewerResourceScope,
} from "./viewer-backend.ts";

const APP_URI = "ui://mcp-build123d/results-viewer";
const APP_HTML = "<!doctype html><html><head></head><body>viewer</body></html>";

function server(overrides: Partial<ChatMcpServerConfig> = {}): ChatMcpServerConfig {
  return {
    id: "build123d",
    displayName: "Build123d",
    description: "Parametric CAD execution",
    transport: "streamable-http",
    mcpUrl: "http://127.0.0.1:3014/mcp",
    healthUrl: "http://127.0.0.1:3014/health",
    expectedTools: ["build123d_execute"],
    expectedViews: [
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-build123d/assembly-viewer",
    ],
    ...overrides,
  };
}

interface RpcCall {
  readonly url: string;
  readonly method: string;
  readonly nameHeader: string | null;
  readonly params: Record<string, unknown>;
}

function rpcFetch(
  result: unknown,
  calls: RpcCall[] = [],
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      method: string;
      params: Record<string, unknown>;
    };
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      method: body.method,
      nameHeader: headers.get("Mcp-Name"),
      params: body.params,
    });
    return Promise.resolve(
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as typeof fetch;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.test("viewerResourceScope admits the head shared by every view", () => {
  assertEquals(
    viewerResourceScope([
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-build123d/assembly-viewer",
    ]),
    "ui://mcp-build123d/",
  );
});

Deno.test("viewerResourceScope refuses empty and split authorities", () => {
  assertEquals(viewerResourceScope([]), undefined);
  assertEquals(
    viewerResourceScope([
      "ui://mcp-build123d/results-viewer",
      "ui://mcp-other/results-viewer",
    ]),
    undefined,
  );
});

Deno.test("resolveApp fetches the exact view and pins its fingerprint", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({
      contents: [{
        uri: APP_URI,
        mimeType: "text/html;profile=mcp-app",
        text: APP_HTML,
      }],
    }, calls),
  });
  const app = await backend.resolveApp("build123d", APP_URI);
  const bytes = new TextEncoder().encode(APP_HTML);
  assertEquals(app.uri, APP_URI);
  assertEquals(app.mimeType, "text/html;profile=mcp-app");
  assertEquals(app.bytes, bytes);
  assertEquals(app.fingerprint, `sha256:${await sha256Hex(bytes)}`);
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.method, "resources/read");
  assertEquals(calls[0]?.nameHeader, APP_URI);
  assertEquals(calls[0]?.params.uri, APP_URI);
});

Deno.test("resolveApp refuses URIs outside the expected views without fetching", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({}, calls),
  });
  await assertRejects(
    () => backend.resolveApp("build123d", "ui://mcp-build123d/other-viewer"),
    Error,
    "App URI is not an expected view of the owning MCP server.",
  );
  await assertRejects(
    () => backend.resolveApp("build123d", "ui://mcp-other/results-viewer"),
    Error,
    "App URI is not an expected view of the owning MCP server.",
  );
  assertEquals(calls.length, 0);
});

Deno.test("resolveApp refuses unknown servers and non-loopback upstreams", async () => {
  const backend = createRegistryViewerBackend({ servers: [server()] });
  await assertRejects(
    () => backend.resolveApp("unknown", APP_URI),
    Error,
    'Unknown MCP server "unknown".',
  );
  const remote = createRegistryViewerBackend({
    servers: [server({ mcpUrl: "http://192.0.2.1:3014/mcp" })],
  });
  await assertRejects(
    () => remote.resolveApp("build123d", APP_URI),
    Error,
    "MCP upstream must be loopback HTTP(S).",
  );
});

Deno.test("resolveApp refuses non-App payloads", async () => {
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({
      contents: [{ uri: APP_URI, mimeType: "text/plain", text: "not an app" }],
    }),
  });
  await assertRejects(
    () => backend.resolveApp("build123d", APP_URI),
    Error,
    "App resource is not a whole MCP App document.",
  );
});

Deno.test("readResource admits in-scope URIs beyond the exact views", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({
      contents: [{
        uri: "ui://mcp-build123d/exports/box.step",
        mimeType: "model/step",
        blob: "c3RlcA==",
      }],
    }, calls),
  });
  const result = await backend.readResource(
    "build123d",
    "ui://mcp-build123d/exports/box.step",
  ) as { contents: Array<{ blob: string }> };
  assertEquals(result.contents[0]?.blob, "c3RlcA==");
  assertEquals(calls.length, 1);
});

Deno.test("readResource admits digest-bound artifacts of the owning server", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({
      contents: [{
        uri: "casys://build123d/artifacts/abc.glb",
        mimeType: "model/gltf-binary",
        blob: "Z2xi",
      }],
    }, calls),
  });
  await backend.readResource("build123d", "casys://build123d/artifacts/abc.glb");
  assertEquals(calls.length, 1);
  await assertRejects(
    () => backend.readResource("build123d", "casys://other/artifacts/abc.glb"),
    Error,
    "Resource URI is outside the owning MCP server.",
  );
});

Deno.test("readResource refuses out-of-scope URIs without fetching", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({}, calls),
  });
  await assertRejects(
    () => backend.readResource("build123d", "ui://mcp-other/exports/box.step"),
    Error,
    "Resource URI is outside the owning MCP server.",
  );
  assertEquals(calls.length, 0);
  const viewless = createRegistryViewerBackend({
    servers: [server({ expectedViews: [] })],
  });
  await assertRejects(
    () => viewless.readResource("build123d", "ui://mcp-build123d/exports/box.step"),
    Error,
    "Resource URI is outside the owning MCP server.",
  );
});

Deno.test("callTool posts the exact name and arguments to the owning upstream", async () => {
  const calls: RpcCall[] = [];
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({ content: [{ type: "text", text: "ok" }] }, calls),
  });
  const result = await backend.callTool("build123d", "build123d_execute", {
    script: "result = 1",
  });
  assertEquals(result, { content: [{ type: "text", text: "ok" }] });
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.method, "tools/call");
  assertEquals(calls[0]?.nameHeader, "build123d_execute");
  assertEquals(calls[0]?.params.name, "build123d_execute");
  assertEquals(
    (calls[0]?.params.arguments as Record<string, unknown>).script,
    "result = 1",
  );
});

Deno.test("viewer reads follow the assigned runtime endpoint", async () => {
  const calls: RpcCall[] = [];
  let endpoint: { readonly mcpUrl: string } | undefined = {
    mcpUrl: "http://127.0.0.1:45678/mcp",
  };
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: rpcFetch({ content: [{ type: "text", text: "ok" }] }, calls),
    resolveEndpoint: () => endpoint,
  });
  await backend.callTool("build123d", "build123d_execute", {});
  assertEquals(calls[0]?.url, "http://127.0.0.1:45678/mcp");
  endpoint = { mcpUrl: "http://127.0.0.1:49999/mcp" };
  await backend.callTool("build123d", "build123d_execute", {});
  assertEquals(calls[1]?.url, "http://127.0.0.1:49999/mcp");
  endpoint = undefined;
  await assertRejects(
    () => backend.callTool("build123d", "build123d_execute", {}),
    Error,
    "no assigned endpoint",
  );
  assertEquals(calls.length, 2);
});

Deno.test("viewer fetch failures surface scrubbed of runtime identity", async () => {
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: () =>
      Promise.reject(
        new Error(
          "fetch failed for http://127.0.0.1:45678/mcp (container 0272a50fad75)",
        ),
      ),
  });
  const error = await backend.callTool("build123d", "build123d_execute", {}).catch((
    e: Error,
  ) => e);
  assert(error instanceof Error);
  assert(!error.message.includes("45678"), `port leaked: ${error.message}`);
  assert(!error.message.includes("0272a50fad75"), `id leaked: ${error.message}`);
  assert(error.message.includes("127.0.0.1:<port>"), error.message);
});

Deno.test("oversize provider responses are refused", async () => {
  const backend = createRegistryViewerBackend({
    servers: [server()],
    fetch: (() =>
      Promise.resolve(
        new Response("x".repeat(2_000_000), { status: 200 }),
      )) as typeof fetch,
  });
  await assertRejects(
    () => backend.callTool("build123d", "build123d_execute", {}),
    Error,
    "MCP tools/call response is too large.",
  );
});

Deno.test("refusing backend rejects every viewer interaction", async () => {
  const backend = createRefusingViewerBackend("Live viewer Apps are unavailable.");
  await assertRejects(
    () => backend.resolveApp("build123d", APP_URI),
    Error,
    "Live viewer Apps are unavailable.",
  );
  await assertRejects(
    () => backend.callTool("build123d", "build123d_execute", {}),
    Error,
    "Live viewer Apps are unavailable.",
  );
  await assertRejects(
    () => backend.readResource("build123d", APP_URI),
    Error,
    "Live viewer Apps are unavailable.",
  );
  assertEquals(
    viewerResourceScope(["ui://mcp-build123d/results-viewer"]),
    "ui://mcp-build123d/",
  );
});
