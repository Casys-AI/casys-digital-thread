/** Code-owned, self-hashing conformance input for local Modelica qualification. */

import {
  MODELICA_ISOLATED_OUTPUT_MANIFEST,
  type ModelicaIsolatedInputBundle,
  type PreparedModelicaIsolatedInputBundle,
  validateModelicaIsolatedInputBundle,
} from "../../../../domain/modelica/qualified-kit/isolated-execution.ts";
import type { ModelicaMicrosandboxQualificationBasis } from "../../../../domain/modelica/qualified-kit/microsandbox-qualification.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { deepFreeze } from "../../../../domain/kernel/case-validation.ts";
import {
  MODELICA_QUALIFIED_MODEL_SOURCE,
  MODELICA_QUALIFIED_SCENARIO_SOURCE,
} from "./run.ts";

export const MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256 =
  "043132ed24db6df3f9ded2e688a70d4cf6527841f626a9134f0ced49a2f61b72";
export const MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256 =
  "458cd80498b070cb2313cfdf5f4184a70272f689a9c20d7fc90acff655b88e65";
export const MODELICA_QUALIFIED_KIT_WRAPPER_SHA256 =
  "b5336d1615b017900f65aa9d491f3ecae8b3afb377d0bb38bc5678b03028c816";

export interface ModelicaMicrosandboxQualificationKit {
  readonly basis: ModelicaMicrosandboxQualificationBasis;
  readonly bundle: PreparedModelicaIsolatedInputBundle;
}

export async function createModelicaMicrosandboxQualificationKit(
  engine: ModelicaIsolatedInputBundle["method"]["engine"],
): Promise<ModelicaMicrosandboxQualificationKit> {
  const encoder = new TextEncoder();
  const invocation = deepFreeze({
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
  });
  const selection = deepFreeze({
    modelId: "linear-thermal-ramp-v1",
    modelVersion: "0.1.0",
    scenarioId: "linear-ramp-nominal",
  });
  const method = deepFreeze({
    lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
    resultNormalizer: {
      id: "linear-thermal-ramp-result-normalizer",
      version: "1.0.0",
    },
    engine: { ...engine },
  });
  const inputs = deepFreeze([
    {
      role: "model" as const,
      basename: "model.mo" as const,
      mediaType: "text/x-modelica" as const,
      byteCount: encoder.encode(MODELICA_QUALIFIED_MODEL_SOURCE).byteLength,
      sha256: "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6",
      text: MODELICA_QUALIFIED_MODEL_SOURCE,
    },
    {
      role: "scenario" as const,
      basename: "scenario.json" as const,
      mediaType: "application/json" as const,
      byteCount: encoder.encode(MODELICA_QUALIFIED_SCENARIO_SOURCE).byteLength,
      sha256: "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e",
      text: MODELICA_QUALIFIED_SCENARIO_SOURCE,
    },
  ]);
  const basis = deepFreeze({
    case: {
      schemaVersion: "modelica-microsandbox-conformance-case/1.0",
      selection,
      invocation,
      expected: {
        metricId: "temperature_final",
        value: 22,
        unit: "degC",
        absoluteTolerance: 1e-8,
      },
    },
    manifest: {
      schemaVersion: "modelica-microsandbox-conformance-manifest/1.0",
      method,
      outputManifest: MODELICA_ISOLATED_OUTPUT_MANIFEST,
      worker: {
        wrapperSha256: MODELICA_QUALIFIED_KIT_WRAPPER_SHA256,
        workerContractSha256: MODELICA_QUALIFIED_KIT_WORKER_CONTRACT_SHA256,
        denoLockSha256: MODELICA_QUALIFIED_KIT_DENO_LOCK_SHA256,
      },
    },
    sourceCapture: {
      schemaVersion: "modelica-microsandbox-conformance-source-capture/1.0",
      inputs: inputs.map(({ text: _text, ...input }) => input),
    },
  });
  const [caseFingerprint, manifestFingerprint, sourceCaptureFingerprint] = await Promise
    .all([
      sha256Fingerprint(basis.case),
      sha256Fingerprint(basis.manifest),
      sha256Fingerprint(basis.sourceCapture),
    ]);
  const document = await validateModelicaIsolatedInputBundle({
    schemaVersion: "modelica-isolated-input-bundle/1.0",
    qualification: {
      caseSha256: caseFingerprint.digest,
      manifestSha256: manifestFingerprint.digest,
      sourceCaptureSha256: sourceCaptureFingerprint.digest,
    },
    selection,
    invocation,
    method,
    inputs,
  });
  const text = deterministicJson(document);
  const bytes = encoder.encode(text);
  const fingerprint = await sha256Fingerprint(document);
  return Object.freeze({
    basis,
    bundle: Object.freeze({ document, text, bytes, fingerprint }),
  });
}
