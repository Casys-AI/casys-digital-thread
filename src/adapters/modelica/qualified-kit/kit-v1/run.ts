/**
 * Image-owned OpenModelica wrapper for the only locally qualified kit.
 *
 * The Microsandbox profile invokes Deno directly with three fixed paths. The
 * bundle cannot select a command, executable, model, scenario, source path,
 * output name, result normalizer, or unit conversion.
 */

import {
  KitRegistry,
  type ModelicaKit,
  ModelicaService,
  OpenModelicaRunner,
  type SimulationRun,
} from "jsr:@casys/mcp-modelica@0.4.0";
import { MODELICA_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const BUNDLE_SCHEMA = "modelica-isolated-input-bundle/1.0";
const EVIDENCE_SCHEMA = "modelica-isolated-evidence/1.0";
const FIXED_PATHS = Object.freeze({
  bundle: MODELICA_MICROSANDBOX_WORKER_CONTRACT.sourcePath,
  output: MODELICA_MICROSANDBOX_WORKER_CONTRACT.outputDirectory,
  work: MODELICA_MICROSANDBOX_WORKER_CONTRACT.workDirectory,
});
const KIT_ID = "linear-thermal-ramp-v1";
const KIT_VERSION = "0.1.0";
const MODEL_NAME = "LinearThermalRamp";
const SCENARIO_ID = "linear-ramp-nominal";
const MODEL_SHA256 = "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6";
const SCENARIO_SHA256 =
  "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e";
const LOWERING = Object.freeze({ id: "modelica-omc-lowering", version: "1.0.0" });
const RESULT_NORMALIZER = Object.freeze({
  id: "linear-thermal-ramp-result-normalizer",
  version: "1.0.0",
});

export const MODELICA_QUALIFIED_MODEL_SOURCE = `model LinearThermalRamp
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

export const MODELICA_QUALIFIED_SCENARIO_SOURCE = `{
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

const PARAMETERS = Object.freeze([
  Object.freeze({
    id: "heating_rate",
    modelicaName: "heatingRate",
    modelicaType: "Real",
    description: "Constant derivative used by the solver-conformance ramp.",
    inputUnit: "K/s",
    modelicaUnit: "K/s",
    defaultValue: 1,
    minimum: 0.1,
    maximum: 10,
    factor: 1,
    offset: 0,
  }),
  Object.freeze({
    id: "initial_temperature",
    modelicaName: "initialTemperature",
    modelicaType: "Real",
    description: "Initial value of the conformance ramp.",
    inputUnit: "degC",
    modelicaUnit: "degC",
    defaultValue: 20,
    minimum: -50,
    maximum: 100,
    factor: 1,
    offset: 0,
  }),
]);

interface AuthorizedBundle {
  readonly document: Record<string, unknown>;
  readonly sha256: string;
  readonly invocation: {
    readonly timeoutMs: number;
    readonly parameters: readonly AuthorizedParameter[];
  };
  readonly method: {
    readonly lowering: { readonly id: string; readonly version: string };
    readonly resultNormalizer: { readonly id: string; readonly version: string };
    readonly engine: {
      readonly name: string;
      readonly version: string;
      readonly mslVersion: string;
    };
  };
}

interface AuthorizedParameter {
  readonly id: string;
  readonly modelicaName: string;
  readonly inputValue: number;
  readonly inputUnit: string;
  readonly modelicaValue: number;
  readonly modelicaUnit: string;
}

if (import.meta.main) await main();

async function main(): Promise<void> {
  if (
    Deno.args.length !== 3 || Deno.args[0] !== FIXED_PATHS.bundle ||
    Deno.args[1] !== FIXED_PATHS.output || Deno.args[2] !== FIXED_PATHS.work
  ) {
    fail("The fixed Modelica wrapper requires its three registered paths.");
  }
  const bundle = await authorizeModelicaInputBundle(
    await Deno.readFile(FIXED_PATHS.bundle),
  );
  await assertEmptyDirectory(FIXED_PATHS.output, "output");
  await assertEmptyDirectory(FIXED_PATHS.work, "work");

  const runsDirectory = `${FIXED_PATHS.work}/runs`;
  await Deno.mkdir(runsDirectory, { mode: 0o700 });
  const kit = await createQualifiedKit();
  const service = new ModelicaService(
    new KitRegistry([kit]),
    new OpenModelicaRunner("omc", FIXED_PATHS.work),
    runsDirectory,
  );
  const parameterOverrides = Object.fromEntries(
    bundle.invocation.parameters.map((parameter) => [
      parameter.id,
      { value: parameter.inputValue, unit: parameter.inputUnit },
    ]),
  );
  const run = await service.simulate({
    model_id: KIT_ID,
    scenario_id: SCENARIO_ID,
    parameter_overrides: parameterOverrides,
    timeout_ms: bundle.invocation.timeoutMs,
  });
  const resultCsv = await validateSuccessfulRun(service, run, bundle);
  const resultBytes = new TextEncoder().encode(resultCsv);
  const resultSha256 = await sha256(resultBytes);
  const evidence = {
    schemaVersion: EVIDENCE_SCHEMA,
    inputBundleSha256: bundle.sha256,
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
    metrics: [{
      id: "temperature_final",
      value: run.metrics.temperature_final!.value,
      unit: "degC",
    }],
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: resultSha256,
    },
    warnings: [],
  };
  const evidenceBytes = new TextEncoder().encode(canonicalJson(evidence));
  await Deno.writeFile(`${FIXED_PATHS.output}/result.csv`, resultBytes, {
    createNew: true,
    mode: 0o400,
  });
  await Deno.writeFile(`${FIXED_PATHS.output}/evidence.json`, evidenceBytes, {
    createNew: true,
    mode: 0o400,
  });
  await assertExactOutputDirectory(FIXED_PATHS.output);
  await writeControlEvidence();
}

/** Pure, image-owned admission used both by the worker and unit tests. */
export async function authorizeModelicaInputBundle(
  bytes: Uint8Array,
): Promise<AuthorizedBundle> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail("The Modelica input bundle must contain bytes.");
  }
  const source = decode(bytes, "input bundle");
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    fail("The Modelica input bundle is not JSON.");
  }
  const root = record(parsed, "bundle");
  if (canonicalJson(root) !== source) {
    fail("The Modelica input bundle is not canonical JSON.");
  }
  exactKeys(root, [
    "inputs",
    "invocation",
    "method",
    "qualification",
    "schemaVersion",
    "selection",
  ], "bundle");
  literal(root.schemaVersion, BUNDLE_SCHEMA, "bundle.schemaVersion");

  const qualification = record(root.qualification, "bundle.qualification");
  exactKeys(qualification, [
    "caseSha256",
    "manifestSha256",
    "sourceCaptureSha256",
  ], "bundle.qualification");
  digest(qualification.caseSha256, "bundle.qualification.caseSha256");
  digest(qualification.manifestSha256, "bundle.qualification.manifestSha256");
  digest(
    qualification.sourceCaptureSha256,
    "bundle.qualification.sourceCaptureSha256",
  );

  const selection = record(root.selection, "bundle.selection");
  exactKeys(selection, ["modelId", "modelVersion", "scenarioId"], "bundle.selection");
  literal(selection.modelId, KIT_ID, "bundle.selection.modelId");
  literal(selection.modelVersion, KIT_VERSION, "bundle.selection.modelVersion");
  literal(selection.scenarioId, SCENARIO_ID, "bundle.selection.scenarioId");

  const inputs = array(root.inputs, "bundle.inputs");
  if (inputs.length !== 2) fail("The Modelica bundle requires exactly two inputs.");
  await validateInput(inputs[0], {
    role: "model",
    basename: "model.mo",
    mediaType: "text/x-modelica",
    text: MODELICA_QUALIFIED_MODEL_SOURCE,
    sha256: MODEL_SHA256,
  }, "bundle.inputs[0]");
  await validateInput(inputs[1], {
    role: "scenario",
    basename: "scenario.json",
    mediaType: "application/json",
    text: MODELICA_QUALIFIED_SCENARIO_SOURCE,
    sha256: SCENARIO_SHA256,
  }, "bundle.inputs[1]");

  const invocation = record(root.invocation, "bundle.invocation");
  exactKeys(invocation, [
    "metrics",
    "modelName",
    "numberOfIntervals",
    "parameters",
    "solver",
    "startTimeS",
    "stopTimeS",
    "timeoutMs",
  ], "bundle.invocation");
  literal(invocation.modelName, MODEL_NAME, "bundle.invocation.modelName");
  literal(invocation.startTimeS, 0, "bundle.invocation.startTimeS");
  literal(invocation.stopTimeS, 2, "bundle.invocation.stopTimeS");
  literal(invocation.numberOfIntervals, 20, "bundle.invocation.numberOfIntervals");
  literal(invocation.solver, "dassl", "bundle.invocation.solver");
  const timeoutMs = boundedInteger(
    invocation.timeoutMs,
    1,
    120_000,
    "bundle.invocation.timeoutMs",
  );
  const parameters = array(invocation.parameters, "bundle.invocation.parameters");
  if (parameters.length !== PARAMETERS.length) {
    fail("The Modelica bundle requires the complete qualified parameter set.");
  }
  const authorizedParameters = parameters.map((value, index) =>
    validateParameter(
      value,
      PARAMETERS[index]!,
      `bundle.invocation.parameters[${index}]`,
    )
  );
  const metrics = array(invocation.metrics, "bundle.invocation.metrics");
  if (metrics.length !== 1) fail("The Modelica bundle requires one qualified metric.");
  const metric = record(metrics[0], "bundle.invocation.metrics[0]");
  exactKeys(metric, ["id", "required", "unit"], "bundle.invocation.metrics[0]");
  literal(metric.id, "temperature_final", "bundle.invocation.metrics[0].id");
  literal(metric.required, true, "bundle.invocation.metrics[0].required");
  literal(metric.unit, "degC", "bundle.invocation.metrics[0].unit");

  const method = validateMethod(root.method);
  return Object.freeze({
    document: root,
    sha256: await sha256(bytes),
    invocation: Object.freeze({
      timeoutMs,
      parameters: Object.freeze(authorizedParameters),
    }),
    method,
  });
}

