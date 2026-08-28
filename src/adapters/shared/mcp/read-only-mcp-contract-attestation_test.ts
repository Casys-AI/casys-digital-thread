import { assertEquals, assertMatch } from "@std/assert";
import {
  attestReadOnlyMcpContract,
  READ_ONLY_MCP_CONTRACT_METHODS,
} from "./read-only-mcp-contract-attestation.ts";

Deno.test("read-only MCP contract attestor records schemas without invoking a tool", async () => {
  const methods: string[] = [];
  const attestation = await attestReadOnlyMcpContract(target(), {
    fetch: fakeFetch(methods),
  });

  assertEquals(attestation.mutatesRuntime, false);
  assertEquals(attestation.evidenceLevel, "contract-attested");
  assertEquals(attestation.health, "healthy");
  assertEquals(attestation.healthMatchesExpected, true);
  assertEquals(attestation.protocolVersion, "2026-07-28");
  assertEquals(attestation.protocolMatchesExpected, true);
  assertEquals(attestation.server, { name: "fake", version: "1.2.3" });
  assertEquals(attestation.serverMatchesExpected, true);
  assertEquals(attestation.tools.map((tool) => tool.name), ["read", "write"]);
  assertEquals(attestation.views, ["ui://fake/view"]);
  assertMatch(attestation.schemaFingerprint?.digest ?? "", /^[a-f0-9]{64}$/);
  assertEquals(attestation.schemaFingerprintStatus, "observed-not-verified");
  assertEquals(methods, ["GET", ...READ_ONLY_MCP_CONTRACT_METHODS]);
});

Deno.test("read-only MCP contract attestor leaves an incomplete surface declared", async () => {
  const attestation = await attestReadOnlyMcpContract({
    ...target(),
    expectedTools: ["read", "missing"],
  }, { fetch: fakeFetch([]) });

  assertEquals(attestation.evidenceLevel, "declared");
  assertEquals(attestation.missingExpectedTools, ["missing"]);
  assertEquals(attestation.schemaFingerprint !== null, true);
  assertEquals(attestation.schemaFingerprintStatus, "observed-not-verified");
});

Deno.test("read-only MCP contract attestor does not attest a healthy lookalike endpoint", async () => {
  const attestation = await attestReadOnlyMcpContract(target(), {
    fetch: fakeFetch([], { name: "lookalike", version: "1.2.3" }),
  });

  assertEquals(attestation.health, "healthy");
  assertEquals(attestation.server, { name: "lookalike", version: "1.2.3" });
  assertEquals(attestation.serverMatchesExpected, false);
  assertEquals(attestation.evidenceLevel, "declared");
});

Deno.test("read-only MCP contract attestor compares the health declaration", async () => {
  const attestation = await attestReadOnlyMcpContract(target(), {
    fetch: fakeFetch([], undefined, "degraded"),
  });

  assertEquals(attestation.health, "unexpected");
  assertEquals(attestation.healthStatus, "degraded");
  assertEquals(attestation.healthMatchesExpected, false);
  assertEquals(attestation.serverMatchesExpected, true);
  assertEquals(attestation.evidenceLevel, "declared");
});

function target() {
  return {
    id: "fake",
    healthUrl: "http://127.0.0.1:3999/health",
    mcpUrl: "http://127.0.0.1:3999/mcp",
    expectedHealthStatus: "ok",
    expectedServer: { name: "fake", version: "1.2.3" },
    expectedTools: ["read", "write"],
    expectedViews: ["ui://fake/view"],
  } as const;
}

function fakeFetch(
  methods: string[],
  serverInfo = { name: "fake", version: "1.2.3" },
  healthStatus = "ok",
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      methods.push("GET");
      return Promise.resolve(Response.json({ status: healthStatus }));
    }
    const body = JSON.parse(String(init?.body)) as { method: string };
    methods.push(body.method);
    if (body.method === "server/discover") {
      return Promise.resolve(rpc({
        supportedVersions: ["2026-07-28"],
        serverInfo,
      }));
    }
    if (body.method === "tools/list") {
      return Promise.resolve(rpc({
        tools: [
          {
            name: "write",
            inputSchema: { type: "object", properties: { a: { type: "string" } } },
            outputSchema: { type: "object" },
          },
          {
            name: "read",
            inputSchema: { type: "object" },
            outputSchema: { type: "array" },
            _meta: { ui: { resourceUri: "ui://fake/view" } },
          },
        ],
      }));
    }
    if (body.method === "resources/list") {
      return Promise.resolve(rpc({ resources: [] }));
    }
    throw new Error(`Unexpected method ${body.method}`);
  }) as typeof fetch;
}

function rpc(result: Record<string, unknown>): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: 1,
    result: { resultType: "complete", ...result },
  });
}
