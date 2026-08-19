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
  validateExpectedProviderResource,
} from "../../analysis/provider-resource-reader.ts";
import {
  type IsolatedCodeOutputDeclaration,
  validateIsolatedCodeOutputManifest,
} from "../../analysis/isolated-code-execution.ts";
import {
  canonicalModelicaQualifiedManifestDocumentText,
  type ModelicaQualifiedManifestDocument,
  type ModelicaResumableIdentity,
  validateModelicaQualifiedManifestDocument,
} from "../recorded/resumable-capabilities.ts";
import {
  canonicalSimulationCaseV2Text,
  type SimulationCaseV2,
  validateSimulationCaseV2,
} from "../recorded/simulation-case-v2.ts";
export const MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA =
  "modelica-isolated-input-bundle/1.0" as const;
export const MODELICA_ISOLATED_EVIDENCE_SCHEMA =
  "modelica-isolated-evidence/1.0" as const;

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
    readonly lowering: ModelicaResumableIdentity;
    readonly resultNormalizer: ModelicaResumableIdentity;
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

export interface QualifiedModelicaIsolatedSource {
  readonly role: ModelicaIsolatedInputRole;
  readonly bytes: Uint8Array;
}

interface QualificationAuthority {
  readonly caseDigest: string;
  readonly simulationCase: QualificationCasReference;
  readonly manifest: QualificationCasReference;
  readonly sourceCapture: QualificationCasReference;
  readonly sources: readonly {
    readonly role: ModelicaIsolatedInputRole;
    readonly mediaType: string;
    readonly resourceUri: string;
    readonly cas: QualificationCasReference;
  }[];
}

interface QualificationCasReference {
  readonly uri: string;
  readonly byteCount: number;
  readonly sha256: string;
}

