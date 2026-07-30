import { assertEquals, assertRejects } from "@std/assert";
import {
  type ModelicaScenarioEvidence,
  ScenarioContractVerifier,
  ScenarioContractVerifierError,
} from "./scenario-contract-verifier.ts";

const PLAN_PATH = "config/verification-plans/coffee-machine-nominal-v1.json";
const PLAN_SHA256 = "2208a36ee6c2bae10422550ad032f43e7720fe25833152840bc9b80da2ed8b7d";

Deno.test("ScenarioContractVerifier evaluates the exact bound scenario with unit-bearing evidence", async () => {
  const source = await Deno.readTextFile(PLAN_PATH);
  const readPaths: string[] = [];
  const calls: Array<{ method: string; rpcMethod?: string; session?: string }> = [];
  let requestedArguments: unknown;
  const rawOutcome = {
    results: [{
      constraintId: "scenario-target-temperature-reached",
      constraintName: "Scenario target temperature reached",
      status: "pass",
      expression: "water_temperature_max >= 90 [degC]",
      margin: { value: 4, unit: "degC" },
    }],
    summary: { total: 1, pass: 1, fail: 0, error: 0, unresolved: 0 },
    resolvedValues: { water_temperature_max: { value: 94, unit: "degC" } },
  };
  const fakeFetch = (async (
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    await Promise.resolve();
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    if (method === "DELETE") {
      calls.push({ method, session: headers.get("mcp-session-id") ?? undefined });
      return new Response(null, { status: 204 });
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({
      method,
      rpcMethod: String(body.method),
      session: headers.get("mcp-session-id") ?? undefined,
    });
    if (body.method === "initialize") {
      return Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18", serverInfo: { name: "mcp-syson" } },
      }, { headers: { "mcp-session-id": "scenario-session" } });
    }
    if (body.method === "notifications/initialized") {
      return new Response(null, { status: 202 });
    }
    if (body.method === "tools/call") {
      const params = body.params as Record<string, unknown>;
      assertEquals(params.name, "syson_constraint_evaluate");
      requestedArguments = params.arguments;
      return Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { content: [{ type: "text", text: JSON.stringify(rawOutcome) }] },
      });
    }
    throw new Error(`Unexpected RPC method ${String(body.method)}`);
  }) as typeof fetch;

  const verifier = new ScenarioContractVerifier({
    planPath: PLAN_PATH,
    sysonMcpUrl: "http://127.0.0.1:3009/mcp",
    fetch: fakeFetch,
    readTextFile: (path) => {
      readPaths.push(String(path));
      return Promise.resolve(source);
    },
  });

  const result = await verifier.verify(nominalEvidence());

  assertEquals(readPaths, [PLAN_PATH]);
  assertEquals(result?.plan.path, PLAN_PATH);
  assertEquals(result?.plan.sha256, PLAN_SHA256);
  assertEquals(result?.plan.title, "CoffeeMachine nominal scenario contract");
  assertEquals(result?.plan.source, {
    kind: "versioned-modelica-scenario",
    sourcePath: "mcp-modelica/scenarios/heat-up-nominal.json",
    targetTemperature: { value: 90, unit: "degC" },
    horizon: { value: 900, unit: "s" },
  });
  assertEquals(requestedArguments, {
    constraints: [{
      id: "scenario-target-temperature-reached",
      name: "Scenario target temperature reached",
      expression: {
        kind: "binary",
        op: ">=",
        left: { kind: "ref", featurePath: ["water_temperature_max"] },
        right: { kind: "literal", value: 90, unit: "degC" },
      },
    }],
    values: { water_temperature_max: { value: 94, unit: "degC" } },
  });
  assertEquals(result?.outcome, rawOutcome);
  assertEquals(calls, [
    { method: "POST", rpcMethod: "initialize", session: undefined },
    {
      method: "POST",
      rpcMethod: "notifications/initialized",
      session: "scenario-session",
    },
    { method: "POST", rpcMethod: "tools/call", session: "scenario-session" },
    { method: "DELETE", session: "scenario-session" },
  ]);
});