export async function createQualifiedKit(): Promise<ModelicaKit> {
  if (
    await sha256(new TextEncoder().encode(MODELICA_QUALIFIED_MODEL_SOURCE)) !==
      MODEL_SHA256 ||
    await sha256(new TextEncoder().encode(MODELICA_QUALIFIED_SCENARIO_SOURCE)) !==
      SCENARIO_SHA256
  ) {
    fail("The code-owned Modelica kit sources do not match their reviewed digests.");
  }
  return {
    id: KIT_ID,
    version: KIT_VERSION,
    description:
      "Minimal balanced Modelica ramp for real OMC integration coverage; not a physical thermal oracle.",
    modelName: MODEL_NAME,
    modelSource: MODELICA_QUALIFIED_MODEL_SOURCE,
    parameters: PARAMETERS.map((parameter) => ({
      id: parameter.id,
      modelicaName: parameter.modelicaName,
      modelicaType: parameter.modelicaType,
      description: parameter.description,
      unit: parameter.inputUnit,
      defaultValue: parameter.defaultValue,
      minimum: parameter.minimum,
      maximum: parameter.maximum,
      conversion: {
        from: parameter.inputUnit,
        to: parameter.modelicaUnit,
        factor: parameter.factor,
        offset: parameter.offset,
      },
    })),
    scenarios: [{
      id: SCENARIO_ID,
      description:
        "Solver-conformance ramp from 20 degC at 1 K/s for two seconds; no physical heat balance is claimed.",
      startTimeS: 0,
      stopTimeS: 2,
      numberOfIntervals: 20,
      solver: "dassl",
      targetTemperature: { value: 22, unit: "degC" },
      source: MODELICA_QUALIFIED_SCENARIO_SOURCE,
    }],
    producedMetrics: [{
      id: "temperature_final",
      unit: "degC",
      description: "Final solver sample of the ramp output.",
      required: true,
    }],
    resultNormalizer: {
      ...RESULT_NORMALIZER,
      normalize(resultCsv) {
        const rows = parseCsv(resultCsv);
        if (rows.length < 2) fail("OpenModelica ramp CSV has no data rows.");
        const headers = rows[0]!.map((header) => header.replace(/^\uFEFF/, "").trim());
        const stateIndex = headers.indexOf("temperatureC");
        if (stateIndex < 0) {
          fail("OpenModelica ramp CSV lacks the qualified temperatureC column.");
        }
        const finalValue = Number(rows.at(-1)![stateIndex]);
        if (!Number.isFinite(finalValue)) {
          fail("OpenModelica ramp CSV has no finite final temperatureC value.");
        }
        return {
          metrics: { temperature_final: { value: finalValue, unit: "degC" } },
          warnings: [],
        };
      },
    },
  };
}

