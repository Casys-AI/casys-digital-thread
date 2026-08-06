import { deterministicJson } from "../../domain/deterministic-json.ts";
import type { PersistedModelicaRunEvidence } from "../observed-modelica-thread-branch.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

/**
 * Normalized, server-owned evidence captured from the approved CM-01 nominal
 * Modelica kit. This is deliberately a static reviewed contract: callers can
 * neither select another kit nor pass parameter overrides.
 */
export const CM01_NOMINAL_MODELICA_CAPTURE_SCHEMA =
  "cm01-nominal-modelica-capture/1.0" as const;

export const CM01_NOMINAL_MODELICA_MODEL = Object.freeze(
  {
    id: "coffee-machine-v1",
    version: "0.1.0",
    sha256: "a641b63a493435fd2ce8123a7b6afbd478656a124610ca33d22112985af8e8ec",
  } as const,
);

export const CM01_NOMINAL_MODELICA_SCENARIO = Object.freeze(
  {
    id: "heat-up-nominal",
    sha256: "5db8a06592050a03a8d727900801f9185b2e7fa2fb3092ce15dd3c6c70eb0941",
  } as const,
);

export const CM01_NOMINAL_MODELICA_PARAMETERS = Object.freeze(
  [
    Object.freeze({ id: "ambient_temperature", value: 20, unit: "degC" }),
    Object.freeze({ id: "boiler_heat_capacity", value: 500, unit: "J/K" }),
    Object.freeze({ id: "heat_loss_conductance", value: 5, unit: "W/K" }),
    Object.freeze({ id: "heater_power", value: 1500, unit: "W" }),
    Object.freeze({ id: "hysteresis", value: 2, unit: "K" }),
    Object.freeze({ id: "initial_water_temperature", value: 20, unit: "degC" }),
    Object.freeze({ id: "setpoint_temperature", value: 93, unit: "degC" }),
    Object.freeze({ id: "water_mass", value: 0.5, unit: "kg" }),
  ] as const,
);

export const CM01_NOMINAL_MODELICA_METRICS = Object.freeze(
  [
    Object.freeze({ id: "heater_energy", unit: "J" }),
    Object.freeze({ id: "heater_power_peak", unit: "W" }),
    Object.freeze({ id: "time_to_target_temperature", unit: "s" }),
    Object.freeze({ id: "water_temperature_max", unit: "degC" }),
  ] as const,
);

const MODELICA_RESULTS_SCHEMA_VERSION = "1.0";
const ARTIFACT_KINDS = [
  "request",
  "resolved_parameters",
  "model",
  "script",
  "diagnostics",
  "result",
  "evidence",
] as const;

type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface Cm01NominalModelicaQuantity {
  readonly id: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
}

/**
 * The only public output of the adapter. It contains normalized evidence, not
 * raw provider payloads or the fixed arguments used to create the run.
 */
export interface Cm01NominalModelicaCapture {
  readonly schemaVersion: typeof CM01_NOMINAL_MODELICA_CAPTURE_SCHEMA;
  readonly kind: "cm01-nominal-modelica-capture";
  readonly producer: {
    readonly serverId: "modelica";
    readonly simulation: { readonly tool: "modelica_simulate"; readonly runId: string };
    readonly readback: { readonly tool: "modelica_run_get"; readonly runId: string };
  };
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly mslVersion: string;
  };
  /** Fixed no-override values resolved by the provider and read back verbatim. */
  readonly resolvedParameters: readonly Cm01NominalModelicaQuantity[];
  /** Hash-bound model, scenario, metrics and provider artifacts. */
  readonly evidence: PersistedModelicaRunEvidence;
  readonly warnings: readonly string[];
}

export interface Cm01NominalModelicaCaptureAdapterOptions {
  /** Server-owned MCP client; its endpoint and transport never cross the tool boundary. */
  readonly modelica: McpToolClient;
}

export class Cm01NominalModelicaCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Cm01NominalModelicaCaptureError";
  }
}

/**
 * Execute and immediately read back the one reviewed CM-01 thermal scenario.
 *
 * The second call is not a convenience fetch: it attests that the returned
 * run is the immutable persisted provider record. Any disagreement between
 * the two complete envelopes fails closed rather than retaining ambiguous
 * evidence.
 */
export class Cm01NominalModelicaCaptureAdapter {
  readonly #modelica: McpToolClient;

