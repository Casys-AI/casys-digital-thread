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
const START_TIME_S = 0;
const STOP_TIME_S = 2;
const NUMBER_OF_INTERVALS = 20;
const SOLVER = "dassl";
const SAMPLE_TIME_ABSOLUTE_TOLERANCE = 1e-12;
const FINAL_TEMPERATURE_ABSOLUTE_TOLERANCE = 1e-9;
const SCENARIO_DESCRIPTION =
  "Server-owned two-second solver-conformance ramp using the exact admitted parameter defaults; no physical heat balance is claimed.";
const HEATING_RATE_RANGE = Object.freeze({ minimum: 0.1, maximum: 10 });
const INITIAL_TEMPERATURE_RANGE = Object.freeze({ minimum: -50, maximum: 100 });
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
  readonly parameterDefaults: {
    readonly heatingRate: number;
    readonly initialTemperature: number;
  };
}

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
  const run = await service.simulate(createAdmittedSimulationRequest(kit));
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
      parameterEvidence(
        "heating_rate",
        "heatingRate",
        run,
        "K/s",
        authorized.parameterDefaults.heatingRate,
      ),
      parameterEvidence(
        "initial_temperature",
        "initialTemperature",
        run,
        "degC",
        authorized.parameterDefaults.initialTemperature,
      ),
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
  if (source.includes("\0") || bytes.byteLength > 262_144) {
    fail("The admitted Modelica source is not a closed-subset UTF-8 model.");
  }
  const parsed = parseClosedSubsetModel(source);
  return Object.freeze({
    modelName: parsed.modelName,
    source,
    sha256: await sha256(bytes),
    byteCount: bytes.byteLength,
    parameterDefaults: parsed.parameterDefaults,
  });
}

export function createAdmittedKit(
  authorized: AuthorizedAdmittedModelicaSource,
): ModelicaKit {
  const expectedFinalTemperature = finalTemperatureFor(
    authorized.parameterDefaults,
  );
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
        defaultValue: authorized.parameterDefaults.heatingRate,
        minimum: HEATING_RATE_RANGE.minimum,
        maximum: HEATING_RATE_RANGE.maximum,
        conversion: { from: "K/s", to: "K/s", factor: 1, offset: 0 },
      },
      {
        id: "initial_temperature",
        modelicaName: "initialTemperature",
        modelicaType: "Real",
        description: "Initial value of the closed-subset ramp.",
        unit: "degC",
        defaultValue: authorized.parameterDefaults.initialTemperature,
        minimum: INITIAL_TEMPERATURE_RANGE.minimum,
        maximum: INITIAL_TEMPERATURE_RANGE.maximum,
        conversion: { from: "degC", to: "degC", factor: 1, offset: 0 },
      },
    ],
    scenarios: [{
      id: SCENARIO_ID,
      description: SCENARIO_DESCRIPTION,
      startTimeS: START_TIME_S,
      stopTimeS: STOP_TIME_S,
      numberOfIntervals: NUMBER_OF_INTERVALS,
      solver: SOLVER,
      targetTemperature: { value: expectedFinalTemperature, unit: "degC" },
      source: admittedScenarioSource(expectedFinalTemperature),
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
        const finalValue = admittedResultFinalTemperature(
          resultCsv,
          authorized.parameterDefaults,
        );
        return {
          metrics: { temperature_final: { value: finalValue, unit: "degC" } },
          warnings: [],
        };
      },
    },
  };
}

export function createAdmittedSimulationRequest(
  kit: ModelicaKit,
): {
  readonly model_id: string;
  readonly scenario_id: string;
  readonly timeout_ms: number;
} {
  return Object.freeze({
    model_id: kit.id,
    scenario_id: SCENARIO_ID,
    timeout_ms: 30_000,
  });
}

export function closedSubsetModelName(source: string): string {
  return parseClosedSubsetModel(source).modelName;
}

interface ParsedClosedSubsetModel {
  readonly modelName: string;
  readonly parameterDefaults: AuthorizedAdmittedModelicaSource["parameterDefaults"];
}

