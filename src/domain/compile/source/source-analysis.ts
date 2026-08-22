/**
 * Language-neutral, source-local facts emitted by a source-analysis frontend.
 *
 * This contract is deliberately below every MCP provider and projection. A
 * Python, Modelica, SPICE, SysML, CalculiX, or plain-text frontend may create this
 * bundle; neither the frontend AST nor any provider-specific invocation leaks
 * into it. The bundle reports facts and diagnostics. It grants no authority.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";

export const SOURCE_ANALYSIS_SCHEMA = "source-analysis/1.0" as const;

export type SourceAnalysisSourceRole =
  | "brief"
  | "sysml-model"
  | "cad-script"
  | "modelica-model"
  | "spice-circuit"
  | "calculix-input";

export type SourceAnalysisLanguage =
  | "plain-text"
  | "sysml-v2"
  | "python"
  | "typescript"
  | "modelica"
  | "spice"
  | "calculix-inp";

export type SourceAnalysisDependencyKind =
  | "static-value-flow"
  | "declared-dependency"
  | "structural-incidence";

export type SourceAnalysisSymbolKind =
  | "artifact"
  | "brief-item"
  | "component"
  | "equation"
  | "function"
  | "metric"
  | "parameter"
  | "requirement"
  | "variable";

/** A source position with one-based lines and zero-based columns. */
export interface SourceAnalysisLocation {
  readonly line: number;
  readonly column: number;
}

/** A source range in the native source; end may equal start for a point span. */
export interface SourceAnalysisSpan {
  readonly start: SourceAnalysisLocation;
  readonly end: SourceAnalysisLocation;
}

export interface SourceAnalysisSource {
  readonly id: string;
  readonly role: SourceAnalysisSourceRole;
  readonly language: SourceAnalysisLanguage;
  readonly fingerprint: ContentFingerprint;
}

export interface SourceAnalysisAnalyzer {
  readonly id: string;
  readonly version: string;
}

export interface SourceAnalysisFinding {
  readonly id: string;
  readonly code: string;
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly span?: SourceAnalysisSpan;
}

export interface SourceAnalysisPolicy {
  readonly profile: string;
  readonly status: "passed" | "rejected";
  readonly findings: readonly SourceAnalysisFinding[];
}

export interface SourceAnalysisSymbol {
  readonly id: string;
  readonly kind: SourceAnalysisSymbolKind;
  readonly name: string;
  readonly span?: SourceAnalysisSpan;
}

/** A directed relation between two symbols declared by this one source. */
export interface SourceAnalysisDependency {
  readonly id: string;
  readonly kind: SourceAnalysisDependencyKind;
  readonly fromSymbolId: string;
  readonly toSymbolId: string;
  readonly span?: SourceAnalysisSpan;
}

/** A native construct deliberately not promoted to a relation or symbol. */
export interface SourceAnalysisUnresolvedConstruct {
  readonly id: string;
  readonly kind: string;
  readonly message: string;
  readonly span?: SourceAnalysisSpan;
}

/**
 * Immutable, content-addressable analysis facts for exactly one native source.
 *
 * It is not a shared AST and it is not an execution plan. Dependencies only
 * refer to ids in `symbols`, which makes every relation explicitly local to
 * `source` until a later semantic resolver links it to another source.
 */
export interface SourceAnalysisBundle {
  readonly schemaVersion: typeof SOURCE_ANALYSIS_SCHEMA;
  readonly source: SourceAnalysisSource;
  readonly analyzer: SourceAnalysisAnalyzer;
  readonly policy: SourceAnalysisPolicy;
  readonly symbols: readonly SourceAnalysisSymbol[];
  readonly dependencies: readonly SourceAnalysisDependency[];
  readonly unresolvedConstructs: readonly SourceAnalysisUnresolvedConstruct[];
}

const ROOT_KEYS = [
  "schemaVersion",
  "source",
  "analyzer",
  "policy",
  "symbols",
  "dependencies",
  "unresolvedConstructs",
] as const;

const SOURCE_ROLES = new Set<SourceAnalysisSourceRole>([
  "brief",
  "sysml-model",
  "cad-script",
  "modelica-model",
  "spice-circuit",
  "calculix-input",
]);
const SOURCE_LANGUAGES = new Set<SourceAnalysisLanguage>([
  "plain-text",
  "sysml-v2",
  "python",
  "typescript",
  "modelica",
  "spice",
  "calculix-inp",
]);
const SYMBOL_KINDS = new Set<SourceAnalysisSymbolKind>([
  "artifact",
  "brief-item",
  "component",
  "equation",
  "function",
  "metric",
  "parameter",
  "requirement",
  "variable",
]);
const DEPENDENCY_KINDS = new Set<SourceAnalysisDependencyKind>([
  "static-value-flow",
  "declared-dependency",
  "structural-incidence",
]);
const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Validate untrusted JSON into a deeply frozen source-analysis bundle.
 *
 * This is fail-closed: all records reject unknown and missing keys, source
 * fingerprints must be canonical SHA-256, ids are unique, and dependency ends
 * must name symbols in this same bundle.
 */
