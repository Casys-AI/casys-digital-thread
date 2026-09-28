/**
 * Lazy per-MCP attachments for the Chat Host (#57).
 *
 * Relays and MCP runtimes start only when Desktop assigns a provider
 * endpoint (on demand), never for unused catalogue entries. A binding
 * change retargets the existing relay in place, so the agent runtime and
 * its session store survive provider restarts; release closes the relay
 * and drops the runtime. Endpoints are host-assigned: unknown ids and
 * non-loopback URLs are refused.
 */
import type { ChatRuntimeAdapter } from "../chat/runtime-port.ts";
import { chatRuntimeKey } from "../chat/runtime-port.ts";
import type { McpRelay } from "./mcp-relay.ts";

export interface McpAttachmentEndpoint {
  readonly mcpUrl: string;
  readonly healthUrl: string;
}

export interface McpAttachmentManagerOptions {
  readonly connectableIds: readonly string[];
  readonly startRelay: (upstreamMcpUrl: string) => Promise<McpRelay>;
  readonly createRuntime: (
    mcpId: string,
    relayUrl: string,
  ) => Promise<ChatRuntimeAdapter>;
  readonly registerRuntime: (key: string, adapter: ChatRuntimeAdapter) => void;
  readonly unregisterRuntime: (key: string) => void;
}

export class McpAttachmentManager {
  readonly #connectable: ReadonlySet<string>;
  readonly #startRelay: (upstreamMcpUrl: string) => Promise<McpRelay>;
  readonly #createRuntime: (
    mcpId: string,
    relayUrl: string,
  ) => Promise<ChatRuntimeAdapter>;
  readonly #registerRuntime: (key: string, adapter: ChatRuntimeAdapter) => void;
  readonly #unregisterRuntime: (key: string) => void;
  readonly #endpoints = new Map<string, McpAttachmentEndpoint>();
  readonly #relays = new Map<string, McpRelay>();
  readonly #runtimes = new Map<string, ChatRuntimeAdapter>();

  constructor(options: McpAttachmentManagerOptions) {
    this.#connectable = new Set(options.connectableIds);
    this.#startRelay = options.startRelay;
    this.#createRuntime = options.createRuntime;
    this.#registerRuntime = options.registerRuntime;
    this.#unregisterRuntime = options.unregisterRuntime;
  }

  resolve(mcpId: string): McpAttachmentEndpoint | undefined {
    return this.#endpoints.get(mcpId);
  }

  relayUrl(mcpId: string): string | undefined {
    return this.#relays.get(mcpId)?.url;
  }

  /**
   * Ensures the relay and runtime for one MCP at its assigned endpoint.
   * Idempotent: an unchanged endpoint reuses everything, a changed one
   * retargets the relay in place and keeps the runtime.
   */
  async ensure(mcpId: string, endpoint: McpAttachmentEndpoint): Promise<void> {
    this.#requireConnectable(mcpId);
    checkedEndpoint(endpoint);
    const relay = this.#relays.get(mcpId);
    if (relay === undefined) {
      const created = await this.#startRelay(endpoint.mcpUrl);
      this.#relays.set(mcpId, created);
      this.#endpoints.set(mcpId, endpoint);
      if (!this.#runtimes.has(mcpId)) {
        const runtime = await this.#createRuntime(mcpId, created.url);
        this.#runtimes.set(mcpId, runtime);
        this.#registerRuntime(chatRuntimeKey("standalone", mcpId), runtime);
      }
      return;
    }
    relay.setUpstream(endpoint.mcpUrl);
    this.#endpoints.set(mcpId, endpoint);
    if (!this.#runtimes.has(mcpId)) {
      const runtime = await this.#createRuntime(mcpId, relay.url);
      this.#runtimes.set(mcpId, runtime);
      this.#registerRuntime(chatRuntimeKey("standalone", mcpId), runtime);
    }
  }

  /**
   * Closes the relay and drops the runtime for one MCP. Sessions persist
   * on disk; the next ensure recreates both. Unknown or absent ids report
   * absent without failing.
   */
  async release(mcpId: string): Promise<"released" | "absent"> {
    const relay = this.#relays.get(mcpId);
    if (relay === undefined) return "absent";
    try {
      await relay.close();
    } finally {
      this.#relays.delete(mcpId);
      this.#endpoints.delete(mcpId);
      if (this.#runtimes.delete(mcpId)) {
        this.#unregisterRuntime(chatRuntimeKey("standalone", mcpId));
      }
    }
    return "released";
  }

  async closeAll(): Promise<void> {
    const ids = [...this.#relays.keys()];
    await Promise.allSettled(ids.map((id) => this.release(id)));
  }

  #requireConnectable(mcpId: string): void {
    if (!this.#connectable.has(mcpId)) {
      throw new Error(`MCP "${mcpId}" is not connectable.`);
    }
  }
}

function checkedEndpoint(endpoint: McpAttachmentEndpoint): void {
  for (const key of ["mcpUrl", "healthUrl"] as const) {
    const value = endpoint[key];
    if (typeof value !== "string" || value.trim() === "") {
      throw new TypeError(`Attachment ${key} must be a non-empty URL.`);
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError(`Attachment ${key} must be an absolute URL.`);
    }
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
    ) {
      throw new TypeError(`Attachment ${key} must be loopback HTTP(S).`);
    }
  }
}

export interface McpEnsureIpcPayload {
  readonly mcpId: string;
  readonly mcpUrl: string;
  readonly healthUrl: string;
}

export interface McpReleaseIpcPayload {
  readonly mcpId: string;
}

/** Strict IPC payload parsers, shared by the host entrypoint. */
export function parseMcpEnsurePayload(value: unknown): McpEnsureIpcPayload {
  const record = ipcRecord(value, "mcp.ensure");
  const mcpId = record.mcpId;
  const mcpUrl = record.mcpUrl;
  const healthUrl = record.healthUrl;
  if (typeof mcpId !== "string" || mcpId.trim() === "" || mcpId.length > 64) {
    throw new TypeError("mcp.ensure mcpId is invalid.");
  }
  if (typeof mcpUrl !== "string" || mcpUrl.length > 2048) {
    throw new TypeError("mcp.ensure mcpUrl is invalid.");
  }
  if (typeof healthUrl !== "string" || healthUrl.length > 2048) {
    throw new TypeError("mcp.ensure healthUrl is invalid.");
  }
  return { mcpId, mcpUrl, healthUrl };
}

export function parseMcpReleasePayload(value: unknown): McpReleaseIpcPayload {
  const record = ipcRecord(value, "mcp.release");
  const mcpId = record.mcpId;
  if (typeof mcpId !== "string" || mcpId.trim() === "" || mcpId.length > 64) {
    throw new TypeError("mcp.release mcpId is invalid.");
  }
  return { mcpId };
}

function ipcRecord(value: unknown, method: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${method} payload must be an object.`);
  }
  return value as Record<string, unknown>;
}
