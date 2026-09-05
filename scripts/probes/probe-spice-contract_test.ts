import { assertEquals } from "@std/assert";
import {
  probeSpiceContract,
  SPICE_ENDPOINT,
  SPICE_EXECUTION_BUDGETS,
  SPICE_EXPECTED_TOOLS,
  SPICE_RELEASE,
  spiceContractFingerprint,
} from "./probe-spice-contract.ts";

const MANIFEST = JSON.stringify({
  servers: [{
    id: "spice",
    serviceName: "mcp-spice",
    mcpUrl: SPICE_ENDPOINT.mcpUrl,
    healthUrl: SPICE_ENDPOINT.healthUrl,
    image: SPICE_RELEASE.image,
    release: {
      version: SPICE_RELEASE.version,
      revision: SPICE_RELEASE.revision,
      ociLabels: SPICE_RELEASE.ociLabels,
    },
    expectedTools: SPICE_EXPECTED_TOOLS,
  }],
});

const HEALTH = { status: "ok", server: "mcp-spice", version: "0.5.2" };
const DISCOVERY = {
  supportedVersions: ["2026-07-28"],
  serverInfo: { name: "mcp-spice", version: "0.5.2" },
  instructions:
    "Both submitted and legacy-path netlists are limited to 1 MiB; each observable kind is limited to 32 names. Transient wrdata is bounded to 8 MiB and 50,000 samples before reduction.",
  resultType: "complete",
};
const TOOLS = [
  tool("ngspice_netlist_submit", ["netlist"], ["sha256", "bytes", "uri"]),
  simulationTool("spice_simulate_op", ["netlist_sha256"], ["node_voltages"]),
  simulationTool(
    "spice_simulate_tran",
    ["netlist_sha256", "tstep_s", "tstop_s"],
    ["node_stats", "simulation"],
  ),
  simulationTool(
    "spice_simulate_dc",
    ["netlist_sha256", "sweep_source", "start_v", "stop_v", "step_v"],
    ["node_stats", "sweep"],
    true,
  ),
];

Deno.test("spice preflight uses discovery only and accepts the reviewed fingerprint", async () => {
  const fake = new FakeSpiceFetch();
  const expected = await fixtureFingerprint(TOOLS);
  const result = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: fake.fetch,
    now: () => new Date("2026-08-28T00:00:00.000Z"),
    expectedContractSha256: expected,
  });

  assertEquals(fake.requests, [
    { method: "GET", url: SPICE_ENDPOINT.healthUrl },
    { method: "server/discover", url: SPICE_ENDPOINT.mcpUrl },
    { method: "tools/list", url: SPICE_ENDPOINT.mcpUrl },
  ]);
  assertEquals(result.observedAt, "2026-08-28T00:00:00.000Z");
  assertEquals(result.contract, "current-surface");
  assertEquals(result.observed.contractFingerprint?.digest, expected);
  assertEquals(result.desired.imageDigestVerified, false);
  assertEquals(result.desired.release, {
    version: SPICE_RELEASE.version,
    revision: SPICE_RELEASE.revision,
    ociLabels: SPICE_RELEASE.ociLabels,
  });
  assertEquals(result.desired.expectedTools, SPICE_EXPECTED_TOOLS);
  assertEquals(result.supportedResultFamilies.units.voltage, "supported");
  assertEquals(result.supportedResultFamilies.units.ampere, "supported");
  assertEquals(result.supportedResultFamilies.units.eventTimeSeconds, "supported");
  assertEquals(result.executionBudgets, {
    status: "reviewed-contract",
    ...SPICE_EXECUTION_BUDGETS,
  });
  if (result.executionBudgets.status !== "reviewed-contract") {
    throw new Error("expected reviewed execution budgets");
  }
  assertEquals(result.executionBudgets.dcWrdataPreReadBytes, 8_388_608);
  assertEquals(result.executionBudgets.dcRequestPoints, 512);
  assertEquals(result.executionBudgets.dcParsePoints, 512);
  assertEquals(result.executionBudgets.ngspiceLogBytesPerStream, 1_048_576);
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

Deno.test("workspace fleet pin carries the qualified image identity and labels", async () => {
  const manifest = JSON.parse(
    await Deno.readTextFile(
      new URL("../../config/mcp-fleet.json", import.meta.url),
    ),
  ) as { servers: Record<string, unknown>[] };
  const matches = manifest.servers.filter((server) => server.id === "spice");
  assertEquals(matches.length, 1);
  const spice = matches[0]!;
  assertEquals(spice.image, SPICE_RELEASE.image);
  assertEquals(spice.expectedTools, SPICE_EXPECTED_TOOLS);
  assertEquals(spice.release, {
    version: SPICE_RELEASE.version,
    revision: SPICE_RELEASE.revision,
    ociLabels: SPICE_RELEASE.ociLabels,
  });
});

Deno.test("one nested schema change invalidates the canonical contract", async () => {
  const changed = structuredClone(TOOLS);
  const opOutput = changed[1].outputSchema as Record<string, unknown>;
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

Deno.test("spice preflight rejects a missing DC tool or changed declared budget", async () => {
  const withoutDc = TOOLS.slice(0, -1);
  const missingDc = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: new FakeSpiceFetch({ tools: withoutDc }).fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });
  assertEquals(missingDc.contract, "contract-divergent");

  const changedBudget = structuredClone(TOOLS);
  const dcInput = changedBudget[3].inputSchema as Record<string, unknown>;
  const properties = dcInput.properties as Record<string, unknown>;
  const step = properties.step_v as Record<string, unknown>;
  step.description = "The resulting sweep is capped at 513 internal points.";
  const divergentBudget = await probeSpiceContract({
    manifestText: MANIFEST,
    fetch: new FakeSpiceFetch({ tools: changedBudget }).fetch,
    expectedContractSha256: await fixtureFingerprint(TOOLS),
  });
  assertEquals(divergentBudget.contract, "contract-divergent");
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

function simulationTool(
  name: string,
  inputNames: string[],
  outputNames: string[],
  isDc = false,
): Record<string, unknown> {
  const inputSchema = objectSchema(inputNames);
  const properties = inputSchema.properties as Record<string, unknown>;
  properties.nodes = observableSchema();
  properties.branch_sources = observableSchema();
  properties.timeout_s = {
    type: "number",
    minimum: SPICE_EXECUTION_BUDGETS.timeoutSeconds.min,
    maximum: SPICE_EXECUTION_BUDGETS.timeoutSeconds.max,
    description: "Simulation timeout in seconds (default 30, max 300).",
  };
  if (isDc) {
    properties.step_v = {
      type: "number",
      description: "The resulting sweep is capped at 512 internal points.",
    };
  }
  return { name, inputSchema, outputSchema: objectSchema(outputNames) };
}

function observableSchema(): Record<string, unknown> {
  return {
    type: "array",
    minItems: 1,
    maxItems: SPICE_EXECUTION_BUDGETS.observablesPerKind,
    items: { type: "string" },
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
    dcSweep: [],
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
