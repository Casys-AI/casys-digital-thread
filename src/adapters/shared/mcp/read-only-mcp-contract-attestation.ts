import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { deepFreeze } from "../../../domain/kernel/case-validation.ts";

/** The wire methods used by this attestor. It never invokes a provider tool. */
export const READ_ONLY_MCP_CONTRACT_METHODS = [
  "server/discover",
  "tools/list",
  "resources/list",
  "resources/read",
] as const;

export interface ReadOnlyMcpRuntimeContractExpectation {
  /** A fixed packaged UI resource; it is never a provider model resource. */
  readonly resourceUri: string;
  readonly fingerprints: {
    readonly serverDiscover: ContentFingerprint;
    readonly toolContracts: ContentFingerprint;
    readonly uiResources: ContentFingerprint;
  };
}

export interface ReadOnlyMcpContractTarget {
  readonly id: string;
  readonly healthUrl: string;
  readonly mcpUrl: string;
  /** Repository-owned health declaration expected from this exact endpoint. */
  readonly expectedHealthStatus: string;
  /** Repository-owned `server/discover.serverInfo` identity for this endpoint. */
  readonly expectedServer: {
    readonly name: string;
    readonly version: string;
  };
  /** Optional published release vectors for a provider's read-only surface. */
  readonly expectedRuntimeContract?: ReadOnlyMcpRuntimeContractExpectation;
  readonly expectedTools: readonly string[];
  readonly expectedViews: readonly string[];
}

export interface ReadOnlyMcpContractTool {
  readonly name: string;
  readonly inputSchema: unknown | null;
  readonly outputSchema: unknown | null;
  readonly resourceUri: string | null;
}

/**
 * A discovery-time contract snapshot. It verifies what a running endpoint
 * declares; it does not invoke a tool, prove an operation, or qualify a
 * product vertical.
 */
export interface ReadOnlyMcpContractAttestation {
  readonly mutatesRuntime: false;
  readonly evidenceLevel: "declared" | "contract-attested";
  readonly target: string;
  readonly expected: {
    readonly healthStatus: string;
    readonly protocolVersion: string;
    readonly server: {
      readonly name: string;
      readonly version: string;
    };
    readonly runtimeContract?: ReadOnlyMcpRuntimeContractExpectation;
  };
  readonly health: "healthy" | "unexpected" | "unavailable";
  readonly healthStatus: string | null;
  readonly healthMatchesExpected: boolean;
  readonly protocolVersion: string | null;
  readonly protocolMatchesExpected: boolean;
  readonly server: {
    readonly name: string | null;
    readonly version: string | null;
  };
  readonly serverMatchesExpected: boolean;
  readonly tools: readonly ReadOnlyMcpContractTool[];
  readonly views: readonly string[];
  /** SHA-256 of the canonical `tools/list` input/output schemas only. */
  readonly schemaFingerprint: ContentFingerprint | null;
  /** This probe records the live identity; golden-contract approval is separate. */
  readonly schemaFingerprintStatus: "observed-not-verified" | "unavailable";
  /** Fingerprints in the provider's published runtime-contract shape. */
  readonly runtimeContractFingerprints: {
    readonly serverDiscover: ContentFingerprint | null;
    readonly toolContracts: ContentFingerprint | null;
    readonly uiResources: ContentFingerprint | null;
  };
  /** `null` means this target has no separately pinned runtime-contract. */
  readonly runtimeContractMatchesExpected: boolean | null;
  readonly missingExpectedTools: readonly string[];
  readonly missingExpectedViews: readonly string[];
  readonly detail: string | null;
}

export interface ReadOnlyMcpContractAttestorOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly protocolVersion?: string;
  /** Test seam; production uses the deterministic kernel SHA-256 primitive. */
  readonly fingerprint?: (value: unknown) => Promise<ContentFingerprint>;
}

