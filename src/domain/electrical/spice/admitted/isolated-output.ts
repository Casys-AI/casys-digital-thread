/** Output validator for one generic admitted SPICE operating-point isolated run. */

import { type IsolatedCodeOutputDeclaration } from "../../../compile/isolation/isolated-code-execution.ts";
import { sha256Hex } from "../../../compile/source/provider-resource-reader.ts";
import { deterministicJson } from "../../../kernel/deterministic-json.ts";
import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
} from "../../../kernel/case-validation.ts";
import {
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  SPICE_ADMITTED_MAX_OBSERVABLES,
  SPICE_ADMITTED_MAX_RESULT_BYTES,
  SPICE_ADMITTED_MAX_SOURCE_BYTES,
  SPICE_ADMITTED_MAX_VECTOR_BYTES,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_RESULT_OUTPUT,
  SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
  SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
  SPICE_ISOLATED_EVIDENCE_SCHEMA,
  SPICE_OPERATING_POINT_ANALYSIS_KIND,
  SPICE_OPERATING_POINT_CURRENT_PARAMS,
  SPICE_OPERATING_POINT_ENGINE_NAME,
  SPICE_OPERATING_POINT_EXPORT,
  SPICE_OPERATING_POINT_RESULT_SCHEMA,
  SPICE_OPERATING_POINT_SIGN_CONVENTION,
  SPICE_OPERATING_POINT_WRAPPER,
} from "./contract.ts";

export type SpiceOperatingPointObservableKind = "node-voltage" | "branch-current";
export type SpiceOperatingPointUnit = "V" | "A";

export interface SpiceOperatingPointObservable {
  readonly nativeName: string;
  readonly kind: SpiceOperatingPointObservableKind;
  readonly sourceSymbol: string;
  readonly value: number;
  readonly unit: SpiceOperatingPointUnit;
}

export interface SpiceOperatingPointResult {
  readonly schemaVersion: typeof SPICE_OPERATING_POINT_RESULT_SCHEMA;
  readonly analysisKind: typeof SPICE_OPERATING_POINT_ANALYSIS_KIND;
  readonly signConvention: typeof SPICE_OPERATING_POINT_SIGN_CONVENTION;
  readonly observables: readonly SpiceOperatingPointObservable[];
}

export interface SpiceIsolatedEvidenceCounts {
  readonly sourceBytes: number;
  readonly observableCount: number;
  readonly nodeVoltageCount: number;
  readonly branchCurrentCount: number;
}

export interface SpiceIsolatedEvidenceLimits {
  readonly maxSourceBytes: number;
  readonly maxObservables: number;
  readonly maxResultBytes: number;
  readonly maxEvidenceBytes: number;
  readonly maxVectorBytes: number;
  readonly maxDurationMs: number;
}

export interface SpiceIsolatedEvidence {
  readonly schemaVersion: typeof SPICE_ISOLATED_EVIDENCE_SCHEMA;
  readonly status: "succeeded";
  readonly analysisKind: typeof SPICE_OPERATING_POINT_ANALYSIS_KIND;
  readonly inputSourceSha256: string;
  readonly profile: typeof SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE;
  readonly wrapper: typeof SPICE_OPERATING_POINT_WRAPPER;
  readonly method: {
    readonly engine: { readonly name: "ngspice"; readonly version: string };
    readonly export: typeof SPICE_OPERATING_POINT_EXPORT;
  };
  readonly counts: SpiceIsolatedEvidenceCounts;
  readonly limits: SpiceIsolatedEvidenceLimits;
  readonly limitations: typeof SPICE_ISOLATED_EVIDENCE_LIMITATIONS;
  readonly warnings: readonly [];
  readonly result: {
    readonly role: "result";
    readonly basename: "result.json";
    readonly byteCount: number;
    readonly sha256: string;
  };
}

const NATIVE_NAME =
  /^(?:v\([a-z0-9_]{1,64}\)|i\([a-z0-9_]{1,64}\)|@[a-z][a-z0-9_]{0,63}\[[a-z]{1,16}\])$/;
const SOURCE_SYMBOL = /^[A-Za-z0-9_]{1,64}$/;
const CURRENT_PARAMS = new Set<string>(SPICE_OPERATING_POINT_CURRENT_PARAMS);
const LIMITS = Object.freeze({
  maxSourceBytes: SPICE_ADMITTED_MAX_SOURCE_BYTES,
  maxObservables: SPICE_ADMITTED_MAX_OBSERVABLES,
  maxResultBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
  maxEvidenceBytes: SPICE_ADMITTED_MAX_EVIDENCE_BYTES,
  maxVectorBytes: SPICE_ADMITTED_MAX_VECTOR_BYTES,
  maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
});

