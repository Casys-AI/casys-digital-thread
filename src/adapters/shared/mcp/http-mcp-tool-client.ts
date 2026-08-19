import {
  StatelessMcpHttpTransport,
  StatelessMcpTransportError,
} from "./stateless-mcp-http-transport.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../../application/ports/out/mcp-tool-client.ts";

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
  readonly #http: StatelessMcpHttpTransport;

  constructor(options: HttpMcpToolClientOptions) {
    this.#http = new StatelessMcpHttpTransport(options);
  }

  async callTool(call: McpToolCall): Promise<McpToolResult> {
    const result = await this.#transport(call);
    if (isRecord(result.structuredContent)) {
      return {
        structuredContent: structuredClone(result.structuredContent),
        text: contentText(result),
      };
    }
    // structuredContent is optional in the MCP specification, and provider
    // releases move between the two shapes (mcp-syson 0.5.1 dropped it,
    // breaking every executor mid-path). Falling back to the first text item
    // parsed as a JSON object is a deterministic transport concern, not a
    // hidden heuristic: anything that is neither shape is still a hard error,
    // and every executor keeps its own fail-closed validation behind this.
    const raw = contentFirstText(result);
    if (raw !== undefined) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new McpToolCallError(
          `${call.name}: tool returned neither structuredContent nor JSON text`,
        );
      }
      if (isRecord(parsed)) {
        return { structuredContent: parsed, text: contentText(result) };
      }
    }
    throw new McpToolCallError(
      `${call.name}: tool did not return structuredContent`,
    );
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
    let result: Record<string, unknown>;
    try {
      result = await this.#http.request({
        method: "tools/call",
        label: call.name,
        name: call.name,
        params: {
          name: call.name,
          arguments: call.arguments ?? {},
        },
      });
    } catch (error) {
      if (error instanceof StatelessMcpTransportError) {
        throw new McpToolCallError(error.message);
      }
      throw error;
    }
    if (result.resultType !== "complete") {
      throw new McpToolCallError(
        `${call.name}: expected resultType \"complete\"`,
      );
    }
    if (result.isError === true) {
      throw new McpToolCallError(
        `${call.name}: ${contentText(result) || "tool reported an error"}`,
      );
    }
    return result;
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
