import type {
  Availability,
  DesiredServer,
  IsoDateTime,
  ObservedMcp,
  ObservedTool,
} from "../domain/types.ts";

export interface McpProbeResult {
  checkedAt: IsoDateTime;
  status: Availability;
  latencyMs?: number;
  httpStatus?: number;
  mcp: ObservedMcp;
  error?: string;
}

export interface McpProbe {
  probe(server: DesiredServer): Promise<McpProbeResult>;
}

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

const MCP_PROTOCOL_VERSION = "2025-06-18";

/**
 * Read-only HTTP probe. It verifies the normal health route, opens a short MCP
 * session, discovers tools/resources, then closes only that probe session.
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

    let sessionId: string | undefined;
    try {
      const initialized = await this.#rpc(
        server.mcpUrl,
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: {
              name: "casys-digital-thread-console",
              version: "0.1.0",
            },
          },
        },
      );
      sessionId = initialized.response.headers.get("mcp-session-id") ??
        undefined;
      const initializeResult = requireResult(
        initialized.payload,
        "initialize",
      );

      if (sessionId) {
        await this.#rpc(
          server.mcpUrl,
          {
            jsonrpc: "2.0",
            method: "notifications/initialized",
          },
          sessionId,
          true,
        );
      }

      const toolsEnvelope = await this.#rpc(
        server.mcpUrl,
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
          params: {},
        },
        sessionId,
      );
      const toolsResult = requireResult(toolsEnvelope.payload, "tools/list");
      const tools = parseTools(toolsResult.tools);

      let resourceUris: string[] = [];
      try {
        const resourcesEnvelope = await this.#rpc(
          server.mcpUrl,
          {
            jsonrpc: "2.0",
            id: 3,
            method: "resources/list",
            params: {},
          },
          sessionId,
        );
        const resourcesResult = requireResult(
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
      const serverInfo = isRecord(initializeResult.serverInfo)
        ? initializeResult.serverInfo
        : {};

      return {
        checkedAt,
        status: "healthy",
        latencyMs: elapsed(this.#monotonicNow(), startedAt),
        httpStatus: healthResponse.status,
        mcp: {
          reachable: true,
          protocolVersion: stringValue(initializeResult.protocolVersion),
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
    } finally {
      if (sessionId) {
        await this.#closeSession(server.mcpUrl, sessionId);
      }
    }
  }

  async #rpc(
    url: string,
    body: Record<string, unknown>,
    sessionId?: string,
    allowEmpty = false,
  ): Promise<{ response: Response; payload: RpcEnvelope }> {
    const headers: Record<string, string> = {
      "accept": "application/json, text/event-stream",
      "content-type": "application/json",
    };
    if (sessionId) headers["mcp-session-id"] = sessionId;

    const response = await this.#request(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`MCP endpoint returned HTTP ${response.status}`);
    }
    const text = await response.text();
    if (allowEmpty && text.trim() === "") {
      return { response, payload: {} };
    }
    return { response, payload: parseRpcBody(text, response.headers) };
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

  async #closeSession(url: string, sessionId: string): Promise<void> {
    try {
      await this.#request(url, {
        method: "DELETE",
        headers: { "mcp-session-id": sessionId },
      });
    } catch {
      // Best-effort session cleanup must never change the probe result.
    }
  }
}

function parseRpcBody(text: string, headers: Headers): RpcEnvelope {
  const contentType = headers.get("content-type") ?? "";
  let jsonText = text.trim();
  if (contentType.includes("text/event-stream") || jsonText.startsWith("event:")) {
    const data = jsonText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .find((line) => line.length > 0);
    if (!data) throw new Error("MCP endpoint returned an empty event stream");
    jsonText = data;
  }
  if (jsonText === "") return {};
  try {
    return JSON.parse(jsonText) as RpcEnvelope;
  } catch {
    throw new Error("MCP endpoint returned invalid JSON");
  }
}

function requireResult(
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
  return envelope.result;
}

function parseTools(value: unknown): ObservedTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== "string") return [];
    const meta = isRecord(entry._meta) ? entry._meta : {};
    const ui = isRecord(meta.ui) ? meta.ui : {};
    const legacyUri = stringValue(meta["ui/resourceUri"]);
    return [{
      name: entry.name,
      description: stringValue(entry.description),
      resourceUri: stringValue(ui.resourceUri) ?? legacyUri,
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
