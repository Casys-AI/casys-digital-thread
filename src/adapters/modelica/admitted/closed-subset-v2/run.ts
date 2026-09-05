/** Image-owned OMC execution for the generic admitted Modelica subset v2. */

import {
  type AuthorizedModelicaClosedSubsetV2Source,
  authorizeModelicaClosedSubsetV2Source,
} from "../../../../domain/modelica/source/closed-subset-v2.ts";
import { MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const SOLVER = "dassl";
const TIME_TOLERANCE = 1e-12;
const PATHS = MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;

export interface AuthorizedAdmittedModelicaSource {
  readonly source: AuthorizedModelicaClosedSubsetV2Source;
  readonly sha256: string;
  readonly byteCount: number;
}

if (import.meta.main) await main();

async function main(): Promise<void> {
  assertInvocation();
  const authorized = await authorizeAdmittedModelicaSource(
    await Deno.readFile(PATHS.sourcePath),
  );
  await assertEmptyDirectory(PATHS.outputDirectory, "output");
  await assertEmptyDirectory(PATHS.workDirectory, "work");
  const rawResultCsv = await runOpenModelica(authorized.source);
  const normalized = normalizeAdmittedCsv(rawResultCsv, authorized.source);
  const resultBytes = new TextEncoder().encode(normalized.csv);
  const metrics = metricsFor(normalized.samples, authorized.source);
  const evidence = {
    schemaVersion: "modelica-isolated-evidence/2.0",
    inputBundleSha256: authorized.sha256,
    status: "succeeded",
    modelName: authorized.source.modelName,
    method: {
      lowering: { id: "modelica-omc-lowering", version: "1.0.0" },
      resultNormalizer: {
        id: "modelica-closed-subset-v2-result-normalizer",
        version: "2.0.0",
      },
      engine: await openModelicaEngine(),
    },
    resolvedParameters: authorized.source.parameters.map((parameter) => ({
      name: parameter.name,
      value: parameter.defaultValue,
      unit: attributeString(parameter.attributes, "unit"),
    })),
    scenario: { ...authorized.source.scenario, solver: SOLVER },
    metrics,
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: resultBytes.byteLength,
      sha256: await sha256(resultBytes),
    },
    warnings: [],
  };
  await Deno.writeFile(`${PATHS.outputDirectory}/result.csv`, resultBytes, {
    createNew: true,
    mode: 0o400,
  });
  await Deno.writeFile(
    `${PATHS.outputDirectory}/evidence.json`,
    new TextEncoder().encode(canonicalJson(evidence)),
    { createNew: true, mode: 0o400 },
  );
  await assertExactOutputDirectory(PATHS.outputDirectory);
  await writeControlEvidence();
}