function parseClosedSubsetModel(source: string): ParsedClosedSubsetModel {
  const cursor = new ClosedSubsetCursor(tokenizeClosedSubset(source));
  cursor.expect("model", "word");
  const modelName = cursor.expectIdentifier("model name");
  if (cursor.peek()?.kind === "string") cursor.take();

  const defaults = new Map<string, number>();
  let outputSeen = false;
  while (cursor.peek()?.text !== "equation") {
    if (cursor.peek()?.text === "parameter") {
      const parameter = parseExactParameter(cursor);
      if (defaults.has(parameter.name)) {
        fail(`The admitted Modelica parameter ${parameter.name} is duplicated.`);
      }
      defaults.set(parameter.name, parameter.defaultValue);
      continue;
    }
    if (cursor.peek()?.text === "output") {
      if (outputSeen) {
        fail("The admitted Modelica source declares more than one ramp output.");
      }
      parseExactOutput(cursor);
      outputSeen = true;
      continue;
    }
    fail("The admitted Modelica source is outside the LinearThermalRamp form.");
  }
  exactNames(defaults, ["heatingRate", "initialTemperature"], "ramp parameters");
  if (!outputSeen) {
    fail("The admitted Modelica source must declare exactly one ramp output.");
  }
  assertExactRampEquation(cursor, modelName);

  const heatingRate = boundedSourceDefault(
    defaults.get("heatingRate")!,
    HEATING_RATE_RANGE,
    "heatingRate",
  );
  const initialTemperature = boundedSourceDefault(
    defaults.get("initialTemperature")!,
    INITIAL_TEMPERATURE_RANGE,
    "initialTemperature",
  );
  return Object.freeze({
    modelName,
    parameterDefaults: Object.freeze({ heatingRate, initialTemperature }),
  });
}

type ClosedSubsetTokenKind = "number" | "punctuation" | "string" | "word";

interface ClosedSubsetToken {
  readonly kind: ClosedSubsetTokenKind;
  readonly text: string;
}

class ClosedSubsetCursor {
  #index = 0;

  constructor(readonly tokens: readonly ClosedSubsetToken[]) {}

  get done(): boolean {
    return this.#index === this.tokens.length;
  }

