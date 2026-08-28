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
export const SPICE_EXPECTED_TOOLS = [
  "ngspice_netlist_submit",
  "spice_simulate_op",
  "spice_simulate_tran",
  "spice_simulate_dc",
] as const;

/** Reviewed desired OCI identity. It is not a runtime-image observation. */
export const SPICE_RELEASE = {
  image:
    "ghcr.io/casys-ai/mcp-spice@sha256:80f8d6b34dc55e623daf936faea5ff9ee75871331aa88d7339191ea17584991b",
  version: "0.5.2",
  revision: "0575f2d0efdca30965c5b155187b78d9412fb1d1",
  ociLabels: {
    "org.opencontainers.image.created": "2026-08-28T15:49:55.406Z",
    "org.opencontainers.image.description":
      "MCP oracle for circuit verification — ngspice batch operating point and reduced transients. The server owns the .control block.",
    "org.opencontainers.image.licenses": "MIT",
    "org.opencontainers.image.revision": "0575f2d0efdca30965c5b155187b78d9412fb1d1",
    "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-spice",
    "org.opencontainers.image.title": "mcp-spice",
    "org.opencontainers.image.url": "https://github.com/Casys-AI/mcp-spice",
    "org.opencontainers.image.version": "0.5.2",
  },
} as const;

/**
 * Reviewed provider execution limits. Discovery/schema exposes the input bounds,
 * timeout, transient ceiling, and DC request cap. The DC pre-read and per-stream
 * log ceilings are release-qualified runtime limits, included here without making
 * this read-only probe an image inspection or execution test.
 */
export const SPICE_EXECUTION_BUDGETS = {
  netlistBytes: 1_048_576,
  observablesPerKind: 32,
  transientWrdataBytes: 8_388_608,
  transientPoints: 50_000,
  dcWrdataPreReadBytes: 8_388_608,
  dcRequestPoints: 512,
  dcParsePoints: 512,
  ngspiceLogBytesPerStream: 1_048_576,
  timeoutSeconds: { default: 30, min: 1, max: 300 },
} as const;

/** Reviewed 2026-08-29 identity, tool schemas, and execution-budget projection. */
export const SPICE_CONTRACT_SHA256 =
  "5873f79d571a67aeafd74f1749ae4a4172a692cfdf9fbab2c8032df95d0d2e8a";

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
    readonly release: {
      readonly version?: string;
      readonly revision?: string;
      readonly ociLabels: Readonly<Record<string, string>>;
    };
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
    readonly dcSweep: readonly string[];
    readonly units: {
      readonly voltage: "supported" | "unresolved";
      readonly ampere: "supported" | "unresolved";
      readonly watt: "unresolved";
      readonly eventTimeSeconds: "supported" | "unresolved";
    };
  };
  readonly executionBudgets:
    | ({ readonly status: "reviewed-contract" } & typeof SPICE_EXECUTION_BUDGETS)
    | { readonly status: "unresolved" };
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
  const expected = options.expectedContractSha256 ?? SPICE_CONTRACT_SHA256;
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
    "The reviewed discovery surface exposes content-addressed netlist admission, voltage and voltage-source-current summaries, transient extrema times, and a bounded DC sweep. This preflight also reports the code-owned reviewed execution-budget projection. It still does not execute a simulation, inspect an image, observe a tools/call error, or establish product authority.",
  );
}

