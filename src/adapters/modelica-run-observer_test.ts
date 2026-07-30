import { assertEquals } from "@std/assert";
import { ModelicaRunObserver } from "./modelica-run-observer.ts";

Deno.test("ModelicaRunObserver reads persisted evidence through MCP and keeps execution separate from verdict", async () => {
  const toolCalls: string[] = [];
  const closedSessions: string[] = [];
  let sessionNumber = 0;
  const fakeFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method === "DELETE") {
      closedSessions.push(headers.get("mcp-session-id") ?? "");
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "initialize") {
      sessionNumber++;
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2025-06-18",
          serverInfo: { name: "mcp-modelica", version: "0.1.5" },
        },
      }, { headers: { "mcp-session-id": "session-" + sessionNumber } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/call") {
      const tool = body.params.name;
      toolCalls.push(tool);
      const payload = tool === "modelica_run_list" ? [summary()] : detail();
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: {
          content: [{ type: "text", text: JSON.stringify(payload) }],
        },
      });
    }
    throw new Error("Unexpected MCP method " + body.method);
  }) as typeof fetch;

  const observer = new ModelicaRunObserver({
    mcpUrl: "http://127.0.0.1:3016/mcp",
    fetch: fakeFetch,
  });
  const listed = await observer.list();
  const loaded = await observer.detail(listed[0].id);

  assertEquals(toolCalls, ["modelica_run_list", "modelica_run_get"]);
  assertEquals(closedSessions, ["session-1", "session-2"]);
  assertEquals(listed, [{
    id: "modelica:run_123",
    name: "coffee-machine-v1 / heat-up-nominal",
    subject: "Modelica 1.0.0",
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    startedAt: "2026-07-30T12:00:00.000Z",
    completedAt: "2026-07-30T12:00:04.000Z",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
  }]);
  assertEquals(loaded?.status, "succeeded");
  assertEquals(loaded?.verdictStatus, "not_evaluated");
  assertEquals(loaded?.modelicaEvidence, {
    runId: "run_123",
    fingerprint: "fingerprint-123",
    model: {
      id: "coffee-machine-v1",
      version: "1.0.0",
      sha256: "model-sha",
    },
    scenario: { id: "heat-up-nominal", sha256: "scenario-sha" },
  });
  assertEquals(loaded?.measurements, [{
    id: "water_temperature_max",
    label: "Maximum water temperature",
    value: { value: 94, unit: "degC", display: "94 degC" },
  }]);
  assertEquals(loaded?.evidence[0], {
    id: "modelica:run_123:0:result",
    kind: "result",
    label: "Simulation result",
    path: "casys://modelica/runs/run_123/result.csv",
    sha256: "abc123",
    bytes: 42,
    producedBy: "mcp-modelica",
  });
});

Deno.test("ModelicaRunObserver preserves missing legacy timing rather than inventing it", async () => {
  const fakeFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    if (method === "DELETE") return new Response(null, { status: 204 });
    const body = JSON.parse(String(init?.body ?? "{}"));
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {},
      }, { headers: { "mcp-session-id": "legacy-session" } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: 2,
      result: {
        content: [{ type: "text", text: JSON.stringify([legacySummary()]) }],
      },
    });
  }) as typeof fetch;
  const observer = new ModelicaRunObserver({
    mcpUrl: "http://127.0.0.1:3016/mcp",
    fetch: fakeFetch,
  });

  assertEquals(await observer.list(), [{
    id: "modelica:run_legacy",
    name: "coffee-machine-v1 / heat-up-nominal",
    subject: "Modelica 1.0.0",
    status: "succeeded",
    verdictStatus: "not_evaluated",
    source: "observed",
    startedAt: undefined,
    completedAt: undefined,
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
  }]);
});

function summary(): Record<string, unknown> {
  return {
    run_id: "run_123",
    status: "succeeded",
    started_at: "2026-07-30T12:00:00.000Z",
    completed_at: "2026-07-30T12:00:04.000Z",
    fingerprint: "fingerprint-123",
    model: {
      id: "coffee-machine-v1",
      version: "1.0.0",
      sha256: "model-sha",
    },
    scenario: { id: "heat-up-nominal", sha256: "scenario-sha" },
  };
}

function legacySummary(): Record<string, unknown> {
  const value = summary();
  delete value.started_at;
  delete value.completed_at;
  value.run_id = "run_legacy";
  return value;
}

function detail(): Record<string, unknown> {
  return {
    ...summary(),
    engine: {
      name: "OpenModelica",
      version: "1.27.0",
      msl_version: "4.1.0",
    },
    resolved_parameters: {
      heater_power: { value: 1500, unit: "W" },
    },
    metrics: {
      water_temperature_max: { value: 94, unit: "degC" },
    },
    artifacts: [{
      kind: "result",
      uri: "casys://modelica/runs/run_123/result.csv",
      sha256: "abc123",
      bytes: 42,
    }],
    warnings: [],
  };
}