  peek(): ClosedSubsetToken | undefined {
    return this.tokens[this.#index];
  }

  take(): ClosedSubsetToken {
    const token = this.peek();
    if (token === undefined) {
      fail("The admitted Modelica source ended outside the LinearThermalRamp form.");
    }
    this.#index += 1;
    return token;
  }

  expect(text: string, kind?: ClosedSubsetTokenKind): ClosedSubsetToken {
    const token = this.take();
    if (token.text !== text || (kind !== undefined && token.kind !== kind)) {
      fail(
        `The admitted Modelica source expected ${text}; it is outside the LinearThermalRamp form.`,
      );
    }
    return token;
  }

  expectIdentifier(label: string): string {
    const token = this.take();
    if (token.kind !== "word" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(token.text)) {
      fail(`The admitted Modelica ${label} is not an exact identifier.`);
    }
    return token.text;
  }
}

interface ParsedParameter {
  readonly name: string;
  readonly defaultValue: number;
}

function parseExactParameter(cursor: ClosedSubsetCursor): ParsedParameter {
  cursor.expect("parameter", "word");
  cursor.expect("Real", "word");
  const name = cursor.expectIdentifier("ramp parameter");
  const unit = name === "heatingRate"
    ? "K/s"
    : name === "initialTemperature"
    ? "degC"
    : fail(`The admitted Modelica parameter ${name} is not registered.`);
  parseExactUnitAttribute(cursor, unit, name);
  cursor.expect("=", "punctuation");
  const defaultValue = parseSignedNumber(cursor, name);
  cursor.expect(";", "punctuation");
  return Object.freeze({ name, defaultValue });
}

function parseExactOutput(cursor: ClosedSubsetCursor): void {
  cursor.expect("output", "word");
  cursor.expect("Real", "word");
  cursor.expect("temperatureC", "word");
  cursor.expect("(", "punctuation");
  const attributes = new Map<string, ClosedSubsetToken>();
  while (cursor.peek()?.text !== ")") {
    const name = cursor.expectIdentifier("output attribute");
    if (attributes.has(name)) {
      fail("The admitted Modelica output attributes are not singular identifiers.");
    }
    cursor.expect("=", "punctuation");
    attributes.set(name, cursor.take());
    if (cursor.peek()?.text === ",") {
      cursor.take();
      continue;
    }
    if (cursor.peek()?.text !== ")") {
      fail("The admitted Modelica output attribute list is not closed.");
    }
  }
  cursor.expect(")", "punctuation");
  cursor.expect(";", "punctuation");
  exactNames(attributes, ["fixed", "start", "unit"], "output attributes");
  exactAttribute(attributes, "unit", "string", '"degC"');
  exactAttribute(attributes, "start", "word", "initialTemperature");
  exactAttribute(attributes, "fixed", "word", "true");
}

function parseExactUnitAttribute(
  cursor: ClosedSubsetCursor,
  expectedUnit: string,
  parameterName: string,
): void {
  cursor.expect("(", "punctuation");
  cursor.expect("unit", "word");
  cursor.expect("=", "punctuation");
  cursor.expect(JSON.stringify(expectedUnit), "string");
  cursor.expect(")", "punctuation");
  if (cursor.peek()?.text === ",") {
    fail(`The admitted Modelica parameter ${parameterName} has extra attributes.`);
  }
}

function assertExactRampEquation(
  cursor: ClosedSubsetCursor,
  modelName: string,
): void {
  cursor.expect("equation", "word");
  cursor.expect("der", "word");
  cursor.expect("(", "punctuation");
  cursor.expect("temperatureC", "word");
  cursor.expect(")", "punctuation");
  cursor.expect("=", "punctuation");
  cursor.expect("heatingRate", "word");
  cursor.expect(";", "punctuation");
  cursor.expect("end", "word");
  cursor.expect(modelName, "word");
  cursor.expect(";", "punctuation");
  if (!cursor.done) {
    fail("The admitted Modelica source has content after its root model.");
  }
}

function parseSignedNumber(
  cursor: ClosedSubsetCursor,
  parameterName: string,
): number {
  let sign = 1;
  if (cursor.peek()?.text === "-") {
    sign = -1;
    cursor.take();
  }
  const token = cursor.take();
  if (token?.kind !== "number") {
    fail(`The admitted Modelica parameter ${parameterName} needs a numeric default.`);
  }
  const value = sign * Number(token.text);
  if (!Number.isFinite(value)) {
    fail(`The admitted Modelica parameter ${parameterName} is not finite.`);
  }
  return value;
}

function exactNames(
  values: ReadonlyMap<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = [...values.keys()].sort(compareAscii);
  if (canonicalJson(actual) !== canonicalJson([...expected].sort(compareAscii))) {
    fail(`The admitted Modelica ${label} do not match the exact ramp form.`);
  }
}

function exactAttribute(
  attributes: ReadonlyMap<string, ClosedSubsetToken>,
  name: string,
  kind: ClosedSubsetTokenKind,
  text: string,
): void {
  const value = attributes.get(name);
  if (value?.kind !== kind || value.text !== text) {
    fail(`The admitted Modelica output attribute ${name} does not match ${text}.`);
  }
}

function tokenizeClosedSubset(source: string): readonly ClosedSubsetToken[] {
  const tokens: ClosedSubsetToken[] = [];
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index = consumeLineComment(source, index + 2);
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      index = consumeBlockComment(source, index + 2);
      continue;
    }
    if (character === '"') {
      const end = consumeString(source, index);
      tokens.push(Object.freeze({ kind: "string", text: source.slice(index, end) }));
      index = end;
      continue;
    }
    if (isDigit(character) || (character === "." && isDigit(source[index + 1]))) {
      const end = consumeNumber(source, index);
      tokens.push(Object.freeze({ kind: "number", text: source.slice(index, end) }));
      index = end;
      continue;
    }
    if (/[A-Za-z_]/.test(character)) {
      const end = consumeWhile(
        source,
        index + 1,
        (value) => /[A-Za-z0-9_]/.test(value),
      );
      tokens.push(Object.freeze({ kind: "word", text: source.slice(index, end) }));
      index = end;
      continue;
    }
    if ("=;(),-".includes(character)) {
      tokens.push(Object.freeze({ kind: "punctuation", text: character }));
      index += 1;
      continue;
    }
    fail("The admitted Modelica source contains an unsupported token.");
  }
  return Object.freeze(tokens);
}

