/**
 * Image-owned OpenModelica wrapper for admitted LinearThermalRamp-form source.
 *
 * Unlike the qualified kit worker, this wrapper executes the exact admitted
 * `/input/source.mo` bytes. Scenario, solver, metric and image remain
 * code-owned. The bundle cannot select a command or executable.
 */

import {
  KitRegistry,
  type ModelicaKit,
  ModelicaService,
  OpenModelicaRunner,
  type SimulationRun,
} from "jsr:@casys/mcp-modelica@0.4.0";
import { MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const EVIDENCE_SCHEMA = "modelica-isolated-evidence/1.0";
const FIXED_PATHS = Object.freeze({
  source: MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.sourcePath,
  output: MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.outputDirectory,
  work: MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.workDirectory,
});
const KIT_VERSION = "0.1.0";
const SCENARIO_ID = "linear-ramp-nominal";
const MODELICA_ADMITTED_SCENARIO_SOURCE = `{
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
const LOWERING = Object.freeze({ id: "modelica-omc-lowering", version: "1.0.0" });
const RESULT_NORMALIZER = Object.freeze({
  id: "linear-thermal-ramp-result-normalizer",
  version: "1.0.0",
});

export interface AuthorizedAdmittedModelicaSource {
  readonly modelName: string;
  readonly source: string;
  readonly sha256: string;
  readonly byteCount: number;
}

if (import.meta.main) await main();

async function main(): Promise<void> {
  if (
    Deno.args.length !== 3 || Deno.args[0] !== FIXED_PATHS.source ||
    Deno.args[1] !== FIXED_PATHS.output || Deno.args[2] !== FIXED_PATHS.work
  ) {
    fail("The admitted Modelica wrapper requires its three registered paths.");
  }
  const authorized = await authorizeAdmittedModelicaSource(
    await Deno.readFile(FIXED_PATHS.source),
  );
  await assertEmptyDirectory(FIXED_PATHS.output, "output");
  await assertEmptyDirectory(FIXED_PATHS.work, "work");

  const runsDirectory = `${FIXED_PATHS.work}/runs`;
  await Deno.mkdir(runsDirectory, { mode: 0o700 });
  const kit = createAdmittedKit(authorized);
  const service = new ModelicaService(
    new KitRegistry([kit]),
    new OpenModelicaRunner("omc", FIXED_PATHS.work),
    runsDirectory,
  );
  const run = await service.simulate({
    model_id: kit.id,
    scenario_id: SCENARIO_ID,
    parameter_overrides: {},
    timeout_ms: 30_000,
  });
  const resultCsv = await validateSuccessfulRun(service, run, authorized);
  const resultBytes = new TextEncoder().encode(resultCsv);
  const resultSha256 = await sha256(resultBytes);
  const evidence = {
    schemaVersion: EVIDENCE_SCHEMA,
    inputBundleSha256: authorized.sha256,
    status: "succeeded",
    method: {
      lowering: LOWERING,
      resultNormalizer: RESULT_NORMALIZER,
      engine: {
        name: run.engine.name,
        version: run.engine.version,
        mslVersion: run.engine.msl_version,
      },
    },
    resolvedParameters: [
      parameterEvidence("heating_rate", "heatingRate", run, "K/s"),
      parameterEvidence("initial_temperature", "initialTemperature", run, "degC"),
    ],
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

/** Pure admission used by the worker and unit tests. */
export async function authorizeAdmittedModelicaSource(
  bytes: Uint8Array,
): Promise<AuthorizedAdmittedModelicaSource> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    fail("The admitted Modelica source must contain bytes.");
  }
  const source = decode(bytes, "admitted source");
  if (source.includes("\0") || source.length > 262_144) {
    fail("The admitted Modelica source is not a closed-subset UTF-8 model.");
  }
  const modelName = closedSubsetModelName(source);
  return Object.freeze({
    modelName,
    source,
    sha256: await sha256(bytes),
    byteCount: bytes.byteLength,
  });
}

export function createAdmittedKit(
  authorized: AuthorizedAdmittedModelicaSource,
): ModelicaKit {
  return {
    id: kitIdFor(authorized.modelName),
    version: KIT_VERSION,
    description:
      "Admitted LinearThermalRamp-form Modelica source; not a physical thermal oracle.",
    modelName: authorized.modelName,
    modelSource: authorized.source,
    parameters: [
      {
        id: "heating_rate",
        modelicaName: "heatingRate",
        modelicaType: "Real",
        description: "Constant derivative used by the closed-subset ramp.",
        unit: "K/s",
        defaultValue: 1,
        minimum: 0.1,
        maximum: 10,
        conversion: { from: "K/s", to: "K/s", factor: 1, offset: 0 },
      },
      {
        id: "initial_temperature",
        modelicaName: "initialTemperature",
        modelicaType: "Real",
        description: "Initial value of the closed-subset ramp.",
        unit: "degC",
        defaultValue: 20,
        minimum: -50,
        maximum: 100,
        conversion: { from: "degC", to: "degC", factor: 1, offset: 0 },
      },
    ],
    scenarios: [{
      id: SCENARIO_ID,
      description:
        "Server-owned ramp window: 0 to 2 s, 20 intervals, dassl. Not caller-selected.",
      startTimeS: 0,
      stopTimeS: 2,
      numberOfIntervals: 20,
      solver: "dassl",
      targetTemperature: { value: 22, unit: "degC" },
      source: MODELICA_ADMITTED_SCENARIO_SOURCE,
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
          fail("OpenModelica ramp CSV lacks the temperatureC column.");
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

export function closedSubsetModelName(source: string): string {
  const match = source.match(
    /^model\s+([A-Za-z_][A-Za-z0-9_]*)\b[\s\S]*\bend\s+\1\s*;\s*$/,
  );
  if (!match) fail("The admitted Modelica source is not one closed model block.");
  const modelName = match[1]!;
  if (
    !/\bparameter\s+Real\s+initialTemperature\b/.test(source) ||
    !/\bparameter\s+Real\s+heatingRate\b/.test(source) ||
    !/\boutput\s+Real\s+temperatureC\b/.test(source) ||
    !/\bder\s*\(\s*temperatureC\s*\)\s*=\s*heatingRate\s*;/.test(source)
  ) {
    fail("The admitted Modelica source is outside the LinearThermalRamp form.");
  }
  if (
    /\b(import|extends|class|block|record|function|package|when|for|while|if)\b/
      .test(source)
  ) {
    fail("The admitted Modelica source contains an unsupported construct.");
  }
  return modelName;
}

function kitIdFor(modelName: string): string {
  return `admitted-${modelName.replaceAll(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
}

function parameterEvidence(
  id: string,
  modelicaName: string,
  run: SimulationRun,
  unit: string,
): {
  readonly id: string;
  readonly modelicaName: string;
  readonly value: number;
  readonly unit: string;
  readonly modelicaValue: number;
  readonly modelicaUnit: string;
} {
  const resolved = run.resolved_parameters[id];
  if (!resolved || resolved.unit !== unit || !Number.isFinite(resolved.value)) {
    fail(`The OpenModelica run omitted qualified parameter ${id}.`);
  }
  return {
    id,
    modelicaName,
    value: resolved.value,
    unit,
    modelicaValue: resolved.value,
    modelicaUnit: unit,
  };
}

async function validateSuccessfulRun(
  service: ModelicaService,
  run: SimulationRun,
  authorized: AuthorizedAdmittedModelicaSource,
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
  if (
    run.model.name !== authorized.modelName ||
    run.model.source_sha256 !== authorized.sha256 ||
    run.scenario.id !== SCENARIO_ID
  ) {
    fail("The OpenModelica run identity is not the admitted source.");
  }
  const metric = run.metrics.temperature_final;
  if (
    Object.keys(run.metrics).length !== 1 || !metric ||
    !Number.isFinite(metric.value) || metric.unit !== "degC" ||
    !Array.isArray(run.warnings) || run.warnings.length !== 0
  ) {
    fail("The OpenModelica run did not emit the closed-subset normalized result.");
  }
  const resultArtifacts = run.artifacts.filter((artifact) =>
    artifact.kind === "result"
  );
  if (resultArtifacts.length !== 1) {
    fail("The OpenModelica run has no singular CSV result.");
  }
  const result = await service.readRunArtifact(run.run_id, resultArtifacts[0]!.uri);
  if (
    result.kind !== "result" || result.source.length === 0 ||
    !result.source.endsWith("\n") || result.source.includes("\0")
  ) {
    fail("The OpenModelica CSV cannot be reopened exactly.");
  }
  return result.source;
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
  const control = MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT.controlFiles;
  await Deno.mkdir(control.directory, { mode: 0o700 });
  for (const path of [control.stdoutPath, control.stderrPath]) {
    await Deno.writeFile(path, new Uint8Array(), {
      createNew: true,
      mode: 0o400,
    });
  }
  const quiescenceBytes = new TextEncoder().encode(control.quiescenceText);
  await Deno.writeFile(control.quiescencePath, quiescenceBytes, {
    createNew: true,
    mode: 0o400,
  });
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

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fail(message: string): never {
  throw new TypeError(message);
}
