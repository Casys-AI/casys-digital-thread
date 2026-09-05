/**
 * Maintainer-only preflight for the pinned HTTP mcp-build123d 0.6.1 contract.
 *
 * It can issue only GET /health, server/discover, tools/list, and resources/list
 * against the code-owned loopback endpoint. It never sends tools/call, executes
 * CAD, reads an artifact, or establishes authority for either the canonical
 * server-fixed route or the admitted sandbox route.
 */

import { sha256Fingerprint } from "../../src/domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../src/domain/kernel/primitives.ts";
import { BUILD123D_EXPORT_TIMEOUT_MS } from "../../src/adapters/cad/canonical/build123d-export-contract.ts";

const MANIFEST_PATH = new URL("../../config/mcp-fleet.json", import.meta.url);
const MCP_PROTOCOL_VERSION = "2026-07-28";
const RESULTS_VIEWER = "ui://mcp-build123d/results-viewer";

export const BUILD123D_ENDPOINT = {
  mcpUrl: "http://127.0.0.1:3014/mcp",
  healthUrl: "http://127.0.0.1:3014/health",
} as const;

type LoopbackEndpoint = {
  mcpUrl: string;
  healthUrl: string;
};

export const BUILD123D_EXPECTED_TOOLS = [
  "build123d_execute",
  "build123d_export",
  "build123d_observe_assembly_integrity",
] as const;

export const BUILD123D_RELEASE = {
  image:
    "ghcr.io/casys-ai/mcp-build123d@sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
  releaseTag: "v0.6.1",
  version: "0.6.1",
  revision: "beaeb648a979437cce8676da103a39d9eb312290",
  imageIndexDigest: "765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d",
  platformManifests: {
    "linux/amd64": "e040ee6385df909d481ac58ec290a1b13f50ca40b0e48eec58949fb5efde8309",
    "linux/arm64": "420d9ba94b71605443ee59cc1160f94e17ead0c5b6a3f5e7a80f76dffa1ea84b",
  },
  ociLabels: {
    "org.opencontainers.image.created": "2026-08-28T16:59:19Z",
    "org.opencontainers.image.description": "Qualified Build123d MCP provider",
    "org.opencontainers.image.licenses": "MIT",
    "org.opencontainers.image.revision": "beaeb648a979437cce8676da103a39d9eb312290",
    "org.opencontainers.image.source": "https://github.com/Casys-AI/mcp-build123d",
    "org.opencontainers.image.title": "mcp-build123d",
    "org.opencontainers.image.url": "https://github.com/denoland/deno_docker",
    "org.opencontainers.image.version": "0.6.1",
  },
} as const;

/** SHA-256 over the 0.6.1 discovery identity and exact listed tool schemas. */
export const BUILD123D_EXPECTED_CONTRACT_SHA256 =
  "43801a71a10eb91959b616947b6ca028fa2ca05e8bf010159180fbf1067f68fa";

export interface ProbeBuild123dContractOptions {
  readonly manifestText?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly expectedContractSha256?: string;
}

