/**
 * Maintainer-only D2 preflight for the pinned mcp-spice discovery surface.
 *
 * This is deliberately not a generic MCP client. It can issue only GET
 * /health, server/discover, and tools/list against the code-owned loopback
 * endpoint. It never sends tools/call or creates a circuit input.
 */

import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";

const MANIFEST_PATH = new URL("../../config/mcp-fleet.json", import.meta.url);
const MCP_PROTOCOL_VERSION = "2026-07-28";
const EXPECTED_TOOLS = ["spice_simulate_op", "spice_simulate_tran"] as const;

/** Reviewed 2026-08-22 provider identity plus exact input/output schemas. */
const EXPECTED_CONTRACT_SHA256 =
  "7b04e7e49cf3451f1c2ced0432490631b06c516fcd3874806dfa989a85c4217e";

export const SPICE_ENDPOINT = {
  mcpUrl: "http://127.0.0.1:3023/mcp",
  healthUrl: "http://127.0.0.1:3023/health",
} as const;

export interface ProbeSpiceContractOptions {
  /** Test seam only. Production reads config/mcp-fleet.json. */
  readonly manifestText?: string;
  /** Test seam only. Production uses global fetch. */
  readonly fetch?: typeof fetch;
  /** Test seam only. Production records the current UTC instant. */
  readonly now?: () => Date;
  /** Test seam only. Production uses the reviewed contract fingerprint above. */
  readonly expectedContractSha256?: string;
}

export interface SpiceContractPreflight {
  readonly probe: "spice-contract";
  readonly observedAt: string;
  readonly endpoint: typeof SPICE_ENDPOINT;
  readonly allowedRequests: readonly [
    "GET /health",
    "server/discover",
    "tools/list",
  ];
  readonly desired: {
    readonly id?: string;
    readonly serviceName?: string;
    readonly mcpUrl?: string;
    readonly healthUrl?: string;
    readonly image?: string;
    readonly expectedTools: readonly string[];
    readonly manifestMatchesCodeOwnedContract: boolean;
    readonly imageDigestVerified: false;
  };
  readonly observed: {
    readonly health?: Record<string, unknown>;
    readonly discovery?: Record<string, unknown>;
    readonly tools?: readonly Record<string, unknown>[];
    readonly contractFingerprint?: ContentFingerprint;
  };
  readonly contract: "current-surface" | "contract-divergent" | "unavailable";
  readonly supportedResultFamilies: {
    readonly operatingPoint: readonly string[];
    readonly reducedTransient: readonly string[];
    readonly units: {
      readonly voltage: "supported" | "unresolved";
      readonly ampere: "unresolved";
      readonly watt: "unresolved";
      readonly eventTimeSeconds: "unresolved";
    };
  };
  readonly gaps: readonly {
    readonly capability: string;
    readonly status: "unresolved";
    readonly reason: string;
  }[];
  readonly conclusion: {
    readonly status: "non-executable-preflight" | "unavailable";
    readonly integration: "unresolved" | "unavailable";
    readonly reason: string;
  };
}

class ContractDivergenceError extends Error {}