async function validateSuccessfulRun(
  service: ModelicaService,
  run: SimulationRun,
  bundle: AuthorizedBundle,
): Promise<string> {
  if (run.status !== "succeeded") {
    const diagnostic = run.artifacts.find((artifact) =>
      artifact.kind === "diagnostics"
    );
    if (!diagnostic) {
      fail(`OpenModelica returned ${run.status} without its diagnostics artifact.`);
    }
    const reopened = await service.readRunArtifact(run.run_id, diagnostic.uri);
    const excerpt = Array.from(reopened.source, (character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f ? " " : character;
    }).join("").trim().slice(-1_000);
    fail(
      `OpenModelica returned ${run.status}${
        excerpt.length === 0 ? "." : `: ${excerpt}`
      }`,
    );
  }
  const identityChecks: readonly [string, unknown, unknown][] = [
    ["model.id", run.model.id, KIT_ID],
    ["model.version", run.model.version, KIT_VERSION],
    ["model.name", run.model.name, MODEL_NAME],
    ["model.source_sha256", run.model.source_sha256, MODEL_SHA256],
    ["scenario.id", run.scenario.id, SCENARIO_ID],
    ["scenario.source_sha256", run.scenario.source_sha256, SCENARIO_SHA256],
    ["result_normalizer", run.result_normalizer, RESULT_NORMALIZER],
    ["engine.name", run.engine.name, bundle.method.engine.name],
    ["engine.version", run.engine.version, bundle.method.engine.version],
    ["engine.msl_version", run.engine.msl_version, bundle.method.engine.mslVersion],
  ];
  for (const [path, actual, expected] of identityChecks) {
    if (canonicalJson(actual) !== canonicalJson(expected)) {
      fail(`The OpenModelica run identity differs at ${path}.`);
    }
  }
  const expectedParameters = Object.fromEntries(
    bundle.invocation.parameters.map((parameter) => [
      parameter.id,
      { value: parameter.inputValue, unit: parameter.inputUnit },
    ]),
  );
  if (canonicalJson(run.resolved_parameters) !== canonicalJson(expectedParameters)) {
    fail("The OpenModelica run changed a qualified parameter or unit.");
  }
  const metricKeys = Object.keys(run.metrics);
  const metric = run.metrics.temperature_final;
  if (
    metricKeys.length !== 1 || metricKeys[0] !== "temperature_final" || !metric ||
    !Number.isFinite(metric.value) || metric.unit !== "degC" ||
    !Array.isArray(run.warnings) || run.warnings.length !== 0
  ) {
    fail("The OpenModelica run did not emit the qualified normalized result.");
  }
  const resultArtifacts = run.artifacts.filter((artifact) =>
    artifact.kind === "result"
  );
  if (resultArtifacts.length !== 1) {
    fail("The OpenModelica run has no singular CSV result.");
  }
  const result = await service.readRunArtifact(run.run_id, resultArtifacts[0]!.uri);
  if (
    result.kind !== "result" || result.bytes !== resultArtifacts[0]!.bytes ||
    result.sha256 !== resultArtifacts[0]!.sha256 || result.source.length === 0 ||
    !result.source.endsWith("\n") || result.source.includes("\0")
  ) {
    fail("The OpenModelica CSV cannot be reopened exactly.");
  }
  return result.source;
}