export function validateSourceAnalysisBundle(value: unknown): SourceAnalysisBundle {
  const root = exactRecord(value, ROOT_KEYS, "$bundle");
  literalValue(root.schemaVersion, SOURCE_ANALYSIS_SCHEMA, "$bundle.schemaVersion");

  const source = parseSource(root.source, "$bundle.source");
  const analyzer = parseAnalyzer(root.analyzer, "$bundle.analyzer");
  const policy = parsePolicy(root.policy, "$bundle.policy");

  const symbols = arrayOf(root.symbols, "$bundle.symbols")
    .map((item, index) => parseSymbol(item, `$bundle.symbols[${index}]`))
    .sort(compareById);
  rejectDuplicates(symbols.map((symbol) => symbol.id), "$bundle.symbols ids");

  const dependencies = arrayOf(root.dependencies, "$bundle.dependencies")
    .map((item, index) => parseDependency(item, `$bundle.dependencies[${index}]`))
    .sort(compareById);
  rejectDuplicates(
    dependencies.map((dependency) => dependency.id),
    "$bundle.dependencies ids",
  );

  const symbolIds = new Set(symbols.map((symbol) => symbol.id));
  for (const dependency of dependencies) {
    if (!symbolIds.has(dependency.fromSymbolId)) {
      throw new TypeError(
        `$bundle.dependencies.${dependency.id}.fromSymbolId must name a symbol in $bundle.symbols.`,
      );
    }
    if (!symbolIds.has(dependency.toSymbolId)) {
      throw new TypeError(
        `$bundle.dependencies.${dependency.id}.toSymbolId must name a symbol in $bundle.symbols.`,
      );
    }
    if (dependency.fromSymbolId === dependency.toSymbolId) {
      throw new TypeError(
        `$bundle.dependencies.${dependency.id} must not reference the same symbol at both ends.`,
      );
    }
  }

  const unresolvedConstructs = arrayOf(
    root.unresolvedConstructs,
    "$bundle.unresolvedConstructs",
  )
    .map((item, index) =>
      parseUnresolvedConstruct(item, `$bundle.unresolvedConstructs[${index}]`)
    )
    .sort(compareById);
  rejectDuplicates(
    unresolvedConstructs.map((construct) => construct.id),
    "$bundle.unresolvedConstructs ids",
  );

  return deepFreeze({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source,
    analyzer,
    policy,
    symbols,
    dependencies,
    unresolvedConstructs,
  });
}

/** Compute the deterministic content fingerprint of a validated bundle. */
export function fingerprintSourceAnalysisBundle(
  value: unknown,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateSourceAnalysisBundle(value));
}

function parseSource(value: unknown, path: string): SourceAnalysisSource {
  const source = exactRecord(value, ["id", "role", "language", "fingerprint"], path);
  const role = sourceRole(source.role, `${path}.role`);
  const language = sourceLanguage(source.language, `${path}.language`);
  return {
    id: safeId(source.id, `${path}.id`),
    role,
    language,
    fingerprint: parseFingerprint(source.fingerprint, `${path}.fingerprint`),
  };
}

function parseAnalyzer(value: unknown, path: string): SourceAnalysisAnalyzer {
  const analyzer = exactRecord(value, ["id", "version"], path);
  return {
    id: safeId(analyzer.id, `${path}.id`),
    version: nonEmptyText(analyzer.version, `${path}.version`),
  };
}

function parsePolicy(value: unknown, path: string): SourceAnalysisPolicy {
  const policy = exactRecord(value, ["profile", "status", "findings"], path);
  const status = policyStatus(policy.status, `${path}.status`);
  const findings = arrayOf(policy.findings, `${path}.findings`)
    .map((item, index) => parseFinding(item, `${path}.findings[${index}]`))
    .sort(compareById);
  rejectDuplicates(findings.map((finding) => finding.id), `${path}.findings ids`);
  const errorCount = findings.filter((finding) => finding.severity === "error").length;
  if (status === "rejected" && errorCount === 0) {
    throw new TypeError(
      `${path}.findings must contain an error for a rejected result.`,
    );
  }
  if (status === "passed" && errorCount > 0) {
    throw new TypeError(
      `${path}.findings must not contain an error for a passed result.`,
    );
  }
  return { profile: safeId(policy.profile, `${path}.profile`), status, findings };
}

function parseFinding(value: unknown, path: string): SourceAnalysisFinding {
  const finding = exactOptionalRecord(
    value,
    ["id", "code", "severity", "message"],
    ["span"],
    path,
  );
  return {
    id: safeId(finding.id, `${path}.id`),
    code: safeId(finding.code, `${path}.code`),
    severity: findingSeverity(finding.severity, `${path}.severity`),
    message: nonEmptyText(finding.message, `${path}.message`),
    ...(Object.hasOwn(finding, "span")
      ? { span: parseSpan(finding.span, `${path}.span`) }
      : {}),
  };
}