export async function probeSpiceContract(
  options: ProbeSpiceContractOptions = {},
): Promise<SpiceContractPreflight> {
  const desired = parseDesiredIdentity(
    options.manifestText ?? await Deno.readTextFile(MANIFEST_PATH),
  );
  const baseline = {
    probe: "spice-contract" as const,
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    endpoint: SPICE_ENDPOINT,
    allowedRequests: [
      "GET /health",
      "server/discover",
      "tools/list",
    ] as const,
    desired,
  };

  if (!desired.manifestMatchesCodeOwnedContract) {
    return report(
      baseline,
      "contract-divergent",
      {},
      "The desired manifest no longer matches the code-owned mcp-spice contract; no alternate endpoint was probed.",
    );
  }

  let health: Record<string, unknown> | undefined;
  let discovery: Record<string, unknown> | undefined;
  let tools: Record<string, unknown>[] | undefined;
  let contractFingerprint: ContentFingerprint | undefined;
  try {
    const fetchImpl = options.fetch ?? fetch;
    health = await getJson(fetchImpl, SPICE_ENDPOINT.healthUrl);
    discovery = await rpc(fetchImpl, 1, "server/discover");
    const listed = await rpc(fetchImpl, 2, "tools/list");
    tools = records(listed.tools, "tools/list tools");
    contractFingerprint = await spiceContractFingerprint(
      health,
      discovery,
      tools,
    );
  } catch (error) {
    const observed = { health, discovery, tools, contractFingerprint };
    const reason = error instanceof Error ? error.message : String(error);
    return error instanceof ContractDivergenceError
      ? report(baseline, "contract-divergent", observed, reason)
      : report(baseline, "unavailable", observed, reason);
  }

  const observed = { health, discovery, tools, contractFingerprint };
  const expected = options.expectedContractSha256 ?? EXPECTED_CONTRACT_SHA256;
  if (contractFingerprint.digest !== expected) {
    return report(
      baseline,
      "contract-divergent",
      observed,
      `Observed contract fingerprint ${contractFingerprint.digest} differs from reviewed ${expected}.`,
    );
  }

  return report(
    baseline,
    "current-surface",
    observed,
    "The current surface is voltage-only and lacks A/W, event-time in seconds, provider readback, input-size bounds, and an observed tools/call error envelope.",
  );
}

/** Fingerprint the exact provider identity and tool schemas relevant to E08. */
export async function spiceContractFingerprint(
  health: Record<string, unknown>,
  discovery: Record<string, unknown>,
  tools: readonly Record<string, unknown>[],
): Promise<ContentFingerprint> {
  const serverInfo = record(discovery.serverInfo, "server/discover serverInfo");
  if (
    health.status !== "ok" || health.server !== "mcp-spice" ||
    typeof health.version !== "string" || serverInfo.name !== "mcp-spice" ||
    serverInfo.version !== health.version
  ) {
    throw new ContractDivergenceError(
      "Health and discovery do not expose one concordant mcp-spice identity.",
    );
  }
  const supportedVersions = strings(
    discovery.supportedVersions,
    "server/discover supportedVersions",
  );
  if (!supportedVersions.includes(MCP_PROTOCOL_VERSION)) {
    throw new ContractDivergenceError(
      `Provider does not support MCP ${MCP_PROTOCOL_VERSION}.`,
    );
  }

  const byName = new Map<string, Record<string, unknown>>();
  for (const tool of tools) {
    if (typeof tool.name !== "string" || byName.has(tool.name)) {
      throw new ContractDivergenceError(
        "tools/list contains an invalid or duplicate name.",
      );
    }
    byName.set(tool.name, tool);
  }
  if (!sameStringSet([...byName.keys()], EXPECTED_TOOLS)) {
    throw new ContractDivergenceError(
      "tools/list does not expose exactly the two reviewed mcp-spice tools.",
    );
  }

  const toolContracts = EXPECTED_TOOLS.map((name) => {
    const tool = byName.get(name)!;
    return {
      name,
      inputSchema: record(tool.inputSchema, `${name} inputSchema`),
      outputSchema: record(tool.outputSchema, `${name} outputSchema`),
    };
  });
  return await sha256Fingerprint({
    provider: {
      name: serverInfo.name,
      version: serverInfo.version,
      supportedVersions: [...supportedVersions].sort(),
    },
    tools: toolContracts,
  });
}