interface RpcEnvelope {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

const DEFAULT_PROTOCOL_VERSION = "2026-07-28";

/**
 * Fetch the declared HTTP/MCP surface without stateful initialization, SSE, or
 * any tool invocation. A target with a published runtime contract additionally
 * reads only its fixed packaged UI resource. The target and expected surface are
 * supplied by server-owned fleet configuration, not an agent.
 */
export async function attestReadOnlyMcpContract(
  target: ReadOnlyMcpContractTarget,
  options: ReadOnlyMcpContractAttestorOptions = {},
): Promise<ReadOnlyMcpContractAttestation> {
  const request = new ReadOnlyMcpContractAttestor(options);
  try {
    assertLoopbackEndpoint(target.healthUrl, "healthUrl");
    assertLoopbackEndpoint(target.mcpUrl, "mcpUrl");
    const healthResponse = await request.health(target.healthUrl);
    if (!healthResponse.ok) {
      return unavailable(
        target,
        request.protocolVersion,
        `Health endpoint returned HTTP ${healthResponse.status}.`,
      );
    }
    const healthStatus = await parseHealthStatus(healthResponse);
    const healthMatchesExpected = healthStatus === target.expectedHealthStatus;
    const discover = await request.rpc(target.mcpUrl, "server/discover", 1);
    const discoverResult = completeResult(discover, "server/discover", 1);
    const protocolVersion = negotiatedProtocolVersion(
      discoverResult,
      request.protocolVersion,
    );
    const protocolMatchesExpected = protocolVersion === request.protocolVersion;
    const server = serverIdentity(discoverResult);
    const serverMatchesExpected = server.name === target.expectedServer.name &&
      server.version === target.expectedServer.version;
    const serverDiscoverFingerprint = await request.fingerprint(discoverResult);
    const listedTools = await request.rpc(target.mcpUrl, "tools/list", 2);
    const listedToolsResult = completeResult(listedTools, "tools/list", 2);
    const tools = parseTools(listedToolsResult);
    const rawTools = rawToolsFrom(listedToolsResult);
    const toolContractsFingerprint = await request.fingerprint(rawTools);
    const listedResources = await request.rpc(target.mcpUrl, "resources/list", 3);
    const resources = parseResourceUris(
      completeResult(listedResources, "resources/list", 3),
    );
    const views = unique([
      ...tools.flatMap((tool) => tool.resourceUri === null ? [] : [tool.resourceUri]),
      ...resources.filter((uri) => uri.startsWith("ui://")),
    ]);
    const schemaFingerprint = await sha256Fingerprint(
      tools.map((tool) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      })),
    );
    const missingExpectedTools = missing(
      target.expectedTools,
      tools.map((tool) => tool.name),
    );
    const missingExpectedViews = missing(target.expectedViews, views);
    const uiResourcesFingerprint = target.expectedRuntimeContract === undefined
      ? null
      : await runtimeResourceFingerprint(
        request,
        target,
      );
    const runtimeContractMatchesExpected = target.expectedRuntimeContract === undefined
      ? null
      : fingerprintsEqual(
        serverDiscoverFingerprint,
        target.expectedRuntimeContract.fingerprints.serverDiscover,
      ) &&
        fingerprintsEqual(
          toolContractsFingerprint,
          target.expectedRuntimeContract.fingerprints.toolContracts,
        ) &&
        uiResourcesFingerprint !== null &&
        fingerprintsEqual(
          uiResourcesFingerprint,
          target.expectedRuntimeContract.fingerprints.uiResources,
        );
    const complete = healthMatchesExpected && protocolMatchesExpected &&
      serverMatchesExpected && missingExpectedTools.length === 0 &&
      missingExpectedViews.length === 0 &&
      runtimeContractMatchesExpected !== false;
    return deepFreeze({
      mutatesRuntime: false,
      evidenceLevel: complete ? "contract-attested" as const : "declared" as const,
      target: target.id,
      expected: expectedIdentity(target, request.protocolVersion),
      health: healthMatchesExpected ? "healthy" as const : "unexpected" as const,
      healthStatus,
      healthMatchesExpected,
      protocolVersion,
      protocolMatchesExpected,
      server,
      serverMatchesExpected,
      tools,
      views,
      schemaFingerprint,
      schemaFingerprintStatus: "observed-not-verified" as const,
      runtimeContractFingerprints: {
        serverDiscover: serverDiscoverFingerprint,
        toolContracts: toolContractsFingerprint,
        uiResources: uiResourcesFingerprint,
      },
      runtimeContractMatchesExpected,
      missingExpectedTools,
      missingExpectedViews,
      detail: complete
        ? null
        : "Health or discovery did not attest the expected endpoint identity, protocol, tools, or views.",
    });
  } catch (error) {
    return unavailable(target, request.protocolVersion, errorMessage(error));
  }
}