function consumeLineComment(source: string, start: number): number {
  let index = start;
  while (index < source.length && source[index] !== "\n") index += 1;
  return index;
}

function consumeBlockComment(source: string, start: number): number {
  let index = start;
  while (index + 1 < source.length) {
    if (source[index] === "*" && source[index + 1] === "/") return index + 2;
    index += 1;
  }
  fail("The admitted Modelica source contains an unclosed block comment.");
}

function consumeString(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '"') return index + 1;
    index += 1;
  }
  fail("The admitted Modelica source contains an unclosed string.");
}

function consumeNumber(source: string, start: number): number {
  let index = start;
  if (source[index] === ".") {
    index = consumeWhile(source, index + 1, isDigit);
  } else {
    index = consumeWhile(source, index, isDigit);
    if (source[index] === ".") {
      index = consumeWhile(source, index + 1, isDigit);
    }
  }
  if (source[index] === "e" || source[index] === "E") {
    let exponent = index + 1;
    if (source[exponent] === "+" || source[exponent] === "-") exponent += 1;
    if (isDigit(source[exponent])) return consumeWhile(source, exponent + 1, isDigit);
  }
  return index;
}

function consumeWhile(
  source: string,
  start: number,
  predicate: (character: string) => boolean,
): number {
  let index = start;
  while (index < source.length && predicate(source[index]!)) index += 1;
  return index;
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function boundedSourceDefault(
  value: number,
  range: { readonly minimum: number; readonly maximum: number },
  name: string,
): number {
  if (value < range.minimum || value > range.maximum) {
    fail(
      `The admitted Modelica default ${name} must be between ${range.minimum} and ${range.maximum}.`,
    );
  }
  return value;
}

function finalTemperatureFor(
  defaults: AuthorizedAdmittedModelicaSource["parameterDefaults"],
): number {
  const value = defaults.initialTemperature +
    defaults.heatingRate * (STOP_TIME_S - START_TIME_S);
  if (!Number.isFinite(value)) {
    fail("The admitted Modelica ramp has no finite final temperature.");
  }
  return value;
}

function admittedScenarioSource(expectedFinalTemperature: number): string {
  return `${
    canonicalJson({
      description: SCENARIO_DESCRIPTION,
      id: SCENARIO_ID,
      number_of_intervals: NUMBER_OF_INTERVALS,
      solver: SOLVER,
      start_time_s: START_TIME_S,
      stop_time_s: STOP_TIME_S,
      target_temperature: { unit: "degC", value: expectedFinalTemperature },
    })
  }\n`;
}

function kitIdFor(modelName: string): string {
  return `admitted-${modelName.replaceAll(/[^A-Za-z0-9]+/g, "-").toLowerCase()}`;
}

function parameterEvidence(
  id: string,
  modelicaName: string,
  run: SimulationRun,
  unit: string,
  expectedValue: number,
): {
  readonly id: string;
  readonly modelicaName: string;
  readonly value: number;
  readonly unit: string;
  readonly modelicaValue: number;
  readonly modelicaUnit: string;
} {
  const resolved = run.resolved_parameters[id];
  if (
    !resolved || resolved.unit !== unit || !Number.isFinite(resolved.value) ||
    resolved.value !== expectedValue
  ) {
    fail(`The OpenModelica run parameter ${id} does not match the admitted source.`);
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
  if (
    canonicalJson(Object.keys(run.resolved_parameters).sort(compareAscii)) !==
      canonicalJson(["heating_rate", "initial_temperature"])
  ) {
    fail("The OpenModelica run parameter set does not match the admitted source.");
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

function admittedResultFinalTemperature(
  source: string,
  defaults: AuthorizedAdmittedModelicaSource["parameterDefaults"],
): number {
  if (
    source.length === 0 || !source.endsWith("\n") || source.includes("\r") ||
    source.includes("\0")
  ) {
    fail("OpenModelica ramp CSV is not canonical LF text.");
  }
  const lines = source.slice(0, -1).split("\n");
  const sampleCount = lines.length - 1;
  if (
    sampleCount !== NUMBER_OF_INTERVALS + 1 &&
    sampleCount !== NUMBER_OF_INTERVALS + 2
  ) {
    fail(
      `OpenModelica ramp CSV has ${sampleCount} samples for ${NUMBER_OF_INTERVALS} admitted intervals.`,
    );
  }
  const header = admittedCsvRow(lines[0]!, "result.header");
  const timeIndex = header.indexOf("time");
  const temperatureIndex = header.indexOf("temperatureC");
  if (
    timeIndex < 0 || temperatureIndex < 0 ||
    header.lastIndexOf("time") !== timeIndex ||
    header.lastIndexOf("temperatureC") !== temperatureIndex ||
    new Set(header).size !== header.length
  ) {
    fail("OpenModelica ramp CSV has unsupported columns.");
  }
  let previousTime = Number.NEGATIVE_INFINITY;
  let finalTemperature = Number.NaN;
  const observedGridIndices = new Set<number>();
  const sampleStep = (STOP_TIME_S - START_TIME_S) / NUMBER_OF_INTERVALS;
  for (let index = 1; index < lines.length; index += 1) {
    const row = admittedCsvRow(lines[index]!, `result.rows[${index - 1}]`);
    if (row.length !== header.length) {
      fail("OpenModelica ramp CSV has a ragged row.");
    }
    const time = Number(row[timeIndex]);
    const temperature = Number(row[temperatureIndex]);
    if (
      !Number.isFinite(time) || !Number.isFinite(temperature) ||
      time < previousTime
    ) {
      fail("OpenModelica ramp CSV contains a non-finite or unordered sample.");
    }
    if (index === 1 && time !== START_TIME_S) {
      fail("OpenModelica ramp CSV starts outside the admitted run.");
    }
    const gridIndex = Math.round((time - START_TIME_S) / sampleStep);
    const expectedTime = START_TIME_S + gridIndex * sampleStep;
    if (
      gridIndex < 0 || gridIndex > NUMBER_OF_INTERVALS ||
      Math.abs(time - expectedTime) > SAMPLE_TIME_ABSOLUTE_TOLERANCE
    ) {
      fail("OpenModelica ramp CSV contains a sample outside the admitted grid.");
    }
    const expectedTemperature = defaults.initialTemperature +
      defaults.heatingRate * (time - START_TIME_S);
    if (
      Math.abs(temperature - expectedTemperature) >
        FINAL_TEMPERATURE_ABSOLUTE_TOLERANCE
    ) {
      fail(
        "OpenModelica ramp CSV temperature trajectory does not match the exact admitted parameter defaults.",
      );
    }
    observedGridIndices.add(gridIndex);
    previousTime = time;
    finalTemperature = temperature;
  }
  if (previousTime !== STOP_TIME_S) {
    fail("OpenModelica ramp CSV ends outside the admitted run.");
  }
  if (observedGridIndices.size !== NUMBER_OF_INTERVALS + 1) {
    fail("OpenModelica ramp CSV does not cover the admitted sample grid.");
  }
  const expectedFinalTemperature = finalTemperatureFor(defaults);
  if (
    Math.abs(finalTemperature - expectedFinalTemperature) >
      FINAL_TEMPERATURE_ABSOLUTE_TOLERANCE
  ) {
    fail(
      "OpenModelica ramp CSV final temperature does not match the exact admitted parameter defaults.",
    );
  }
  return finalTemperature;
}

function admittedCsvRow(source: string, path: string): readonly string[] {
  const cells = source.split(",");
  if (cells.length < 2 || cells.length > 64) {
    fail(`${path} has an unsupported CSV width.`);
  }
  return cells.map((cell, index) => admittedCsvCell(cell, `${path}[${index}]`));
}

function admittedCsvCell(value: string, path: string): string {
  if (value.length === 0 || value !== value.trim()) {
    fail(`${path} is not a canonical CSV cell.`);
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    if (
      value.length < 2 || !value.startsWith('"') || !value.endsWith('"') ||
      value.slice(1, -1).includes('"')
    ) {
      fail(`${path} has unsupported CSV quoting.`);
    }
    return value.slice(1, -1);
  }
  if (value.includes('"')) {
    fail(`${path} has unsupported CSV quoting.`);
  }
  return value;
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

if (import.meta.main) await main();