  constructor(options: Cm01NominalModelicaCaptureAdapterOptions) {
    this.#modelica = options.modelica;
  }

  async capture(): Promise<Cm01NominalModelicaCapture> {
    const simulated = await this.call("modelica_simulate", {
      model_id: CM01_NOMINAL_MODELICA_MODEL.id,
      scenario_id: CM01_NOMINAL_MODELICA_SCENARIO.id,
    });
    const simulatedRun = parseRunEnvelope(
      simulated.structuredContent,
      "modelica_simulate",
    );

    const readback = await this.call("modelica_run_get", {
      run_id: simulatedRun.runId,
    });
    const persistedRun = parseRunEnvelope(
      readback.structuredContent,
      "modelica_run_get",
    );

    if (deterministicJson(simulatedRun) !== deterministicJson(persistedRun)) {
      throw new Cm01NominalModelicaCaptureError(
        "modelica_run_get does not exactly match the persisted run returned by modelica_simulate.",
      );
    }

    return deepFreeze({
      schemaVersion: CM01_NOMINAL_MODELICA_CAPTURE_SCHEMA,
      kind: "cm01-nominal-modelica-capture",
      producer: {
        serverId: "modelica",
        simulation: { tool: "modelica_simulate", runId: persistedRun.runId },
        readback: { tool: "modelica_run_get", runId: persistedRun.runId },
      },
      engine: persistedRun.engine,
      resolvedParameters: persistedRun.resolvedParameters,
      evidence: {
        runId: persistedRun.runId,
        completedAt: persistedRun.completedAt,
        fingerprint: persistedRun.fingerprint,
        model: persistedRun.model,
        scenario: persistedRun.scenario,
        measurements: persistedRun.metrics.map((metric) => ({
          id: metric.id,
          name: metric.name,
          value: metric.value,
          unit: metric.unit,
        })),
        artifacts: persistedRun.artifacts,
      },
      warnings: persistedRun.warnings,
    });
  }

  private async call(
    name: "modelica_simulate" | "modelica_run_get",
    arguments_: Record<string, unknown>,
  ) {
    try {
      return await this.#modelica.callTool({ name, arguments: arguments_ });
    } catch (error) {
      throw new Cm01NominalModelicaCaptureError(
        `${name} failed: ${errorMessage(error)}`,
      );
    }
  }
}

interface NormalizedRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly model: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  };
  readonly scenario: {
    readonly id: string;
    readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  };
  readonly engine: {
    readonly name: string;
    readonly version: string;
    readonly mslVersion: string;
  };
  readonly resolvedParameters: readonly Cm01NominalModelicaQuantity[];
  readonly metrics: readonly Cm01NominalModelicaQuantity[];
  readonly artifacts: PersistedModelicaRunEvidence["artifacts"];
  readonly warnings: readonly string[];
}

function parseRunEnvelope(value: unknown, source: string): NormalizedRun {
  const envelope = exactRecord(value, ["schemaVersion", "kind", "run"], source);
  exact(
    envelope.schemaVersion,
    MODELICA_RESULTS_SCHEMA_VERSION,
    `${source}.schemaVersion`,
  );
  exact(envelope.kind, "run", `${source}.kind`);
  const run = exactRecord(envelope.run, [
    "status",
    "run_id",
    "started_at",
    "completed_at",
    "fingerprint",
    "model",
    "scenario",
    "engine",
    "resolved_parameters",
    "metrics",
    "artifacts",
    "warnings",
  ], `${source}.run`);
  exact(run.status, "succeeded", `${source}.run.status`);
  const runId = identifier(run.run_id, `${source}.run.run_id`);
  const startedAt = isoDate(run.started_at, `${source}.run.started_at`);
  const completedAt = isoDate(run.completed_at, `${source}.run.completed_at`);
  if (Date.parse(startedAt) > Date.parse(completedAt)) {
    fail(`${source}.run.completed_at must not precede started_at.`);
  }
  const runFingerprint = parseFingerprint(
    run.fingerprint,
    `${source}.run.fingerprint`,
  );
  const model = modelIdentity(run.model, `${source}.run.model`);
  const scenario = scenarioIdentity(run.scenario, `${source}.run.scenario`);
  requireCm01Identity(model, scenario, source);
  const engineRecord = exactRecord(
    run.engine,
    ["name", "version", "msl_version"],
    `${source}.run.engine`,
  );
  const engine = {
    name: text(engineRecord.name, `${source}.run.engine.name`),
    version: text(engineRecord.version, `${source}.run.engine.version`),
    mslVersion: text(engineRecord.msl_version, `${source}.run.engine.msl_version`),
  };
  const resolvedParameters = exactQuantities(
    run.resolved_parameters,
    CM01_NOMINAL_MODELICA_PARAMETERS,
    `${source}.run.resolved_parameters`,
    true,
  );
  const metrics = exactQuantities(
    run.metrics,
    CM01_NOMINAL_MODELICA_METRICS,
    `${source}.run.metrics`,
    false,
  );
  const artifacts = parseArtifacts(run.artifacts, runId, `${source}.run.artifacts`);
  const warnings = stringArray(run.warnings, `${source}.run.warnings`);
  return deepFreeze({
    runId,
    startedAt,
    completedAt,
    fingerprint: runFingerprint,
    model,
    scenario,
    engine,
    resolvedParameters,
    metrics,
    artifacts,
    warnings,
  });
}

