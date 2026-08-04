import { assertEquals, assertRejects } from "@std/assert";
import {
  CM01_NOMINAL_MODELICA_MODEL,
  CM01_NOMINAL_MODELICA_PARAMETERS,
  CM01_NOMINAL_MODELICA_SCENARIO,
  Cm01NominalModelicaCaptureAdapter,
  Cm01NominalModelicaCaptureError,
} from "./cm01-nominal-modelica-capture.ts";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "./http-mcp-tool-client.ts";

Deno.test("CM-01 nominal Modelica capture owns exactly the reviewed calls and normalizes persisted evidence", async () => {
  const run = providerRun("run_00000000-0000-4000-8000-000000000000");
  const client = new ScriptedModelicaClient([envelope(run), envelope(run)]);

  const capture = await new Cm01NominalModelicaCaptureAdapter({ modelica: client })
    .capture();

  assertEquals(client.calls, [
    {
      name: "modelica_simulate",
      arguments: {
        model_id: "coffee-machine-v1",
        scenario_id: "heat-up-nominal",
      },
    },
    {
      name: "modelica_run_get",
      arguments: { run_id: "run_00000000-0000-4000-8000-000000000000" },
    },
  ]);
  assertEquals(capture.schemaVersion, "cm01-nominal-modelica-capture/1.0");
  assertEquals(capture.kind, "cm01-nominal-modelica-capture");
  assertEquals(capture.producer, {
    serverId: "modelica",
    simulation: {
      tool: "modelica_simulate",
      runId: "run_00000000-0000-4000-8000-000000000000",
    },
    readback: {
      tool: "modelica_run_get",
      runId: "run_00000000-0000-4000-8000-000000000000",
    },
  });
  assertEquals(capture.evidence.model, {
    id: CM01_NOMINAL_MODELICA_MODEL.id,
    version: CM01_NOMINAL_MODELICA_MODEL.version,
    fingerprint: {
      algorithm: "sha256",
      digest: CM01_NOMINAL_MODELICA_MODEL.sha256,
    },
  });
  assertEquals(capture.evidence.scenario, {
    id: CM01_NOMINAL_MODELICA_SCENARIO.id,
    fingerprint: {
      algorithm: "sha256",
      digest: CM01_NOMINAL_MODELICA_SCENARIO.sha256,
    },
  });
  assertEquals(
    capture.resolvedParameters.map(({ id, value, unit }) => ({ id, value, unit })),
    [...CM01_NOMINAL_MODELICA_PARAMETERS],
  );
  assertEquals(
    capture.evidence.measurements.map(({ id, value, unit }) => ({ id, value, unit })),
    [
      { id: "heater_energy", value: 493914.2758438271, unit: "J" },
      { id: "heater_power_peak", value: 1500, unit: "W" },
      { id: "time_to_target_temperature", value: 138, unit: "s" },
      { id: "water_temperature_max", value: 94.00000007343664, unit: "degC" },
    ],
  );
  assertEquals(
    capture.evidence.artifacts.map((artifact) => ({
      kind: artifact.kind,
      digest: artifact.fingerprint.digest,
      bytes: artifact.bytes,
    })),
    [
      { kind: "request", digest: "1".repeat(64), bytes: 75 },
      { kind: "resolved-parameters", digest: "2".repeat(64), bytes: 312 },
      { kind: "model", digest: CM01_NOMINAL_MODELICA_MODEL.sha256, bytes: 2572 },
      { kind: "script", digest: "3".repeat(64), bytes: 840 },
      { kind: "diagnostics", digest: "4".repeat(64), bytes: 440 },
      { kind: "result", digest: "5".repeat(64), bytes: 351007 },
      { kind: "evidence", digest: "6".repeat(64), bytes: 650 },
    ],
  );
  const serialized = JSON.stringify(capture);
  assertEquals(serialized.includes("model_id"), false);
  assertEquals(serialized.includes("scenario_id"), false);
});

Deno.test("CM-01 nominal Modelica capture rejects changed persisted evidence after simulation", async () => {
  const simulated = providerRun("run_00000000-0000-4000-8000-000000000000");
  const readback = providerRun("run_00000000-0000-4000-8000-000000000000");
  (readback.metrics as Record<string, unknown>).water_temperature_max = {
    value: 95,
    unit: "degC",
  };
  const client = new ScriptedModelicaClient([envelope(simulated), envelope(readback)]);

  await assertRejects(
    () => new Cm01NominalModelicaCaptureAdapter({ modelica: client }).capture(),
    Cm01NominalModelicaCaptureError,
    "does not exactly match",
  );
  assertEquals(client.calls.map((call) => call.name), [
    "modelica_simulate",
    "modelica_run_get",
  ]);
});