export interface Build123dContractPreflight {
  readonly probe: "build123d-contract";
  readonly observedAt: string;
  readonly endpoint: typeof BUILD123D_ENDPOINT;
  readonly allowedRequests: readonly [
    "GET /health",
    "server/discover",
    "tools/list",
    "resources/list",
  ];
  readonly desired: {
    readonly image?: string;
    readonly version?: string;
    readonly revision?: string;
    readonly imageIndexDigest?: string;
    readonly contractFingerprint?: string;
    readonly expectedTools: readonly string[];
    readonly expectedViews: readonly string[];
    readonly manifestMatchesCodeOwnedContract: boolean;
    /** Docker labels/index are declared, not verified by this network-only probe. */
    readonly imageDigestVerified: false;
  };
  readonly observed: {
    readonly health?: Record<string, unknown>;
    readonly discovery?: Record<string, unknown>;
    readonly toolNames?: readonly string[];
    readonly resourceUris?: readonly string[];
    readonly contractFingerprint?: ContentFingerprint;
  };
  readonly contract: "current-surface" | "contract-divergent" | "unavailable";
  readonly surface: {
    readonly serverFixedCad: "declared" | "unresolved";
    readonly assemblyIntegrityObservation: "declared" | "unresolved";
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

export async function probeBuild123dContract(
  options: ProbeBuild123dContractOptions = {},
): Promise<Build123dContractPreflight> {
  const desired = parseDesiredIdentity(
    options.manifestText ?? await Deno.readTextFile(MANIFEST_PATH),
  );
  const baseline = {
    probe: "build123d-contract" as const,
    observedAt: (options.now ?? (() => new Date()))().toISOString(),
    endpoint: BUILD123D_ENDPOINT,
    allowedRequests: [
      "GET /health",
      "server/discover",
      "tools/list",
      "resources/list",
    ] as const,
    desired,
  };
  if (!desired.manifestMatchesCodeOwnedContract) {
    return report(
      baseline,
      "contract-divergent",
      {},
      "The desired manifest no longer matches the reviewed mcp-build123d 0.6.1 contract; no alternate endpoint was probed.",
    );
  }

  let health: Record<string, unknown> | undefined;
  let discovery: Record<string, unknown> | undefined;
  let tools: Record<string, unknown>[] | undefined;
  let resources: Record<string, unknown>[] | undefined;
  let contractFingerprint: ContentFingerprint | undefined;
  try {
    const fetchImpl = options.fetch ?? fetch;
    health = await getJson(fetchImpl, BUILD123D_ENDPOINT.healthUrl);
    discovery = await rpc(fetchImpl, 1, "server/discover");
    const listedTools = await rpc(fetchImpl, 2, "tools/list");
    tools = records(listedTools.tools, "tools/list tools");
    const listedResources = await rpc(fetchImpl, 3, "resources/list");
    resources = records(listedResources.resources, "resources/list resources");
    contractFingerprint = await build123dContractFingerprint(health, discovery, tools);
    assertResources(resources);
  } catch (error) {
    const observed = observedSurface(
      health,
      discovery,
      tools,
      resources,
      contractFingerprint,
    );
    const reason = error instanceof Error ? error.message : String(error);
    return error instanceof ContractDivergenceError
      ? report(baseline, "contract-divergent", observed, reason)
      : report(baseline, "unavailable", observed, reason);
  }

  const observed = observedSurface(
    health,
    discovery,
    tools,
    resources,
    contractFingerprint,
  );
  const expected = options.expectedContractSha256 ?? BUILD123D_EXPECTED_CONTRACT_SHA256;
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
    "The reviewed Build123d discovery surface is present. This non-executable preflight made no tools/call and establishes neither canonical geometry nor admitted sandbox evidence.",
  );
}

/** Fingerprint provider identity and every exact input/output schema. */
export async function build123dContractFingerprint(
  health: Record<string, unknown>,
  discovery: Record<string, unknown>,
  tools: readonly Record<string, unknown>[],
): Promise<ContentFingerprint> {
  const serverInfo = record(discovery.serverInfo, "server/discover serverInfo");
  if (
    health.status !== "ok" || health.server !== "mcp-build123d" ||
    health.version !== BUILD123D_RELEASE.version ||
    serverInfo.name !== "mcp-build123d" ||
    serverInfo.version !== BUILD123D_RELEASE.version
  ) {
    throw new ContractDivergenceError(
      "Health and discovery do not expose one concordant mcp-build123d 0.6.1 identity.",
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
  const byName = indexTools(tools);
  if (!sameStringSet([...byName.keys()], BUILD123D_EXPECTED_TOOLS)) {
    throw new ContractDivergenceError(
      "tools/list does not expose exactly the reviewed mcp-build123d surface.",
    );
  }
  assertExecutionTimeout(byName.get("build123d_execute")!, "build123d_execute");
  assertExecutionTimeout(byName.get("build123d_export")!, "build123d_export");
  const observer = byName.get("build123d_observe_assembly_integrity")!;
  const observerInput = record(
    observer.inputSchema,
    "assembly observation inputSchema",
  );
  if (
    !Array.isArray(observerInput.required) || !observerInput.required.includes("step")
  ) {
    throw new ContractDivergenceError(
      "Assembly observation must require one STEP envelope.",
    );
  }
  const observerOutput = record(
    observer.outputSchema,
    "assembly observation outputSchema",
  );
  const outputProperties = record(
    observerOutput.properties,
    "assembly observation outputSchema properties",
  );
  const producer = record(
    outputProperties.producer,
    "assembly observation producer schema",
  );
  const producerProperties = record(
    producer.properties,
    "assembly observation producer properties",
  );
  if (
    record(producerProperties.packageVersion, "assembly observation package version")
      .const !== BUILD123D_RELEASE.version
  ) {
    throw new ContractDivergenceError(
      "Assembly observation packageVersion is not 0.6.1.",
    );
  }
  const method = record(outputProperties.method, "assembly observation method schema");
  const methodProperties = record(
    method.properties,
    "assembly observation method properties",
  );
  if (
    record(methodProperties.id, "assembly observation method id").const !==
      "occt-assembly-integrity-v1"
  ) {
    throw new ContractDivergenceError(
      "Assembly observation does not declare the reviewed OCCT method.",
    );
  }
  if (
    viewerResourceUri(byName.get("build123d_execute")!) !== RESULTS_VIEWER ||
    viewerResourceUri(byName.get("build123d_export")!) !== RESULTS_VIEWER ||
    viewerResourceUri(observer) !== undefined
  ) {
    throw new ContractDivergenceError(
      "Build123d viewer attachments differ from the reviewed surface.",
    );
  }
  const toolContracts = BUILD123D_EXPECTED_TOOLS.map((name) => {
    const tool = byName.get(name)!;
    return {
      name,
      inputSchema: record(tool.inputSchema, `${name} inputSchema`),
      outputSchema: record(tool.outputSchema, `${name} outputSchema`),
      viewerResourceUri: viewerResourceUri(tool) ?? null,
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
): Build123dContractPreflight["desired"] {
  const manifest = JSON.parse(manifestText) as { servers?: unknown };
  const servers = Array.isArray(manifest.servers)
    ? manifest.servers.filter(isRecord)
    : [];
  const build123d = uniqueServer(servers, "build123d");
  const sandbox = uniqueServer(servers, "build123d-sandbox");
  const identity = recordOrEmpty(build123d?.providerIdentity);
  return {
    image: string(build123d?.image),
    version: string(identity.version),
    revision: string(identity.revision),
    imageIndexDigest: string(identity.imageIndexDigest),
    contractFingerprint: string(identity.contractFingerprint),
    expectedTools: stringArray(build123d?.expectedTools),
    expectedViews: stringArray(build123d?.expectedViews),
    manifestMatchesCodeOwnedContract: build123d !== undefined &&
      sandbox !== undefined &&
      matchesCodeOwnedService(build123d, BUILD123D_ENDPOINT) &&
      matchesCodeOwnedService(sandbox, {
        mcpUrl: "http://127.0.0.1:3024/mcp",
        healthUrl: "http://127.0.0.1:3024/health",
      }) &&
      matchesRelease(build123d) && matchesRelease(sandbox) &&
      sameStringSet(stringArray(build123d.expectedTools), BUILD123D_EXPECTED_TOOLS) &&
      sameStringSet(stringArray(sandbox.expectedTools), BUILD123D_EXPECTED_TOOLS) &&
      sameStringSet(stringArray(build123d.expectedViews), [RESULTS_VIEWER]) &&
      sameStringSet(stringArray(sandbox.expectedViews), [RESULTS_VIEWER]),
    imageDigestVerified: false,
  };
}

function matchesCodeOwnedService(
  server: Record<string, unknown>,
  endpoint: LoopbackEndpoint,
): boolean {
  return server.serviceName === "mcp-build123d" ||
      server.serviceName === "mcp-build123d-sandbox"
    ? typeof server.mcpUrl === "string" && server.mcpUrl === endpoint.mcpUrl &&
      typeof server.healthUrl === "string" && server.healthUrl === endpoint.healthUrl
    : false;
}

function matchesRelease(server: Record<string, unknown>): boolean {
  const identity = recordOrEmpty(server.providerIdentity);
  return server.image === BUILD123D_RELEASE.image &&
    identity.releaseTag === BUILD123D_RELEASE.releaseTag &&
    identity.version === BUILD123D_RELEASE.version &&
    identity.revision === BUILD123D_RELEASE.revision &&
    identity.imageIndexDigest === BUILD123D_RELEASE.imageIndexDigest &&
    identity.contractFingerprint === BUILD123D_EXPECTED_CONTRACT_SHA256 &&
    sameStringRecord(identity.platformManifests, BUILD123D_RELEASE.platformManifests) &&
    sameStringRecord(identity.ociLabels, BUILD123D_RELEASE.ociLabels);
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, { method: "GET", redirect: "error" });
  if (!response.ok) throw new Error(`health returned HTTP ${response.status}`);
  return record(await response.json(), "health response");
}

async function rpc(
  fetchImpl: typeof fetch,
  id: number,
  method: "server/discover" | "tools/list" | "resources/list",
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(BUILD123D_ENDPOINT.mcpUrl, {
    method: "POST",
    redirect: "error",
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
            name: "casys-build123d-contract-preflight",
            version: "1",
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const envelope = record(await response.json(), `${method} response`);
  if (
    envelope.jsonrpc !== "2.0" || envelope.id !== id || envelope.error !== undefined
  ) {
    throw new ContractDivergenceError(
      `${method} returned an invalid JSON-RPC response.`,
    );
  }
  const result = record(envelope.result, `${method} result`);
  if (result.resultType !== "complete") {
    throw new ContractDivergenceError(`${method} did not return resultType complete.`);
  }
  return result;
}

function report(
  baseline: Pick<
    Build123dContractPreflight,
    "probe" | "observedAt" | "endpoint" | "allowedRequests" | "desired"
  >,
  contract: Build123dContractPreflight["contract"],
  observed: Build123dContractPreflight["observed"],
  reason: string,
): Build123dContractPreflight {
  const current = contract === "current-surface";
  return {
    ...baseline,
    observed,
    contract,
    surface: current
      ? {
        serverFixedCad: "declared",
        assemblyIntegrityObservation: "declared",
        viewerUris: [RESULTS_VIEWER],
      }
      : {
        serverFixedCad: "unresolved",
        assemblyIntegrityObservation: "unresolved",
        viewerUris: [],
      },
    gaps: [{
      capability: "cad-execution-and-error-envelope",
      status: "unresolved",
      reason:
        "This read-only preflight never sends tools/call, so it does not observe CAD execution or a tool error envelope.",
    }],
    conclusion: {
      status: contract === "unavailable" ? "unavailable" : "non-executable-preflight",
      integration: contract === "unavailable" ? "unavailable" : "unresolved",
      reason,
    },
  };
}

function observedSurface(
  health: Record<string, unknown> | undefined,
  discovery: Record<string, unknown> | undefined,
  tools: readonly Record<string, unknown>[] | undefined,
  resources: readonly Record<string, unknown>[] | undefined,
  contractFingerprint: ContentFingerprint | undefined,
): Build123dContractPreflight["observed"] {
  return {
    health,
    discovery,
    toolNames: tools?.flatMap((tool) =>
      typeof tool.name === "string" ? [tool.name] : []
    ),
    resourceUris: resources?.flatMap((resource) =>
      typeof resource.uri === "string" ? [resource.uri] : []
    ),
    contractFingerprint,
  };
}

function assertExecutionTimeout(tool: Record<string, unknown>, name: string): void {
  const input = record(tool.inputSchema, `${name} inputSchema`);
  const properties = record(input.properties, `${name} inputSchema properties`);
  const timeout = record(properties.timeout_ms, `${name} timeout_ms schema`);
  if (
    timeout.type !== "integer" || timeout.minimum !== 1 ||
    timeout.maximum !== BUILD123D_EXPORT_TIMEOUT_MS
  ) {
    throw new ContractDivergenceError(
      `${name} timeout_ms must be an integer in [1, ${BUILD123D_EXPORT_TIMEOUT_MS}].`,
    );
  }
}

function assertResources(resources: readonly Record<string, unknown>[]): void {
  const uris = resources.flatMap((resource) =>
    typeof resource.uri === "string" ? [resource.uri] : []
  );
  if (!sameStringSet(uris, [RESULTS_VIEWER])) {
    throw new ContractDivergenceError(
      "resources/list does not expose exactly the reviewed viewer surface.",
    );
  }
}

function indexTools(
  tools: readonly Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  const byName = new Map<string, Record<string, unknown>>();
  for (const tool of tools) {
    if (typeof tool.name !== "string" || byName.has(tool.name)) {
      throw new ContractDivergenceError(
        "tools/list contains an invalid or duplicate name.",
      );
    }
    byName.set(tool.name, tool);
  }
  return byName;
}

function uniqueServer(
  servers: readonly Record<string, unknown>[],
  id: string,
): Record<string, unknown> | undefined {
  const matches = servers.filter((server) => server.id === id);
  return matches.length === 1 ? matches[0] : undefined;
}

function viewerResourceUri(tool: Record<string, unknown>): string | undefined {
  const meta = recordOrEmpty(tool._meta);
  const ui = recordOrEmpty(meta.ui);
  return string(ui.resourceUri);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ContractDivergenceError(`${label} is not an object.`);
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

function recordOrEmpty(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
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

function sameStringRecord(
  actual: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  if (
    !isRecord(actual) ||
    !Object.values(actual).every((value) => typeof value === "string")
  ) {
    return false;
  }
  const keys = Object.keys(actual);
  return keys.length === Object.keys(expected).length &&
    keys.every((key) => actual[key] === expected[key]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

if (import.meta.main) {
  console.log(JSON.stringify(await probeBuild123dContract(), null, 2));
}
