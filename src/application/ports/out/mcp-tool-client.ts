/** A provider-neutral MCP tool invocation issued by an application workflow. */
export interface McpToolCall {
  readonly name: string;
  readonly arguments?: Readonly<Record<string, unknown>>;
}

/** Normalized MCP tool result consumed by the application and its executors. */
export interface McpToolResult {
  /** Machine-readable result used by the digital-thread orchestrator. */
  readonly structuredContent: Readonly<Record<string, unknown>>;
  /** Optional human-readable summary returned by the provider tool. */
  readonly text: string;
}

/**
 * Outbound port for one no-retry MCP tool call.
 *
 * Tool identity and arguments remain server-owned. Concrete transports live in
 * adapters; callers depend only on this capability contract.
 */
export interface McpToolClient {
  callTool(call: McpToolCall): Promise<McpToolResult>;
  /**
   * Variant for tools that serialize their result as JSON text rather than in
   * structured content. It remains explicit so callers cannot silently guess
   * a provider response shape.
   */
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>>;
}