Deno.test("CM-01 nominal Modelica capture fails closed before readback on an unreviewed simulation response", async () => {
  const run = providerRun("run_00000000-0000-4000-8000-000000000000");
  (run.model as Record<string, unknown>).sha256 = "f".repeat(64);
  const client = new ScriptedModelicaClient([envelope(run)]);

  await assertRejects(
    () => new Cm01NominalModelicaCaptureAdapter({ modelica: client }).capture(),
    Cm01NominalModelicaCaptureError,
    "model.sha256 does not match the reviewed CM-01 contract",
  );
  assertEquals(client.calls.map((call) => call.name), ["modelica_simulate"]);
});

Deno.test("CM-01 nominal Modelica capture rejects a malformed artifact ledger", async () => {
  const run = providerRun("run_00000000-0000-4000-8000-000000000000");
  (run.artifacts as unknown[]).pop();
  const client = new ScriptedModelicaClient([envelope(run)]);

  await assertRejects(
    () => new Cm01NominalModelicaCaptureAdapter({ modelica: client }).capture(),
    Cm01NominalModelicaCaptureError,
    "seven reviewed Modelica artifacts",
  );
  assertEquals(client.calls.map((call) => call.name), ["modelica_simulate"]);
});

Deno.test("CM-01 nominal Modelica capture rejects an artifact outside the persisted run ledger", async () => {
  const run = providerRun("run_00000000-0000-4000-8000-000000000000");
  (run.artifacts as Array<Record<string, unknown>>)[5].uri =
    "casys://modelica/runs/run_00000000-0000-4000-8000-000000000000/other.csv";
  const client = new ScriptedModelicaClient([envelope(run)]);

  await assertRejects(
    () => new Cm01NominalModelicaCaptureAdapter({ modelica: client }).capture(),
    Cm01NominalModelicaCaptureError,
    "reviewed result artifact path",
  );
  assertEquals(client.calls.map((call) => call.name), ["modelica_simulate"]);
});

class ScriptedModelicaClient implements McpToolClient {
  readonly calls: McpToolCall[] = [];
  #results: McpToolResult[];

  constructor(results: readonly McpToolResult[]) {
    this.#results = results.map((result) => structuredClone(result));
  }

  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>> {
    return Promise.reject(
      new Error(`callToolTextResult is not implemented by this stub (${call.name})`),
    );
  }

  callTool(call: McpToolCall): Promise<McpToolResult> {
    this.calls.push(structuredClone(call));
    const result = this.#results.shift();
    if (!result) throw new Error(`Unexpected ${call.name}.`);
    return Promise.resolve(structuredClone(result));
  }
}

function envelope(run: Record<string, unknown>): McpToolResult {
  return {
    text: "Persisted simulation run.",
    structuredContent: {
      schemaVersion: "1.0",
      kind: "run",
      run,
    },
  };
}

function providerRun(runId: string): Record<string, unknown> {
  const root = `casys://modelica/runs/${runId}`;
  return {
    status: "succeeded",
    run_id: runId,
    started_at: "2026-08-03T09:00:00.000Z",
    completed_at: "2026-08-03T09:00:02.000Z",
    fingerprint: "f".repeat(64),
    model: {
      id: CM01_NOMINAL_MODELICA_MODEL.id,
      version: CM01_NOMINAL_MODELICA_MODEL.version,
      sha256: CM01_NOMINAL_MODELICA_MODEL.sha256,
    },
    scenario: {
      id: CM01_NOMINAL_MODELICA_SCENARIO.id,
      sha256: CM01_NOMINAL_MODELICA_SCENARIO.sha256,
    },
    engine: { name: "OpenModelica", version: "1.27.0", msl_version: "4.1.0" },
    resolved_parameters: Object.fromEntries(
      CM01_NOMINAL_MODELICA_PARAMETERS.map((parameter) => [parameter.id, {
        value: parameter.value,
        unit: parameter.unit,
      }]),
    ),
    metrics: {
      heater_energy: { value: 493914.2758438271, unit: "J" },
      heater_power_peak: { value: 1500, unit: "W" },
      time_to_target_temperature: { value: 138, unit: "s" },
      water_temperature_max: { value: 94.00000007343664, unit: "degC" },
    },
    artifacts: [
      {
        kind: "request",
        uri: `${root}/request.json`,
        sha256: "1".repeat(64),
        bytes: 75,
      },
      {
        kind: "resolved_parameters",
        uri: `${root}/resolved-parameters.json`,
        sha256: "2".repeat(64),
        bytes: 312,
      },
      {
        kind: "model",
        uri: `${root}/CoffeeMachine.mo`,
        sha256: CM01_NOMINAL_MODELICA_MODEL.sha256,
        bytes: 2572,
      },
      { kind: "script", uri: `${root}/run.mos`, sha256: "3".repeat(64), bytes: 840 },
      {
        kind: "diagnostics",
        uri: `${root}/omc.log`,
        sha256: "4".repeat(64),
        bytes: 440,
      },
      {
        kind: "result",
        uri: `${root}/result.csv`,
        sha256: "5".repeat(64),
        bytes: 351007,
      },
      {
        kind: "evidence",
        uri: `${root}/evidence.json`,
        sha256: "6".repeat(64),
        bytes: 650,
      },
    ],
    warnings: [],
  };
}
