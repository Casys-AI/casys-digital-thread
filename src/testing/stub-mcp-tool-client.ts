import type { McpToolCall } from "../application/ports/out/mcp-tool-client.ts";

/**
 * Default implementation of callToolTextResult for test stubs.
 *
 * All production paths that need callToolTextResult (syson_constraint_solve)
 * go through HttpMcpToolClient directly. Test stubs never reach that path;
 * their operations stay in callTool(). This helper satisfies the McpToolClient
 * interface contract without polluting every stub class with boilerplate.
 *
 * If a future test actually exercises a text-result path, override the method
 * in the relevant stub instead of removing this guard.
 */
export function stubCallToolTextResult(
  call: McpToolCall,
): Promise<Record<string, unknown>> {
  return Promise.reject(
    new Error(
      `callToolTextResult is not implemented by this test stub (tool: ${call.name})`,
    ),
  );
}
