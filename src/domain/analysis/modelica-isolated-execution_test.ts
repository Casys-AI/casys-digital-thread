import { assertEquals, assertRejects } from "@std/assert";
import {
  createModelicaIsolatedInputBundle,
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  validateModelicaIsolatedInputBundle,
  validateModelicaIsolatedOutput,
  validateModelicaIsolatedRun,
} from "./modelica-isolated-execution.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  fingerprintModelicaResumableProviderJson,
  validateModelicaQualifiedManifestDocument,
} from "./modelica-resumable-capabilities.ts";
import {
  canonicalSimulationCaseV2Text,
  validateSimulationCaseV2,
} from "./simulation-case-v2.ts";
import { fingerprintResourceBytes } from "./provider-resource-reader.ts";
import { deterministicJson } from "../kernel/deterministic-json.ts";

const encoder = new TextEncoder();

Deno.test("Modelica isolated bundle closes qualified sources, conversions and metric units", async () => {
  const fixture = await modelicaFixture();
  const bundle = await createModelicaIsolatedInputBundle(fixture);
  const replay = await validateModelicaIsolatedInputBundle(
    JSON.parse(bundle.text),
  );

  assertEquals(await fingerprintResourceBytes(bundle.bytes), bundle.fingerprint.digest);
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

Deno.test("Modelica isolated bundle rejects changed qualified source bytes and units", async () => {
  const fixture = await modelicaFixture();
  await assertRejects(
    () =>
      createModelicaIsolatedInputBundle({
        ...fixture,
        sources: fixture.sources.map((source) =>
          source.role === "model"
            ? { ...source, bytes: encoder.encode("model Other end Other;") }
            : source
        ),
      }),
    TypeError,
    "diverge",
  );
  const wrongCase = structuredClone(fixture.simulationCase);
  wrongCase.parameters[0].unit = "W";
  await assertRejects(
    () =>
      createModelicaIsolatedInputBundle({
        ...fixture,
        simulationCaseBytes: encoder.encode(deterministicJson(wrongCase)),
      }),
    TypeError,
    "canonical JSON",
  );
});

Deno.test("Modelica output validation closes canonical evidence against exact CSV", async () => {
  const fixture = await modelicaFixture();
  const bundle = await createModelicaIsolatedInputBundle(fixture);
  const resultBytes = encoder.encode(qualifiedResultCsv());
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/1.0",
    inputBundleSha256: bundle.fingerprint.digest,
    status: "succeeded",
    method: bundle.document.method,
    resolvedParameters: bundle.document.invocation.parameters.map((parameter) => ({
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
      bundle: bundle.document,
      evidenceBytes,
      resultBytes,
    }),
    evidence,
  );

  const wrong = structuredClone(evidence) as unknown as {
    metrics: Array<{ unit: string }>;
  };
  wrong.metrics[0].unit = "K";
  await assertRejects(
    () =>
      validateModelicaIsolatedRun({
        bundle: bundle.document,
        evidenceBytes: encoder.encode(deterministicJson(wrong)),
        resultBytes,
      }),
    TypeError,
    "qualified units",
  );

  const wrongValue = structuredClone(evidence) as unknown as {
    metrics: Array<{ value: number }>;
  };
  wrongValue.metrics[0].value = 23;
  await assertRejects(
    () =>
      validateModelicaIsolatedRun({
        bundle: bundle.document,
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

async function modelicaFixture() {
  const modelBytes = encoder.encode(
    `model LinearThermalRamp
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
`,
  );
  const scenarioBytes = encoder.encode(`{
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
`);
  const modelSha256 = await fingerprintResourceBytes(modelBytes);
  const scenarioSha256 = await fingerprintResourceBytes(scenarioBytes);
  const scenarioPublic = {
    id: "linear-ramp-nominal",
    description:
      "Solver-conformance ramp from 20 degC at 1 K/s for two seconds; no physical heat balance is claimed.",
    start_time_s: 0,
    stop_time_s: 2,
    number_of_intervals: 20,
    solver: "dassl",
    target_temperature: { value: 22, unit: "degC" },
  };
  const modelResource = {
    uri: "casys://modelica/kits/linear-thermal-ramp-v1/0.1.0/model.mo",
    mediaType: "text/x-modelica",
    bytes: modelBytes.byteLength,
    sha256: modelSha256,
    qualification: "qualified-kit",
  };
  const scenarioResource = {
    uri:
      "casys://modelica/kits/linear-thermal-ramp-v1/0.1.0/scenarios/linear-ramp-nominal.json",
    mediaType: "application/json",
    bytes: scenarioBytes.byteLength,
    sha256: scenarioSha256,
    qualification: "qualified-kit",
  };
  const unsigned = {
    schemaVersion: "2.1",
    model: {
      id: "linear-thermal-ramp-v1",
      version: "0.1.0",
      name: "LinearThermalRamp",
      source: modelResource,
    },
    scenario: {
      id: "linear-ramp-nominal",
      source: scenarioResource,
      public: scenarioPublic,
      projection_sha256: await fingerprintModelicaResumableProviderJson(
        scenarioPublic,
      ),
    },
    parameters: [
      {
        id: "initial_temperature",
        modelica_name: "initialTemperature",
        modelica_type: "Real",
        description: "Initial temperature",
        unit: "degC",
        minimum: -50,
        maximum: 100,
        conversion: { from: "degC", to: "degC", factor: 1, offset: 0 },
      },
      {
        id: "heating_rate",
        modelica_name: "heatingRate",
        modelica_type: "Real",
        description: "Heating rate",
        unit: "K/s",
        minimum: 0.1,
        maximum: 10,
        conversion: { from: "K/s", to: "K/s", factor: 1, offset: 0 },
      },
    ],
    produced_metrics: [{
      id: "temperature_final",
      unit: "degC",
      description: "Final temperature",
      required: true,
    }],
    result_normalizer: {
      id: "linear-thermal-ramp-result-normalizer",
      version: "1.0.0",
    },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", msl_version: "4.0" },
  };
  const fingerprint = await fingerprintModelicaResumableProviderJson(unsigned);
  const manifest = await validateModelicaQualifiedManifestDocument({
    schemaVersion: "modelica-qualified-manifest/1.0",
    contractVersion: "2.1",
    selection: {
      modelId: "linear-thermal-ramp-v1",
      modelVersion: "0.1.0",
      scenarioId: "linear-ramp-nominal",
    },
    fingerprint,
    modelName: "LinearThermalRamp",
    model: {
      uri: modelResource.uri,
      mediaType: modelResource.mediaType,
      byteCount: modelResource.bytes,
      sha256: modelResource.sha256,
      qualification: modelResource.qualification,
    },
    scenario: {
      uri: scenarioResource.uri,
      mediaType: scenarioResource.mediaType,
      byteCount: scenarioResource.bytes,
      sha256: scenarioResource.sha256,
      qualification: scenarioResource.qualification,
    },
    scenarioPublic: {
      id: scenarioPublic.id,
      description: scenarioPublic.description,
      startTimeS: scenarioPublic.start_time_s,
      stopTimeS: scenarioPublic.stop_time_s,
      numberOfIntervals: scenarioPublic.number_of_intervals,
      solver: scenarioPublic.solver,
      targetTemperature: scenarioPublic.target_temperature,
    },
    scenarioProjectionSha256: unsigned.scenario.projection_sha256,
    parameters: [
      {
        id: "initial_temperature",
        modelicaName: "initialTemperature",
        modelicaType: "Real",
        description: "Initial temperature",
        unit: "degC",
        minimum: -50,
        maximum: 100,
        conversion: { from: "degC", to: "degC", factor: 1, offset: 0 },
      },
      {
        id: "heating_rate",
        modelicaName: "heatingRate",
        modelicaType: "Real",
        description: "Heating rate",
        unit: "K/s",
        minimum: 0.1,
        maximum: 10,
        conversion: { from: "K/s", to: "K/s", factor: 1, offset: 0 },
      },
    ],
    producedMetrics: [{
      id: "temperature_final",
      unit: "degC",
      description: "Final temperature",
      required: true,
    }],
    resultNormalizer: {
      id: "linear-thermal-ramp-result-normalizer",
      version: "1.0.0",
    },
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    engine: { name: "OpenModelica", version: "1.23", mslVersion: "4.0" },
  });
  const simulationCase = {
    schemaVersion: "simulation-case/2.0",
    id: "thermal-case",
    revision: 1,
    scope: "test",
    evidenceBoundary: "observation only",
    project: {
      id: "project-1",
      subjectId: "subject-1",
      baseThreadSnapshot: { id: "snapshot-1", revision: 1, subjectId: "subject-1" },
    },
    kit: {
      modelId: "linear-thermal-ramp-v1",
      modelVersion: "0.1.0",
      modelSha256,
    },
    scenario: {
      id: "linear-ramp-nominal",
      sourceSha256: scenarioSha256,
      projectionSha256: manifest.scenarioProjectionSha256,
    },
    parameters: [
      { id: "initial_temperature", value: 20, unit: "degC" },
      { id: "heating_rate", value: 1, unit: "K/s" },
    ],
    expectedMetrics: [{ id: "temperature_final", unit: "degC" }],
    parameterMode: "explicit-overrides",
    timeoutMs: 1000,
  };
  const validatedSimulationCase = validateSimulationCaseV2(simulationCase);
  const simulationCaseText = canonicalSimulationCaseV2Text(validatedSimulationCase);
  const simulationCaseBytes = encoder.encode(simulationCaseText);
  const caseSha256 = await fingerprintResourceBytes(simulationCaseBytes);
  const manifestText = await canonicalModelicaQualifiedManifestDocumentText(
    manifest,
  );
  const manifestBytes = encoder.encode(manifestText);
  const sourceCaptureDocument = {
    schemaVersion: "modelica-qualified-source-capture/1.0",
    selection: manifest.selection,
    manifestFingerprint: manifest.fingerprint,
    artifacts: [
      {
        role: "model",
        resource: {
          uri: modelResource.uri,
          mediaType: modelResource.mediaType,
          byteCount: modelResource.bytes,
          sha256: modelResource.sha256,
        },
        cas: cas("source", modelSha256, modelBytes),
      },
      {
        role: "scenario",
        resource: {
          uri: scenarioResource.uri,
          mediaType: scenarioResource.mediaType,
          byteCount: scenarioResource.bytes,
          sha256: scenarioResource.sha256,
        },
        cas: cas("source", scenarioSha256, scenarioBytes),
      },
    ],
  };
  const sourceCaptureBytes = encoder.encode(deterministicJson(sourceCaptureDocument));
  const sourceCaptureSha256 = await fingerprintResourceBytes(sourceCaptureBytes);
  const manifestSha256 = await fingerprintResourceBytes(manifestBytes);
  const qualification = {
    schemaVersion: "simulation-case-qualification-capture/2.0",
    operation: { id: "simulate.seal-simulation-case", version: "2" },
    trustedRunId: "seal-run-1",
    sealBasis: { snapshotId: "snapshot-1", revision: 1, subjectId: "subject-1" },
    mrtr: {
      decisionId: "decision-1",
      inputFingerprint: "d".repeat(64),
      approvalId: "approval-1",
      approvalFingerprint: "e".repeat(64),
      workItemId: "work-1",
    },
    caseDigest: caseSha256,
    simulationCase: cas("case", caseSha256, simulationCaseBytes),
    manifest: cas("manifest", manifestSha256, manifestBytes),
    sourceCapture: cas("capture", sourceCaptureSha256, sourceCaptureBytes),
    sources: [
      {
        role: "model",
        mediaType: "text/x-modelica",
        resourceUri: modelResource.uri,
        cas: cas("source", modelSha256, modelBytes),
      },
      {
        role: "scenario",
        mediaType: "application/json",
        resourceUri: scenarioResource.uri,
        cas: cas("source", scenarioSha256, scenarioBytes),
      },
    ],
    sealedAt: "2026-08-14T00:00:00.000Z",
  };
  const qualificationBytes = encoder.encode(deterministicJson(qualification));
  return {
    simulationCase,
    manifest,
    qualification,
    simulationCaseBytes,
    manifestBytes,
    qualificationBytes,
    sourceCaptureBytes,
    sources: [
      { role: "model" as const, bytes: modelBytes },
      { role: "scenario" as const, bytes: scenarioBytes },
    ],
  };
}

function cas(namespace: string, sha256: string, bytes: Uint8Array) {
  return {
    uri: `casys://${namespace}/sha256/${sha256}`,
    byteCount: bytes.byteLength,
    sha256,
  };
}