function validateMethod(value: unknown): AuthorizedBundle["method"] {
  const method = record(value, "bundle.method");
  exactKeys(method, ["engine", "lowering", "resultNormalizer"], "bundle.method");
  const lowering = identity(method.lowering, "bundle.method.lowering");
  const normalizer = identity(
    method.resultNormalizer,
    "bundle.method.resultNormalizer",
  );
  if (
    canonicalJson(lowering) !== canonicalJson(LOWERING) ||
    canonicalJson(normalizer) !== canonicalJson(RESULT_NORMALIZER)
  ) fail("The Modelica bundle names an unsupported method.");
  const engine = record(method.engine, "bundle.method.engine");
  exactKeys(engine, ["mslVersion", "name", "version"], "bundle.method.engine");
  literal(engine.name, "OpenModelica", "bundle.method.engine.name");
  return Object.freeze({
    lowering,
    resultNormalizer: normalizer,
    engine: Object.freeze({
      name: "OpenModelica",
      version: nonEmpty(engine.version, "bundle.method.engine.version"),
      mslVersion: nonEmpty(engine.mslVersion, "bundle.method.engine.mslVersion"),
    }),
  });
}

async function validateInput(
  value: unknown,
  expected: {
    readonly role: string;
    readonly basename: string;
    readonly mediaType: string;
    readonly text: string;
    readonly sha256: string;
  },
  path: string,
): Promise<void> {
  const input = record(value, path);
  exactKeys(input, [
    "basename",
    "byteCount",
    "mediaType",
    "role",
    "sha256",
    "text",
  ], path);
  literal(input.role, expected.role, `${path}.role`);
  literal(input.basename, expected.basename, `${path}.basename`);
  literal(input.mediaType, expected.mediaType, `${path}.mediaType`);
  literal(input.text, expected.text, `${path}.text`);
  const bytes = new TextEncoder().encode(expected.text);
  literal(input.byteCount, bytes.byteLength, `${path}.byteCount`);
  literal(input.sha256, expected.sha256, `${path}.sha256`);
  if (await sha256(bytes) !== expected.sha256) fail(`${path} digest is inconsistent.`);
}