function parseSymbol(value: unknown, path: string): SourceAnalysisSymbol {
  const symbol = exactOptionalRecord(value, ["id", "kind", "name"], ["span"], path);
  return {
    id: safeId(symbol.id, `${path}.id`),
    kind: symbolKind(symbol.kind, `${path}.kind`),
    name: nonEmptyText(symbol.name, `${path}.name`),
    ...(Object.hasOwn(symbol, "span")
      ? { span: parseSpan(symbol.span, `${path}.span`) }
      : {}),
  };
}

function parseDependency(value: unknown, path: string): SourceAnalysisDependency {
  const dependency = exactOptionalRecord(
    value,
    ["id", "kind", "fromSymbolId", "toSymbolId"],
    ["span"],
    path,
  );
  return {
    id: safeId(dependency.id, `${path}.id`),
    kind: dependencyKind(dependency.kind, `${path}.kind`),
    fromSymbolId: safeId(dependency.fromSymbolId, `${path}.fromSymbolId`),
    toSymbolId: safeId(dependency.toSymbolId, `${path}.toSymbolId`),
    ...(Object.hasOwn(dependency, "span")
      ? { span: parseSpan(dependency.span, `${path}.span`) }
      : {}),
  };
}

function parseUnresolvedConstruct(
  value: unknown,
  path: string,
): SourceAnalysisUnresolvedConstruct {
  const construct = exactOptionalRecord(
    value,
    ["id", "kind", "message"],
    ["span"],
    path,
  );
  return {
    id: safeId(construct.id, `${path}.id`),
    kind: safeId(construct.kind, `${path}.kind`),
    message: nonEmptyText(construct.message, `${path}.message`),
    ...(Object.hasOwn(construct, "span")
      ? { span: parseSpan(construct.span, `${path}.span`) }
      : {}),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)) {
    throw new TypeError(
      `${path}.digest must be a lowercase 64-character SHA-256 hex digest.`,
    );
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function parseSpan(value: unknown, path: string): SourceAnalysisSpan {
  const span = exactRecord(value, ["start", "end"], path);
  const start = parseLocation(span.start, `${path}.start`);
  const end = parseLocation(span.end, `${path}.end`);
  if (end.line < start.line || (end.line === start.line && end.column < start.column)) {
    throw new TypeError(`${path}.end must not precede ${path}.start.`);
  }
  return { start, end };
}

function parseLocation(value: unknown, path: string): SourceAnalysisLocation {
  const location = exactRecord(value, ["line", "column"], path);
  return {
    line: positiveSourcePosition(location.line, `${path}.line`),
    column: positiveSourcePosition(location.column, `${path}.column`),
  };
}

function positiveSourcePosition(value: unknown, path: string): number {
  const minimum = path.endsWith(".column") ? 0 : 1;
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new TypeError(
      `${path} must be a ${minimum === 0 ? "non-negative" : "positive"} integer.`,
    );
  }
  return Number(value);
}

function exactOptionalRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    // exactRecord supplies the canonical error wording for non-record values.
    return exactRecord(value, requiredKeys, path);
  }
  const actualKeys = Object.keys(value as Record<string, unknown>);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of actualKeys) {
    if (!allowed.has(key)) throw new TypeError(`${path} has unsupported field ${key}.`);
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${path}.${key} is required.`);
  }
  // Retain exactRecord as the single plain-object assertion, including when
  // optional fields are present. The allowed/missing checks above make this
  // dynamic key set just as fail-closed as a static exactRecord call.
  return exactRecord(value, actualKeys, path);
}

function sourceRole(value: unknown, path: string): SourceAnalysisSourceRole {
  if (
    typeof value !== "string" || !SOURCE_ROLES.has(value as SourceAnalysisSourceRole)
  ) {
    throw new TypeError(`${path} must be a supported source role.`);
  }
  return value as SourceAnalysisSourceRole;
}

function sourceLanguage(value: unknown, path: string): SourceAnalysisLanguage {
  if (
    typeof value !== "string" ||
    !SOURCE_LANGUAGES.has(value as SourceAnalysisLanguage)
  ) {
    throw new TypeError(`${path} must be a supported source language.`);
  }
  return value as SourceAnalysisLanguage;
}

function symbolKind(value: unknown, path: string): SourceAnalysisSymbolKind {
  if (
    typeof value !== "string" || !SYMBOL_KINDS.has(value as SourceAnalysisSymbolKind)
  ) {
    throw new TypeError(`${path} must be a supported symbol kind.`);
  }
  return value as SourceAnalysisSymbolKind;
}

function dependencyKind(value: unknown, path: string): SourceAnalysisDependencyKind {
  if (
    typeof value !== "string" ||
    !DEPENDENCY_KINDS.has(value as SourceAnalysisDependencyKind)
  ) {
    throw new TypeError(`${path} must be a supported source-local dependency kind.`);
  }
  return value as SourceAnalysisDependencyKind;
}

function policyStatus(value: unknown, path: string): "passed" | "rejected" {
  if (value !== "passed" && value !== "rejected") {
    throw new TypeError(`${path} must equal "passed" or "rejected".`);
  }
  return value;
}

function findingSeverity(value: unknown, path: string): "warning" | "error" {
  if (value !== "warning" && value !== "error") {
    throw new TypeError(`${path} must equal "warning" or "error".`);
  }
  return value;
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