function parseDesiredIdentity(
  manifestText: string,
): SpiceContractPreflight["desired"] {
  const manifest = JSON.parse(manifestText) as { servers?: unknown };
  const matches = Array.isArray(manifest.servers)
    ? manifest.servers.filter((item) => isRecord(item) && item.id === "spice")
    : [];
  const spice: Record<string, unknown> = matches.length === 1 ? matches[0] : {};
  const expectedTools = Array.isArray(spice.expectedTools) &&
      spice.expectedTools.every((item: unknown) => typeof item === "string")
    ? spice.expectedTools as string[]
    : [];
  const image = string(spice.image);
  return {
    id: string(spice.id),
    serviceName: string(spice.serviceName),
    mcpUrl: string(spice.mcpUrl),
    healthUrl: string(spice.healthUrl),
    image,
    expectedTools,
    manifestMatchesCodeOwnedContract: matches.length === 1 &&
      spice.serviceName === "mcp-spice" &&
      spice.mcpUrl === SPICE_ENDPOINT.mcpUrl &&
      spice.healthUrl === SPICE_ENDPOINT.healthUrl &&
      sameStringSet(expectedTools, EXPECTED_TOOLS) &&
      typeof image === "string" &&
      /^ghcr\.io\/casys-ai\/mcp-spice@sha256:[a-f0-9]{64}$/.test(image),
    // This probe has neither Docker permission nor an image-inspection path.
    imageDigestVerified: false,
  };
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { method: "GET" });
  if (!response.ok) throw new Error(`health returned HTTP ${response.status}`);
  return record(await response.json(), "health response");
}

async function rpc(
  fetchImpl: typeof fetch,
  id: number,
  method: "server/discover" | "tools/list",
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(SPICE_ENDPOINT.mcpUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": method,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: "casys-spice-contract-preflight",
            version: "1",
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const envelope = record(await response.json(), `${method} response`);
  if (envelope.error !== undefined) {
    throw new ContractDivergenceError(`${method} returned a JSON-RPC error.`);
  }
  const result = record(envelope.result, `${method} result`);
  if (result.resultType !== "complete") {
    throw new ContractDivergenceError(
      `${method} did not return resultType complete.`,
    );
  }
  return result;
}

function report(
  baseline: Pick<
    SpiceContractPreflight,
    "probe" | "observedAt" | "endpoint" | "allowedRequests" | "desired"
  >,
  contract: SpiceContractPreflight["contract"],
  observed: SpiceContractPreflight["observed"],
  reason: string,
): SpiceContractPreflight {
  const current = contract === "current-surface";
  return {
    ...baseline,
    observed,
    contract,
    supportedResultFamilies: current
      ? {
        operatingPoint: ["node_voltages", "measurements", "input_artifact"],
        reducedTransient: [
          "node_stats:min_v,max_v,final_v",
          "measurements:final_v",
          "simulation:n_points,tstop_s",
        ],
        units: {
          voltage: "supported",
          ampere: "unresolved",
          watt: "unresolved",
          eventTimeSeconds: "unresolved",
        },
      }
      : unresolvedFamilies(),
    gaps: GAPS.map(([capability, reason]) => ({
      capability,
      status: "unresolved" as const,
      reason,
    })),
    conclusion: {
      status: contract === "unavailable" ? "unavailable" : "non-executable-preflight",
      integration: contract === "unavailable" ? "unavailable" : "unresolved",
      reason,
    },
  };
}

const GAPS = [
  ["ampere-observation", "No listed output schema exposes branch current in A."],
  ["watt-observation", "No listed output schema exposes power in W."],
  ["event-time-seconds", "Transient returns requested tstop_s, not event time in s."],
  ["provider-readback", "No run id or provider readback method is listed."],
  ["input-size-bounds", "No byte, node-count, or transient-point bound is listed."],
  [
    "error-envelope",
    "This read-only probe never observes a tools/call error envelope.",
  ],
] as const;

function unresolvedFamilies(): SpiceContractPreflight["supportedResultFamilies"] {
  return {
    operatingPoint: [],
    reducedTransient: [],
    units: {
      voltage: "unresolved",
      ampere: "unresolved",
      watt: "unresolved",
      eventTimeSeconds: "unresolved",
    },
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ContractDivergenceError(`${label} is not an object.`);
  }
  return value;
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new ContractDivergenceError(`${label} is not an object array.`);
  }
  return value;
}

function strings(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new ContractDivergenceError(`${label} is not a string array.`);
  }
  return value;
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    actual.every((item) => expected.includes(item));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

if (import.meta.main) {
  console.log(JSON.stringify(await probeSpiceContract(), null, 2));
}
