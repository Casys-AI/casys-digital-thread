import { assertEquals } from "jsr:@std/assert@1.0.14";
import {
  CONSOLE_SNAPSHOT_TOOL_NAME,
  CONTROL_PLANE_HEALTH_URL,
  CONTROL_PLANE_LIFECYCLE_SCHEMA,
  CONTROL_PLANE_MCP_URL,
  CONTROL_PLANE_PRODUCT_VERSION,
  CONTROL_PLANE_SERVER_VERSION,
  DESKTOP_LIFECYCLE_TOOL_NAME,
  MCP_PROTOCOL_VERSION,
} from "./contracts.ts";
import {
  parseProviderSnapshot,
  probeConsoleSnapshot,
  probeControlPlaneLifecycle,
} from "./probes.ts";

const DIGEST =
  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const LAUNCH_ID = "11111111-1111-4111-8111-111111111111";
const EXPECTED = {
  productIdentifier: "ai.casys.digital-thread" as const,
  productVersion: CONTROL_PLANE_PRODUCT_VERSION,
  serverName: "casys-digital-thread-console" as const,
  serverVersion: CONTROL_PLANE_SERVER_VERSION,
  configDigest: DIGEST,
};

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

function assertFailed(
  result: { ok: boolean; error?: { code: string } },
  code: string,
) {
  if (result.ok) throw new Error(`expected failure ${code}, got ok`);
  assertEquals(result.error?.code, code);
}

