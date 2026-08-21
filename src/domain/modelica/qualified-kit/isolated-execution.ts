/**
 * Closed, provider-neutral payloads for one locally isolated Modelica run.
 *
 * `IsolatedCodeRunner` deliberately accepts one byte string.  For Modelica the
 * byte string is this canonical bundle, never an implicit concatenation: each
 * qualified input keeps its role, fixed sandbox basename, media type, byte
 * count, digest and exact UTF-8 text.  The bundle digest is therefore the
 * runner receipt's `sourceSha256` and commits the complete invocation.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  sha256Hex,
} from "../../compile/source/provider-resource-reader.ts";
import {
  type IsolatedCodeOutputDeclaration,
  validateIsolatedCodeOutputManifest,
} from "../../compile/isolation/isolated-code-execution.ts";

export const MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA =
  "modelica-isolated-input-bundle/1.0" as const;
export const MODELICA_ISOLATED_EVIDENCE_SCHEMA =
  "modelica-isolated-evidence/1.0" as const;

export interface ModelicaMethodIdentity {
  readonly id: string;
  readonly version: string;
}

export const MODELICA_ISOLATED_EXECUTION_PROFILE = Object.freeze({
  id: "modelica-qualified-kit-v1",
  version: "1.0.0",
});

/**
 * The first local profile is intentionally one real solver-conformance kit,
 * not a generic Modelica source runner. Its source, scenario, parameter and
 * metric contracts are re-opened from the sealed qualified manifest below and
 * again by the image-owned @casys/mcp-modelica normalizer.
 */
export const MODELICA_LOCAL_QUALIFIED_KIT = Object.freeze({
  modelId: "linear-thermal-ramp-v1",
  modelVersion: "0.1.0",
  modelName: "LinearThermalRamp",
  scenarioId: "linear-ramp-nominal",
  modelSha256: "ebe3e0b018bfa058e76930e5f57ced5a4f626f1b373f9f265c9ad8b194edd1a6",
  modelByteCount: 372,
  scenarioSha256: "95877d59ed094e7844ddc7fb3a744bdc2ad07c6779d812f4883762f2e31c086e",
  scenarioByteCount: 312,
  scenario: Object.freeze({
    description:
      "Solver-conformance ramp from 20 degC at 1 K/s for two seconds; no physical heat balance is claimed.",
    startTimeS: 0,
    stopTimeS: 2,
    numberOfIntervals: 20,
    solver: "dassl",
    targetTemperature: Object.freeze({ value: 22, unit: "degC" }),
  }),
  parameters: Object.freeze([
    Object.freeze({
      id: "heating_rate",
      modelicaName: "heatingRate",
      modelicaType: "Real",
      unit: "K/s",
      minimum: 0.1,
      maximum: 10,
      conversion: Object.freeze({ from: "K/s", to: "K/s", factor: 1, offset: 0 }),
    }),
    Object.freeze({
      id: "initial_temperature",
      modelicaName: "initialTemperature",
      modelicaType: "Real",
      unit: "degC",
      minimum: -50,
      maximum: 100,
      conversion: Object.freeze({
        from: "degC",
        to: "degC",
        factor: 1,
        offset: 0,
      }),
    }),
  ]),
  metrics: Object.freeze([
    Object.freeze({ id: "temperature_final", unit: "degC", required: true }),
  ]),
});

export const MODELICA_ISOLATED_OUTPUT_MANIFEST:
  readonly IsolatedCodeOutputDeclaration[] = validateIsolatedCodeOutputManifest([
    {
      role: "evidence",
      basename: "evidence.json",
      mediaType: "application/json",
      format: "modelica-isolated-evidence-v1",
    },
    {
      role: "result",
      basename: "result.csv",
      mediaType: "text/csv",
      format: "openmodelica-result-csv",
    },
  ]);

export const MODELICA_LOCAL_LOWERING = Object.freeze({
  id: "modelica-omc-lowering",
  version: "1.0.0",
});
export const MODELICA_LOCAL_RESULT_NORMALIZER = Object.freeze({
  id: "linear-thermal-ramp-result-normalizer",
  version: "1.0.0",
});

