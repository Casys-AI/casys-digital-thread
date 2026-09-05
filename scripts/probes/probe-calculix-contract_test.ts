import { assertEquals } from "@std/assert";
import {
  CALCULIX_ENDPOINT,
  CALCULIX_EXPECTED_TOOLS,
  calculixContractFingerprint,
  MAX_ORDINARY_SOLVE_TIMEOUT_MS,
  probeCalculixContract,
} from "./probe-calculix-contract.ts";

const IMAGE_DIGEST = "ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8";
const REVISION = "6fb30a75c4876ad469cc472ffa8ca691e0a6b58b";
const VIEWER = "ui://mcp-calculix/results-viewer";
const MANIFEST = JSON.stringify({
  servers: [{
    id: "calculix",
    serviceName: "mcp-calculix",
    mcpUrl: CALCULIX_ENDPOINT.mcpUrl,
    image: `ghcr.io/casys-ai/mcp-calculix@sha256:${IMAGE_DIGEST}`,
    providerIdentity: {
      version: "0.8.2",
      revision: REVISION,
      imageIndexDigest: IMAGE_DIGEST,
      ociLabels: {
        "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-calculix",
        "org.opencontainers.image.title": "mcp-calculix",
        "org.opencontainers.image.version": "0.8.2",
        "org.opencontainers.image.revision": REVISION,
      },
      contractFingerprint:
        "8e8b5c007299818908d424413483addf7fdde5928175c80d2817232b85839ed4",
      ordinarySolveTimeoutMaxMs: MAX_ORDINARY_SOLVE_TIMEOUT_MS,
    },
    expectedTools: CALCULIX_EXPECTED_TOOLS,
    expectedViews: [VIEWER],
  }],
});

const DISCOVERY = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "mcp-calculix", version: "0.8.2" },
  resultType: "complete",
};
const TOOLS = CALCULIX_EXPECTED_TOOLS.map((name) => tool(name));

Deno.test("CalculiX preflight uses MCP discovery without inventing a health route", async () => {
  const fake = new FakeCalculixFetch();
  const expected = await fixtureFingerprint(TOOLS);
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    now: () => new Date("2026-08-28T15:04:00.000Z"),
    expectedContractSha256: expected,
  });

  assertEquals(fake.requests, [
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
    manifestText: MANIFEST.replace("0.8.2", "0.8.3"),
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

Deno.test("ordinary solves require the reviewed 120000 ms timeout maximum", async () => {
  const changed = structuredClone(TOOLS);
  const schema = changed.find((tool) => tool.name === "calculix_solve_buckling")!
    .inputSchema as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  (properties.timeout_ms as Record<string, unknown>).maximum =
    MAX_ORDINARY_SOLVE_TIMEOUT_MS + 1;
  const result = await probeCalculixContract({
    manifestText: MANIFEST,
    fetch: new FakeCalculixFetch({ tools: changed }).fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });

  assertEquals(result.contract, "contract-divergent");
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

Deno.test("CalculiX MCP discovery transport failure remains unavailable", async () => {
  const fake = new FakeCalculixFetch({ failDiscovery: true });
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
  readonly #failDiscovery: boolean;

  constructor(options: {
    tools?: Record<string, unknown>[];
    failDiscovery?: boolean;
  } = {}) {
    this.#tools = options.tools ?? structuredClone(TOOLS);
    this.#failDiscovery = options.failDiscovery ?? false;
  }

  readonly fetch: typeof fetch = (input, init) => {
    const url = String(input);
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
    if (this.#failDiscovery && body.method === "server/discover") {
      return Promise.reject(new TypeError("connection refused"));
    }
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
  const inputSchema = objectSchema(["step_path"]);
  if (ordinarySolveNames().includes(name)) {
    const properties = inputSchema.properties as Record<string, unknown>;
    properties.timeout_ms = {
      type: "integer",
      minimum: 1,
      maximum: MAX_ORDINARY_SOLVE_TIMEOUT_MS,
    };
  }
  return {
    name,
    inputSchema,
    outputSchema: objectSchema(["schemaVersion"]),
    ...(hasViewer ? { _meta: { ui: { resourceUri: VIEWER } } } : {}),
  };
}

function ordinarySolveNames(): readonly string[] {
  return [
    "calculix_solve_static",
    "calculix_solve_modal",
    "calculix_solve_buckling",
    "calculix_solve_creep",
    "calculix_solve_coupled_thermal",
  ];
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
  return (await calculixContractFingerprint(DISCOVERY, tools)).digest;
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
