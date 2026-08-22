import { fail, type HostResult, ok } from "../host/result.ts";
import {
  CONSOLE_SNAPSHOT_TOOL_NAME,
  CONTROL_PLANE_HEALTH_URL,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_NAME,
  type ControlPlaneHealthDocument,
  type ControlPlaneLifecycleIdentity,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  type ExpectedControlPlaneIdentity,
  type ExpectedLiveControlPlaneIdentity,
  MCP_PROTOCOL_VERSION,
  PROBE_RECOVERY,
  PROBE_TIMEOUT_MS,
  type ProviderFleetStatus,
  type ProviderSnapshotObservation,
} from "./contracts.ts";
import { parseHealthDocument, parseLifecycleIdentity } from "./parse.ts";

const CLIENT_META = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "casys-digital-thread-desktop",
    version: CONTROL_PLANE_PRODUCT_VERSION,
  },
};

const FLEET_STATUSES: readonly ProviderFleetStatus[] = [
  "healthy",
  "degraded",
  "unavailable",
  "unknown",
];

export interface ControlPlaneLifecycleProbe {
  readonly health: ControlPlaneHealthDocument;
  readonly lifecycle: ControlPlaneLifecycleIdentity;
}

export function isListenerAbsent(result: HostResult<unknown>): boolean {
  return !result.ok && result.error.code === "probe.connection-refused";
}

export async function probeControlPlaneLifecycle(
  fetchImpl: typeof fetch,
  expected: ExpectedLiveControlPlaneIdentity,
  options: { readonly timeoutMs?: number } = {},
): Promise<HostResult<ControlPlaneLifecycleProbe>> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const healthResponse = await getJson(
    fetchImpl,
    CONTROL_PLANE_HEALTH_URL,
    timeoutMs,
  );
  if (!healthResponse.ok) return healthResponse;

  const health = parseHealthDocument(healthResponse.value, expected);
  if (!health.ok) return health;

  const discover = await rpc(fetchImpl, timeoutMs, 1, "server/discover", {});
  if (!discover.ok) return discover;
  const discovered = parseDiscover(discover.value, expected);
  if (!discovered.ok) return discovered;

  const listed = await rpc(fetchImpl, timeoutMs, 2, "tools/list", {});
  if (!listed.ok) return listed;
  const tools = parseToolNames(listed.value);
  if (!tools.ok) return tools;
  if (!tools.value.includes(DESKTOP_LIFECYCLE_TOOL_NAME)) {
    return fail(
      "probe.lifecycle-missing",
      "tools/list does not include the exact Desktop lifecycle tool",
      PROBE_RECOVERY,
    );
  }

  const called = await rpc(fetchImpl, timeoutMs, 3, "tools/call", {
    name: DESKTOP_LIFECYCLE_TOOL_NAME,
    arguments: {},
  }, DESKTOP_LIFECYCLE_TOOL_NAME);
  if (!called.ok) return called;
  const structured = structuredContent(called.value, DESKTOP_LIFECYCLE_TOOL_NAME);
  if (!structured.ok) return structured;
  const lifecycle = parseLifecycleIdentity(structured.value);
  if (!lifecycle.ok) return lifecycle;

  if (lifecycle.value.serverVersion !== expected.serverVersion) {
    return fail(
      "probe.lifecycle-mismatch",
      "lifecycle serverVersion does not match the expected server version",
      PROBE_RECOVERY,
    );
  }
  if (lifecycle.value.productVersion !== expected.productVersion) {
    return fail(
      "probe.lifecycle-mismatch",
      "lifecycle productVersion does not match the expected product version",
      PROBE_RECOVERY,
    );
  }
  if (lifecycle.value.configDigest !== expected.configDigest) {
    return fail(
      "probe.lifecycle-mismatch",
      "lifecycle configDigest does not match the expected digest",
      PROBE_RECOVERY,
    );
  }

  return ok(Object.freeze({
    health: health.value,
    lifecycle: lifecycle.value,
  }));
}

export async function probeConsoleSnapshot(
  fetchImpl: typeof fetch,
  options: { readonly timeoutMs?: number } = {},
): Promise<HostResult<ProviderSnapshotObservation>> {
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const called = await rpc(fetchImpl, timeoutMs, 4, "tools/call", {
    name: CONSOLE_SNAPSHOT_TOOL_NAME,
    arguments: {},
  }, CONSOLE_SNAPSHOT_TOOL_NAME);
  if (!called.ok) return called;
  const structured = structuredContent(called.value, CONSOLE_SNAPSHOT_TOOL_NAME);
  if (!structured.ok) return structured;
  return parseProviderSnapshot(structured.value);
}