export async function authorizeAdmittedModelicaSource(
  bytes: Uint8Array,
): Promise<AuthorizedAdmittedModelicaSource> {
  if (
    !(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
    bytes.byteLength > 262_144
  ) {
    fail("The admitted Modelica source must contain 1 to 262144 bytes.");
  }
  let sourceText: string;
  try {
    sourceText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("The admitted Modelica source is not UTF-8.");
  }
  if (new TextEncoder().encode(sourceText).byteLength !== bytes.byteLength) {
    fail("The admitted Modelica source is not canonical UTF-8.");
  }
  return Object.freeze({
    source: authorizeModelicaClosedSubsetV2Source(sourceText),
    sha256: await sha256(bytes),
    byteCount: bytes.byteLength,
  });
}

/** The signed source annotation is the scenario; DASSL is fixed worker policy. */
export function admittedScenarioFor(source: AuthorizedModelicaClosedSubsetV2Source) {
  return Object.freeze({ ...source.scenario, solver: SOLVER });
}

/** Restricts OMC's CSV surface to the declared output names, in source order. */
export function admittedOutputVariableFilter(
  source: AuthorizedModelicaClosedSubsetV2Source,
): string {
  return `^(?:${source.outputs.map((output) => escapeRegex(output.name)).join("|")})$`;
}

/** Validate the declared output grid only; no project-specific analytic oracle. */
export function normalizeAdmittedResult(
  resultCsv: string,
  source: AuthorizedModelicaClosedSubsetV2Source,
): readonly {
  readonly outputName: string;
  readonly statistic: "final" | "max_abs";
  readonly value: number;
  readonly unit: string;
}[] {
  return metricsFor(normalizeAdmittedCsv(resultCsv, source).samples, source);
}

function metricsFor(
  samples: readonly {
    readonly time: number;
    readonly values: Record<string, number>;
  }[],
  source: AuthorizedModelicaClosedSubsetV2Source,
): readonly {
  readonly outputName: string;
  readonly statistic: "final" | "max_abs";
  readonly value: number;
  readonly unit: string;
}[] {
  const metrics: {
    outputName: string;
    statistic: "final" | "max_abs";
    value: number;
    unit: string;
  }[] = [];
  for (const output of source.outputs) {
    const values = samples.map((sample) => sample.values[output.name]!);
    metrics.push({
      outputName: output.name,
      statistic: "final",
      value: values.at(-1)!,
      unit: attributeString(output.attributes, "unit"),
    }, {
      outputName: output.name,
      statistic: "max_abs",
      value: Math.max(...values.map((value) => Math.abs(value))),
      unit: attributeString(output.attributes, "unit"),
    });
  }
  return Object.freeze(metrics.map((metric) => Object.freeze(metric)));
}

async function runOpenModelica(
  source: AuthorizedModelicaClosedSubsetV2Source,
): Promise<string> {
  const resultBasename = "modelica-result";
  const scriptPath = `${PATHS.workDirectory}/run.mos`;
  const scenario = admittedScenarioFor(source);
  const script = [
    `loadFile(${JSON.stringify(PATHS.sourcePath)});`,
    `simulate(${source.modelName}, startTime=${scenario.startTimeS}, stopTime=${scenario.stopTimeS}, numberOfIntervals=${scenario.numberOfIntervals}, tolerance=${scenario.tolerance}, method=\"${SOLVER}\", outputFormat=\"csv\", variableFilter=${
      JSON.stringify(admittedOutputVariableFilter(source))
    }, fileNamePrefix=${JSON.stringify(resultBasename)});`,
    "getErrorString();",
  ].join("\n");
  await Deno.writeTextFile(scriptPath, script, { createNew: true, mode: 0o400 });
  let command: Deno.CommandOutput;
  try {
    command = await new Deno.Command("omc", {
      args: [scriptPath],
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(30_000),
    }).output();
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      fail("OpenModelica exceeded the worker's code-owned 30000 ms timeout.");
    }
    throw error;
  }
  if (!command.success) {
    const diagnostic = new TextDecoder().decode(command.stderr).replaceAll(
      // deno-lint-ignore no-control-regex -- Worker diagnostics are normalized before evidence handling.
      /[\x00-\x1f\x7f]/g,
      " ",
    ).trim().slice(-1_000);
    fail(`OpenModelica failed${diagnostic.length === 0 ? "." : `: ${diagnostic}`}`);
  }
  try {
    return await Deno.readTextFile(
      `${PATHS.workDirectory}/${resultBasename}_res.csv`,
    );
  } catch {
    fail("OpenModelica did not produce its code-owned CSV result.");
  }
}

function normalizeAdmittedCsv(
  resultCsv: string,
  source: AuthorizedModelicaClosedSubsetV2Source,
): {
  readonly csv: string;
  readonly samples: readonly {
    readonly time: number;
    readonly values: Record<string, number>;
  }[];
} {
  if (
    !resultCsv.endsWith("\n") || resultCsv.includes("\r") || resultCsv.includes("\0")
  ) {
    fail("OpenModelica CSV must be canonical LF text.");
  }
  const lines = resultCsv.slice(0, -1).split("\n");
  const header = csvRow(lines[0]!);
  const expected = [
    "time",
    ...source.outputs.map((output) => output.name),
  ];
  if (
    header.length !== expected.length || new Set(header).size !== header.length ||
    expected.some((column) => !header.includes(column))
  ) {
    fail("OpenModelica CSV columns are not the admitted output set.");
  }
  const columns = new Map(header.map((column, index) => [column, index]));
  const samples: { time: number; values: Record<string, number> }[] = [];
  const derivativeOutputs = new Set(
    source.equations.filter((equation) => equation.discriminator === "der")
      .map((equation) => equation.lhsName),
  );
  const seen = new Set<number>();
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const text of lines.slice(1)) {
    const cells = csvRow(text);
    if (cells.length !== header.length) fail("OpenModelica CSV has a ragged row.");
    const time = Number(cells[columns.get("time")!]);
    if (!Number.isFinite(time) || time < previousTime) {
      fail("OpenModelica CSV time is invalid.");
    }
    const gridIndex = Math.round(
      (time - source.scenario.startTimeS) / source.scenario.intervalS,
    );
    if (
      gridIndex < 0 || gridIndex > source.scenario.numberOfIntervals ||
      Math.abs(
          time - (source.scenario.startTimeS + gridIndex * source.scenario.intervalS),
        ) > TIME_TOLERANCE
    ) {
      fail("OpenModelica CSV sample is outside the declared experiment grid.");
    }
    const values: Record<string, number> = {};
    for (const output of source.outputs) {
      const value = Number(cells[columns.get(output.name)!]);
      if (!Number.isFinite(value)) {
        fail("OpenModelica CSV contains a non-finite output.");
      }
      values[output.name] = value;
      if (
        gridIndex === 0 && derivativeOutputs.has(output.name) &&
        !initialValueMatches(
          value,
          outputStart(source, output),
          source.scenario.tolerance,
        )
      ) {
        fail("OpenModelica CSV initial output does not match declared start.");
      }
    }
    seen.add(gridIndex);
    samples.push({ time, values });
    previousTime = time;
  }
  if (
    samples.length < source.scenario.numberOfIntervals + 1 ||
    samples.length > source.scenario.numberOfIntervals + 2 ||
    samples[0]?.time !== source.scenario.startTimeS ||
    samples.at(-1)?.time !== source.scenario.stopTimeS ||
    seen.size !== source.scenario.numberOfIntervals + 1
  ) {
    fail("OpenModelica CSV does not cover the declared experiment grid.");
  }
  const csv = [
    ["time", ...source.outputs.map((output) => output.name)].map(csvCell).join(","),
    ...samples.map((sample) =>
      [
        sample.time,
        ...source.outputs.map((output) => sample.values[output.name]!),
      ].map((value) => String(value)).join(",")
    ),
  ].join("\n") + "\n";
  return Object.freeze({ csv, samples: Object.freeze(samples) });
}