function validateParameter(
  value: unknown,
  expected: (typeof PARAMETERS)[number],
  path: string,
): AuthorizedParameter {
  const parameter = record(value, path);
  exactKeys(parameter, [
    "id",
    "inputUnit",
    "inputValue",
    "modelicaName",
    "modelicaUnit",
    "modelicaValue",
  ], path);
  literal(parameter.id, expected.id, `${path}.id`);
  literal(parameter.modelicaName, expected.modelicaName, `${path}.modelicaName`);
  literal(parameter.inputUnit, expected.inputUnit, `${path}.inputUnit`);
  literal(parameter.modelicaUnit, expected.modelicaUnit, `${path}.modelicaUnit`);
  const inputValue = finite(parameter.inputValue, `${path}.inputValue`);
  if (inputValue < expected.minimum || inputValue > expected.maximum) {
    fail(`${path}.inputValue is outside the qualified range.`);
  }
  const modelicaValue = finite(parameter.modelicaValue, `${path}.modelicaValue`);
  const converted = normalizeNumber(inputValue * expected.factor + expected.offset);
  if (!Object.is(modelicaValue, converted) && modelicaValue !== converted) {
    fail(`${path}.modelicaValue differs from the code-owned unit conversion.`);
  }
  return Object.freeze({
    id: expected.id,
    modelicaName: expected.modelicaName,
    inputValue: normalizeNumber(inputValue),
    inputUnit: expected.inputUnit,
    modelicaValue: normalizeNumber(modelicaValue),
    modelicaUnit: expected.modelicaUnit,
  });
}

