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
  /**
   * Variant for tools that serialise their result as JSON text in
   * content[0].text rather than in structuredContent (e.g. syson_constraint_solve).
   * Uses the same stateless-2026-07-28 transport as callTool.
   */
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>>;
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
    const result = await this.#transport(call);
    if (!isRecord(result.structuredContent)) {
      throw new McpToolCallError(
        `${call.name}: tool did not return structuredContent`,
      );
    }
    return {
      structuredContent: structuredClone(result.structuredContent),
      text: contentText(result),
    };
  }

  /**
   * Reads content[0].text and parses it as JSON.
   *
   * This method exists because some MCP tools — notably syson_constraint_solve
   * — never emit structuredContent; they serialise their result as a JSON
   * string inside the first text content item. Routing those tools through
   * callTool() would always raise "did not return structuredContent", making
   * them unreachable. callToolTextResult() uses the identical transport so
   * all stateless-protocol guarantees (headers, _meta, timeout, error
   * propagation) remain in force.
   */
  async callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    const result = await this.#transport(call);
    const raw = contentFirstText(result);
    if (raw === undefined) {
      throw new McpToolCallError(
        `${call.name}: tool returned no content[0].text`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new McpToolCallError(
        `${call.name}: content[0].text is not valid JSON`,
      );
    }
    if (!isRecord(parsed)) {
      throw new McpToolCallError(
        `${call.name}: content[0].text did not parse to an object`,
      );
    }
    return parsed;
  }

  /**
   * Shared transport: stateless-2026-07-28 headers + _meta, timeout guard,
   * HTTP status check, JSON-RPC envelope validation, and isError propagation.
   * Returns the validated result record so each public method can apply its
   * own content-extraction rule without duplicating the wire protocol.
   */
  async #transport(call: McpToolCall): Promise<Record<string, unknown>> {
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
    return payload.result;
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

/** Returns content[0].text only when the first item is a text block. */
function contentFirstText(result: Record<string, unknown>): string | undefined {
  if (!Array.isArray(result.content) || result.content.length === 0) {
    return undefined;
  }
  const first = result.content[0];
  if (isRecord(first) && first.type === "text" && typeof first.text === "string") {
    return first.text;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