Deno.test("ScenarioContractVerifier returns undefined without a SysON call when binding differs", async () => {
  let fetchCalls = 0;
  const verifier = new ScenarioContractVerifier({
    planPath: PLAN_PATH,
    sysonMcpUrl: "http://127.0.0.1:3009/mcp",
    fetch: (() => {
      fetchCalls++;
      return Promise.resolve(new Response("unexpected"));
    }) as typeof fetch,
    readTextFile: Deno.readTextFile,
  });

  const result = await verifier.verify({
    ...nominalEvidence(),
    scenario: {
      id: "heat-up-nominal",
      sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    },
  });

  assertEquals(result, undefined);
  assertEquals(fetchCalls, 0);
});

Deno.test("ScenarioContractVerifier sends initialized even when SysON does not issue a session id", async () => {
  const source = await Deno.readTextFile(PLAN_PATH);
  const calls: Array<{ rpcMethod: string; session?: string }> = [];
  const rawOutcome = { results: [], summary: { total: 0 } };
  const fakeFetch = ((
    _input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const headers = new Headers(init?.headers);
    calls.push({
      rpcMethod: String(body.method),
      session: headers.get("mcp-session-id") ?? undefined,
    });
    if (body.method === "initialize") {
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18", serverInfo: { name: "mcp-syson" } },
      }));
    }
    if (body.method === "notifications/initialized") {
      return Promise.resolve(new Response(null, { status: 202 }));
    }
    if (body.method === "tools/call") {
      return Promise.resolve(Response.json({
        jsonrpc: "2.0",
        id: 2,
        result: { structuredContent: rawOutcome },
      }));
    }
    throw new Error(`Unexpected RPC method ${String(body.method)}`);
  }) as typeof fetch;
  const verifier = new ScenarioContractVerifier({
    planPath: PLAN_PATH,
    sysonMcpUrl: "http://127.0.0.1:3009/mcp",
    fetch: fakeFetch,
    readTextFile: () => Promise.resolve(source),
  });

  const result = await verifier.verify(nominalEvidence());

  assertEquals(result?.outcome, rawOutcome);
  assertEquals(calls, [
    { rpcMethod: "initialize", session: undefined },
    { rpcMethod: "notifications/initialized", session: undefined },
    { rpcMethod: "tools/call", session: undefined },
  ]);
});

Deno.test("ScenarioContractVerifier rejects a plan that adds a product limit", async () => {
  const parsed = JSON.parse(await Deno.readTextFile(PLAN_PATH)) as {
    constraints: unknown[];
  };
  parsed.constraints.push({
    id: "invented-product-limit",
    name: "Invented product limit",
    expression: {},
  });
  let fetchCalls = 0;
  const verifier = new ScenarioContractVerifier({
    planPath: PLAN_PATH,
    sysonMcpUrl: "http://127.0.0.1:3009/mcp",
    fetch: (() => {
      fetchCalls++;
      return Promise.resolve(new Response("unexpected"));
    }) as typeof fetch,
    readTextFile: () => Promise.resolve(JSON.stringify(parsed)),
  });

  await assertRejects(
    () => verifier.verify(nominalEvidence()),
    ScenarioContractVerifierError,
    "exactly the one scenario-derived target condition",
  );
  assertEquals(fetchCalls, 0);
});

Deno.test("ScenarioContractVerifier rejects an invalid plan during startup preparation", async () => {
  let fetchCalls = 0;
  const verifier = new ScenarioContractVerifier({
    planPath: PLAN_PATH,
    sysonMcpUrl: "http://127.0.0.1:3009/mcp",
    fetch: (() => {
      fetchCalls++;
      return Promise.resolve(new Response("unexpected"));
    }) as typeof fetch,
    readTextFile: () => Promise.resolve("not valid JSON"),
  });

  await assertRejects(
    () => verifier.prepare(),
    ScenarioContractVerifierError,
    "contains invalid JSON",
  );
  assertEquals(fetchCalls, 0);
});

function nominalEvidence(): ModelicaScenarioEvidence {
  return {
    runId: "run_58ff43f8-2567-4887-96a7-5ef11ee5d4ea",
    model: {
      id: "coffee-machine-v1",
      version: "0.1.0",
      sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
    },
    scenario: {
      id: "heat-up-nominal",
      sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
    },
    metrics: {
      water_temperature_max: { value: 94, unit: "degC" },
      time_to_target_temperature: { value: 138, unit: "s" },
    },
  };
}