function identity(
  value: unknown,
  path: string,
): { readonly id: string; readonly version: string } {
  const item = record(value, path);
  exactKeys(item, ["id", "version"], path);
  return Object.freeze({
    id: nonEmpty(item.id, `${path}.id`),
    version: nonEmpty(item.version, `${path}.version`),
  });
}

async function assertEmptyDirectory(path: string, label: string): Promise<void> {
  const info = await Deno.lstat(path);
  if (!info.isDirectory || info.isSymlink) {
    fail(`The fixed ${label} path is not a directory.`);
  }
  for await (const _entry of Deno.readDir(path)) {
    fail(`The fixed ${label} directory is not empty.`);
  }
}

async function assertExactOutputDirectory(path: string): Promise<void> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The Modelica output set is not regular files.");
    }
    names.push(entry.name);
  }
  names.sort(compareAscii);
  if (canonicalJson(names) !== canonicalJson(["evidence.json", "result.csv"])) {
    fail("The Modelica worker emitted an unexpected output set.");
  }
}

async function writeControlEvidence(): Promise<void> {
  const control = MODELICA_MICROSANDBOX_WORKER_CONTRACT.controlFiles;
  await Deno.mkdir(control.directory, { mode: 0o700 });
  for (const path of [control.stdoutPath, control.stderrPath]) {
    await Deno.writeFile(path, new Uint8Array(), {
      createNew: true,
      mode: 0o400,
    });
  }
  const quiescenceBytes = new TextEncoder().encode(control.quiescenceText);
  // Written last: its presence means every awaited OMC command and declared
  // output write completed before the backend is allowed to inventory bytes.
  await Deno.writeFile(control.quiescencePath, quiescenceBytes, {
    createNew: true,
    mode: 0o400,
  });
  const expected = ["quiesced.json", "stderr.bin", "stdout.bin"];
  const observed: string[] = [];
  for await (const entry of Deno.readDir(control.directory)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The Modelica worker control evidence is not regular files.");
    }
    observed.push(entry.name);
  }
  observed.sort(compareAscii);
  if (canonicalJson(observed) !== canonicalJson(expected)) {
    fail("The Modelica worker control evidence set is not exact.");
  }
  if (
    await Deno.readTextFile(control.quiescencePath) !== control.quiescenceText ||
    (await Deno.readFile(control.stdoutPath)).byteLength !== 0 ||
    (await Deno.readFile(control.stderrPath)).byteLength !== 0
  ) fail("The Modelica worker control evidence failed its exact reread.");
}

function parseCsv(source: string): string[][] {
  return source.trim().split(/\r?\n/).map((line) =>
    line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""))
  );
}

export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      fail("Canonical JSON cannot encode a non-finite number.");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    const entries = Object.keys(item).filter((key) => item[key] !== undefined)
      .sort(compareAscii).map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(item[key])}`
      );
    return `{${entries.join(",")}}`;
  }
  fail(`Canonical JSON cannot encode ${typeof value}.`);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function decode(bytes: Uint8Array, path: string): string {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail(`${path} is not UTF-8.`);
  }
  if (new TextEncoder().encode(source).byteLength !== bytes.byteLength) {
    fail(`${path} is not canonical UTF-8.`);
  }
  return source;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const observed = Object.keys(value).sort(compareAscii);
  const sortedExpected = [...expected].sort(compareAscii);
  if (canonicalJson(observed) !== canonicalJson(sortedExpected)) {
    fail(`${path} has an unsupported shape.`);
  }
}

function literal(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) fail(`${path} is not the registered value.`);
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail(`${path} must be a canonical non-empty string.`);
  }
  return value;
}

function digest(value: unknown, path: string): string {
  const text = nonEmpty(value, path);
  if (!/^[a-f0-9]{64}$/.test(text)) fail(`${path} must be a lowercase SHA-256.`);
  return text;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be finite.`);
  }
  return normalizeNumber(value);
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (
    !Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum
  ) {
    fail(`${path} is outside its integer bounds.`);
  }
  return Number(value);
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string): never {
  throw new TypeError(message);
}