/** Fingerprint exact provider identity, all tool schemas, and reviewed budgets. */
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
  if (!sameStringSet([...byName.keys()], SPICE_EXPECTED_TOOLS)) {
    throw new ContractDivergenceError(
      "tools/list does not expose exactly the four reviewed mcp-spice tools.",
    );
  }

  const toolContracts = SPICE_EXPECTED_TOOLS.map((name) => {
    const tool = byName.get(name)!;
    return {
      name,
      inputSchema: record(tool.inputSchema, `${name} inputSchema`),
      outputSchema: record(tool.outputSchema, `${name} outputSchema`),
    };
  });
  assertExecutionBudgets(discovery, byName);
  return await sha256Fingerprint({
    provider: {
      name: serverInfo.name,
      version: serverInfo.version,
      supportedVersions: [...supportedVersions].sort(),
      executionBudgets: SPICE_EXECUTION_BUDGETS,
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
  const release = isRecord(spice.release) ? spice.release : {};
  const ociLabels = stringRecord(release.ociLabels);
  return {
    id: string(spice.id),
    serviceName: string(spice.serviceName),
    mcpUrl: string(spice.mcpUrl),
    healthUrl: string(spice.healthUrl),
    image,
    release: {
      version: string(release.version),
      revision: string(release.revision),
      ociLabels,
    },
    expectedTools,
    manifestMatchesCodeOwnedContract: matches.length === 1 &&
      spice.serviceName === "mcp-spice" &&
      spice.mcpUrl === SPICE_ENDPOINT.mcpUrl &&
      spice.healthUrl === SPICE_ENDPOINT.healthUrl &&
      sameStringSet(expectedTools, SPICE_EXPECTED_TOOLS) &&
      image === SPICE_RELEASE.image &&
      release.version === SPICE_RELEASE.version &&
      release.revision === SPICE_RELEASE.revision &&
      sameStringRecord(ociLabels, SPICE_RELEASE.ociLabels),
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
        operatingPoint: [
          "node_voltages:V",
          "branch_currents_a:A",
          "measurements:voltage-only",
          "input_artifact:sha256,bytes,source_path",
        ],
        reducedTransient: [
          "node_stats:min_v,max_v,final_v,min_at_s,max_at_s,final_at_s",
          "branch_current_stats_a:min_a,max_a,final_a,min_at_s,max_at_s,final_at_s",
          "measurements:final_v",
          "simulation:n_points,tstop_s",
        ],
        dcSweep: [
          "node_stats:min_v,max_v,final_v,min_at_source_v,max_at_source_v,final_at_source_v",
          "branch_current_stats_a:min_a,max_a,final_a,min_at_source_v,max_at_source_v,final_at_source_v",
          "sweep:source,start_v,stop_v,step_v,n_points,max_points",
        ],
        units: {
          voltage: "supported",
          ampere: "supported",
          watt: "unresolved",
          eventTimeSeconds: "supported",
        },
      }
      : unresolvedFamilies(),
    executionBudgets: current
      ? { status: "reviewed-contract", ...SPICE_EXECUTION_BUDGETS }
      : { status: "unresolved" },
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
  ["watt-observation", "No listed output schema exposes power in W."],
  ["provider-readback", "No run id or provider readback method is listed."],
  [
    "runtime-budget-enforcement",
    "This read-only probe verifies discovery/schema bounds and reports release-qualified private limits, but never submits or runs a circuit to test runtime enforcement.",
  ],
  [
    "error-envelope",
    "This read-only probe never observes a tools/call error envelope.",
  ],
] as const;

function unresolvedFamilies(): SpiceContractPreflight["supportedResultFamilies"] {
  return {
    operatingPoint: [],
    reducedTransient: [],
    dcSweep: [],
    units: {
      voltage: "unresolved",
      ampere: "unresolved",
      watt: "unresolved",
      eventTimeSeconds: "unresolved",
    },
  };
}

function assertExecutionBudgets(
  discovery: Record<string, unknown>,
  byName: ReadonlyMap<string, Record<string, unknown>>,
): void {
  const instructions = requiredString(
    discovery.instructions,
    "server/discover instructions",
  );
  for (
    const fragment of [
      "Both submitted and legacy-path netlists are limited to 1 MiB",
      "each observable kind is limited to 32 names",
      "Transient wrdata is bounded to 8 MiB and 50,000 samples before reduction",
    ]
  ) {
    if (!instructions.includes(fragment)) {
      throw new ContractDivergenceError(
        `server/discover instructions do not declare ${fragment}.`,
      );
    }
  }

  for (
    const name of [
      "spice_simulate_op",
      "spice_simulate_tran",
      "spice_simulate_dc",
    ] as const
  ) {
    const properties = inputProperties(byName.get(name)!, name);
    for (const field of ["nodes", "branch_sources"] as const) {
      const schema = record(properties[field], `${name} ${field} schema`);
      if (schema.maxItems !== SPICE_EXECUTION_BUDGETS.observablesPerKind) {
        throw new ContractDivergenceError(
          `${name} ${field} maxItems does not equal ${SPICE_EXECUTION_BUDGETS.observablesPerKind}.`,
        );
      }
    }
    const timeout = record(properties.timeout_s, `${name} timeout_s schema`);
    if (
      timeout.minimum !== SPICE_EXECUTION_BUDGETS.timeoutSeconds.min ||
      timeout.maximum !== SPICE_EXECUTION_BUDGETS.timeoutSeconds.max ||
      !requiredString(timeout.description, `${name} timeout_s description`).includes(
        "default 30, max 300",
      )
    ) {
      throw new ContractDivergenceError(
        `${name} timeout_s does not declare the reviewed 1–300 s range and default 30 s.`,
      );
    }
  }

  const dcProperties = inputProperties(
    byName.get("spice_simulate_dc")!,
    "spice_simulate_dc",
  );
  if (
    !requiredString(
      record(dcProperties.step_v, "spice_simulate_dc step_v schema").description,
      "spice_simulate_dc step_v description",
    ).includes(`${SPICE_EXECUTION_BUDGETS.dcRequestPoints} internal points`)
  ) {
    throw new ContractDivergenceError(
      "spice_simulate_dc does not declare the reviewed 512-point request ceiling.",
    );
  }
}

function inputProperties(
  tool: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return record(
    record(tool.inputSchema, `${name} inputSchema`).properties,
    `${name} inputSchema properties`,
  );
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

function requiredString(value: unknown, label: string): string {
  const result = string(value);
  if (result === undefined) {
    throw new ContractDivergenceError(`${label} is not a string.`);
  }
  return result;
}

function stringRecord(value: unknown): Record<string, string> {
  if (
    !isRecord(value) || !Object.values(value).every((item) => typeof item === "string")
  ) {
    return {};
  }
  return value as Record<string, string>;
}

function sameStringRecord(
  actual: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): boolean {
  const actualKeys = Object.keys(actual);
  const expectedKeys = Object.keys(expected);
  return actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => actual[key] === expected[key]);
}

if (import.meta.main) {
  console.log(JSON.stringify(await probeSpiceContract(), null, 2));
}