export function validateAdmittedSpiceIsolatedOutput(
  declaration: IsolatedCodeOutputDeclaration,
  bytes: Uint8Array,
): void {
  const expected = SPICE_ADMITTED_OUTPUT_MANIFEST.find((entry) =>
    entry.role === declaration.role
  );
  if (!expected || deterministicJson(expected) !== deterministicJson(declaration)) {
    throw new TypeError("The admitted SPICE output declaration is not registered.");
  }
  if (declaration.role === SPICE_ADMITTED_RESULT_OUTPUT.role) {
    parseSpiceOperatingPointResult(bytes);
    return;
  }
  parseSpiceIsolatedEvidence(bytes);
}

export function parseSpiceOperatingPointResult(
  bytes: Uint8Array,
): SpiceOperatingPointResult {
  if (bytes.byteLength < 1 || bytes.byteLength > SPICE_ADMITTED_MAX_RESULT_BYTES) {
    throw new TypeError(
      "$spiceOperatingPointResult must contain 1 to 262144 bytes.",
    );
  }
  const parsed = parseJson(bytes, "$spiceOperatingPointResult");
  const root = exactRecord(parsed, [
    "schemaVersion",
    "analysisKind",
    "signConvention",
    "observables",
  ], "$spiceOperatingPointResult");
  literalValue(
    root.schemaVersion,
    SPICE_OPERATING_POINT_RESULT_SCHEMA,
    "$spiceOperatingPointResult.schemaVersion",
  );
  literalValue(
    root.analysisKind,
    SPICE_OPERATING_POINT_ANALYSIS_KIND,
    "$spiceOperatingPointResult.analysisKind",
  );
  parseSignConvention(
    root.signConvention,
    "$spiceOperatingPointResult.signConvention",
  );
  const observables = parseObservables(
    root.observables,
    "$spiceOperatingPointResult.observables",
  );
  return deepFreeze({
    schemaVersion: SPICE_OPERATING_POINT_RESULT_SCHEMA,
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    signConvention: SPICE_OPERATING_POINT_SIGN_CONVENTION,
    observables,
  });
}

export function parseSpiceIsolatedEvidence(
  bytes: Uint8Array,
): SpiceIsolatedEvidence {
  if (bytes.byteLength < 1 || bytes.byteLength > SPICE_ADMITTED_MAX_EVIDENCE_BYTES) {
    throw new TypeError(
      "$spiceIsolatedEvidence must contain 1 to 262144 bytes.",
    );
  }
  const parsed = parseJson(bytes, "$spiceIsolatedEvidence");
  const root = exactRecord(parsed, [
    "schemaVersion",
    "status",
    "analysisKind",
    "inputSourceSha256",
    "profile",
    "wrapper",
    "method",
    "counts",
    "limits",
    "limitations",
    "warnings",
    "result",
  ], "$spiceIsolatedEvidence");
  literalValue(
    root.schemaVersion,
    SPICE_ISOLATED_EVIDENCE_SCHEMA,
    "$spiceIsolatedEvidence.schemaVersion",
  );
  literalValue(root.status, "succeeded", "$spiceIsolatedEvidence.status");
  literalValue(
    root.analysisKind,
    SPICE_OPERATING_POINT_ANALYSIS_KIND,
    "$spiceIsolatedEvidence.analysisKind",
  );
  const inputSourceSha256 = sha256Hex(
    root.inputSourceSha256,
    "$spiceIsolatedEvidence.inputSourceSha256",
  );
  parseNamedVersion(
    root.profile,
    SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
    "$spiceIsolatedEvidence.profile",
  );
  parseNamedVersion(
    root.wrapper,
    SPICE_OPERATING_POINT_WRAPPER,
    "$spiceIsolatedEvidence.wrapper",
  );
  const method = exactRecord(
    root.method,
    ["engine", "export"],
    "$spiceIsolatedEvidence.method",
  );
  const engine = exactRecord(
    method.engine,
    ["name", "version"],
    "$spiceIsolatedEvidence.method.engine",
  );
  literalValue(
    engine.name,
    SPICE_OPERATING_POINT_ENGINE_NAME,
    "$spiceIsolatedEvidence.method.engine.name",
  );
  const engineVersion = nonEmptyText(
    engine.version,
    "$spiceIsolatedEvidence.method.engine.version",
  );
  if (!/^[0-9]{1,8}$/.test(engineVersion)) {
    throw new TypeError(
      "$spiceIsolatedEvidence.method.engine.version must be the ngspice major version.",
    );
  }
  parseNamedVersion(
    method.export,
    SPICE_OPERATING_POINT_EXPORT,
    "$spiceIsolatedEvidence.method.export",
  );
  const counts = parseCounts(root.counts, "$spiceIsolatedEvidence.counts");
  parseLimits(root.limits, "$spiceIsolatedEvidence.limits");
  parseLimitations(root.limitations, "$spiceIsolatedEvidence.limitations");
  if (!Array.isArray(root.warnings) || root.warnings.length !== 0) {
    throw new TypeError("$spiceIsolatedEvidence.warnings must be empty.");
  }
  const result = exactRecord(
    root.result,
    ["role", "basename", "byteCount", "sha256"],
    "$spiceIsolatedEvidence.result",
  );
  literalValue(result.role, "result", "$spiceIsolatedEvidence.result.role");
  literalValue(
    result.basename,
    SPICE_ADMITTED_RESULT_OUTPUT.basename,
    "$spiceIsolatedEvidence.result.basename",
  );
  const byteCount = positiveInteger(
    result.byteCount,
    "$spiceIsolatedEvidence.result.byteCount",
  );
  if (byteCount > SPICE_ADMITTED_MAX_RESULT_BYTES) {
    throw new TypeError(
      "$spiceIsolatedEvidence.result.byteCount exceeds the admitted result bound.",
    );
  }
  return deepFreeze({
    schemaVersion: SPICE_ISOLATED_EVIDENCE_SCHEMA,
    status: "succeeded",
    analysisKind: SPICE_OPERATING_POINT_ANALYSIS_KIND,
    inputSourceSha256,
    profile: SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE,
    wrapper: SPICE_OPERATING_POINT_WRAPPER,
    method: {
      engine: { name: SPICE_OPERATING_POINT_ENGINE_NAME, version: engineVersion },
      export: SPICE_OPERATING_POINT_EXPORT,
    },
    counts,
    limits: LIMITS,
    limitations: SPICE_ISOLATED_EVIDENCE_LIMITATIONS,
    warnings: [],
    result: {
      role: "result",
      basename: "result.json",
      byteCount,
      sha256: sha256Hex(result.sha256, "$spiceIsolatedEvidence.result.sha256"),
    },
  });
}