export function parseProviderSnapshot(
  value: unknown,
): HostResult<ProviderSnapshotObservation> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return fail(
      "snapshot.schema-invalid",
      "console_snapshot structuredContent must be an object",
      PROBE_RECOVERY,
    );
  }
  const root = value as Record<string, unknown>;
  const fleet = asRecord(root.fleet, "snapshot.fleet");
  if (!fleet.ok) return fleet;
  const status = fleet.value.status;
  if (!isFleetStatus(status)) {
    return fail(
      "snapshot.fleet-invalid",
      "console_snapshot.fleet.status is not a known availability",
      PROBE_RECOVERY,
    );
  }
  const counts = asRecord(fleet.value.counts, "snapshot.fleet.counts");
  if (!counts.ok) return counts;
  const healthy = asCount(counts.value.healthy, "healthy");
  if (!healthy.ok) return healthy;
  const total = asCount(counts.value.total, "total");
  if (!total.ok) return total;
  const drift = asCount(counts.value.drift, "drift");
  if (!drift.ok) return drift;
  if (healthy.value > total.value || drift.value > total.value) {
    return fail(
      "snapshot.counts-invalid",
      "console_snapshot fleet healthy and drift counts must not exceed total",
      PROBE_RECOVERY,
    );
  }

  const runs = asRecord(root.runs, "snapshot.runs");
  if (!runs.ok) return runs;
  if (!Array.isArray(runs.value.items)) {
    return fail(
      "snapshot.runs-invalid",
      "console_snapshot.runs.items must be an array",
      PROBE_RECOVERY,
    );
  }
  let demoRunCount = 0;
  for (const item of runs.value.items) {
    if (isRecord(item) && item.source === "demo") demoRunCount += 1;
  }

  return ok(Object.freeze({
    fleetStatus: status,
    healthy: healthy.value,
    total: total.value,
    drift: drift.value,
    runCount: runs.value.items.length,
    demoRunCount,
  }));
}

function parseDiscover(
  result: Record<string, unknown>,
  expected: ExpectedControlPlaneIdentity,
): HostResult<true> {
  if (result.resultType !== "complete") {
    return fail(
      "probe.discover-invalid",
      'server/discover resultType must be "complete"',
      PROBE_RECOVERY,
    );
  }
  const versions = result.supportedVersions;
  if (
    !Array.isArray(versions) ||
    !versions.includes(MCP_PROTOCOL_VERSION)
  ) {
    return fail(
      "probe.discover-invalid",
      `server/discover must support MCP ${MCP_PROTOCOL_VERSION}`,
      PROBE_RECOVERY,
    );
  }
  const serverInfo = asRecord(result.serverInfo, "server/discover serverInfo");
  if (!serverInfo.ok) return serverInfo;
  if (
    serverInfo.value.name !== CONTROL_PLANE_SERVER_NAME ||
    serverInfo.value.version !== expected.serverVersion
  ) {
    return fail(
      "probe.discover-mismatch",
      "server/discover serverInfo is not the exact Desktop control-plane identity",
      PROBE_RECOVERY,
    );
  }
  return ok(true);
}

function parseToolNames(
  result: Record<string, unknown>,
): HostResult<readonly string[]> {
  if (result.resultType !== "complete") {
    return fail(
      "probe.tools-invalid",
      'tools/list resultType must be "complete"',
      PROBE_RECOVERY,
    );
  }
  if (!Array.isArray(result.tools)) {
    return fail(
      "probe.tools-invalid",
      "tools/list tools must be an array",
      PROBE_RECOVERY,
    );
  }
  const names: string[] = [];
  for (const tool of result.tools) {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      return fail(
        "probe.tools-invalid",
        "tools/list entries must have a name",
        PROBE_RECOVERY,
      );
    }
    names.push(tool.name);
  }
  return ok(Object.freeze(names));
}