export type ModelicaIsolatedInputRole =
  | "model"
  | "parameter_schema"
  | "scenario";

export interface ModelicaIsolatedInputMember {
  readonly role: ModelicaIsolatedInputRole;
  readonly basename: "model.mo" | "parameter-schema.json" | "scenario.json";
  readonly mediaType: "application/json" | "text/x-modelica";
  readonly byteCount: number;
  readonly sha256: string;
  /** Exact qualified-kit text; the canonical outer JSON escapes it by value. */
  readonly text: string;
}

export interface ModelicaIsolatedInputBundle {
  readonly schemaVersion: typeof MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA;
  readonly qualification: {
    readonly caseSha256: string;
    readonly manifestSha256: string;
    readonly sourceCaptureSha256: string;
  };
  readonly selection: {
    readonly modelId: string;
    readonly modelVersion: string;
    readonly scenarioId: string;
  };
  readonly invocation: {
    readonly modelName: string;
    readonly startTimeS: number;
    readonly stopTimeS: number;
    readonly numberOfIntervals: number;
    readonly solver: string;
    readonly timeoutMs: number;
    readonly parameters: readonly {
      readonly id: string;
      readonly modelicaName: string;
      readonly inputValue: number;
      readonly inputUnit: string;
      readonly modelicaValue: number;
      readonly modelicaUnit: string;
    }[];
    readonly metrics: readonly {
      readonly id: string;
      readonly unit: string;
      readonly required: boolean;
    }[];
  };
  readonly method: {
    readonly lowering: ModelicaMethodIdentity;
    readonly resultNormalizer: ModelicaMethodIdentity;
    readonly engine: {
      readonly name: string;
      readonly version: string;
      readonly mslVersion: string;
    };
  };
  readonly inputs: readonly ModelicaIsolatedInputMember[];
}

export interface PreparedModelicaIsolatedInputBundle {
  readonly document: ModelicaIsolatedInputBundle;
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly fingerprint: ContentFingerprint;
}

export interface ModelicaIsolatedEvidence {
  readonly schemaVersion: typeof MODELICA_ISOLATED_EVIDENCE_SCHEMA;
  readonly inputBundleSha256: string;
  readonly status: "succeeded";
  readonly method: ModelicaIsolatedInputBundle["method"];
  readonly resolvedParameters: readonly {
    readonly id: string;
    readonly modelicaName: string;
    readonly value: number;
    readonly unit: string;
    readonly modelicaValue: number;
    readonly modelicaUnit: string;
  }[];
  readonly metrics: readonly {
    readonly id: string;
    readonly value: number;
    readonly unit: string;
  }[];
  readonly result: {
    readonly role: "result";
    readonly basename: "result.csv";
    readonly byteCount: number;
    readonly sha256: string;
  };
  readonly warnings: readonly string[];
}