interface QualifiedSourceCaptureAuthority {
  readonly selection: ModelicaQualifiedManifestDocument["selection"];
  readonly manifestFingerprint: string;
  readonly artifacts: readonly {
    readonly role: ModelicaIsolatedInputRole;
    readonly resource: {
      readonly uri: string;
      readonly mediaType: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    readonly cas: QualificationCasReference;
  }[];
}

/**
 * Build the only accepted local payload from already reopened qualification
 * evidence.  No provider default, unit inference or filename comes from the
 * caller.
 */
export async function createModelicaIsolatedInputBundle(input: {
  readonly simulationCaseBytes: Uint8Array;
  readonly manifestBytes: Uint8Array;
  readonly qualificationBytes: Uint8Array;
  readonly sourceCaptureBytes: Uint8Array;
  readonly sources: readonly QualifiedModelicaIsolatedSource[];
}): Promise<PreparedModelicaIsolatedInputBundle> {
  const simulationCaseText = exactUtf8(
    input.simulationCaseBytes,
    "$simulationCaseBytes",
  );
  const simulationCase = validateSimulationCaseV2(
    parseExactJson(simulationCaseText, "$simulationCaseBytes"),
  );
  if (canonicalSimulationCaseV2Text(simulationCase) !== simulationCaseText) {
    throw new TypeError("$simulationCaseBytes are not canonical JSON.");
  }
  const manifestText = exactUtf8(input.manifestBytes, "$manifestBytes");
  const manifest = await validateModelicaQualifiedManifestDocument(
    parseExactJson(manifestText, "$manifestBytes"),
  );
  if (
    await canonicalModelicaQualifiedManifestDocumentText(manifest) !== manifestText
  ) throw new TypeError("$manifestBytes are not canonical JSON.");
  const qualificationText = exactUtf8(
    input.qualificationBytes,
    "$qualificationBytes",
  );
  const qualificationValue = parseExactJson(
    qualificationText,
    "$qualificationBytes",
  );
  const qualification = validateQualificationAuthority(
    qualificationValue,
  );
  if (deterministicJson(qualificationValue) !== qualificationText) {
    throw new TypeError("$qualificationBytes are not canonical JSON.");
  }
  const sourceCapture = validateQualifiedSourceCaptureBytes(
    input.sourceCaptureBytes,
  );
  const reopenedAuthorities: readonly [
    string,
    Uint8Array,
    QualificationCasReference,
  ][] = [
    ["case", input.simulationCaseBytes, qualification.simulationCase],
    ["manifest", input.manifestBytes, qualification.manifest],
    ["source capture", input.sourceCaptureBytes, qualification.sourceCapture],
  ];
  for (const [label, bytes, reference] of reopenedAuthorities) {
    if (
      bytes.byteLength !== reference.byteCount ||
      await fingerprintResourceBytes(bytes) !== reference.sha256
    ) {
      throw new TypeError(
        `The reopened Modelica ${label} differs from qualification.`,
      );
    }
  }
  assertSourceCaptureAuthority(sourceCapture, manifest, qualification);
  assertQualifiedAuthorities(simulationCase, manifest);
  const inputs = await prepareMembers(input.sources, manifest, qualification);
  const document = await validateModelicaIsolatedInputBundle({
    schemaVersion: MODELICA_ISOLATED_INPUT_BUNDLE_SCHEMA,
    qualification: {
      caseSha256: qualification.caseDigest,
      manifestSha256: qualification.manifest.sha256,
      sourceCaptureSha256: qualification.sourceCapture.sha256,
    },
    selection: manifest.selection,
    invocation: invocationFor(simulationCase, manifest),
    method: {
      lowering: manifest.lowering,
      resultNormalizer: manifest.resultNormalizer,
      engine: manifest.engine,
    },
    inputs,
  });
  const text = deterministicJson(document);
  const bytes = new TextEncoder().encode(text);
  return Object.freeze({
    document,
    text,
    bytes: Uint8Array.from(bytes),
    fingerprint: await sha256Fingerprint(document),
  });
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

async function prepareMembers(
  sourceValues: readonly QualifiedModelicaIsolatedSource[],
  manifest: ModelicaQualifiedManifestDocument,
  qualification: QualificationAuthority,
): Promise<readonly ModelicaIsolatedInputMember[]> {
  const sources = [...sourceValues];
  rejectDuplicates(sources.map((source) => source.role), "$sources roles");
  const expected = [
    { role: "model" as const, resource: manifest.model },
    ...(manifest.parameterSchema === undefined ? [] : [{
      role: "parameter_schema" as const,
      resource: manifest.parameterSchema,
    }]),
    { role: "scenario" as const, resource: manifest.scenario },
  ];
  if (sources.length !== expected.length) {
    throw new TypeError("The local Modelica bundle lacks an exact qualified source.");
  }
  const prepared = await Promise.all(expected.map(async ({ role, resource }) => {
    const source = sources.find((candidate) => candidate.role === role);
    const authority = qualification.sources.find((candidate) =>
      candidate.role === role
    );
    if (!source || !authority || !(source.bytes instanceof Uint8Array)) {
      throw new TypeError(`Qualified Modelica ${role} bytes are missing.`);
    }
    const bytes = Uint8Array.from(source.bytes);
    const digest = await fingerprintResourceBytes(bytes);
    if (
      bytes.byteLength !== resource.byteCount || digest !== resource.sha256 ||
      authority.mediaType !== resource.mediaType ||
      authority.resourceUri !== resource.uri ||
      authority.cas.byteCount !== resource.byteCount ||
      authority.cas.sha256 !== resource.sha256
    ) {
      throw new TypeError(`Qualified Modelica ${role} bytes or authority diverge.`);
    }
    const text = exactUtf8(bytes, `$sources.${role}`);
    if (text.includes("\0")) {
      throw new TypeError(`Qualified Modelica ${role} contains NUL.`);
    }
    if (role !== "model") {
      try {
        JSON.parse(text);
      } catch {
        throw new TypeError(`Qualified Modelica ${role} is not JSON.`);
      }
    }
    return await validateMember({
      role,
      basename: basenameFor(role),
      mediaType: resource.mediaType,
      byteCount: bytes.byteLength,
      sha256: digest,
      text,
    }, `$sources.${role}`);
  }));
  return deepFreeze(
    prepared.sort((left, right) => compareAsciiCodeUnits(left.role, right.role)),
  );
}

function validateQualifiedSourceCaptureBytes(
  bytesValue: Uint8Array,
): QualifiedSourceCaptureAuthority {
  const text = exactUtf8(bytesValue, "$sourceCaptureBytes");
  const root = exactRecord(
    parseExactJson(text, "$sourceCaptureBytes"),
    ["schemaVersion", "selection", "manifestFingerprint", "artifacts"],
    "$sourceCapture",
  );
  literalValue(
    root.schemaVersion,
    "modelica-qualified-source-capture/1.0",
    "$sourceCapture.schemaVersion",
  );
  const selection = exactRecord(
    root.selection,
    ["modelId", "modelVersion", "scenarioId"],
    "$sourceCapture.selection",
  );
  const artifacts = arrayOf(root.artifacts, "$sourceCapture.artifacts").map(
    (value, index) => {
      const path = `$sourceCapture.artifacts[${index}]`;
      const entry = exactRecord(value, ["role", "resource", "cas"], path);
      const role = inputRole(entry.role, `${path}.role`);
      const resource = validateExpectedProviderResource(
        entry.resource,
        `${path}.resource`,
      );
      const cas = qualificationCas(entry.cas, `${path}.cas`);
      if (
        cas.sha256 !== resource.sha256 || cas.byteCount !== resource.byteCount
      ) throw new TypeError(`${path}.cas differs from its provider resource.`);
      return deepFreeze({ role, resource, cas });
    },
  ).sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(
    artifacts.map((artifact) => artifact.role),
    "$sourceCapture.artifacts roles",
  );
  rejectDuplicates(
    artifacts.map((artifact) => artifact.resource.uri),
    "$sourceCapture.artifacts URIs",
  );
  if (
    artifacts.length < 2 || artifacts.length > 3 ||
    !artifacts.some((artifact) => artifact.role === "model") ||
    !artifacts.some((artifact) => artifact.role === "scenario")
  ) throw new TypeError("$sourceCapture must close model and scenario.");
  const capture: QualifiedSourceCaptureAuthority = deepFreeze({
    selection: {
      modelId: safeId(selection.modelId, "$sourceCapture.selection.modelId"),
      modelVersion: nonEmptyText(
        selection.modelVersion,
        "$sourceCapture.selection.modelVersion",
      ),
      scenarioId: safeId(
        selection.scenarioId,
        "$sourceCapture.selection.scenarioId",
      ),
    },
    manifestFingerprint: sha256Hex(
      root.manifestFingerprint,
      "$sourceCapture.manifestFingerprint",
    ),
    artifacts,
  });
  if (
    deterministicJson({
      schemaVersion: "modelica-qualified-source-capture/1.0",
      ...capture,
    }) !== text
  ) throw new TypeError("$sourceCaptureBytes are not canonical JSON.");
  return capture;
}

function assertSourceCaptureAuthority(
  capture: QualifiedSourceCaptureAuthority,
  manifest: ModelicaQualifiedManifestDocument,
  qualification: QualificationAuthority,
): void {
  const resources = [
    { role: "model" as const, ...manifest.model },
    ...(manifest.parameterSchema === undefined ? [] : [{
      role: "parameter_schema" as const,
      ...manifest.parameterSchema,
    }]),
    { role: "scenario" as const, ...manifest.scenario },
  ].sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  const expectedArtifacts = resources.map((resource) => {
    const authority = qualification.sources.find((candidate) =>
      candidate.role === resource.role
    );
    if (!authority) {
      throw new TypeError(`Qualification lacks ${resource.role} source authority.`);
    }
    return {
      role: resource.role,
      resource: {
        uri: resource.uri,
        mediaType: resource.mediaType,
        byteCount: resource.byteCount,
        sha256: resource.sha256,
      },
      cas: authority.cas,
    };
  });
  if (
    deterministicJson(capture.selection) !== deterministicJson(manifest.selection) ||
    capture.manifestFingerprint !== manifest.fingerprint ||
    deterministicJson(capture.artifacts) !== deterministicJson(expectedArtifacts)
  ) {
    throw new TypeError(
      "The reopened source capture diverges from the qualified manifest and authority.",
    );
  }
}

function assertQualifiedAuthorities(
  simulationCase: SimulationCaseV2,
  manifest: ModelicaQualifiedManifestDocument,
): void {
  if (
    manifest.selection.modelId !== MODELICA_LOCAL_QUALIFIED_KIT.modelId ||
    manifest.selection.modelVersion !== MODELICA_LOCAL_QUALIFIED_KIT.modelVersion ||
    manifest.selection.scenarioId !== MODELICA_LOCAL_QUALIFIED_KIT.scenarioId ||
    manifest.modelName !== MODELICA_LOCAL_QUALIFIED_KIT.modelName ||
    manifest.parameterSchema !== undefined ||
    manifest.model.sha256 !== MODELICA_LOCAL_QUALIFIED_KIT.modelSha256 ||
    manifest.model.byteCount !== MODELICA_LOCAL_QUALIFIED_KIT.modelByteCount ||
    manifest.scenario.sha256 !== MODELICA_LOCAL_QUALIFIED_KIT.scenarioSha256 ||
    manifest.scenario.byteCount !==
      MODELICA_LOCAL_QUALIFIED_KIT.scenarioByteCount ||
    deterministicJson({
        description: manifest.scenarioPublic.description,
        startTimeS: manifest.scenarioPublic.startTimeS,
        stopTimeS: manifest.scenarioPublic.stopTimeS,
        numberOfIntervals: manifest.scenarioPublic.numberOfIntervals,
        solver: manifest.scenarioPublic.solver,
        targetTemperature: manifest.scenarioPublic.targetTemperature,
      }) !== deterministicJson(MODELICA_LOCAL_QUALIFIED_KIT.scenario) ||
    manifest.selection.modelId !== simulationCase.kit.modelId ||
    manifest.selection.modelVersion !== simulationCase.kit.modelVersion ||
    manifest.selection.scenarioId !== simulationCase.scenario.id ||
    manifest.model.sha256 !== simulationCase.kit.modelSha256 ||
    manifest.scenario.sha256 !== simulationCase.scenario.sourceSha256 ||
    manifest.scenarioProjectionSha256 !== simulationCase.scenario.projectionSha256
  ) {
    throw new TypeError("The Modelica case, manifest and qualification diverge.");
  }
  assertSupportedMethod({
    lowering: manifest.lowering,
    resultNormalizer: manifest.resultNormalizer,
    engine: manifest.engine,
  }, "$manifest");
  const parameters = new Map(manifest.parameters.map((item) => [item.id, item]));
  const qualifiedParameterContract = [...parameters.values()].map((item) => ({
    id: item.id,
    modelicaName: item.modelicaName,
    modelicaType: item.modelicaType,
    unit: item.unit,
    minimum: item.minimum,
    maximum: item.maximum,
    conversion: item.conversion,
  })).sort(compareById);
  if (
    deterministicJson(qualifiedParameterContract) !==
      deterministicJson(MODELICA_LOCAL_QUALIFIED_KIT.parameters) ||
    parameters.size !== simulationCase.parameters.length ||
    simulationCase.parameters.some((item) => {
      const qualified = parameters.get(item.id);
      return !qualified || qualified.unit !== item.unit ||
        item.value < qualified.minimum || item.value > qualified.maximum ||
        qualified.conversion.from !== item.unit || qualified.conversion.factor === 0;
    })
  ) {
    throw new TypeError("The Modelica parameters or units are not qualified.");
  }
  const metrics = new Map(manifest.producedMetrics.map((item) => [item.id, item]));
  const qualifiedMetricContract = [...metrics.values()].map((item) => ({
    id: item.id,
    unit: item.unit,
    required: item.required,
  })).sort(compareById);
  if (
    deterministicJson(qualifiedMetricContract) !==
      deterministicJson(MODELICA_LOCAL_QUALIFIED_KIT.metrics) ||
    metrics.size !== simulationCase.expectedMetrics.length ||
    simulationCase.expectedMetrics.some((item) =>
      metrics.get(item.id)?.unit !== item.unit
    )
  ) {
    throw new TypeError("The Modelica metric units are not qualified.");
  }
}

/**
 * Local duplicate of the execution-relevant closed authority projection.  It
 * keeps this domain contract independent from the file-backed capture adapter
 * while still rejecting extra or missing fields in the persisted @2 envelope.
 */
function validateQualificationAuthority(value: unknown): QualificationAuthority {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "sealBasis",
    "mrtr",
    "caseDigest",
    "simulationCase",
    "manifest",
    "sourceCapture",
    "sources",
    "sealedAt",
  ], "$qualification");
  literalValue(
    root.schemaVersion,
    "simulation-case-qualification-capture/2.0",
    "$qualification.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$qualification.operation",
  );
  literalValue(
    operation.id,
    "simulate.seal-simulation-case",
    "$qualification.operation.id",
  );
  literalValue(operation.version, "2", "$qualification.operation.version");
  safeId(root.trustedRunId, "$qualification.trustedRunId");
  const basis = exactRecord(
    root.sealBasis,
    ["snapshotId", "revision", "subjectId"],
    "$qualification.sealBasis",
  );
  safeId(basis.snapshotId, "$qualification.sealBasis.snapshotId");
  positiveInteger(basis.revision, "$qualification.sealBasis.revision");
  safeId(basis.subjectId, "$qualification.sealBasis.subjectId");
  const mrtr = exactRecord(root.mrtr, [
    "decisionId",
    "inputFingerprint",
    "approvalId",
    "approvalFingerprint",
    "workItemId",
  ], "$qualification.mrtr");
  safeId(mrtr.decisionId, "$qualification.mrtr.decisionId");
  sha256Hex(mrtr.inputFingerprint, "$qualification.mrtr.inputFingerprint");
  safeId(mrtr.approvalId, "$qualification.mrtr.approvalId");
  sha256Hex(mrtr.approvalFingerprint, "$qualification.mrtr.approvalFingerprint");
  safeId(mrtr.workItemId, "$qualification.mrtr.workItemId");
  canonicalIso(root.sealedAt, "$qualification.sealedAt");
  const caseDigest = sha256Hex(root.caseDigest, "$qualification.caseDigest");
  const simulationCase = qualificationCas(
    root.simulationCase,
    "$qualification.simulationCase",
  );
  if (simulationCase.sha256 !== caseDigest) {
    throw new TypeError("$qualification.simulationCase differs from caseDigest.");
  }
  const sources = arrayOf(root.sources, "$qualification.sources").map(
    (item, index) => {
      const path = `$qualification.sources[${index}]`;
      const source = exactRecord(
        item,
        ["role", "mediaType", "resourceUri", "cas"],
        path,
      );
      const role = inputRole(source.role, `${path}.role`);
      const mediaType = nonEmptyText(source.mediaType, `${path}.mediaType`);
      if (mediaType !== (role === "model" ? "text/x-modelica" : "application/json")) {
        throw new TypeError(`${path}.mediaType is not registered for ${role}.`);
      }
      return deepFreeze({
        role,
        mediaType,
        resourceUri: nonEmptyText(source.resourceUri, `${path}.resourceUri`),
        cas: qualificationCas(source.cas, `${path}.cas`),
      });
    },
  ).sort((left, right) => compareAsciiCodeUnits(left.role, right.role));
  rejectDuplicates(
    sources.map((source) => source.role),
    "$qualification.sources roles",
  );
  if (
    !sources.some((source) => source.role === "model") ||
    !sources.some((source) => source.role === "scenario")
  ) {
    throw new TypeError("$qualification.sources lacks model or scenario.");
  }
  return deepFreeze({
    caseDigest,
    simulationCase,
    manifest: qualificationCas(root.manifest, "$qualification.manifest"),
    sourceCapture: qualificationCas(
      root.sourceCapture,
      "$qualification.sourceCapture",
    ),
    sources,
  });
}