Deno.test("probeControlPlaneLifecycle requires exact health, discover, and lifecycle identity", async () => {
  const calls: Captured[] = [];
  const fetchImpl = fakeFetch(calls, {
    health: {
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    discover: discoverResult(),
    tools: [DESKTOP_LIFECYCLE_TOOL_NAME, CONSOLE_SNAPSHOT_TOOL_NAME],
    lifecycle: lifecycleIdentity(),
  });

  const result = await probeControlPlaneLifecycle(fetchImpl, EXPECTED);
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(result.value.lifecycle.launchId, LAUNCH_ID);
  assertEquals(result.value.health.server, "casys-digital-thread-console");
  assertEquals(calls.map((call) => `${call.method} ${call.url}`), [
    `GET ${CONTROL_PLANE_HEALTH_URL}`,
    `POST ${CONTROL_PLANE_MCP_URL}`,
    `POST ${CONTROL_PLANE_MCP_URL}`,
    `POST ${CONTROL_PLANE_MCP_URL}`,
  ]);
  assertEquals(calls[1]?.body?.method, "server/discover");
  assertEquals(calls[2]?.body?.method, "tools/list");
  assertEquals(calls[3]?.body?.method, "tools/call");
  assertEquals(calls[3]?.headers["mcp-name"], DESKTOP_LIFECYCLE_TOOL_NAME);
  assertEquals(calls[1]?.headers["mcp-protocol-version"], MCP_PROTOCOL_VERSION);
  assertEquals(calls.every((call) => !call.url.includes("localhost")), true);
});

Deno.test("probeControlPlaneLifecycle fails closed when name and version match but digest does not", async () => {
  const fetchImpl = fakeFetch([], {
    health: {
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    discover: discoverResult(),
    tools: [DESKTOP_LIFECYCLE_TOOL_NAME],
    lifecycle: {
      ...lifecycleIdentity(),
      configDigest:
        "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
  });
  const result = await probeControlPlaneLifecycle(fetchImpl, EXPECTED);
  assertFailed(result, "probe.lifecycle-mismatch");
});

Deno.test("probeControlPlaneLifecycle proves absence only on connection refusal", async () => {
  const fetchImpl =
    (() => Promise.reject(new TypeError("connection refused"))) as typeof fetch;
  const result = await probeControlPlaneLifecycle(fetchImpl, EXPECTED);
  assertFailed(result, "probe.connection-refused");
});

Deno.test("probeControlPlaneLifecycle keeps timeout and other network failures ambiguous", async () => {
  const timeout =
    (() => Promise.reject(new DOMException("aborted", "AbortError"))) as typeof fetch;
  assertFailed(
    await probeControlPlaneLifecycle(timeout, EXPECTED),
    "probe.timeout",
  );

  const network =
    (() => Promise.reject(new TypeError("network changed"))) as typeof fetch;
  assertFailed(
    await probeControlPlaneLifecycle(network, EXPECTED),
    "probe.unavailable",
  );
});

Deno.test("probeControlPlaneLifecycle rejects a foreign server/discover identity", async () => {
  const fetchImpl = fakeFetch([], {
    health: {
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    discover: {
      resultType: "complete",
      supportedVersions: [MCP_PROTOCOL_VERSION],
      serverInfo: { name: "other-console", version: CONTROL_PLANE_SERVER_VERSION },
      capabilities: {},
    },
    tools: [DESKTOP_LIFECYCLE_TOOL_NAME],
    lifecycle: lifecycleIdentity(),
  });
  const result = await probeControlPlaneLifecycle(fetchImpl, EXPECTED);
  assertFailed(result, "probe.discover-mismatch");
});

Deno.test("probeControlPlaneLifecycle rejects tools/list without the Desktop lifecycle tool", async () => {
  const fetchImpl = fakeFetch([], {
    health: {
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    discover: discoverResult(),
    tools: [CONSOLE_SNAPSHOT_TOOL_NAME],
    lifecycle: lifecycleIdentity(),
  });
  const result = await probeControlPlaneLifecycle(fetchImpl, EXPECTED);
  assertFailed(result, "probe.lifecycle-missing");
});

Deno.test("parseProviderSnapshot keeps fleet counts and never copies endpoints", () => {
  const result = parseProviderSnapshot({
    schemaVersion: "2.0",
    fleet: {
      status: "unavailable",
      counts: {
        total: 3,
        healthy: 0,
        degraded: 0,
        unavailable: 3,
        unknown: 0,
        drift: 0,
      },
      servers: [{
        id: "syson",
        desired: { mcpUrl: "http://127.0.0.1:3009/mcp" },
      }],
    },
    runs: { items: [{ id: "demo-1", source: "demo" }] },
  });
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(result.value, {
    fleetStatus: "unavailable",
    healthy: 0,
    total: 3,
    drift: 0,
    runCount: 1,
    demoRunCount: 1,
  });
  assertEquals("servers" in result.value, false);
});

Deno.test("probeConsoleSnapshot reads structuredContent only", async () => {
  const calls: Captured[] = [];
  const fetchImpl = fakeFetch(calls, {
    health: {
      status: "ok",
      server: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    discover: discoverResult(),
    tools: [CONSOLE_SNAPSHOT_TOOL_NAME],
    snapshot: {
      fleet: {
        status: "healthy",
        counts: {
          total: 1,
          healthy: 1,
          degraded: 0,
          unavailable: 0,
          unknown: 0,
          drift: 0,
        },
      },
      runs: { items: [] },
    },
  });
  const result = await probeConsoleSnapshot(fetchImpl);
  if (!result.ok) throw new Error(result.error.message);
  assertEquals(result.value.fleetStatus, "healthy");
  assertEquals(calls[0]?.body?.method, "tools/call");
  assertEquals(calls[0]?.headers["mcp-name"], CONSOLE_SNAPSHOT_TOOL_NAME);
});

function lifecycleIdentity() {
  return {
    schema: CONTROL_PLANE_LIFECYCLE_SCHEMA,
    productVersion: CONTROL_PLANE_PRODUCT_VERSION,
    serverVersion: CONTROL_PLANE_SERVER_VERSION,
    launchId: LAUNCH_ID,
    configDigest: DIGEST,
  };
}

function discoverResult() {
  return {
    resultType: "complete",
    supportedVersions: [MCP_PROTOCOL_VERSION],
    serverInfo: {
      name: "casys-digital-thread-console",
      version: CONTROL_PLANE_SERVER_VERSION,
    },
    capabilities: { tools: {} },
    instructions: "fleet console",
  };
}

function fakeFetch(
  calls: Captured[],
  script: {
    health: Record<string, unknown>;
    discover: Record<string, unknown>;
    tools: string[];
    lifecycle?: Record<string, unknown>;
    snapshot?: Record<string, unknown>;
  },
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const body = method === "POST"
      ? JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      : undefined;
    calls.push({ url, method, headers, body });
    if (url === CONTROL_PLANE_HEALTH_URL && method === "GET") {
      return Promise.resolve(Response.json(script.health));
    }
    if (url !== CONTROL_PLANE_MCP_URL || method !== "POST") {
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    if (body?.method === "server/discover") {
      return Promise.resolve(rpc(1, script.discover));
    }
    if (body?.method === "tools/list") {
      return Promise.resolve(rpc(2, {
        resultType: "complete",
        tools: script.tools.map((name) => ({ name })),
      }));
    }
    if (body?.method === "tools/call") {
      const params = body.params as Record<string, unknown>;
      if (params.name === DESKTOP_LIFECYCLE_TOOL_NAME && script.lifecycle) {
        return Promise.resolve(rpc(3, {
          resultType: "complete",
          structuredContent: script.lifecycle,
        }));
      }
      if (params.name === CONSOLE_SNAPSHOT_TOOL_NAME && script.snapshot) {
        return Promise.resolve(rpc(4, {
          resultType: "complete",
          structuredContent: script.snapshot,
        }));
      }
    }
    return Promise.resolve(new Response("unexpected", { status: 500 }));
  }) as typeof fetch;
}

function rpc(id: number, result: Record<string, unknown>): Response {
  return Response.json({ jsonrpc: "2.0", id, result });
}