function structuredContent(
  result: Record<string, unknown>,
  tool: string,
): HostResult<unknown> {
  if (result.resultType !== "complete") {
    return fail(
      "probe.tool-invalid",
      `${tool} resultType must be "complete"`,
      PROBE_RECOVERY,
    );
  }
  if (result.isError === true) {
    return fail(
      "probe.tool-invalid",
      `${tool} returned isError`,
      PROBE_RECOVERY,
    );
  }
  if (!Object.hasOwn(result, "structuredContent")) {
    return fail(
      "probe.tool-invalid",
      `${tool} did not return structuredContent`,
      PROBE_RECOVERY,
    );
  }
  return ok(result.structuredContent);
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<HostResult<unknown>> {
  const response = await request(fetchImpl, url, { method: "GET" }, timeoutMs);
  if (!response.ok) return response;
  return await parseResponseJson(response.value, "health");
}

async function rpc(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  id: number,
  method: "server/discover" | "tools/list" | "tools/call",
  params: Record<string, unknown>,
  toolName?: string,
): Promise<HostResult<Record<string, unknown>>> {
  const headers: Record<string, string> = {
    "accept": "application/json",
    "content-type": "application/json",
    "mcp-protocol-version": MCP_PROTOCOL_VERSION,
    "mcp-method": method,
  };
  if (method === "tools/call" && toolName !== undefined) {
    headers["mcp-name"] = toolName;
  }
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: { ...params, _meta: CLIENT_META },
  });
  const response = await request(fetchImpl, CONTROL_PLANE_MCP_URL, {
    method: "POST",
    headers,
    body,
  }, timeoutMs);
  if (!response.ok) return response;
  const json = await parseResponseJson(response.value, method);
  if (!json.ok) return json;
  if (!isRecord(json.value)) {
    return fail(
      "probe.rpc-invalid",
      `${method} returned a non-object JSON-RPC envelope`,
      PROBE_RECOVERY,
    );
  }
  if (json.value.jsonrpc !== "2.0") {
    return fail(
      "probe.rpc-invalid",
      `${method} jsonrpc must be "2.0"`,
      PROBE_RECOVERY,
    );
  }
  if (isRecord(json.value.error)) {
    return fail(
      "probe.rpc-invalid",
      `${method} returned a JSON-RPC error`,
      PROBE_RECOVERY,
    );
  }
  if (!isRecord(json.value.result)) {
    return fail(
      "probe.rpc-invalid",
      `${method} is missing result`,
      PROBE_RECOVERY,
    );
  }
  return ok(json.value.result);
}

async function request(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<HostResult<Response>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      return fail(
        "probe.http-status",
        `control-plane probe returned HTTP ${response.status}`,
        PROBE_RECOVERY,
      );
    }
    return ok(response);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    if (timedOut) {
      return fail(
        "probe.timeout",
        "control-plane probe timed out",
        PROBE_RECOVERY,
      );
    }
    if (isConnectionRefused(error)) {
      return fail(
        "probe.connection-refused",
        "control-plane listener refused the connection",
        PROBE_RECOVERY,
      );
    }
    return fail(
      "probe.unavailable",
      "control-plane probe failed without proving listener absence",
      PROBE_RECOVERY,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponseJson(
  response: Response,
  path: string,
): Promise<HostResult<unknown>> {
  const text = await response.text();
  try {
    return ok(JSON.parse(text) as unknown);
  } catch {
    return fail(
      "probe.rpc-invalid",
      `${path} returned invalid JSON`,
      PROBE_RECOVERY,
    );
  }
}

function asRecord(
  value: unknown,
  path: string,
): HostResult<Record<string, unknown>> {
  if (!isRecord(value)) {
    return fail(
      `${path.split(".")[0]}.schema-invalid`,
      `${path} must be an object`,
      PROBE_RECOVERY,
    );
  }
  return ok(value);
}

function asCount(value: unknown, field: string): HostResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return fail(
      "snapshot.counts-invalid",
      `console_snapshot.fleet.counts.${field} must be a non-negative integer`,
      PROBE_RECOVERY,
    );
  }
  return ok(value);
}

function isFleetStatus(value: unknown): value is ProviderFleetStatus {
  return (FLEET_STATUSES as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isConnectionRefused(error: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (error instanceof Deno.errors.ConnectionRefused) return true;
  if (
    error instanceof Error &&
    /\b(?:ECONNREFUSED|connection refused)\b/i.test(error.message)
  ) {
    return true;
  }
  if (isRecord(error)) {
    if (error.code === "ECONNREFUSED" || error.name === "ConnectionRefused") {
      return true;
    }
    if (Object.hasOwn(error, "cause")) {
      return isConnectionRefused(error.cause, depth + 1);
    }
  }
  return false;
}
