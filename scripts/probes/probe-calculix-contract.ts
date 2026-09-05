/**
 * Maintainer-only preflight for the pinned HTTP mcp-calculix 0.8.2 contract.
 *
 * This is deliberately not a generic MCP client. It can issue only
 * server/discover and tools/list against the code-owned loopback endpoint.
 * The published 0.8.2 provider has no /health route, so this probe does not
 * invent one. It never sends tools/call, starts a mesh preflight, writes a
 * run, or reads a provider resource. Its result concerns the optional
 * sensitivity fleet only; it neither invokes nor establishes provenance for
 * the separate isolated product operation verify.run-fea-static-proof@3.
 */

import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";

const MANIFEST_PATH = new URL("../../config/mcp-fleet.json", import.meta.url);
const MCP_PROTOCOL_VERSION = "2026-07-28";
const IMAGE_DIGEST = "ea933089d0941dd7c45d7e00a825be64c412edbb334a05dc568745ce885abfc8";
const IMAGE = `ghcr.io/casys-ai/mcp-calculix@sha256:${IMAGE_DIGEST}`;
const VERSION = "0.8.2";
const REVISION = "6fb30a75c4876ad469cc472ffa8ca691e0a6b58b";
const RESULTS_VIEWER = "ui://mcp-calculix/results-viewer";
export const MAX_ORDINARY_SOLVE_TIMEOUT_MS = 120_000;

export const CALCULIX_ENDPOINT = {
  mcpUrl: "http://127.0.0.1:3015/mcp",
} as const;

export const CALCULIX_EXPECTED_TOOLS = [
  "calculix_mesh_preflight",
  "calculix_run_get",
  "calculix_solve_buckling",
  "calculix_solve_coupled_thermal",
  "calculix_solve_creep",
  "calculix_solve_modal",
  "calculix_solve_static",
  "calculix_solve_static_recorded",
] as const;

/** SHA-256 over the 0.8.2 discovery identity and all listed tool schemas. */
export const CALCULIX_EXPECTED_CONTRACT_SHA256 =
  "8e8b5c007299818908d424413483addf7fdde5928175c80d2817232b85839ed4";

export interface ProbeCalculixContractOptions {
  /** Test seam only. Production reads config/mcp-fleet.json. */
  readonly manifestText?: string;
  /** Test seam only. Production uses global fetch. */
  readonly fetch?: typeof fetch;
  /** Test seam only. Production records the current UTC instant. */
  readonly now?: () => Date;
  /** Test seam only. Production uses the reviewed fingerprint above. */
  readonly expectedContractSha256?: string;
}

