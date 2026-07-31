import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DesiredServer } from "../domain/types.ts";
import { HttpMcpProbe } from "./http-mcp-probe.ts";

Deno.test("HttpMcpProbe discovers a stateless server, tools, and resources", async () => {
  const calls: Array<
    { url: string; method: string; headers: Headers; body?: Record<string, unknown> }
  > = [];
  const fakeFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = method === "POST"
      ? JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      : undefined;
    calls.push({ url, method, headers, body });
    if (url.endsWith("/health")) {
      return Response.json({ status: "ok" });
    }
    assertEquals(headers.get("mcp-protocol-version"), "2026-07-28");
    assertEquals(headers.get("mcp-method"), body?.method);
    assertEquals(headers.get("mcp-session-id"), null);
    const meta = (body?.params as Record<string, unknown>)._meta as Record<
      string,
      unknown
    >;
    assertEquals(meta["io.modelcontextprotocol/protocolVersion"], "2026-07-28");
    assertEquals(meta["io.modelcontextprotocol/clientCapabilities"], {});
    if (body?.method === "server/discover") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          supportedVersions: ["2026-07-28"],
          serverInfo: { name: "fake-mcp", version: "1.2.3" },
          capabilities: { tools: {}, resources: {} },
        },
      });
    }
    if (body?.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: {
          resultType: "complete",
          tools: [{
            name: "test_read",
            description: "Read",
            _meta: { ui: { resourceUri: "ui://test/view" } },
          }],
        },
      });
    }
    if (body?.method === "resources/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: 3,
        result: {
          resultType: "complete",
          resources: [{ uri: "ui://test/view" }, { uri: "data://test" }],
        },
      });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  }) as typeof fetch;

  const probe = new HttpMcpProbe({
    fetch: fakeFetch,
    now: () => new Date("2026-07-30T10:00:00.000Z"),
    monotonicNow: increasingClock(),
  });
  const result = await probe.probe(serverFixture());

  assertEquals(result.status, "healthy");
  assertEquals(result.checkedAt, "2026-07-30T10:00:00.000Z");
  assertEquals(result.mcp.serverName, "fake-mcp");
  assertEquals(result.mcp.tools, [{
    name: "test_read",
    description: "Read",
    resourceUri: "ui://test/view",
  }]);
  assertEquals(result.mcp.resourceUris, ["data://test", "ui://test/view"]);
  assertEquals(result.mcp.viewerUris, ["ui://test/view"]);
  assertEquals(calls.map((call) => call.body?.method), [
    undefined,
    "server/discover",
    "tools/list",
    "resources/list",
  ]);
});

Deno.test("HttpMcpProbe keeps an honest unavailable observation", async () => {
  const probe = new HttpMcpProbe({
    fetch: (() => Promise.resolve(new Response("no", { status: 503 }))) as typeof fetch,
    monotonicNow: increasingClock(),
  });
  const result = await probe.probe(serverFixture());
  assertEquals(result.status, "unavailable");
  assertEquals(result.httpStatus, 503);
  assertEquals(result.mcp.reachable, false);
  assertStringIncludes(result.error ?? "", "HTTP 503");
});

Deno.test("HttpMcpProbe labels MCP discovery failure as degraded", async () => {
  const fakeFetch = (async (input: string | URL | Request) => {
    await Promise.resolve();
    if (String(input).endsWith("/health")) return Response.json({ status: "ok" });
    return new Response("broken", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const result = await new HttpMcpProbe({
    fetch: fakeFetch,
    monotonicNow: increasingClock(),
  }).probe(serverFixture());
  assertEquals(result.status, "degraded");
  assertEquals(result.mcp.reachable, false);
  assertStringIncludes(result.error ?? "", "invalid JSON");
});

function serverFixture(): DesiredServer {
  return {
    id: "test",
    displayName: "Test",
    role: "test",
    serviceName: "mcp-test",
    transport: "streamable-http",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    healthUrl: "http://127.0.0.1:3999/health",
    image: "example.test/toolchain:1",
    required: true,
    expectedTools: ["test_read"],
  };
}

function increasingClock(): () => number {
  let value = 0;
  return () => value++;
}
