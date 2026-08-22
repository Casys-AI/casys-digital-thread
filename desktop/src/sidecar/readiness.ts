import {
  CONTROL_PLANE_ENDPOINT,
  CONTROL_PLANE_HEALTH_URL,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  EXACT_DISCOVER_SERVER_INFO,
  EXACT_HEALTH,
  type LifecycleIdentity,
  MCP_PROTOCOL_VERSION,
  SidecarFailure,
} from "./contracts.ts";
import { exactRecord, isRecord, parseJsonObject } from "./json.ts";

export interface ReadinessFetch {
  (input: string, init?: RequestInit): Promise<Response>;
}

const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "casys-desktop-control-plane-helper",
    version: "0.2.0",
  },
};

export async function assertControlPlaneReady(
  identity: LifecycleIdentity,
  fetchImpl: ReadinessFetch = fetch,
): Promise<void> {
  await assertExactHealth(fetchImpl);
  await assertExactDiscover(fetchImpl);
  await assertExactLifecycleIdentity(identity, fetchImpl);
}

async function assertExactHealth(fetchImpl: ReadinessFetch): Promise<void> {
  const response = await fetchImpl(CONTROL_PLANE_HEALTH_URL, { method: "GET" });
  if (!response.ok) {
    throw new SidecarFailure(
      "readiness.health-http",
      `GET /health returned HTTP ${response.status}`,
    );
  }
  const body = parseJsonObject(await response.text(), "health", "readiness.health");
  const record = exactRecord(
    body,
    ["status", "server", "version"],
    "health",
    "readiness.health",
  );
  if (
    record.status !== EXACT_HEALTH.status ||
    record.server !== EXACT_HEALTH.server ||
    record.version !== EXACT_HEALTH.version
  ) {
    throw new SidecarFailure(
      "readiness.health",
      "GET /health did not return the exact Desktop control-plane identity.",
    );
  }
}

async function assertExactDiscover(fetchImpl: ReadinessFetch): Promise<void> {
  const result = await mcpCall(fetchImpl, "server/discover", {});
  if (result.resultType !== "complete") {
    throw new SidecarFailure(
      "readiness.discover",
      "server/discover did not complete.",
    );
  }
  if (!isRecord(result.serverInfo)) {
    throw new SidecarFailure(
      "readiness.discover",
      "server/discover omitted serverInfo.",
    );
  }
  if (
    result.serverInfo.name !== EXACT_DISCOVER_SERVER_INFO.name ||
    result.serverInfo.version !== EXACT_DISCOVER_SERVER_INFO.version
  ) {
    throw new SidecarFailure(
      "readiness.discover",
      "server/discover serverInfo is not the exact Desktop control-plane identity.",
    );
  }
}

async function assertExactLifecycleIdentity(
  identity: LifecycleIdentity,
  fetchImpl: ReadinessFetch,
): Promise<void> {
  const result = await mcpCall(fetchImpl, "tools/call", {
    name: DESKTOP_LIFECYCLE_TOOL_NAME,
    arguments: {},
  });
  if (result.resultType !== "complete") {
    throw new SidecarFailure(
      "readiness.lifecycle",
      "desktop_control_plane_lifecycle did not complete.",
    );
  }
  const snapshot = result.structuredContent;
  if (!isRecord(snapshot)) {
    throw new SidecarFailure(
      "readiness.lifecycle",
      "desktop_control_plane_lifecycle omitted structuredContent.",
    );
  }
  if (
    snapshot.schema !== identity.schema ||
    snapshot.launchId !== identity.launchId ||
    snapshot.configDigest !== identity.configDigest ||
    snapshot.productVersion !== identity.productVersion ||
    snapshot.serverVersion !== identity.serverVersion
  ) {
    throw new SidecarFailure(
      "readiness.lifecycle",
      "desktop_control_plane_lifecycle identity does not match this launch.",
    );
  }
}

async function mcpCall(
  fetchImpl: ReadinessFetch,
  method: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": method,
  };
  if (method === "tools/call" && typeof params.name === "string") {
    headers["mcp-name"] = params.name;
  }
  const response = await fetchImpl(CONTROL_PLANE_ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: { ...params, _meta: CLIENT_META },
    }),
  });
  if (!response.ok) {
    throw new SidecarFailure(
      "readiness.mcp-http",
      `${method} returned HTTP ${response.status}`,
    );
  }
  const envelope = parseJsonObject(await response.text(), method, "readiness.mcp");
  if (!isRecord(envelope)) {
    throw new SidecarFailure(
      "readiness.mcp",
      `${method} returned a non-object envelope`,
    );
  }
  if (isRecord(envelope.error)) {
    throw new SidecarFailure(
      "readiness.mcp",
      `${method}: ${String(envelope.error.message ?? "JSON-RPC error")}`,
    );
  }
  if (!isRecord(envelope.result)) {
    throw new SidecarFailure("readiness.mcp", `${method} omitted result`);
  }
  return envelope.result;
}