class ReadOnlyMcpContractAttestor {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #fingerprint: (value: unknown) => Promise<ContentFingerprint>;
  readonly protocolVersion: string;

  constructor(options: ReadOnlyMcpContractAttestorOptions) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
    this.protocolVersion = options.protocolVersion ?? DEFAULT_PROTOCOL_VERSION;
    this.#fingerprint = options.fingerprint ?? sha256Fingerprint;
  }

  fingerprint(value: unknown): Promise<ContentFingerprint> {
    return this.#fingerprint(value);
  }

  async health(url: string): Promise<Response> {
    return await this.#request(url, { method: "GET" });
  }

  async rpc(
    url: string,
    method: typeof READ_ONLY_MCP_CONTRACT_METHODS[number],
    id: number,
    params: Record<string, unknown> = {},
  ): Promise<RpcEnvelope> {
    const response = await this.#request(url, {
      method: "POST",
      headers: {
        "accept": "application/json",
        "content-type": "application/json",
        "mcp-protocol-version": this.protocolVersion,
        "mcp-method": method,
        ...(typeof params.uri === "string" ? { "mcp-name": params.uri } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": this.protocolVersion,
            "io.modelcontextprotocol/clientCapabilities": {},
            "io.modelcontextprotocol/clientInfo": {
              name: "casys-behave-contract-attestor",
              version: "0.1.0",
            },
          },
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`${method} returned HTTP ${response.status}`);
    }
    const source = await response.text();
    try {
      const value: unknown = JSON.parse(source);
      if (!isRecord(value)) {
        throw new Error(`${method} returned a non-object JSON-RPC envelope`);
      }
      return value;
    } catch {
      throw new Error(`${method} returned invalid JSON`);
    }
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.#fetch(url, {
        ...init,
        redirect: "error",
        signal: controller.signal,
      });
      if (response.redirected) {
        throw new Error("Read-only MCP endpoint redirected the request");
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }
}

function unavailable(
  target: ReadOnlyMcpContractTarget,
  protocolVersion: string,
  detail: string,
): ReadOnlyMcpContractAttestation {
  return deepFreeze({
    mutatesRuntime: false,
    evidenceLevel: "declared" as const,
    target: target.id,
    expected: expectedIdentity(target, protocolVersion),
    health: "unavailable" as const,
    healthStatus: null,
    healthMatchesExpected: false,
    protocolVersion: null,
    protocolMatchesExpected: false,
    server: { name: null, version: null },
    serverMatchesExpected: false,
    tools: [],
    views: [],
    schemaFingerprint: null,
    schemaFingerprintStatus: "unavailable" as const,
    runtimeContractFingerprints: {
      serverDiscover: null,
      toolContracts: null,
      uiResources: null,
    },
    runtimeContractMatchesExpected: null,
    missingExpectedTools: unique([...target.expectedTools]),
    missingExpectedViews: unique([...target.expectedViews]),
    detail,
  });
}

function expectedIdentity(
  target: ReadOnlyMcpContractTarget,
  protocolVersion: string,
): ReadOnlyMcpContractAttestation["expected"] {
  return deepFreeze({
    healthStatus: target.expectedHealthStatus,
    protocolVersion,
    server: target.expectedServer,
    ...(target.expectedRuntimeContract === undefined
      ? {}
      : { runtimeContract: target.expectedRuntimeContract }),
  });
}

