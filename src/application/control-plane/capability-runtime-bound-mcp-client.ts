/**
 * Control-plane operation: one sealed ROP plus one session lease open the
 * exact persistent-Compose MCP client.
 *
 * Executors never name a URL, host, port, bearer, provider or tool envelope.
 * This is not a registry, gateway, pool, retry policy, or approval object.
 */

import type { McpToolClient } from "../ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeBoundMcpClient } from "../ports/out/capability/capability-runtime-connection.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeExecutionSession } from "./capability-runtime-execution-session.ts";
import { requiredQualifiedPersistentComposePublication } from "./capability-runtime-persistent-compose-publication.ts";

export async function openLeaseBoundCapabilityRuntimeMcpClient(input: {
  readonly connection: CapabilityRuntimeBoundMcpClient;
  readonly session: CapabilityRuntimeExecutionSession;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
}): Promise<McpToolClient> {
  const publication = requiredQualifiedPersistentComposePublication(
    input.operationalCapability,
  );
  const handle = await input.connection.broker.connect({
    lease: input.session.lease,
    binding: publication.binding,
    launchGroup: publication.launchGroup,
  });
  return await input.connection.openMcpClient(handle);
}
