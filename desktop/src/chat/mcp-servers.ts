/**
 * Connectable MCP registry for standalone chat (#49).
 *
 * Runtime-agnostic: it ships in the bundled Chat Host (Node) and runs under
 * Deno in tests. The fleet manifest stays the single source of provider
 * identity; this module validates the exact entries standalone chat may
 * attach and refuses anything else.
 *
 * Supported boundary (#49): streamable-http loopback servers declared in
 * `config/mcp-fleet.json`, Build123d pilot first. No stdio, no SSE, no
 * remote endpoint, no caller-supplied URL: `mcp.enable` names a registry
 * id, and the host owns the connection.
 */
import fleetManifest from "../../../config/mcp-fleet.json" with { type: "json" };
import { HttpMcpProbe } from "../../../src/adapters/shared/mcp/http-mcp-probe.ts";
import type { DesiredServer } from "../../../src/application/control-plane/read-model/fleet-manifest.ts";
import type { ChatMcpProbeOutcome, ChatMcpServerConfig } from "./runtime-port.ts";

/** Registry ids standalone chat may attach in this iteration. */
const CONNECTABLE_IDS = ["build123d"] as const;

export interface ChatMcpProbeOptions {
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Validates the connectable fleet entries. Throws a TypeError naming the
 * exact divergence for any unexpected entry.
 */
export function connectableMcpServers(): ChatMcpServerConfig[] {
  const servers = Array.isArray(
      (fleetManifest as { servers?: unknown }).servers,
    )
    ? (fleetManifest as { servers: unknown[] }).servers
    : [];
  return CONNECTABLE_IDS.map((id) => {
    const entry = servers.filter((server) =>
      typeof server === "object" && server !== null &&
      (server as { id?: unknown }).id === id
    );
    if (entry.length !== 1) {
      throw new TypeError(`Fleet manifest must declare exactly one "${id}" server.`);
    }
    return validatedServer(entry[0] as Record<string, unknown>);
  });
}

/**
 * Direct endpoint probe: health route, discovery, then tool listing. Used
 * before attaching, so a connection failure is reported as such and never
 * as a tool execution failure.
 */
export async function probeChatMcpServer(
  server: ChatMcpServerConfig,
  options: ChatMcpProbeOptions = {},
): Promise<ChatMcpProbeOutcome> {
  const probe = new HttpMcpProbe({
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const result = await probe.probe(desiredServer(server));
  if (result.status !== "healthy") {
    return {
      ok: false,
      error: result.error ?? result.mcp.error ?? "MCP server is unreachable.",
    };
  }
  const names = result.mcp.tools.map((tool) => tool.name);
  const missing = server.expectedTools.filter((tool) => !names.includes(tool));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Server is healthy but misses expected tools: ${missing.join(", ")}.`,
    };
  }
  return { ok: true, tools: names };
}

function validatedServer(server: Record<string, unknown>): ChatMcpServerConfig {
  const id = stringField(server, "id");
  if (server.transport !== "streamable-http") {
    throw new TypeError(`Fleet ${id} transport must be streamable-http.`);
  }
  const mcpUrl = loopbackHttpUrl(stringField(server, "mcpUrl"), id, "mcpUrl");
  const healthUrl = loopbackHttpUrl(stringField(server, "healthUrl"), id, "healthUrl");
  const expectedTools = server.expectedTools;
  if (
    !Array.isArray(expectedTools) || expectedTools.length === 0 ||
    !expectedTools.every((tool): tool is string => typeof tool === "string")
  ) {
    throw new TypeError(`Fleet ${id} must declare non-empty expectedTools.`);
  }
  return {
    id,
    displayName: stringField(server, "displayName"),
    description: stringField(server, "role"),
    transport: "streamable-http",
    mcpUrl,
    healthUrl,
    expectedTools,
    expectedViews: expectedViews(server, id),
  };
}

function expectedViews(
  server: Record<string, unknown>,
  id: string,
): readonly string[] {
  const views = server.expectedViews;
  if (views === undefined) return [];
  if (
    !Array.isArray(views) ||
    !views.every((view): view is string =>
      typeof view === "string" && isViewerUiUri(view)
    )
  ) {
    throw new TypeError(
      `Fleet ${id} expectedViews must be an array of ui:// view URIs.`,
    );
  }
  return [...views];
}

function isViewerUiUri(value: string): boolean {
  if (
    !value.startsWith("ui://") || value.length > 500 || /\s/.test(value)
  ) return false;
  const rest = value.slice("ui://".length);
  const slash = rest.indexOf("/");
  return slash > 0 && slash < rest.length - 1;
}

function desiredServer(server: ChatMcpServerConfig): DesiredServer {
  return {
    id: server.id,
    displayName: server.displayName,
    role: server.description,
    serviceName: server.id,
    transport: "streamable-http",
    mcpUrl: server.mcpUrl,
    healthUrl: server.healthUrl,
    image: "",
    required: true,
    expectedTools: [...server.expectedTools],
  };
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Fleet chat MCP entry must declare ${key}.`);
  }
  return value;
}

function loopbackHttpUrl(value: string, id: string, key: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Fleet ${id} ${key} must be an absolute URL.`);
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new TypeError(`Fleet ${id} ${key} must be loopback HTTP(S).`);
  }
  return url.href;
}
