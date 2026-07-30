import { assertEquals, assertStringIncludes } from "@std/assert";
import type { DesiredServer } from "../domain/types.ts";
import { HttpMcpProbe } from "./http-mcp-probe.ts";

Deno.test("HttpMcpProbe discovers tools, resources, and closes its session", async () => {
  const calls: Array<{ url: string; method: string; session?: string }> = [];
  const fakeFetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({
      url,
      method,
      session: headers.get("mcp-session-id") ?? undefined,
    });
    if (url.endsWith("/health")) {
      return Response.json({ status: "ok" });
    }
    if (method === "DELETE") return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "fake-mcp", version: "1.2.3" },
          capabilities: { tools: {}, resources: {} },
        },
      }, { headers: { "mcp-session-id": "probe-session" } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: {
          tools: [{
            name: "test_read",
            description: "Read",
            _meta: { ui: { resourceUri: "ui://test/view" } },
          }],
        },
      });
    }
    if (body.method === "resources/list") {
      return Response.json({
        jsonrpc: "2.0",
        id: 3,
        result: {
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
  assertEquals(calls.at(-1), {
    url: "http://127.0.0.1:3999/mcp",
    method: "DELETE",
    session: "probe-session",
  });
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
