import { assertEquals, assertMatch } from "@std/assert";
import { attestReadOnlyMcpContract } from "./read-only-mcp-contract-attestation.ts";

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
  assertEquals(attestation.runtimeContractMatchesExpected, null);
  assertEquals(methods, ["GET", "server/discover", "tools/list", "resources/list"]);
});

Deno.test("read-only MCP contract attestor verifies a pinned packaged runtime contract", async () => {
  const methods: string[] = [];
  const attestation = await attestReadOnlyMcpContract({
    ...target(),
    expectedRuntimeContract: {
      resourceUri: "ui://fake/view",
      fingerprints: {
        serverDiscover: fingerprint("1"),
        toolContracts: fingerprint("2"),
        uiResources: fingerprint("3"),
      },
    },
  }, {
    fetch: fakeFetch(methods),
    fingerprint: fakeRuntimeFingerprint,
  });

  assertEquals(attestation.evidenceLevel, "contract-attested");
  assertEquals(attestation.runtimeContractMatchesExpected, true);
  assertEquals(
    attestation.runtimeContractFingerprints,
    {
      serverDiscover: fingerprint("1"),
      toolContracts: fingerprint("2"),
      uiResources: fingerprint("3"),
    },
  );
  assertEquals(methods, [
    "GET",
    "server/discover",
    "tools/list",
    "resources/list",
    "resources/read",
  ]);
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

Deno.test("read-only MCP contract attestor refuses a non-loopback target before fetching", async () => {
  const methods: string[] = [];
  const attestation = await attestReadOnlyMcpContract({
    ...target(),
    healthUrl: "http://example.com/health",
  }, { fetch: fakeFetch(methods) });

  assertEquals(attestation.evidenceLevel, "declared");
  assertEquals(attestation.health, "unavailable");
  assertEquals(methods, []);
  assertMatch(attestation.detail ?? "", /loopback HTTP URL/);
});

Deno.test("read-only MCP contract attestor refuses redirected responses", async () => {
  const response = Response.json({ status: "ok" });
  Object.defineProperty(response, "redirected", { value: true });
  const attestation = await attestReadOnlyMcpContract(target(), {
    fetch: (() => Promise.resolve(response)) as typeof fetch,
  });

  assertEquals(attestation.evidenceLevel, "declared");
  assertEquals(attestation.health, "unavailable");
  assertMatch(attestation.detail ?? "", /redirected/);
});

for (
  const testCase of [
    {
      name: "mismatched response id",
      mutate: (envelope: Record<string, unknown>) => ({ ...envelope, id: 99 }),
      detail: /response identity/,
    },
    {
      name: "missing JSON-RPC version",
      mutate: (envelope: Record<string, unknown>) => {
        const { jsonrpc: _jsonrpc, ...rest } = envelope;
        return rest;
      },
      detail: /response identity/,
    },
    {
      name: "both result and error",
      mutate: (envelope: Record<string, unknown>) => ({
        ...envelope,
        error: { message: "ambiguous" },
      }),
      detail: /exactly one JSON-RPC result or error/,
    },
    {
      name: "neither result nor error",
      mutate: (envelope: Record<string, unknown>) => {
        const { result: _result, ...rest } = envelope;
        return rest;
      },
      detail: /exactly one JSON-RPC result or error/,
    },
  ] as const
) {
  Deno.test(`read-only MCP contract attestor refuses ${testCase.name}`, async () => {
    const attestation = await attestReadOnlyMcpContract(target(), {
      fetch: fakeFetchWithRpcMutation(testCase.mutate),
    });

    assertEquals(attestation.evidenceLevel, "declared");
    assertEquals(attestation.health, "unavailable");
    assertMatch(attestation.detail ?? "", testCase.detail);
  });
}

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
    const body = JSON.parse(String(init?.body)) as { method: string; id: number };
    methods.push(body.method);
    if (body.method === "server/discover") {
      return Promise.resolve(rpc({
        supportedVersions: ["2026-07-28"],
        serverInfo,
      }, body.id));
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
      }, body.id));
    }
    if (body.method === "resources/list") {
      return Promise.resolve(rpc({ resources: [] }, body.id));
    }
    if (body.method === "resources/read") {
      return Promise.resolve(rpc({
        contents: [{ uri: "ui://fake/view", text: "viewer" }],
      }, body.id));
    }
    throw new Error(`Unexpected method ${body.method}`);
  }) as typeof fetch;
}

function fakeFetchWithRpcMutation(
  mutate: (envelope: Record<string, unknown>) => Record<string, unknown>,
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/health")) {
      return Promise.resolve(Response.json({ status: "ok" }));
    }
    const body = JSON.parse(String(init?.body)) as { method: string; id: number };
    let result: Record<string, unknown>;
    if (body.method === "server/discover") {
      result = {
        supportedVersions: ["2026-07-28"],
        serverInfo: { name: "fake", version: "1.2.3" },
      };
    } else if (body.method === "tools/list") {
      result = { tools: [] };
    } else if (body.method === "resources/list") {
      result = { resources: [] };
    } else {
      throw new Error(`Unexpected method ${body.method}`);
    }
    const envelope = {
      jsonrpc: "2.0",
      id: body.id,
      result: { resultType: "complete", ...result },
    };
    return Promise.resolve(Response.json(mutate(envelope)));
  }) as typeof fetch;
}

function rpc(result: Record<string, unknown>, id: number): Response {
  return Response.json({
    jsonrpc: "2.0",
    id,
    result: { resultType: "complete", ...result },
  });
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}

function fakeRuntimeFingerprint(value: unknown) {
  if (Array.isArray(value)) return Promise.resolve(fingerprint("2"));
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.contents)) return Promise.resolve(fingerprint("3"));
  }
  return Promise.resolve(fingerprint("1"));
}
