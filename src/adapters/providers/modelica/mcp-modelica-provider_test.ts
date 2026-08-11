import { assertEquals, assertRejects } from "@std/assert";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import type { SimulationCase } from "../../../domain/analysis/simulation-case.ts";
import { DynamicSystemResponseError } from "../../../domain/analysis/simulation-capabilities.ts";
import {
  lowerModelicaSimulationCase,
  McpModelicaProvider,
} from "./mcp-modelica-provider.ts";

const CASE: SimulationCase = {
  schemaVersion: "simulation-case/1.0",
  id: "case:thermal",
  revision: 1,
  scope: "Bounded thermal scenario",
  evidenceBoundary: "Observations only",
  project: {
    id: "project:test",
    subjectId: "subject:test",
    baseThreadSnapshot: {
      id: "snapshot:test",
      revision: 1,
      subjectId: "subject:test",
    },
  },
  kit: {
    modelId: "thermal-kit",
    modelVersion: "1.2.3",
    modelSha256: "a".repeat(64),
  },
  scenario: { id: "heat-up", sha256: "b".repeat(64) },
  parameters: [
    { id: "zeta", value: 2, unit: "K" },
    { id: "alpha", value: 1, unit: "W" },
  ],
  expectedMetrics: [{ id: "temperature", unit: "degC" }],
  parameterMode: "explicit-overrides",
  timeoutMs: 42_000,
};

Deno.test("McpModelicaProvider lowers a case to the exact pinned provider request", () => {
  assertEquals(lowerModelicaSimulationCase(CASE), {
    model_id: "thermal-kit",
    scenario_id: "heat-up",
    parameter_overrides: {
      alpha: { value: 1, unit: "W" },
      zeta: { value: 2, unit: "K" },
    },
    timeout_ms: 42_000,
  });
});

Deno.test("McpModelicaProvider owns the method-catalog tool lowering", async () => {
  const calls: unknown[] = [];
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({
        structuredContent: {
          kits: [{
            id: "thermal-kit",
            version: "1.2.3",
            parameters: [
              { id: "alpha", unit: "W", minimum: 0, maximum: 10 },
              { id: "zeta", unit: "K", minimum: 0, maximum: 10 },
            ],
            produced_metrics: [{ id: "temperature", unit: "degC" }],
          }],
        },
        text: "",
      });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  await new McpModelicaProvider(client).assertMethodAvailable(CASE);
  assertEquals(calls, [{ name: "modelica_kit_list", arguments: {} }]);
});

Deno.test("McpModelicaProvider owns the exact simulation tool dispatch", async () => {
  const calls: unknown[] = [];
  const response = {
    schemaVersion: "1.0",
    kind: "run",
    run: { run_id: "run:provider:1", status: "succeeded" },
  };
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({ structuredContent: response, text: "" });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const provider = new McpModelicaProvider(client);
  const plan = provider.resolve(CASE);

  assertEquals(plan.readbackOperation, {
    serverId: "modelica",
    operationId: "modelica_run_get",
  });
  const dispatch = await provider.simulate(plan);
  assertEquals(calls, [{
    name: "modelica_simulate",
    arguments: {
      model_id: "thermal-kit",
      scenario_id: "heat-up",
      parameter_overrides: {
        alpha: { value: 1, unit: "W" },
        zeta: { value: 2, unit: "K" },
      },
      timeout_ms: 42_000,
    },
  }]);
  assertEquals(dispatch.providerRunId, "run:provider:1");
  assertEquals(dispatch.status, "succeeded");
  assertEquals(dispatch.exactProviderRecord, response);
});

Deno.test("McpModelicaProvider readRun lowers exactly to modelica_run_get", async () => {
  const calls: unknown[] = [];
  const response = {
    schemaVersion: "1.0",
    kind: "run",
    run: {
      artifacts: [
        {
          bytes: 10,
          kind: "evidence",
          sha256: "c".repeat(64),
          uri: "casys://modelica/evidence/provider-read",
        },
        {
          bytes: 20,
          kind: "model",
          sha256: CASE.kit.modelSha256,
          uri: "casys://modelica/model/provider-read.mo",
        },
        {
          bytes: 30,
          kind: "result",
          sha256: "d".repeat(64),
          uri: "casys://modelica/result/provider-read.mat",
        },
      ],
      completed_at: "2026-08-11T02:00:01.000Z",
      engine: {
        msl_version: "4.0.0",
        name: "OpenModelica",
        version: "1.23.0",
      },
      fingerprint: "e".repeat(64),
      metrics: { temperature: { unit: "degC", value: 91.2 } },
      model: {
        id: CASE.kit.modelId,
        sha256: CASE.kit.modelSha256,
        version: CASE.kit.modelVersion,
      },
      resolved_parameters: {
        alpha: { unit: "W", value: 1 },
        zeta: { unit: "K", value: 2 },
      },
      run_id: "run:provider:read",
      scenario: {
        id: CASE.scenario.id,
        sha256: CASE.scenario.sha256,
      },
      started_at: "2026-08-11T02:00:00.000Z",
      status: "succeeded",
      warnings: [],
    },
  };
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({ structuredContent: response, text: "" });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const expected = {
    kit: CASE.kit,
    scenario: CASE.scenario,
    parameters: CASE.parameters,
    expectedMetrics: CASE.expectedMetrics,
  };

  const run = await new McpModelicaProvider(client).readRun(
    "run:provider:read",
    expected,
  );

  assertEquals(calls, [{
    name: "modelica_run_get",
    arguments: { run_id: "run:provider:read" },
  }]);
  assertEquals(run.runId, "run:provider:read");
});

Deno.test("McpModelicaProvider marks a returned malformed simulation response as acknowledged", async () => {
  const calls: unknown[] = [];
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({
        structuredContent: {
          schemaVersion: "1.0",
          kind: "run",
          run: { status: "succeeded" },
        },
        text: "",
      });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const provider = new McpModelicaProvider(client);

  const failure = await assertRejects(
    () => provider.simulate(provider.resolve(CASE)),
    DynamicSystemResponseError,
  );

  assertEquals(failure.cause instanceof Error, true);
  assertEquals(calls.length, 1);
});
