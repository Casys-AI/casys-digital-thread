/**
 * Narrow reopen port: exact AgentResourceReference only.
 *
 * Callers that only need existence/identity checks depend on this
 * structural type, not the concrete ReopenAgentResource class.
 */

import type { AgentResourceReference } from "../../../../domain/resource/agent-resource-capture.ts";

export interface AgentResourceExactReopener {
  reopenExact(expected: AgentResourceReference): Promise<unknown>;
}
