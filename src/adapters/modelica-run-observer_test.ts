import { assertEquals, assertRejects } from "@std/assert";
import {
  ModelicaRunObserver,
  ModelicaRunObserverError,
} from "./modelica-run-observer.ts";

Deno.test("ModelicaRunObserver reads exact v1 envelopes over stateless MCP", async () => {
  const toolCalls: string[] = [];
  const fakeFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}"));
    assertEquals(headers.get("mcp-protocol-version"), "2026-07-28");
    assertEquals(headers.get("mcp-method"), "tools/call");
    assertEquals(headers.get("mcp-name"), body.params.name);
    assertEquals(headers.get("mcp-session-id"), null);
    assertEquals(
      body.params._meta["io.modelcontextprotocol/protocolVersion"],
      "2026-07-28",
    );
    if (body.method === "tools/call") {
      const tool = body.params.name;
      toolCalls.push(tool);
      const structuredContent = tool === "modelica_run_list"
        ? { schemaVersion: "1.0", kind: "run-list", runs: [summary()] }
        : { schemaVersion: "1.0", kind: "run", run: detail() };
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          structuredContent,
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

Deno.test("ModelicaRunObserver rejects a legacy text result without the v1 envelope", async () => {
  const fakeFetch = (async (
    _input: string | URL | Request,
    _init?: RequestInit,
  ) => {
    await Promise.resolve();
    return Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: {
        resultType: "complete",
        content: [{ type: "text", text: JSON.stringify([legacySummary()]) }],
      },
    });
  }) as typeof fetch;
  const observer = new ModelicaRunObserver({
    mcpUrl: "http://127.0.0.1:3016/mcp",
    fetch: fakeFetch,
  });

  await assertRejects(
    () => observer.list(),
    ModelicaRunObserverError,
    "structuredContent must be an object",
  );
});

Deno.test("ModelicaRunObserver rejects a v1 envelope with the wrong kind", async () => {
  const observer = new ModelicaRunObserver({
    mcpUrl: "http://127.0.0.1:3016/mcp",
    fetch: (() =>
      Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: {
          resultType: "complete",
          structuredContent: { schemaVersion: "1.0", kind: "run", run: detail() },
        },
      }))) as typeof fetch,
  });

  await assertRejects(
    () => observer.list(),
    ModelicaRunObserverError,
    "unsupported v1 run-list envelope",
  );
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