/** Replay validator for the canonical bundle after WAL or CAS recovery. */
export async function validateModelicaIsolatedInputBundle(
  value: unknown,
  path = "$modelicaInputBundle",
): Promise<ModelicaIsolatedInputBundle> {
  const root = exactRecord(value, [
    "schemaVersion",
    "qualification",
    "selection",
    "invocation",
    "method",
    "inputs",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const qualification = exactRecord(root.qualification, [
    "caseSha256",
    "manifestSha256",
    "sourceCaptureSha256",
  ], `${path}.qualification`);
  const selection = exactRecord(
    root.selection,
    ["modelId", "modelVersion", "scenarioId"],
    `${path}.selection`,
  );
  const invocation = validateInvocation(root.invocation, `${path}.invocation`);
  const method = validateMethod(root.method, `${path}.method`);
  assertSupportedMethod(method, path);
  const inputs = (await Promise.all(
    nonEmptyArray(root.inputs, `${path}.inputs`).map((item, index) =>
      validateMember(item, `${path}.inputs[${index}]`)
    ),
  )).sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(inputs.map((member) => member.role), `${path}.inputs roles`);
  if (
    inputs.length < 2 || inputs.length > 3 || inputs[0]?.role !== "model" ||
    inputs.at(-1)?.role !== "scenario"
  ) {
    throw new TypeError(
      `${path}.inputs must contain model, scenario and optional schema.`,
    );
  }
  return deepFreeze({
    schemaVersion: MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    qualification: {
      caseSha256: sha256Hex(
        qualification.caseSha256,
        `${path}.qualification.caseSha256`,
      ),
      manifestSha256: sha256Hex(
        qualification.manifestSha256,
        `${path}.qualification.manifestSha256`,
      ),
      sourceCaptureSha256: sha256Hex(
        qualification.sourceCaptureSha256,
        `${path}.qualification.sourceCaptureSha256`,
      ),
    },
    selection: {
      modelId: safeId(selection.modelId, `${path}.selection.modelId`),
      modelVersion: nonEmptyText(
        selection.modelVersion,
        `${path}.selection.modelVersion`,
      ),
      scenarioId: safeId(selection.scenarioId, `${path}.selection.scenarioId`),
    },
    invocation,
    method,
    inputs,
  });
}

/**
 * Format validator wired into the isolation broker.  Semantic cross-checks
 * that need the per-run bundle are repeated by `validateModelicaIsolatedRun`.
 */
export function validateModelicaIsolatedOutput(
  declaration: IsolatedCodeOutputDeclaration,
  bytes: Uint8Array,
): void {
  const expected = MODELICA_ISOLATED_OUTPUT_MANIFEST.find((entry) =>
    entry.role === declaration.role
  );
  if (!expected || deterministicJson(expected) !== deterministicJson(declaration)) {
    throw new TypeError("The Modelica output declaration is not registered.");
  }
  if (declaration.role === "result") {
    const text = exactUtf8(bytes, "$modelicaOutput.result");
    if (text.length === 0 || !text.endsWith("\n") || text.includes("\0")) {
      throw new TypeError("The Modelica result must be non-empty LF-terminated CSV.");
    }
    return;
  }
  const text = exactUtf8(bytes, "$modelicaOutput.evidence");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError("The Modelica evidence output is not JSON.");
  }
  const evidence = validateModelicaIsolatedEvidence(parsed);
  if (deterministicJson(evidence) !== text) {
    throw new TypeError("The Modelica evidence output is not canonical JSON.");
  }
}

export function validateModelicaIsolatedEvidence(
  value: unknown,
  path = "$modelicaEvidence",
): ModelicaIsolatedEvidence {
  const root = exactRecord(value, [
    "schemaVersion",
    "inputBundleSha256",
    "status",
    "method",
    "resolvedParameters",
    "metrics",
    "result",
    "warnings",
  ], path);
  literalValue(
    root.schemaVersion,
    MODELICA_ISOLATED_EVIDENCE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.status, "succeeded", `${path}.status`);
  const method = validateMethod(root.method, `${path}.method`);
  assertSupportedMethod(method, path);
  const resolvedParameters = arrayOf(
    root.resolvedParameters,
    `${path}.resolvedParameters`,
  ).map((item, index) => {
    const itemPath = `${path}.resolvedParameters[${index}]`;
    const parameter = exactRecord(item, [
      "id",
      "modelicaName",
      "value",
      "unit",
      "modelicaValue",
      "modelicaUnit",
    ], itemPath);
    return deepFreeze({
      id: safeId(parameter.id, `${itemPath}.id`),
      modelicaName: modelicaIdentifier(
        parameter.modelicaName,
        `${itemPath}.modelicaName`,
      ),
      value: normalizedFinite(parameter.value, `${itemPath}.value`),
      unit: nonEmptyText(parameter.unit, `${itemPath}.unit`),
      modelicaValue: normalizedFinite(
        parameter.modelicaValue,
        `${itemPath}.modelicaValue`,
      ),
      modelicaUnit: nonEmptyText(
        parameter.modelicaUnit,
        `${itemPath}.modelicaUnit`,
      ),
    });
  }).sort(compareById);
  rejectDuplicates(
    resolvedParameters.map((parameter) => parameter.id),
    `${path}.resolvedParameters ids`,
  );
  const metrics = nonEmptyArray(root.metrics, `${path}.metrics`).map(
    (item, index) => {
      const itemPath = `${path}.metrics[${index}]`;
      const metric = exactRecord(item, ["id", "value", "unit"], itemPath);
      return deepFreeze({
        id: safeId(metric.id, `${itemPath}.id`),
        value: normalizedFinite(metric.value, `${itemPath}.value`),
        unit: nonEmptyText(metric.unit, `${itemPath}.unit`),
      });
    },
  ).sort(compareById);
  rejectDuplicates(metrics.map((metric) => metric.id), `${path}.metrics ids`);
  const result = exactRecord(
    root.result,
    ["role", "basename", "byteCount", "sha256"],
    `${path}.result`,
  );
  literalValue(result.role, "result", `${path}.result.role`);
  literalValue(result.basename, "result.csv", `${path}.result.basename`);
  const warnings = arrayOf(root.warnings, `${path}.warnings`).map(
    (warning, index) => nonEmptyText(warning, `${path}.warnings[${index}]`),
  );
  rejectDuplicates(warnings, `${path}.warnings`);
  warnings.sort(compareAsciiCodeUnits);
  return deepFreeze({
    schemaVersion: MODELICA_ISOLATED_EVIDENCE_SCHEMA,
    inputBundleSha256: sha256Hex(
      root.inputBundleSha256,
      `${path}.inputBundleSha256`,
    ),
    status: "succeeded",
    method,
    resolvedParameters,
    metrics,
    result: {
      role: "result",
      basename: "result.csv",
      byteCount: nonNegativeInteger(result.byteCount, `${path}.result.byteCount`),
      sha256: sha256Hex(result.sha256, `${path}.result.sha256`),
    },
    warnings,
  });
}

/** Full per-run validator used before local results become Thread evidence. */
export async function validateModelicaIsolatedRun(input: {
  readonly bundle: unknown;
  readonly evidenceBytes: Uint8Array;
  readonly resultBytes: Uint8Array;
}): Promise<ModelicaIsolatedEvidence> {
  const bundle = await validateModelicaIsolatedInputBundle(input.bundle);
  const bundleFingerprint = await sha256Fingerprint(bundle);
  const evidenceText = exactUtf8(input.evidenceBytes, "$modelicaRun.evidence");
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidenceText);
  } catch {
    throw new TypeError("The Modelica run evidence is not JSON.");
  }
  const evidence = validateModelicaIsolatedEvidence(parsed);
  if (deterministicJson(evidence) !== evidenceText) {
    throw new TypeError("The Modelica run evidence is not canonical JSON.");
  }
  const resultSha256 = await fingerprintResourceBytes(input.resultBytes);
  const resultFinalTemperature = qualifiedResultFinalTemperature(
    input.resultBytes,
    bundle,
  );
  if (
    evidence.inputBundleSha256 !== bundleFingerprint.digest ||
    evidence.result.byteCount !== input.resultBytes.byteLength ||
    evidence.result.sha256 !== resultSha256 ||
    deterministicJson(evidence.method) !== deterministicJson(bundle.method)
  ) {
    throw new TypeError(
      "The Modelica run does not bind its exact bundle, method and CSV.",
    );
  }
  const expectedParameters = bundle.invocation.parameters.map((parameter) => ({
    id: parameter.id,
    modelicaName: parameter.modelicaName,
    value: parameter.inputValue,
    unit: parameter.inputUnit,
    modelicaValue: parameter.modelicaValue,
    modelicaUnit: parameter.modelicaUnit,
  }));
  if (
    deterministicJson(evidence.resolvedParameters) !==
      deterministicJson(expectedParameters)
  ) {
    throw new TypeError("The Modelica run changed a qualified value or unit.");
  }
  const expectedMetrics = bundle.invocation.metrics;
  if (
    evidence.metrics.length !== expectedMetrics.length ||
    expectedMetrics.some((expected, index) => {
      const observed = evidence.metrics[index];
      return !observed || observed.id !== expected.id ||
        observed.unit !== expected.unit;
    }) || evidence.warnings.length !== 0
  ) {
    throw new TypeError("The Modelica run metrics do not match the qualified units.");
  }
  const finalTemperature = evidence.metrics.find((metric) =>
    metric.id === "temperature_final"
  );
  if (
    !finalTemperature ||
    !Object.is(finalTemperature.value, resultFinalTemperature) &&
      finalTemperature.value !== resultFinalTemperature
  ) {
    throw new TypeError(
      "The Modelica run metric differs from the exact result CSV.",
    );
  }
  return evidence;
}