async function runtimeResourceFingerprint(
  request: ReadOnlyMcpContractAttestor,
  target: ReadOnlyMcpContractTarget,
): Promise<ContentFingerprint> {
  const contract = target.expectedRuntimeContract;
  if (contract === undefined) {
    throw new Error("No runtime-contract expectation is configured.");
  }
  const resource = await request.rpc(
    target.mcpUrl,
    "resources/read",
    4,
    { uri: contract.resourceUri },
  );
  return await request.fingerprint(
    completeResult(resource, "resources/read", 4),
  );
}

async function parseHealthStatus(response: Response): Promise<string | null> {
  let value: unknown;
  try {
    value = JSON.parse(await response.text());
  } catch {
    return null;
  }
  return isRecord(value) ? stringValue(value.status) : null;
}

function completeResult(
  envelope: RpcEnvelope,
  method: string,
  expectedId: number,
): Record<string, unknown> {
  if (envelope.jsonrpc !== "2.0" || envelope.id !== expectedId) {
    throw new Error(`${method}: invalid JSON-RPC response identity`);
  }
  const hasResult = Object.hasOwn(envelope, "result");
  const hasError = Object.hasOwn(envelope, "error");
  if (hasResult === hasError) {
    throw new Error(`${method}: expected exactly one JSON-RPC result or error`);
  }
  if (hasError) {
    const error = isRecord(envelope.error) ? envelope.error : {};
    const message = typeof error.message === "string"
      ? error.message
      : "JSON-RPC error";
    throw new Error(`${method}: ${message}`);
  }
  if (!isRecord(envelope.result) || envelope.result.resultType !== "complete") {
    throw new Error(`${method}: expected a complete result`);
  }
  return envelope.result;
}

function assertLoopbackEndpoint(value: string, label: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute loopback HTTP URL`);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    url.search !== ""
  ) {
    throw new TypeError(`${label} must be an absolute loopback HTTP URL`);
  }
}

function negotiatedProtocolVersion(
  discover: Record<string, unknown>,
  expected: string,
): string | null {
  const supported = Array.isArray(discover.supportedVersions)
    ? discover.supportedVersions.filter((version): version is string =>
      typeof version === "string"
    )
    : [];
  return supported.includes(expected) ? expected : null;
}

function serverIdentity(
  discover: Record<string, unknown>,
): { name: string | null; version: string | null } {
  const serverInfo = isRecord(discover.serverInfo) ? discover.serverInfo : {};
  return deepFreeze({
    name: stringValue(serverInfo.name),
    version: stringValue(serverInfo.version),
  });
}

function parseTools(
  result: Record<string, unknown>,
): readonly ReadOnlyMcpContractTool[] {
  const values = Array.isArray(result.tools) ? result.tools : [];
  const tools = values.flatMap((value) => {
    if (!isRecord(value) || typeof value.name !== "string" || value.name === "") {
      return [];
    }
    const meta = isRecord(value._meta) ? value._meta : {};
    const ui = isRecord(meta.ui) ? meta.ui : {};
    return [deepFreeze({
      name: value.name,
      inputSchema: value.inputSchema ?? null,
      outputSchema: value.outputSchema ?? null,
      resourceUri: stringValue(ui.resourceUri),
    })];
  });
  return deepFreeze(tools.sort((left, right) => left.name.localeCompare(right.name)));
}

function rawToolsFrom(result: Record<string, unknown>): readonly unknown[] {
  if (!Array.isArray(result.tools)) {
    throw new Error("tools/list returned no tools array");
  }
  return result.tools;
}

function parseResourceUris(result: Record<string, unknown>): readonly string[] {
  const values = Array.isArray(result.resources) ? result.resources : [];
  return deepFreeze(
    unique(
      values.flatMap((value) =>
        isRecord(value) && typeof value.uri === "string" ? [value.uri] : []
      ),
    ),
  );
}

function missing(
  expected: readonly string[],
  actual: readonly string[],
): readonly string[] {
  const available = new Set(actual);
  return deepFreeze(unique(expected.filter((item) => !available.has(item))));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") return "Timed out";
  return error instanceof Error ? error.message : String(error);
}