function csvRow(text: string): string[] {
  const cells = text.split(",");
  if (
    cells.length < 2 || cells.some((cell) => cell.length === 0 || cell !== cell.trim())
  ) fail("OpenModelica CSV has invalid cells.");
  return cells.map((cell) =>
    cell.startsWith('"') && cell.endsWith('"') ? cell.slice(1, -1) : cell
  );
}
function csvCell(value: string): string {
  return JSON.stringify(value);
}
function attributeString(
  attributes: readonly { name: string; value: unknown }[],
  name: string,
): string {
  const value = attributes.find((attribute) => attribute.name === name)?.value;
  if (typeof value !== "string") {
    fail(`Authorized Modelica attribute ${name} is not string.`);
  }
  return value;
}
function outputStart(
  source: AuthorizedModelicaClosedSubsetV2Source,
  output: AuthorizedModelicaClosedSubsetV2Source["outputs"][number],
): number {
  const start = output.attributes.find((attribute) => attribute.name === "start");
  if (typeof start?.value === "number" && Number.isFinite(start.value)) {
    return start.value;
  }
  const parameter = source.parameters.find((candidate) =>
    candidate.name === start?.referencedName
  );
  if (parameter === undefined) {
    fail("Authorized Modelica output start is not resolvable.");
  }
  return parameter.defaultValue;
}
function assertInvocation(): void {
  if (
    Deno.args.length !== 3 || Deno.args[0] !== PATHS.sourcePath ||
    Deno.args[1] !== PATHS.outputDirectory || Deno.args[2] !== PATHS.workDirectory
  ) fail("The admitted Modelica v2 worker requires its three registered paths.");
}
async function openModelicaEngine() {
  const version = await new Deno.Command("omc", {
    args: ["--version"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!version.success) fail("OpenModelica version read failed.");
  const text = new TextDecoder().decode(version.stdout).trim();
  if (text.length === 0) fail("OpenModelica version read was empty.");
  return { name: "OpenModelica", version: text, mslVersion: "not-used" };
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
  const entries: string[] = [];
  for await (const entry of Deno.readDir(path)) {
    if (!entry.isFile || entry.isSymlink) {
      fail("The Modelica output set is not regular files.");
    }
    entries.push(entry.name);
  }
  if (
    JSON.stringify(entries.sort()) !== JSON.stringify(["evidence.json", "result.csv"])
  ) fail("The Modelica worker emitted an unexpected output set.");
}
async function writeControlEvidence(): Promise<void> {
  const control = PATHS.controlFiles;
  await Deno.mkdir(control.directory, { mode: 0o700 });
  for (const path of [control.stdoutPath, control.stderrPath]) {
    await Deno.writeFile(path, new Uint8Array(), { createNew: true, mode: 0o400 });
  }
  await Deno.writeFile(
    control.quiescencePath,
    new TextEncoder().encode(control.quiescenceText),
    { createNew: true, mode: 0o400 },
  );
}
function canonicalJson(value: unknown): string {
  if (
    value === null || typeof value === "number" || typeof value === "boolean" ||
    typeof value === "string"
  ) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${
      Object.entries(value as Record<string, unknown>).filter(([, value]) =>
        value !== undefined
      ).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) =>
        `${JSON.stringify(key)}:${canonicalJson(value)}`
      ).join(",")
    }}`;
  }
  fail("Canonical JSON cannot encode this value.");
}
function initialValueMatches(
  actual: number,
  expected: number,
  tolerance: number,
): boolean {
  return Math.abs(actual - expected) <=
    Math.max(tolerance, 1e-9) * Math.max(1, Math.abs(expected));
}
function escapeRegex(value: string): string {
  return value.replaceAll(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function fail(message: string): never {
  throw new TypeError(message);
}
