import { assertEquals } from "@std/assert";
import {
  probeSpiceContract,
  SPICE_ENDPOINT,
  spiceContractFingerprint,
} from "./probe-spice-contract.ts";

const MANIFEST = JSON.stringify({
  servers: [{
    id: "spice",
    serviceName: "mcp-spice",
    mcpUrl: SPICE_ENDPOINT.mcpUrl,
    healthUrl: SPICE_ENDPOINT.healthUrl,
    image:
      "ghcr.io/casys-ai/mcp-spice@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    expectedTools: ["spice_simulate_op", "spice_simulate_tran"],
  }],
});

const HEALTH = { status: "ok", server: "mcp-spice", version: "0.1.0" };
const DISCOVERY = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "mcp-spice", version: "0.1.0" },
  resultType: "complete",
};
const TOOLS = [
  tool("spice_simulate_op", ["netlist_path", "nodes"], ["node_voltages"]),
  tool(
    "spice_simulate_tran",
    ["netlist_path", "tstep_s", "tstop_s", "nodes"],
    ["node_stats", "simulation"],
  ),
];

Deno.test("spice preflight uses discovery only and accepts the reviewed fingerprint", async () => {
  const fake = new FakeSpiceFetch();
  const expected = await fixtureFingerprint(TOOLS);
  const result = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    now: () => new Date("2026-08-22T00:00:00.000Z"),
    expectedContractSha256: expected,
  });

  assertEquals(fake.requests, [
    { method: "GET", url: SPICE_ENDPOINT.healthUrl },
    { method: "server/discover", url: SPICE_ENDPOINT.mcpUrl },
    { method: "tools/list", url: SPICE_ENDPOINT.mcpUrl },
  ]);
  assertEquals(result.observedAt, "2026-08-22T00:00:00.000Z");
  assertEquals(result.contract, "current-surface");
  assertEquals(result.observed.contractFingerprint?.digest, expected);
  assertEquals(result.desired.imageDigestVerified, false);
  assertEquals(result.supportedResultFamilies.units.voltage, "supported");
  assertEquals(result.conclusion.integration, "unresolved");
});

Deno.test("spice preflight rejects manifest drift before network", async () => {
  const fake = new FakeSpiceFetch();
  const result = await probeSpiceContract({
    manifestText: MANIFEST.replace("@sha256:", ":latest#"),
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(fake.requests, []);
  assertEquals(result.supportedResultFamilies, unresolvedFamilies());
});

Deno.test("one nested schema change invalidates the canonical contract", async () => {
  const changed = structuredClone(TOOLS);
  const opOutput = changed[0].outputSchema as Record<string, unknown>;
  const properties = opOutput.properties as Record<string, unknown>;
  properties.node_voltages = { type: "array" };
  const fake = new FakeSpiceFetch({ tools: changed });
  const result = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(result.supportedResultFamilies, unresolvedFamilies());
});

Deno.test("non-complete discovery remains contract-divergent", async () => {
  const fake = new FakeSpiceFetch({ toolsResultType: "partial" });
  const result = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });

  assertEquals(result.contract, "contract-divergent");
  assertEquals(result.supportedResultFamilies, unresolvedFamilies());
});

Deno.test("transport failure remains unavailable", async () => {
  const fake = new FakeSpiceFetch({ failHealth: true });
  const result = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
  });

  assertEquals(result.contract, "unavailable");
  assertEquals(result.conclusion.status, "unavailable");
});

class FakeSpiceFetch {
  readonly requests: { method: string; url: string }[] = [];
  readonly #tools: Record<string, unknown>[];
  readonly #toolsResultType: string;
  readonly #failHealth: boolean;

  constructor(options: {
    tools?: Record<string, unknown>[];
    toolsResultType?: string;
    failHealth?: boolean;
  } = {}) {
    this.#tools = options.tools ?? structuredClone(TOOLS);
    this.#toolsResultType = options.toolsResultType ?? "complete";
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
      init?.method !== "POST" || url !== SPICE_ENDPOINT.mcpUrl ||
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
          result: {
            resultType: this.#toolsResultType,
            tools: this.#tools,
          },
        }),
    );
  };
}

function tool(
  name: string,
  inputNames: string[],
  outputNames: string[],
): Record<string, unknown> {
  return {
    name,
    inputSchema: objectSchema(inputNames),
    outputSchema: objectSchema(outputNames),
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
  return (await spiceContractFingerprint(HEALTH, DISCOVERY, tools)).digest;
}

function unresolvedFamilies() {
  return {
    operatingPoint: [],
    reducedTransient: [],
    units: {
      voltage: "unresolved" as const,
      ampere: "unresolved" as const,
      watt: "unresolved" as const,
      eventTimeSeconds: "unresolved" as const,
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