export interface CalculixContractPreflight {
  readonly probe: "calculix-contract";
  readonly observedAt: string;
  readonly endpoint: typeof CALCULIX_ENDPOINT;
  readonly allowedRequests: readonly [
    "server/discover",
    "tools/list",
  ];
  readonly desired: {
    readonly id?: string;
    readonly serviceName?: string;
    readonly mcpUrl?: string;
    readonly image?: string;
    readonly version?: string;
    readonly revision?: string;
    readonly imageIndexDigest?: string;
    readonly ordinarySolveTimeoutMaxMs?: number;
    readonly expectedTools: readonly string[];
    readonly expectedViews: readonly string[];
    readonly contractFingerprint?: string;
    readonly manifestMatchesCodeOwnedContract: boolean;
    /** Docker labels/index are declared, not verified by this network-only probe. */
    readonly imageDigestVerified: false;
  };
  readonly observed: {
    readonly discovery?: Record<string, unknown>;
    /** Names only: schemas are fingerprinted but not emitted into terminal logs. */
    readonly toolNames?: readonly string[];
    /** Viewer metadata is a reviewed surface, but no resource is read. */
    readonly viewerAttachments?: readonly {
      readonly name: string;
      readonly resourceUri: string;
    }[];
    readonly contractFingerprint?: ContentFingerprint;
  };
  readonly contract: "current-surface" | "contract-divergent" | "unavailable";
  readonly surface: {
    readonly meshPreflight: "declared" | "unresolved";
    readonly ordinarySolves: readonly string[];
    readonly recordedStaticRecovery: "declared" | "unresolved";
    readonly viewerUris: readonly string[];
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

export async function probeCalculixContract(
  options: ProbeCalculixContractOptions = {},
): Promise<CalculixContractPreflight> {
  const desired = parseDesiredIdentity(
    options.manifestText ?? await Deno.readTextFile(MANIFEST_PATH),
  );
  const baseline = {
    probe: "calculix-contract" as const,
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    endpoint: CALCULIX_ENDPOINT,
    allowedRequests: [
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
      "The desired manifest no longer matches the reviewed mcp-calculix 0.8.2 contract; no alternate endpoint was probed.",
    );
  }

  let discovery: Record<string, unknown> | undefined;
  let tools: Record<string, unknown>[] | undefined;
  let contractFingerprint: ContentFingerprint | undefined;
  try {
    const fetchImpl = options.fetch ?? fetch;
    discovery = await rpc(fetchImpl, 1, "server/discover");
    const listed = await rpc(fetchImpl, 2, "tools/list");
    tools = records(listed.tools, "tools/list tools");
    contractFingerprint = await calculixContractFingerprint(
      discovery,
      tools,
    );
  } catch (error) {
    const observed = observedSurface(discovery, tools, contractFingerprint);
    const reason = error instanceof Error ? error.message : String(error);
    return error instanceof ContractDivergenceError
      ? report(baseline, "contract-divergent", observed, reason)
      : report(baseline, "unavailable", observed, reason);
  }

  const observed = observedSurface(discovery, tools, contractFingerprint);
  const expected = options.expectedContractSha256 ??
    CALCULIX_EXPECTED_CONTRACT_SHA256;
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
    "The reviewed HTTP sensitivity surface is present. This non-executable preflight made no tools/call and does not establish product-static proof provenance.",
  );
}

/** Fingerprint provider identity, all exact schemas, and viewer attachment surface. */
export async function calculixContractFingerprint(
  discovery: Record<string, unknown>,
  tools: readonly Record<string, unknown>[],
): Promise<ContentFingerprint> {
  const serverInfo = record(discovery.serverInfo, "server/discover serverInfo");
  if (
    serverInfo.name !== "mcp-calculix" || serverInfo.version !== VERSION
  ) {
    throw new ContractDivergenceError(
      "Discovery does not expose the reviewed mcp-calculix 0.8.2 identity.",
    );
  }
  const supportedVersions = strings(
    discovery.supportedVersions,
    "server/discover supportedVersions",
  );
  if (!sameStringSet(supportedVersions, [MCP_PROTOCOL_VERSION])) {
    throw new ContractDivergenceError(
      `Provider does not expose exactly MCP ${MCP_PROTOCOL_VERSION}.`,
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
  if (!sameStringSet([...byName.keys()], CALCULIX_EXPECTED_TOOLS)) {
    throw new ContractDivergenceError(
      "tools/list does not expose exactly the reviewed mcp-calculix tool surface.",
    );
  }

  for (const name of ordinarySolveNames()) {
    const inputSchema = record(byName.get(name)?.inputSchema, `${name} inputSchema`);
    const properties = record(inputSchema.properties, `${name} inputSchema properties`);
    const timeout = record(properties.timeout_ms, `${name} timeout_ms schema`);
    if (
      timeout.type !== "integer" || timeout.minimum !== 1 ||
      timeout.maximum !== MAX_ORDINARY_SOLVE_TIMEOUT_MS
    ) {
      throw new ContractDivergenceError(
        `${name} timeout_ms must be an integer in [1, ${MAX_ORDINARY_SOLVE_TIMEOUT_MS}].`,
      );
    }
  }

  const viewerTools = CALCULIX_EXPECTED_TOOLS.filter((name) =>
    viewerResourceUri(byName.get(name)!) === RESULTS_VIEWER
  );
  if (
    !sameStringSet(viewerTools, [
      "calculix_solve_static",
      "calculix_solve_static_recorded",
    ])
  ) {
    throw new ContractDivergenceError(
      "The results viewer is not attached to exactly the reviewed static surfaces.",
    );
  }

  const toolContracts = CALCULIX_EXPECTED_TOOLS.map((name) => {
    const tool = byName.get(name)!;
    return {
      name,
      inputSchema: record(tool.inputSchema, `${name} inputSchema`),
      outputSchema: record(tool.outputSchema, `${name} outputSchema`),
      viewerResourceUri: viewerResourceUri(tool),
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
): CalculixContractPreflight["desired"] {
  const manifest = JSON.parse(manifestText) as { servers?: unknown };
  const matches = Array.isArray(manifest.servers)
    ? manifest.servers.filter((item) => isRecord(item) && item.id === "calculix")
    : [];
  const calculix: Record<string, unknown> = matches.length === 1 ? matches[0] : {};
  const identity = isRecord(calculix.providerIdentity) ? calculix.providerIdentity : {};
  const labels = isRecord(identity.ociLabels) ? identity.ociLabels : {};
  const expectedTools = stringArray(calculix.expectedTools);
  const expectedViews = stringArray(calculix.expectedViews);
  const image = string(calculix.image);
  const version = string(identity.version);
  const revision = string(identity.revision);
  const imageIndexDigest = string(identity.imageIndexDigest);
  const ordinarySolveTimeoutMaxMs = positiveInteger(
    identity.ordinarySolveTimeoutMaxMs,
  );
  const contractFingerprint = string(identity.contractFingerprint);
  return {
    id: string(calculix.id),
    serviceName: string(calculix.serviceName),
    mcpUrl: string(calculix.mcpUrl),
    image,
    version,
    revision,
    imageIndexDigest,
    ordinarySolveTimeoutMaxMs,
    expectedTools,
    expectedViews,
    contractFingerprint,
    manifestMatchesCodeOwnedContract: matches.length === 1 &&
      calculix.serviceName === "mcp-calculix" &&
      calculix.mcpUrl === CALCULIX_ENDPOINT.mcpUrl &&
      image === IMAGE &&
      version === VERSION && revision === REVISION &&
      imageIndexDigest === IMAGE_DIGEST &&
      ordinarySolveTimeoutMaxMs === MAX_ORDINARY_SOLVE_TIMEOUT_MS &&
      contractFingerprint === CALCULIX_EXPECTED_CONTRACT_SHA256 &&
      labels["org.opencontainers.image.source"] ===
        "https://github.com/Casys-AI/mcp-calculix" &&
      labels["org.opencontainers.image.title"] === "mcp-calculix" &&
      labels["org.opencontainers.image.version"] === VERSION &&
      labels["org.opencontainers.image.revision"] === REVISION &&
      sameStringSet(expectedTools, CALCULIX_EXPECTED_TOOLS) &&
      sameStringSet(expectedViews, [RESULTS_VIEWER]),
    // This probe has neither Docker permission nor an image-inspection path.
    imageDigestVerified: false,
  };
}

async function rpc(
  fetchImpl: typeof fetch,
  id: number,
  method: "server/discover" | "tools/list",
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(CALCULIX_ENDPOINT.mcpUrl, {
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
            name: "casys-calculix-contract-preflight",
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
    CalculixContractPreflight,
    "probe" | "observedAt" | "endpoint" | "allowedRequests" | "desired"
  >,
  contract: CalculixContractPreflight["contract"],
  observed: CalculixContractPreflight["observed"],
  reason: string,
): CalculixContractPreflight {
  const current = contract === "current-surface";
  return {
    ...baseline,
    observed,
    contract,
    surface: current
      ? {
        meshPreflight: "declared",
        ordinarySolves: [
          "calculix_solve_static",
          "calculix_solve_modal",
          "calculix_solve_buckling",
          "calculix_solve_creep",
          "calculix_solve_coupled_thermal",
        ],
        recordedStaticRecovery: "declared",
        viewerUris: [RESULTS_VIEWER],
      }
      : {
        meshPreflight: "unresolved",
        ordinarySolves: [],
        recordedStaticRecovery: "unresolved",
        viewerUris: [],
      },
    gaps: [{
      capability: "solve-execution-and-error-envelope",
      status: "unresolved",
      reason:
        "This read-only preflight never sends tools/call, so it does not observe solver execution or a tool error envelope.",
    }],
    conclusion: {
      status: contract === "unavailable" ? "unavailable" : "non-executable-preflight",
      integration: contract === "unavailable" ? "unavailable" : "unresolved",
      reason,
    },
  };
}

function observedSurface(
  discovery: Record<string, unknown> | undefined,
  tools: readonly Record<string, unknown>[] | undefined,
  contractFingerprint: ContentFingerprint | undefined,
): CalculixContractPreflight["observed"] {
  const toolNames = tools?.flatMap((tool) =>
    typeof tool.name === "string" ? [tool.name] : []
  );
  const viewerAttachments = tools?.flatMap((tool) => {
    const name = string(tool.name);
    const resourceUri = viewerResourceUri(tool);
    return name && resourceUri ? [{ name, resourceUri }] : [];
  });
  return {
    discovery,
    toolNames,
    viewerAttachments,
    contractFingerprint,
  };
}

function viewerResourceUri(tool: Record<string, unknown>): string | undefined {
  const meta = isRecord(tool._meta) ? tool._meta : undefined;
  const ui = meta && isRecord(meta.ui) ? meta.ui : undefined;
  return ui ? string(ui.resourceUri) : undefined;
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

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
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

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : undefined;
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

if (import.meta.main) {
  console.log(JSON.stringify(await probeCalculixContract(), null, 2));
}