function parseSignConvention(value: unknown, path: string): void {
  const record = exactRecord(value, [
    "kind",
    "voltageSourceBranchCurrent",
    "passiveCurrent",
  ], path);
  literalValue(record.kind, SPICE_OPERATING_POINT_SIGN_CONVENTION.kind, `${path}.kind`);
  literalValue(
    record.voltageSourceBranchCurrent,
    SPICE_OPERATING_POINT_SIGN_CONVENTION.voltageSourceBranchCurrent,
    `${path}.voltageSourceBranchCurrent`,
  );
  literalValue(
    record.passiveCurrent,
    SPICE_OPERATING_POINT_SIGN_CONVENTION.passiveCurrent,
    `${path}.passiveCurrent`,
  );
}

function parseObservables(
  value: unknown,
  path: string,
): readonly SpiceOperatingPointObservable[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new TypeError(`${path} must be a non-empty array.`);
  }
  if (value.length > SPICE_ADMITTED_MAX_OBSERVABLES) {
    throw new TypeError(`${path} exceeds the admitted observable bound.`);
  }
  const observables = value.map((item, index) =>
    parseObservable(item, `${path}[${index}]`)
  );
  for (let index = 1; index < observables.length; index += 1) {
    if (
      compareAscii(
        observables[index - 1]!.nativeName,
        observables[index]!.nativeName,
      ) >= 0
    ) {
      throw new TypeError(`${path} must be strictly ordered by nativeName.`);
    }
  }
  return deepFreeze(observables);
}

function parseObservable(
  value: unknown,
  path: string,
): SpiceOperatingPointObservable {
  const record = exactRecord(value, [
    "nativeName",
    "kind",
    "sourceSymbol",
    "value",
    "unit",
  ], path);
  const nativeName = parseNativeName(record.nativeName, `${path}.nativeName`);
  const kind = parseKind(record.kind, `${path}.kind`);
  const sourceSymbol = parseSourceSymbol(
    record.sourceSymbol,
    `${path}.sourceSymbol`,
  );
  const unit = parseUnit(record.unit, `${path}.unit`);
  assertNativeMatchesSymbol(nativeName, kind, sourceSymbol, path);
  if (kind === "node-voltage" && unit !== "V") {
    throw new TypeError(`${path}.unit must be V for a node voltage.`);
  }
  if (kind === "branch-current" && unit !== "A") {
    throw new TypeError(`${path}.unit must be A for a branch current.`);
  }
  return {
    nativeName,
    kind,
    sourceSymbol,
    value: finite(record.value, `${path}.value`),
    unit,
  };
}

export function parseNativeName(value: unknown, path: string): string {
  const name = nonEmptyText(value, path);
  if (name !== name.toLowerCase() || !NATIVE_NAME.test(name)) {
    throw new TypeError(`${path} is not an admitted ngspice native name.`);
  }
  const current = name.match(/^@[a-z][a-z0-9_]*\[([a-z]+)\]$/);
  if (current && !CURRENT_PARAMS.has(current[1]!)) {
    throw new TypeError(`${path} is not an admitted ngspice current parameter.`);
  }
  return name;
}

