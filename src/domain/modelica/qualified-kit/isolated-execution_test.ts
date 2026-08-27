import { assertEquals, assertRejects } from "@std/assert";
import {
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  MODELICA_LOCAL_LOWERING,
  MODELICA_LOCAL_RESULT_NORMALIZER,
  validateModelicaIsolatedInputBundle,
  validateModelicaIsolatedOutput,
  validateModelicaIsolatedRun,
} from "./isolated-execution.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";

const encoder = new TextEncoder();
const MODEL_SOURCE = `model LinearThermalRamp
  "Minimal balanced solver-conformance model; not a physical thermal oracle."
  parameter Real initialTemperature(unit = "degC") = 20;
  parameter Real heatingRate(unit = "K/s") = 1;
  output Real temperatureC(
    unit = "degC",
    start = initialTemperature,
    fixed = true);
equation
  der(temperatureC) = heatingRate;
end LinearThermalRamp;
`;
const SCENARIO_SOURCE = `{
  "id": "linear-ramp-nominal",
  "description": "Solver-conformance ramp from 20 degC at 1 K/s for two seconds; no physical heat balance is claimed.",
  "start_time_s": 0,
  "stop_time_s": 2,
  "number_of_intervals": 20,
  "solver": "dassl",
  "target_temperature": {
    "value": 22,
    "unit": "degC"
  }
}
`;

Deno.test("Modelica isolated bundle closes qualified sources, conversions and metric units", async () => {
  const document = await validBundle();
  const replay = await validateModelicaIsolatedInputBundle(
    JSON.parse(deterministicJson(document)),
  );

  assertEquals(replay.inputs.map((member) => [member.role, member.basename]), [
    ["model", "model.mo"],
    ["scenario", "scenario.json"],
  ]);
  assertEquals(replay.invocation.parameters, [
    {
      id: "heating_rate",
      modelicaName: "heatingRate",
      inputValue: 1,
      inputUnit: "K/s",
      modelicaValue: 1,
      modelicaUnit: "K/s",
    },
    {
      id: "initial_temperature",
      modelicaName: "initialTemperature",
      inputValue: 20,
      inputUnit: "degC",
      modelicaValue: 20,
      modelicaUnit: "degC",
    },
  ]);
  assertEquals(replay.invocation.metrics, [{
    id: "temperature_final",
    unit: "degC",
    required: true,
  }]);
});

Deno.test("Modelica isolated bundle rejects changed qualified source bytes", async () => {
  const document = structuredClone(await validBundle()) as unknown as {
    inputs: Array<{ text: string }>;
  };
  document.inputs[0]!.text = "model Other end Other;";
  await assertRejects(
    () => validateModelicaIsolatedInputBundle(document),
    TypeError,
    "does not match exact UTF-8 bytes",
  );
});

Deno.test("Modelica output validation closes canonical evidence against exact CSV", async () => {
  const bundle = await validBundle();
  const resultBytes = encoder.encode(qualifiedResultCsv());
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/1.0",
    inputBundleSha256: await fingerprintResourceBytes(
      encoder.encode(deterministicJson(bundle)),
    ),
    status: "succeeded",
    method: bundle.method,
    resolvedParameters: bundle.invocation.parameters.map((parameter) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      value: parameter.inputValue,
      unit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    metrics: [{ id: "temperature_final", value: 22, unit: "degC" }],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await fingerprintResourceBytes(resultBytes),
    },
    warnings: [],
  } as const;
  const evidenceBytes = encoder.encode(deterministicJson(evidence));
  const byRole = new Map(
    MODELICA_ISOLATED_OUTPUT_MANIFEST.map((item) => [item.role, item]),
  );

  validateModelicaIsolatedOutput(byRole.get("result")!, resultBytes);
  validateModelicaIsolatedOutput(byRole.get("evidence")!, evidenceBytes);
  assertEquals(
    await validateModelicaIsolatedRun({
      bundle,
      evidenceBytes,
      resultBytes,
    }),
    evidence,
  );

  const wrong = structuredClone(evidence) as unknown as {
    metrics: Array<{ unit: string }>;
  };
  wrong.metrics[0]!.unit = "K";
  await assertRejects(
    () =>
      validateModelicaIsolatedRun({
        bundle,
        evidenceBytes: encoder.encode(deterministicJson(wrong)),
        resultBytes,
      }),
    TypeError,
    "qualified units",
  );

  const wrongValue = structuredClone(evidence) as unknown as {
    metrics: Array<{ value: number }>;
  };
  wrongValue.metrics[0]!.value = 23;
  await assertRejects(
    () =>
      validateModelicaIsolatedRun({
        bundle,
        evidenceBytes: encoder.encode(deterministicJson(wrongValue)),
        resultBytes,
      }),
    TypeError,
    "differs from the exact result CSV",
  );
});

function qualifiedResultCsv(): string {
  const rows = Array.from(
    { length: 21 },
    (_, index) => `${index / 10},${20 + index / 10}`,
  );
  return `time,temperatureC\n${rows.join("\n")}\n`;
}

async function validBundle() {
  const modelBytes = encoder.encode(MODEL_SOURCE);
  const scenarioBytes = encoder.encode(SCENARIO_SOURCE);
  return await validateModelicaIsolatedInputBundle({
    schemaVersion: "modelica-isolated-input-bundle/1.0",
    qualification: {
      caseSha256: "1".repeat(64),
      manifestSha256: "2".repeat(64),
      sourceCaptureSha256: "3".repeat(64),
    },
    selection: {
      modelId: "linear-thermal-ramp-v1",
      modelVersion: "0.1.0",
      scenarioId: "linear-ramp-nominal",
    },
    invocation: {
      modelName: "LinearThermalRamp",
      startTimeS: 0,
      stopTimeS: 2,
      numberOfIntervals: 20,
      solver: "dassl",
      timeoutMs: 1_000,
      parameters: [
        {
          id: "heating_rate",
          modelicaName: "heatingRate",
          inputValue: 1,
          inputUnit: "K/s",
          modelicaValue: 1,
          modelicaUnit: "K/s",
        },
        {
          id: "initial_temperature",
          modelicaName: "initialTemperature",
          inputValue: 20,
          inputUnit: "degC",
          modelicaValue: 20,
          modelicaUnit: "degC",
        },
      ],
      metrics: [{ id: "temperature_final", unit: "degC", required: true }],
    },
    method: {
      lowering: MODELICA_LOCAL_LOWERING,
      resultNormalizer: MODELICA_LOCAL_RESULT_NORMALIZER,
      engine: { name: "OpenModelica", version: "1.23", mslVersion: "4.0" },
    },
    inputs: [
      {
        role: "model",
        basename: "model.mo",
        mediaType: "text/x-modelica",
        byteCount: modelBytes.byteLength,
        sha256: "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6",
        text: MODEL_SOURCE,
      },
      {
        role: "scenario",
        basename: "scenario.json",
        mediaType: "application/json",
        byteCount: scenarioBytes.byteLength,
        sha256: "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e",
        text: SCENARIO_SOURCE,
      },
    ],
  });
}
