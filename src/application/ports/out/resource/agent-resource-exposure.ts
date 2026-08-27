/**
 * Read-only MCP resource publication of a captured object.
 *
 * Application code never talks to McpApp. The adapter registers
 * `resources/read` handlers and attests size + MIME.
 */

import type { AgentResourceReference } from "../../../../domain/resource/agent-resource-capture.ts";

export interface AgentResourceExposure {
  expose(reference: AgentResourceReference): Promise<void>;
  restore(): Promise<void>;
}