function parseKind(value: unknown, path: string): SpiceOperatingPointObservableKind {
  if (value !== "node-voltage" && value !== "branch-current") {
    throw new TypeError(`${path} must be node-voltage or branch-current.`);
  }
  return value;
}

function parseSourceSymbol(value: unknown, path: string): string {
  const symbol = nonEmptyText(value, path);
  if (!SOURCE_SYMBOL.test(symbol)) {
    throw new TypeError(`${path} is not an admitted circuit symbol.`);
  }
  return symbol;
}

function parseUnit(value: unknown, path: string): SpiceOperatingPointUnit {
  if (value !== "V" && value !== "A") {
    throw new TypeError(`${path} must be V or A.`);
  }
  return value;
}

export function assertNativeMatchesSymbol(
  nativeName: string,
  kind: SpiceOperatingPointObservableKind,
  sourceSymbol: string,
  path: string,
): void {
  const folded = sourceSymbol.toLowerCase();
  if (kind === "node-voltage") {
    if (nativeName !== `v(${folded})`) {
      throw new TypeError(`${path} nativeName does not match the node symbol.`);
    }
    return;
  }
  if (nativeName === `i(${folded})`) return;
  const device = nativeName.match(/^@([a-z][a-z0-9_]*)\[([a-z]+)\]$/);
  if (device?.[1] === folded && CURRENT_PARAMS.has(device[2]!)) return;
  throw new TypeError(`${path} nativeName does not match the element symbol.`);
}

function parseCounts(value: unknown, path: string): SpiceIsolatedEvidenceCounts {
  const record = exactRecord(value, [
    "sourceBytes",
    "observableCount",
    "nodeVoltageCount",
    "branchCurrentCount",
  ], path);
  const sourceBytes = boundedCount(
    record.sourceBytes,
    1,
    SPICE_ADMITTED_MAX_SOURCE_BYTES,
    `${path}.sourceBytes`,
  );
  const observableCount = boundedCount(
    record.observableCount,
    1,
    SPICE_ADMITTED_MAX_OBSERVABLES,
    `${path}.observableCount`,
  );
  const nodeVoltageCount = boundedCount(
    record.nodeVoltageCount,
    0,
    SPICE_ADMITTED_MAX_OBSERVABLES,
    `${path}.nodeVoltageCount`,
  );
  const branchCurrentCount = boundedCount(
    record.branchCurrentCount,
    0,
    SPICE_ADMITTED_MAX_OBSERVABLES,
    `${path}.branchCurrentCount`,
  );
  if (nodeVoltageCount + branchCurrentCount !== observableCount) {
    throw new TypeError(`${path} kind counts do not sum to observableCount.`);
  }
  return deepFreeze({
    sourceBytes,
    observableCount,
    nodeVoltageCount,
    branchCurrentCount,
  });
}

function parseLimits(value: unknown, path: string): void {
  const record = exactRecord(value, [
    "maxSourceBytes",
    "maxObservables",
    "maxResultBytes",
    "maxEvidenceBytes",
    "maxVectorBytes",
    "maxDurationMs",
  ], path);
  for (const [key, expected] of Object.entries(LIMITS)) {
    literalValue(record[key], expected, `${path}.${key}`);
  }
}

function parseLimitations(value: unknown, path: string): void {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (
    deterministicJson(value) !== deterministicJson(SPICE_ISOLATED_EVIDENCE_LIMITATIONS)
  ) {
    throw new TypeError(`${path} must be the exact documentary limitation list.`);
  }
}

function parseNamedVersion(
  value: unknown,
  expected: { readonly id: string; readonly version: string },
  path: string,
): void {
  const record = exactRecord(value, ["id", "version"], path);
  literalValue(record.id, expected.id, `${path}.id`);
  literalValue(record.version, expected.version, `${path}.version`);
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  const text = exactUtf8(bytes, path);
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError(`${path} is not JSON.`);
  }
}

function exactUtf8(bytes: Uint8Array, path: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError(`${path} is not UTF-8.`);
  }
  if (new TextEncoder().encode(text).byteLength !== bytes.byteLength) {
    throw new TypeError(`${path} is not canonical UTF-8.`);
  }
  return text;
}

function boundedCount(
  value: unknown,
  minimum: number,
  maximum: number,
  path: string,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(`${path} must be an integer >= ${minimum}.`);
  }
  const count = Number(value);
  if (count > maximum) {
    throw new TypeError(`${path} exceeds its admitted bound.`);
  }
  return count;
}

function compareAscii(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}