function qualifiedResultFinalTemperature(
  bytes: Uint8Array,
  bundle: ModelicaIsolatedInputBundle,
): number {
  const source = exactUtf8(bytes, "$modelicaRun.result");
  if (
    source.length === 0 || !source.endsWith("\n") || source.includes("\r") ||
    source.includes("\0")
  ) {
    throw new TypeError("The Modelica result CSV is not canonical LF text.");
  }
  const lines = source.slice(0, -1).split("\n");
  const sampleCount = lines.length - 1;
  if (
    sampleCount !== bundle.invocation.numberOfIntervals + 1 &&
    sampleCount !== bundle.invocation.numberOfIntervals + 2
  ) {
    throw new TypeError(
      `The Modelica result CSV has ${sampleCount} samples for ${bundle.invocation.numberOfIntervals} qualified intervals.`,
    );
  }
  const header = qualifiedCsvRow(lines[0]!, "$modelicaRun.result.header");
  const timeIndex = header.indexOf("time");
  const temperatureIndex = header.indexOf("temperatureC");
  if (
    timeIndex < 0 || temperatureIndex < 0 ||
    header.lastIndexOf("time") !== timeIndex ||
    header.lastIndexOf("temperatureC") !== temperatureIndex ||
    new Set(header).size !== header.length
  ) {
    throw new TypeError("The Modelica result CSV has unsupported columns.");
  }
  let previousTime = Number.NEGATIVE_INFINITY;
  let finalTemperature = Number.NaN;
  const uniqueTimes = new Set<number>();
  for (let index = 1; index < lines.length; index += 1) {
    const row = qualifiedCsvRow(
      lines[index]!,
      `$modelicaRun.result.rows[${index - 1}]`,
    );
    if (row.length !== header.length) {
      throw new TypeError("The Modelica result CSV has a ragged row.");
    }
    const time = Number(row[timeIndex]);
    const temperature = Number(row[temperatureIndex]);
    if (
      !Number.isFinite(time) || !Number.isFinite(temperature) ||
      time < previousTime
    ) {
      throw new TypeError(
        "The Modelica result CSV contains a non-finite or unordered sample.",
      );
    }
    if (index === 1 && time !== bundle.invocation.startTimeS) {
      throw new TypeError("The Modelica result CSV starts outside the qualified run.");
    }
    uniqueTimes.add(time);
    previousTime = time;
    finalTemperature = temperature;
  }
  if (previousTime !== bundle.invocation.stopTimeS) {
    throw new TypeError("The Modelica result CSV ends outside the qualified run.");
  }
  if (uniqueTimes.size !== bundle.invocation.numberOfIntervals + 1) {
    throw new TypeError(
      "The Modelica result CSV does not cover the qualified sample grid.",
    );
  }
  return normalizedFinite(finalTemperature, "$modelicaRun.result.finalTemperature");
}