function requireCm01Identity(
  model: NormalizedRun["model"],
  scenario: NormalizedRun["scenario"],
  source: string,
): void {
  exact(model.id, CM01_NOMINAL_MODELICA_MODEL.id, `${source}.run.model.id`);
  exact(
    model.version,
    CM01_NOMINAL_MODELICA_MODEL.version,
    `${source}.run.model.version`,
  );
  exact(
    model.fingerprint.digest,
    CM01_NOMINAL_MODELICA_MODEL.sha256,
    `${source}.run.model.sha256`,
  );
  exact(
    scenario.id,
    CM01_NOMINAL_MODELICA_SCENARIO.id,
    `${source}.run.scenario.id`,
  );
  exact(
    scenario.fingerprint.digest,
    CM01_NOMINAL_MODELICA_SCENARIO.sha256,
    `${source}.run.scenario.sha256`,
  );
}

function modelIdentity(value: unknown, path: string): NormalizedRun["model"] {
  const record = exactRecord(value, ["id", "version", "sha256"], path);
  return {
    id: identifier(record.id, `${path}.id`),
    version: text(record.version, `${path}.version`),
    fingerprint: parseFingerprint(record.sha256, `${path}.sha256`),
  };
}

function scenarioIdentity(value: unknown, path: string): NormalizedRun["scenario"] {
  const record = exactRecord(value, ["id", "sha256"], path);
  return {
    id: identifier(record.id, `${path}.id`),
    fingerprint: parseFingerprint(record.sha256, `${path}.sha256`),
  };
}

function exactQuantities(
  value: unknown,
  expected: readonly {
    readonly id: string;
    readonly unit: string;
    readonly value?: number;
  }[],
  path: string,
  exactValue: boolean,
): readonly Cm01NominalModelicaQuantity[] {
  const record = recordOf(value, path);
  const actualIds = Object.keys(record).sort();
  const expectedIds = expected.map((item) => item.id).sort();
  if (deterministicJson(actualIds) !== deterministicJson(expectedIds)) {
    fail(`${path} must contain exactly the reviewed CM-01 quantity ids.`);
  }
  return expected.map((item) => {
    const quantity = exactRecord(
      record[item.id],
      ["value", "unit"],
      `${path}.${item.id}`,
    );
    const numeric = finite(quantity.value, `${path}.${item.id}.value`);
    exact(quantity.unit, item.unit, `${path}.${item.id}.unit`);
    if (exactValue) exact(numeric, item.value, `${path}.${item.id}.value`);
    return {
      id: item.id,
      name: quantityLabel(item.id),
      value: numeric,
      unit: item.unit,
    };
  });
}

