const MCP_PROTOCOL_VERSION = "2026-07-28";

const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "casys-digital-thread-orchestrator",
    version: "0.1.0",
  },
};

export interface McpToolCall {
  name: string;
  arguments?: Readonly<Record<string, unknown>>;
}

export interface McpToolResult {
  /** Machine-readable result used by the digital-thread orchestrator. */
  structuredContent: Readonly<Record<string, unknown>>;
  /** Optional human-readable summary returned by the provider tool. */
  text: string;
}

export interface McpToolClient {
  callTool(call: McpToolCall): Promise<McpToolResult>;
}

export interface HttpMcpToolClientOptions {
  mcpUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class McpToolCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolCallError";
  }
}

/**
 * Backend-only client for the fleet's stateless Streamable HTTP endpoints.
 *
 * It deliberately exposes only tools/call. The browser never receives MCP
 * credentials or service URLs, and this class never retries a call: an
 * engineering computation may be expensive or have durable side effects.
 */
export class HttpMcpToolClient implements McpToolClient {
  readonly #mcpUrl: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  #nextRequestId = 1;

  constructor(options: HttpMcpToolClientOptions) {
    if (options.mcpUrl.trim() === "") {
      throw new TypeError("mcpUrl must be a non-empty URL");
    }
    this.#mcpUrl = options.mcpUrl;
    this.#fetch = options.fetch ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(this.#timeoutMs) || this.#timeoutMs < 1) {
      throw new TypeError("timeoutMs must be a positive integer");
    }
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    if (call.name.trim() === "") {
      throw new TypeError("tool name must be a non-empty string");
    }
    const requestId = this.#nextRequestId++;
    const body = {
      jsonrpc: "2.0",
      id: requestId,
      method: "tools/call",
      params: {
        _meta: CLIENT_META,
        name: call.name,
        arguments: call.arguments ?? {},
      },
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetch(this.#mcpUrl, {
        method: "POST",
        headers: {
          "accept": "application/json",
          "content-type": "application/json",
          "mcp-protocol-version": MCP_PROTOCOL_VERSION,
          "mcp-method": "tools/call",
          "mcp-name": call.name,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new McpToolCallError(
          `${call.name}: MCP tool call timed out after ${this.#timeoutMs}ms`,
        );
      }
      throw new McpToolCallError(
        `${call.name}: MCP request failed: ${errorMessage(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new McpToolCallError(
        `${call.name}: MCP endpoint returned HTTP ${response.status}`,
      );
    }
    const payload = await parseEnvelope(response, call.name);
    if (payload.error) {
      throw new McpToolCallError(
        `${call.name}: ${payload.error.message ?? "JSON-RPC error"}`,
      );
    }
    if (!isRecord(payload.result)) {
      throw new McpToolCallError(`${call.name}: missing result`);
    }
    if (payload.result.resultType !== "complete") {
      throw new McpToolCallError(
        `${call.name}: expected resultType \"complete\"`,
      );
    }
    if (payload.result.isError === true) {
      throw new McpToolCallError(
        `${call.name}: ${contentText(payload.result) || "tool reported an error"}`,
      );
    }
    if (!isRecord(payload.result.structuredContent)) {
      throw new McpToolCallError(
        `${call.name}: tool did not return structuredContent`,
      );
    }
    return {
      structuredContent: structuredClone(payload.result.structuredContent),
      text: contentText(payload.result),
    };
  }
}

interface RpcEnvelope {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

async function parseEnvelope(
  response: Response,
  toolName: string,
): Promise<RpcEnvelope> {
  const text = (await response.text()).trim();
  if (text === "") {
    throw new McpToolCallError(`${toolName}: MCP endpoint returned an empty body`);
  }
  try {
    return JSON.parse(text) as RpcEnvelope;
  } catch {
    throw new McpToolCallError(`${toolName}: MCP endpoint returned invalid JSON`);
  }
}

function contentText(result: Record<string, unknown>): string {
  if (!Array.isArray(result.content)) return "";
  return result.content.flatMap((item) =>
    isRecord(item) && item.type === "text" && typeof item.text === "string"
      ? [item.text]
      : []
  ).join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
