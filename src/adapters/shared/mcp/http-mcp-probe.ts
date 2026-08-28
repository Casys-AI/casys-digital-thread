import type {
  McpProbe,
  McpProbeResult,
} from "../../../application/control-plane/ports.ts";
import type { DesiredServer } from "../../../application/control-plane/read-model/fleet-manifest.ts";
import type {
  ObservedMcp,
  ObservedTool,
} from "../../../application/control-plane/read-model/fleet-observation.ts";

export type {
  McpProbe,
  McpProbeResult,
} from "../../../application/control-plane/ports.ts";

export interface HttpMcpProbeOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => Date;
  monotonicNow?: () => number;
}

interface RpcEnvelope {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

const MCP_PROTOCOL_VERSION = "2026-07-28";
const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "casys-digital-thread-console",
    version: "0.1.0",
  },
};

/**
 * Read-only stateless HTTP probe. When a published provider declares a health
 * route, it verifies that route, discovers the server, then lists its tools
 * and resources without a session or SSE stream. A provider with no health
 * route stays literally unavailable to this fleet projection.
 */
export class HttpMcpProbe implements McpProbe {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #now: () => Date;
  readonly #monotonicNow: () => number;

  constructor(options: HttpMcpProbeOptions = {}) {
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 2_000;
    this.#now = options.now ?? (() => new Date());
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async probe(server: DesiredServer): Promise<McpProbeResult> {
    const checkedAt = this.#now().toISOString();
    const startedAt = this.#monotonicNow();
    const emptyMcp = (): ObservedMcp => ({
      reachable: false,
      tools: [],
      resourceUris: [],
      viewerUris: [],
    });

    if (!server.healthUrl) {
      return {
        checkedAt,
        status: "unavailable",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        mcp: {
          ...emptyMcp(),
          error: "No provider health endpoint is declared.",
        },
        error:
          "No provider health endpoint is declared; fleet discovery is intentionally unavailable.",
      };
    }

    let healthResponse: Response;
    try {
      healthResponse = await this.#request(server.healthUrl, { method: "GET" });
    } catch (error) {
      const message = compactError(error);
      return {
        checkedAt,
        status: "unavailable",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        mcp: { ...emptyMcp(), error: message },
        error: `Health probe failed: ${message}`,
      };
    }

    if (!healthResponse.ok) {
      const message = `Health endpoint returned HTTP ${healthResponse.status}`;
      return {
        checkedAt,
        status: "unavailable",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        httpStatus: healthResponse.status,
        mcp: { ...emptyMcp(), error: message },
        error: message,
      };
    }

    try {
      const discovered = await this.#rpc(
        server.mcpUrl,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: { _meta: CLIENT_META },
        },
      );
      const discoverResult = requireCompleteResult(
        discovered.payload,
        "server/discover",
      );

      const toolsEnvelope = await this.#rpc(
        server.mcpUrl,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: { _meta: CLIENT_META },
        },
      );
      const toolsResult = requireCompleteResult(toolsEnvelope.payload, "tools/list");
      const tools = parseTools(toolsResult.tools);

      let resourceUris: string[] = [];
      try {
        const resourcesEnvelope = await this.#rpc(
          server.mcpUrl,
          {
            jsonrpc: "2.0",
            id: 3,
            method: "resources/list",
            params: { _meta: CLIENT_META },
          },
        );
        const resourcesResult = requireCompleteResult(
          resourcesEnvelope.payload,
          "resources/list",
        );
        resourceUris = parseResourceUris(resourcesResult.resources);
      } catch {
        // Resources are an optional MCP capability. Tool discovery remains a
        // successful probe when the server does not expose resources/list.
      }

      const viewerUris = unique([
        ...tools.flatMap((tool) => tool.resourceUri ? [tool.resourceUri] : []),
        ...resourceUris.filter((uri) => uri.startsWith("ui://")),
      ]);
      const serverInfo = isRecord(discoverResult.serverInfo)
        ? discoverResult.serverInfo
        : {};

      return {
        checkedAt,
        status: "healthy",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        httpStatus: healthResponse.status,
        mcp: {
          reachable: true,
          protocolVersion: MCP_PROTOCOL_VERSION,
          serverName: stringValue(serverInfo.name),
          serverVersion: stringValue(serverInfo.version),
          tools,
          resourceUris,
          viewerUris,
        },
      };
    } catch (error) {
      const message = compactError(error);
      return {
        checkedAt,
        status: "degraded",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        httpStatus: healthResponse.status,
        mcp: { ...emptyMcp(), error: message },
        error: `MCP discovery failed: ${message}`,
      };
    }
  }

  async #rpc(
    url: string,
    body: Record<string, unknown>,
  ): Promise<{ response: Response; payload: RpcEnvelope }> {
    const headers: Record<string, string> = {
      "accept": "application/json",
      "content-type": "application/json",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      "mcp-method": String(body.method),
    };
    const params = isRecord(body.params) ? body.params : {};
    if (body.method === "tools/call" && typeof params.name === "string") {
      headers["mcp-name"] = params.name;
    }

    const response = await this.#request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`MCP endpoint returned HTTP ${response.status}`);
    }
    const text = await response.text();
    return { response, payload: parseRpcBody(text) };
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      return await this.#fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseRpcBody(text: string): RpcEnvelope {
  const jsonText = text.trim();
  if (jsonText === "") throw new Error("MCP endpoint returned an empty JSON body");
  try {
    return JSON.parse(jsonText) as RpcEnvelope;
  } catch {
    throw new Error("MCP endpoint returned invalid JSON");
  }
}

function requireCompleteResult(
  envelope: RpcEnvelope,
  operation: string,
): Record<string, unknown> {
  if (envelope.error) {
    throw new Error(
      `${operation}: ${envelope.error.message ?? "JSON-RPC error"}`,
    );
  }
  if (!isRecord(envelope.result)) {
    throw new Error(`${operation}: missing result`);
  }
  if (envelope.result.resultType !== "complete") {
    throw new Error(`${operation}: expected resultType \"complete\"`);
  }
  return envelope.result;
}

function parseTools(value: unknown): ObservedTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return [];
    const meta = isRecord(entry._meta) ? entry._meta : {};
    const ui = isRecord(meta.ui) ? meta.ui : {};
    return [{
      name: entry.name,
      description: stringValue(entry.description),
      resourceUri: stringValue(ui.resourceUri),
    }];
  });
}

function parseResourceUris(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value.flatMap((entry) =>
      isRecord(entry) && typeof entry.uri === "string" ? [entry.uri] : []
    ),
  );
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

function compactError(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Timed out";
  }
  return error instanceof Error ? error.message : String(error);
}