function parseArtifacts(
  value: unknown,
  runId: string,
  path: string,
): PersistedModelicaRunEvidence["artifacts"] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  if (value.length !== ARTIFACT_KINDS.length) {
    fail(`${path} must contain the seven reviewed Modelica artifacts.`);
  }
  const artifacts = value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const record = exactRecord(item, ["kind", "uri", "sha256", "bytes"], itemPath);
    const kind = artifactKind(record.kind, `${itemPath}.kind`);
    const uri = text(record.uri, `${itemPath}.uri`);
    if (uri !== `casys://modelica/runs/${runId}/${artifactFileName(kind)}`) {
      fail(`${itemPath}.uri does not match the reviewed ${kind} artifact path.`);
    }
    return {
      kind: artifactKindForEvidence(kind),
      name: artifactLabel(kind),
      uri,
      fingerprint: parseFingerprint(record.sha256, `${itemPath}.sha256`),
      bytes: nonNegativeInteger(record.bytes, `${itemPath}.bytes`),
    };
  });
  const seen = artifacts.map((artifact) => artifact.kind).sort();
  const expected = ARTIFACT_KINDS.map(artifactKindForEvidence).sort();
  if (deterministicJson(seen) !== deterministicJson(expected)) {
    fail(`${path} must contain each reviewed Modelica artifact kind exactly once.`);
  }
  const modelArtifact = artifacts.find((artifact) => artifact.kind === "model");
  if (modelArtifact?.fingerprint.digest !== CM01_NOMINAL_MODELICA_MODEL.sha256) {
    fail(`${path} model SHA-256 does not match the reviewed CM-01 model.`);
  }
  return ARTIFACT_KINDS.map((kind) =>
    artifacts.find((artifact) => artifact.kind === artifactKindForEvidence(kind))!
  );
}

function artifactKind(value: unknown, path: string): ArtifactKind {
  if (typeof value !== "string" || !ARTIFACT_KINDS.includes(value as ArtifactKind)) {
    fail(`${path} must be a supported Modelica artifact kind.`);
  }
  return value as ArtifactKind;
}

function artifactKindForEvidence(
  kind: ArtifactKind,
): PersistedModelicaRunEvidence["artifacts"][number]["kind"] {
  return kind === "resolved_parameters" ? "resolved-parameters" : kind;
}

function artifactLabel(kind: ArtifactKind): string {
  const labels: Record<ArtifactKind, string> = {
    request: "Simulation request",
    resolved_parameters: "Resolved parameters",
    model: "Modelica model",
    script: "OpenModelica script",
    diagnostics: "OpenModelica diagnostics",
    result: "Simulation result",
    evidence: "Computed evidence",
  };
  return labels[kind];
}

function artifactFileName(kind: ArtifactKind): string {
  const paths: Record<ArtifactKind, string> = {
    request: "request.json",
    resolved_parameters: "resolved-parameters.json",
    model: "CoffeeMachine.mo",
    script: "run.mos",
    diagnostics: "omc.log",
    result: "result.csv",
    evidence: "evidence.json",
  };
  return paths[kind];
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = recordOf(value, path);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    fail(`${path} has unsupported or missing fields.`);
  }
  return record;
}

function recordOf(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function identifier(value: unknown, path: string): string {
  const result = text(value, path);
  if (
    result.length > 255 ||
    [...result].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    fail(`${path} must be a bounded identifier.`);
  }
  return result;
}

function isoDate(value: unknown, path: string): string {
  const result = text(value, path);
  if (Number.isNaN(Date.parse(result))) fail(`${path} must be ISO-8601.`);
  return result;
}

function parseFingerprint(
  value: unknown,
  path: string,
): { readonly algorithm: "sha256"; readonly digest: string } {
  const digest = text(value, path).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(digest)) fail(`${path} must be a SHA-256 digest.`);
  return { algorithm: "sha256", digest };
}

function quantityLabel(id: string): string {
  const labels: Record<string, string> = {
    ambient_temperature: "Ambient temperature",
    boiler_heat_capacity: "Boiler heat capacity",
    heat_loss_conductance: "Heat loss conductance",
    heater_energy: "Heater energy",
    heater_power: "Heater power",
    heater_power_peak: "Peak heater power",
    hysteresis: "Hysteresis",
    initial_water_temperature: "Initial water temperature",
    setpoint_temperature: "Setpoint temperature",
    time_to_target_temperature: "Time to target temperature",
    water_mass: "Water mass",
    water_temperature_max: "Maximum water temperature",
  };
  return labels[id] ?? id.replaceAll("_", " ");
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(`${path} must be a finite number.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function stringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value.map((item, index) => text(item, `${path}[${index}]`));
}

function exact(actual: unknown, expected: unknown, path: string): void {
  if (actual !== expected) fail(`${path} does not match the reviewed CM-01 contract.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fail(message: string): never {
  throw new Cm01NominalModelicaCaptureError(message);
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
