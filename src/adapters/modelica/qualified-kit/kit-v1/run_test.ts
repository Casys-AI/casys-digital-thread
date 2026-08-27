import { assertEquals, assertRejects } from "@std/assert";
import {
  authorizeModelicaInputBundle,
  canonicalJson,
  createQualifiedKit,
  MODELICA_QUALIFIED_MODEL_SOURCE,
  MODELICA_QUALIFIED_SCENARIO_SOURCE,
} from "./run.ts";

const encoder = new TextEncoder();
const MODEL_SHA256 = "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6";
const SCENARIO_SHA256 =
  "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e";

Deno.test("Modelica worker admits only the complete canonical qualified-kit bundle", async () => {
  const document = exactBundle();
  const authorized = await authorizeModelicaInputBundle(
    encoder.encode(canonicalJson(document)),
  );

  assertEquals(
    authorized.invocation.parameters.map((parameter) => ({
      id: parameter.id,
      inputValue: parameter.inputValue,
      inputUnit: parameter.inputUnit,
      modelicaValue: parameter.modelicaValue,
      modelicaUnit: parameter.modelicaUnit,
    })),
    [
      {
        id: "heating_rate",
        inputValue: 1,
        inputUnit: "K/s",
        modelicaValue: 1,
        modelicaUnit: "K/s",
      },
      {
        id: "initial_temperature",
        inputValue: 20,
        inputUnit: "degC",
        modelicaValue: 20,
        modelicaUnit: "degC",
      },
    ],
  );
  assertEquals(authorized.method, {
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    resultNormalizer: {
      id: "linear-thermal-ramp-result-normalizer",
      version: "1.0.0",
    },
    engine: {
      name: "OpenModelica",
      version: "1.23.1",
      mslVersion: "4.1.0",
    },
  });
});

Deno.test("Modelica worker rejects source, conversion and method substitution", async () => {
  const changedSource = exactBundle();
  changedSource.inputs[0].text += " ";
  changedSource.inputs[0].byteCount += 1;
  await assertRejects(
    () => authorizeModelicaInputBundle(bytes(changedSource)),
    TypeError,
    "registered value",
  );

  const changedConversion = exactBundle();
  changedConversion.invocation.parameters[0].modelicaValue = 2;
  await assertRejects(
    () => authorizeModelicaInputBundle(bytes(changedConversion)),
    TypeError,
    "unit conversion",
  );

  const changedMethod = exactBundle();
  changedMethod.method.resultNormalizer.version = "2.0.0";
  await assertRejects(
    () => authorizeModelicaInputBundle(bytes(changedMethod)),
    TypeError,
    "unsupported method",
  );

  await assertRejects(
    () =>
      authorizeModelicaInputBundle(
        encoder.encode(JSON.stringify(exactBundle(), null, 2)),
      ),
    TypeError,
    "not canonical JSON",
  );
});

Deno.test("Modelica worker owns the qualified units and CSV normalizer", async () => {
  const kit = await createQualifiedKit();
  assertEquals(kit.id, "linear-thermal-ramp-v1");
  assertEquals(kit.version, "0.1.0");
  assertEquals(
    kit.parameters.map((parameter) => ({
      id: parameter.id,
      unit: parameter.unit,
      conversion: parameter.conversion,
      range: [parameter.minimum, parameter.maximum],
    })),
    [
      {
        id: "heating_rate",
        unit: "K/s",
        conversion: { from: "K/s", to: "K/s", factor: 1, offset: 0 },
        range: [0.1, 10],
      },
      {
        id: "initial_temperature",
        unit: "degC",
        conversion: { from: "degC", to: "degC", factor: 1, offset: 0 },
        range: [-50, 100],
      },
    ],
  );
  assertEquals(
    kit.resultNormalizer.normalize(
      '"time","temperatureC"\n0,20\n2,22\n',
      kit.scenarios[0]!,
    ),
    {
      metrics: { temperature_final: { value: 22, unit: "degC" } },
      warnings: [],
    },
  );
});

function exactBundle() {
  return {
    schemaVersion: "modelica-isolated-input-bundle/1.0",
    qualification: {
      caseSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64),
      sourceCaptureSha256: "c".repeat(64),
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
      timeoutMs: 30_000,
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
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      resultNormalizer: {
        id: "linear-thermal-ramp-result-normalizer",
        version: "1.0.0",
      },
      engine: {
        name: "OpenModelica",
        version: "1.23.1",
        mslVersion: "4.1.0",
      },
    },
    inputs: [
      {
        role: "model",
        basename: "model.mo",
        mediaType: "text/x-modelica",
        byteCount: encoder.encode(MODELICA_QUALIFIED_MODEL_SOURCE).byteLength,
        sha256: MODEL_SHA256,
        text: MODELICA_QUALIFIED_MODEL_SOURCE,
      },
      {
        role: "scenario",
        basename: "scenario.json",
        mediaType: "application/json",
        byteCount: encoder.encode(MODELICA_QUALIFIED_SCENARIO_SOURCE).byteLength,
        sha256: SCENARIO_SHA256,
        text: MODELICA_QUALIFIED_SCENARIO_SOURCE,
      },
    ],
  };
}

function bytes(value: ReturnType<typeof exactBundle>): Uint8Array {
  return encoder.encode(canonicalJson(value));
}