function qualifiedCsvRow(source: string, path: string): readonly string[] {
  const cells = source.split(",");
  if (cells.length < 2 || cells.length > 64) {
    throw new TypeError(`${path} has an unsupported CSV width.`);
  }
  return cells.map((cell, index) => qualifiedCsvCell(cell, `${path}[${index}]`));
}

function qualifiedCsvCell(value: string, path: string): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} is not a canonical CSV cell.`);
  }
  if (value.startsWith('"') || value.endsWith('"')) {
    if (
      value.length < 2 || !value.startsWith('"') || !value.endsWith('"') ||
      value.slice(1, -1).includes('"')
    ) throw new TypeError(`${path} has unsupported CSV quoting.`);
    return value.slice(1, -1);
  }
  if (value.includes('"')) {
    throw new TypeError(`${path} has unsupported CSV quoting.`);
  }
  return value;
}
function validateInvocation(
  value: unknown,
  path: string,
): ModelicaIsolatedInputBundle["invocation"] {
  const root = exactRecord(value, [
    "modelName",
    "startTimeS",
    "stopTimeS",
    "numberOfIntervals",
    "solver",
    "timeoutMs",
    "parameters",
    "metrics",
  ], path);
  const startTimeS = normalizedFinite(root.startTimeS, `${path}.startTimeS`);
  const stopTimeS = normalizedFinite(root.stopTimeS, `${path}.stopTimeS`);
  if (startTimeS < 0 || stopTimeS <= startTimeS) {
    throw new TypeError(`${path} has invalid time bounds.`);
  }
  const timeoutMs = positiveInteger(root.timeoutMs, `${path}.timeoutMs`);
  if (timeoutMs > 120_000) throw new TypeError(`${path}.timeoutMs exceeds 120000.`);
  const parameters = arrayOf(root.parameters, `${path}.parameters`).map(
    (item, index) => {
      const itemPath = `${path}.parameters[${index}]`;
      const parameter = exactRecord(item, [
        "id",
        "modelicaName",
        "inputValue",
        "inputUnit",
        "modelicaValue",
        "modelicaUnit",
      ], itemPath);
      return deepFreeze({
        id: safeId(parameter.id, `${itemPath}.id`),
        modelicaName: modelicaIdentifier(
          parameter.modelicaName,
          `${itemPath}.modelicaName`,
        ),
        inputValue: normalizedFinite(parameter.inputValue, `${itemPath}.inputValue`),
        inputUnit: nonEmptyText(parameter.inputUnit, `${itemPath}.inputUnit`),
        modelicaValue: normalizedFinite(
          parameter.modelicaValue,
          `${itemPath}.modelicaValue`,
        ),
        modelicaUnit: nonEmptyText(parameter.modelicaUnit, `${itemPath}.modelicaUnit`),
      });
    },
  ).sort(compareById);
  rejectDuplicates(parameters.map((item) => item.id), `${path}.parameters ids`);
  rejectDuplicates(
    parameters.map((item) => item.modelicaName),
    `${path}.parameters modelica names`,
  );
  const metrics = nonEmptyArray(root.metrics, `${path}.metrics`).map((item, index) => {
    const itemPath = `${path}.metrics[${index}]`;
    const metric = exactRecord(item, ["id", "unit", "required"], itemPath);
    if (typeof metric.required !== "boolean") {
      throw new TypeError(`${itemPath}.required must be boolean.`);
    }
    return deepFreeze({
      id: safeId(metric.id, `${itemPath}.id`),
      unit: nonEmptyText(metric.unit, `${itemPath}.unit`),
      required: metric.required,
    });
  }).sort(compareById);
  rejectDuplicates(metrics.map((item) => item.id), `${path}.metrics ids`);
  return deepFreeze({
    modelName: modelicaIdentifier(root.modelName, `${path}.modelName`),
    startTimeS,
    stopTimeS,
    numberOfIntervals: positiveInteger(
      root.numberOfIntervals,
      `${path}.numberOfIntervals`,
    ),
    solver: safeId(root.solver, `${path}.solver`),
    timeoutMs,
    parameters,
    metrics,
  });
}

function validateMethod(
  value: unknown,
  path: string,
): ModelicaIsolatedInputBundle["method"] {
  const root = exactRecord(value, [
    "lowering",
    "resultNormalizer",
    "engine",
  ], path);
  const engine = exactRecord(
    root.engine,
    ["name", "version", "mslVersion"],
    `${path}.engine`,
  );
  return deepFreeze({
    lowering: identity(root.lowering, `${path}.lowering`),
    resultNormalizer: identity(
      root.resultNormalizer,
      `${path}.resultNormalizer`,
    ),
    engine: {
      name: nonEmptyText(engine.name, `${path}.engine.name`),
      version: nonEmptyText(engine.version, `${path}.engine.version`),
      mslVersion: nonEmptyText(engine.mslVersion, `${path}.engine.mslVersion`),
    },
  });
}

function assertSupportedMethod(
  method: ModelicaIsolatedInputBundle["method"],
  path: string,
): void {
  if (
    deterministicJson(method.lowering) !== deterministicJson(MODELICA_LOCAL_LOWERING) ||
    deterministicJson(method.resultNormalizer) !==
      deterministicJson(MODELICA_LOCAL_RESULT_NORMALIZER) ||
    method.engine.name !== "OpenModelica"
  ) {
    throw new TypeError(`${path} names an unsupported local Modelica method.`);
  }
}

async function validateMember(
  value: unknown,
  path: string,
): Promise<ModelicaIsolatedInputMember> {
  const root = exactRecord(
    value,
    ["role", "basename", "mediaType", "byteCount", "sha256", "text"],
    path,
  );
  const role = inputRole(root.role, `${path}.role`);
  literalValue(root.basename, basenameFor(role), `${path}.basename`);
  const mediaType = role === "model" ? "text/x-modelica" : "application/json";
  literalValue(root.mediaType, mediaType, `${path}.mediaType`);
  const text = typeof root.text === "string" ? root.text : (() => {
    throw new TypeError(`${path}.text must be a string.`);
  })();
  const bytes = new TextEncoder().encode(text);
  const byteCount = nonNegativeInteger(root.byteCount, `${path}.byteCount`);
  if (byteCount !== bytes.byteLength) {
    throw new TypeError(`${path}.byteCount does not match exact UTF-8 bytes.`);
  }
  const sha256 = sha256Hex(root.sha256, `${path}.sha256`);
  if (await fingerprintResourceBytes(bytes) !== sha256) {
    throw new TypeError(`${path}.sha256 does not match exact UTF-8 bytes.`);
  }
  return deepFreeze({
    role,
    basename: basenameFor(role),
    mediaType,
    byteCount,
    sha256,
    text,
  });
}

function identity(value: unknown, path: string): ModelicaMethodIdentity {
  const root = exactRecord(value, ["id", "version"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: nonEmptyText(root.version, `${path}.version`),
  });
}

function inputRole(value: unknown, path: string): ModelicaIsolatedInputRole {
  if (value === "model" || value === "parameter_schema" || value === "scenario") {
    return value;
  }
  throw new TypeError(`${path} is unsupported.`);
}

function basenameFor(
  role: ModelicaIsolatedInputRole,
): ModelicaIsolatedInputMember["basename"] {
  if (role === "model") return "model.mo";
  if (role === "scenario") return "scenario.json";
  return "parameter-schema.json";
}

function modelicaIdentifier(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) {
    throw new TypeError(`${path} must be a Modelica identifier.`);
  }
  return text;
}

function exactUtf8(bytes: Uint8Array, path: string): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${path} must be bytes.`);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${path} is not valid UTF-8.`);
  }
  if (new TextEncoder().encode(text).byteLength !== bytes.byteLength) {
    throw new TypeError(`${path} is not canonical UTF-8.`);
  }
  return text;
}
function normalizedFinite(value: unknown, path: string): number {
  const parsed = finite(value, path);
  return Object.is(parsed, -0) ? 0 : parsed;
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return compareAsciiCodeUnits(left.id, right.id);
}

/** Exact profile/bundle compatibility check used by composition and replay. */
export function assertModelicaBundleMethod(
  bundle: ModelicaIsolatedInputBundle,
  expected: ModelicaIsolatedInputBundle["method"],
): void {
  if (deterministicJson(bundle.method) !== deterministicJson(expected)) {
    throw new TypeError(
      "The Modelica bundle method differs from its execution profile.",
    );
  }
}