function qualificationCas(value: unknown, path: string): QualificationCasReference {
  const root = exactRecord(value, ["uri", "byteCount", "sha256"], path);
  const sha256 = sha256Hex(root.sha256, `${path}.sha256`);
  const uri = nonEmptyText(root.uri, `${path}.uri`);
  if (!uri.endsWith(`/sha256/${sha256}`)) {
    throw new TypeError(`${path}.uri does not end with its SHA-256.`);
  }
  return deepFreeze({
    uri,
    byteCount: nonNegativeInteger(root.byteCount, `${path}.byteCount`),
    sha256,
  });
}

function canonicalIso(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  try {
    if (new Date(text).toISOString() !== text) throw new Error();
  } catch {
    throw new TypeError(`${path} must be canonical ISO-8601 UTC.`);
  }
  return text;
}

function invocationFor(
  simulationCase: SimulationCaseV2,
  manifest: ModelicaQualifiedManifestDocument,
): ModelicaIsolatedInputBundle["invocation"] {
  const qualifiedParameters = new Map(
    manifest.parameters.map((item) => [item.id, item]),
  );
  const parameters = simulationCase.parameters.map((input) => {
    const qualified = qualifiedParameters.get(input.id)!;
    const modelicaValue = normalizedFinite(
      input.value * qualified.conversion.factor + qualified.conversion.offset,
      `$parameters.${input.id}.modelicaValue`,
    );
    return {
      id: input.id,
      modelicaName: qualified.modelicaName,
      inputValue: normalizedFinite(input.value, `$parameters.${input.id}.value`),
      inputUnit: input.unit,
      modelicaValue,
      modelicaUnit: qualified.conversion.to,
    };
  }).sort(compareById);
  const expected = new Set(simulationCase.expectedMetrics.map((item) => item.id));
  const metrics = manifest.producedMetrics.filter((item) => expected.has(item.id)).map(
    (item) => ({ id: item.id, unit: item.unit, required: item.required }),
  ).sort(compareById);
  return deepFreeze({
    modelName: manifest.modelName,
    startTimeS: manifest.scenarioPublic.startTimeS,
    stopTimeS: manifest.scenarioPublic.stopTimeS,
    numberOfIntervals: manifest.scenarioPublic.numberOfIntervals,
    solver: manifest.scenarioPublic.solver,
    timeoutMs: simulationCase.timeoutMs,
    parameters,
    metrics,
  });
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

function identity(value: unknown, path: string): ModelicaResumableIdentity {
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

function parseExactJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${path} is not JSON.`);
  }
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
