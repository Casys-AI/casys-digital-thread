/**
 * Process-local locator for a lease-bound Capability Runtime publication.
 *
 * The handle is opaque: it carries no URL, hostname, port, bearer, provider,
 * tool name or arguments. The broker locates only. It does not start, stop,
 * qualify, health-check, retry, pool or supervise a runtime.
 */

import type { CapabilityRuntimeLaunchGroupReference } from "../../../../domain/capability/runtime/capability-runtime-launch-group.ts";
import type { CapabilityRuntimeLease } from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { McpToolClient } from "../mcp-tool-client.ts";

declare const capabilityRuntimeConnectionHandleBrand: unique symbol;

/** Process-local connection fact. Never persist, clone, or serialize. */
export interface CapabilityRuntimeConnectionHandle {
  readonly [capabilityRuntimeConnectionHandleBrand]: true;
}

export class CapabilityRuntimeConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityRuntimeConnectionError";
  }
}

export interface CapabilityRuntimeConnectionRequest {
  readonly lease: CapabilityRuntimeLease;
  readonly binding: { readonly id: string; readonly version: string };
  readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
}

export interface CapabilityRuntimeConnectionBroker {
  connect(
    request: CapabilityRuntimeConnectionRequest,
  ): Promise<CapabilityRuntimeConnectionHandle>;
}

/**
 * Opens a no-retry MCP client from an exact handle. The caller never names the
 * publication. Construction is process-local and must fail closed.
 */
export interface CapabilityRuntimeMcpClientOpener {
  open(handle: CapabilityRuntimeConnectionHandle): Promise<McpToolClient>;
}

/** Composition-owned pair: locate a handle, then open the bound client. */
export interface CapabilityRuntimeBoundMcpClient {
  readonly broker: CapabilityRuntimeConnectionBroker;
  readonly openMcpClient: CapabilityRuntimeMcpClientOpener["open"];
}
