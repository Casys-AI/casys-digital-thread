import { assertEquals } from "@std/assert";
import {
  CALCULIX_ENDPOINT,
  CALCULIX_EXPECTED_TOOLS,
  calculixContractFingerprint,
  probeCalculixContract,
} from "./probe-calculix-contract.ts";

const IMAGE_DIGEST = "c38fe50eadcca77180c2bc060c073035af62924fa2b927d3f8005b6060be76d4";
const REVISION = "e4c3b8284c3ac17c71bfd1b53dfdcb0f2f4262da";
const VIEWER = "ui://mcp-calculix/results-viewer";
const MANIFEST = JSON.stringify({
  servers: [{
    id: "calculix",
    serviceName: "mcp-calculix",
    mcpUrl: CALCULIX_ENDPOINT.mcpUrl,
    healthUrl: CALCULIX_ENDPOINT.healthUrl,
    image: `ghcr.io/casys-ai/mcp-calculix@sha256:${IMAGE_DIGEST}`,
    providerIdentity: {
      version: "0.8.1",
      revision: REVISION,
      imageIndexDigest: IMAGE_DIGEST,
      ociLabels: {
        "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-calculix",
        "org.opencontainers.image.title": "mcp-calculix",
        "org.opencontainers.image.version": "0.8.1",
        "org.opencontainers.image.revision": REVISION,
      },
      contractFingerprint:
        "b4e02d82f30aa1275c29716d4e8e1bd680bf1959485cb4eb388bfa8e937c79d4",
    },
    expectedTools: CALCULIX_EXPECTED_TOOLS,
    expectedViews: [VIEWER],
  }],
});

const HEALTH = { status: "ok", server: "mcp-calculix", version: "0.8.1" };
const DISCOVERY = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "mcp-calculix", version: "0.8.1" },
  resultType: "complete",
};
const TOOLS = CALCULIX_EXPECTED_TOOLS.map((name) => tool(name));

Deno.test("CalculiX preflight uses only discovery and accepts the reviewed fingerprint", async () => {
  const fake = new FakeCalculixFetch();
  const expected = await fixtureFingerprint(TOOLS);
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    now: () => new Date("2026-08-28T15:04:00.000Z"),
    expectedContractSha256: expected,
  });

  assertEquals(fake.requests, [
    { method: "GET", url: CALCULIX_ENDPOINT.healthUrl },
    { method: "server/discover", url: CALCULIX_ENDPOINT.mcpUrl },
    { method: "tools/list", url: CALCULIX_ENDPOINT.mcpUrl },
  ]);
  assertEquals(result.observedAt, "2026-08-28T15:04:00.000Z");
  assertEquals(result.contract, "current-surface");
  assertEquals(result.observed.contractFingerprint?.digest, expected);
  assertEquals(result.desired.imageDigestVerified, false);
  assertEquals(result.surface.meshPreflight, "declared");
  assertEquals(result.surface.recordedStaticRecovery, "declared");
  assertEquals(result.conclusion.integration, "unresolved");
});

Deno.test("CalculiX preflight rejects desired release drift before network", async () => {
  const fake = new FakeCalculixFetch();
  const result = await probeCalculixContract({
    manifestText: MANIFEST.replace("0.8.1", "0.8.2"),
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(fake.requests, []);
  assertEquals(result.surface, unresolvedSurface());
});

Deno.test("a nested CalculiX schema change invalidates the canonical contract", async () => {
  const changed = structuredClone(TOOLS);
  const schema = changed[0].inputSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  properties.step_path = { type: "number" };
  const fake = new FakeCalculixFetch({ tools: changed });
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(result.surface, unresolvedSurface());
});

Deno.test("a missing static viewer attachment is contract-divergent", async () => {
  const changed = structuredClone(TOOLS);
  delete changed.find((tool) => tool.name === "calculix_solve_static")!._meta;
  const fake = new FakeCalculixFetch({ tools: changed });
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "contract-divergent");
});

Deno.test("CalculiX transport failure remains unavailable", async () => {
  const fake = new FakeCalculixFetch({ failHealth: true });
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "unavailable");
  assertEquals(result.conclusion.status, "unavailable");
});

class FakeCalculixFetch {
  readonly requests: { method: string; url: string }[] = [];
  readonly #tools: Record<string, unknown>[];
  readonly #failHealth: boolean;

  constructor(options: {
    tools?: Record<string, unknown>[];
    failHealth?: boolean;
  } = {}) {
    this.#tools = options.tools ?? structuredClone(TOOLS);
    this.#failHealth = options.failHealth ?? false;
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = String(input);
    if ((init?.method ?? "GET") === "GET") {
      this.requests.push({ method: "GET", url });
      if (this.#failHealth) return Promise.reject(new TypeError("connection refused"));
      return Promise.resolve(jsonResponse(HEALTH));
    }

    const body = JSON.parse(String(init?.body)) as { method?: string };
    if (
      init?.method !== "POST" || url !== CALCULIX_ENDPOINT.mcpUrl ||
      (body.method !== "server/discover" && body.method !== "tools/list")
    ) {
      return Promise.reject(
        new Error(`unexpected request ${init?.method} ${url} ${body.method}`),
      );
    }
    this.requests.push({ method: body.method, url });
    return Promise.resolve(
      body.method === "server/discover"
        ? jsonResponse({ jsonrpc: "2.0", id: 1, result: DISCOVERY })
        : jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: { resultType: "complete", tools: this.#tools },
        }),
    );
  };
}

function tool(name: string): Record<string, unknown> {
  const hasViewer = name === "calculix_solve_static" ||
    name === "calculix_solve_static_recorded";
  return {
    name,
    inputSchema: objectSchema(["step_path"]),
    outputSchema: objectSchema(["schemaVersion"]),
    ...(hasViewer ? { _meta: { ui: { resourceUri: VIEWER } } } : {}),
  };
}

function objectSchema(names: string[]): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: names,
    properties: Object.fromEntries(names.map((name) => [name, { type: "string" }])),
  };
}

async function fixtureFingerprint(
  tools: Record<string, unknown>[],
): Promise<string> {
  return (await calculixContractFingerprint(HEALTH, DISCOVERY, tools)).digest;
}

function unresolvedSurface() {
  return {
    meshPreflight: "unresolved" as const,
    ordinarySolves: [],
    recordedStaticRecovery: "unresolved" as const,
    viewerUris: [],
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
