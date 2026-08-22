import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  fingerprintSourceAnalysisBundle,
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "./source-analysis.ts";

const FINGERPRINT = { algorithm: "sha256", digest: "a".repeat(64) } as const;

const PYTHON_BUNDLE: unknown = {
  schemaVersion: SOURCE_ANALYSIS_SCHEMA,
  source: {
    id: "cad.drip-tray",
    role: "cad-script",
    language: "python",
    fingerprint: FINGERPRINT,
  },
  analyzer: { id: "python-ast", version: "1.0.0" },
  policy: { profile: "cad.preview", status: "passed", findings: [] },
  symbols: [
    {
      id: "wall-thickness",
      kind: "parameter",
      name: "wall_thickness",
      // Source locations are one-based by line and zero-based by column. A
      // point span is legal and carries the location of a single token.
      span: { start: { line: 2, column: 0 }, end: { line: 2, column: 0 } },
    },
    {
      id: "result",
      kind: "artifact",
      name: "result",
      span: { start: { line: 8, column: 1 }, end: { line: 8, column: 24 } },
    },
  ],
  dependencies: [
    {
      id: "wall-thickness-to-result",
      kind: "static-value-flow",
      fromSymbolId: "wall-thickness",
      toSymbolId: "result",
      span: { start: { line: 8, column: 10 }, end: { line: 8, column: 23 } },
    },
  ],
  unresolvedConstructs: [],
};

const MODELICA_BUNDLE: unknown = {
  schemaVersion: SOURCE_ANALYSIS_SCHEMA,
  source: {
    id: "thermal.machine",
    role: "modelica-model",
    language: "modelica",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
  },
  analyzer: { id: "openmodelica-incidence", version: "1.0.0" },
  policy: {
    profile: "modelica.simulation",
    status: "rejected",
    findings: [
      {
        id: "dynamic-call",
        code: "dynamic-call",
        severity: "error",
        message: "The equation target is unresolved.",
        span: { start: { line: 12, column: 3 }, end: { line: 12, column: 18 } },
      },
    ],
  },
  symbols: [
    { id: "heater-power", kind: "parameter", name: "heaterPower" },
    { id: "thermal-balance", kind: "equation", name: "thermalBalance" },
    { id: "water-temperature", kind: "variable", name: "waterTemperature" },
  ],
  dependencies: [
    {
      id: "heater-to-balance",
      kind: "structural-incidence",
      fromSymbolId: "heater-power",
      toSymbolId: "thermal-balance",
    },
    {
      id: "balance-to-temperature",
      kind: "structural-incidence",
      fromSymbolId: "thermal-balance",
      toSymbolId: "water-temperature",
    },
  ],
  unresolvedConstructs: [
    {
      id: "external-lookup",
      kind: "external-reference",
      message: "A package lookup remains unresolved.",
    },
  ],
};

Deno.test("SourceAnalysisBundle accepts and deeply freezes native Python CAD facts", () => {
  const bundle = validateSourceAnalysisBundle(PYTHON_BUNDLE);

  assertEquals(bundle.source.language, "python");
  assertEquals(bundle.dependencies[0].kind, "static-value-flow");
  assertEquals(bundle.symbols[1].span?.start.column, 0);
  assertEquals(bundle.symbols[1].span?.start, bundle.symbols[1].span?.end);
  assert(Object.isFrozen(bundle));
  assert(Object.isFrozen(bundle.source));
  assert(Object.isFrozen(bundle.symbols));
  assert(Object.isFrozen(bundle.symbols[0].span));
});

Deno.test("SourceAnalysisBundle accepts Modelica structural incidence without a provider contract", () => {
  const bundle = validateSourceAnalysisBundle(MODELICA_BUNDLE);

  assertEquals(bundle.source.role, "modelica-model");
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.dependencies.length, 2);
  assertEquals(bundle.unresolvedConstructs[0].kind, "external-reference");
});

Deno.test("SourceAnalysisBundle accepts circuit-only SPICE facts without a provider contract", () => {
  const bundle = validateSourceAnalysisBundle({
    schemaVersion: SOURCE_ANALYSIS_SCHEMA,
    source: {
      id: "source.spice.clamp",
      role: "spice-circuit",
      language: "spice",
      fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    },
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    policy: {
      profile: "spice-circuit-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: "artifact.circuit", kind: "artifact", name: "circuit" },
      { id: "parameter.rseries", kind: "parameter", name: "rseries" },
      { id: "component.Rseries", kind: "component", name: "Rseries" },
      { id: "node.nmid", kind: "variable", name: "nmid" },
    ],
    dependencies: [{
      id: "dependency.rseries.Rseries",
      kind: "static-value-flow",
      fromSymbolId: "parameter.rseries",
      toSymbolId: "component.Rseries",
    }],
    unresolvedConstructs: [],
  });
  assertEquals(bundle.source.role, "spice-circuit");
  assertEquals(bundle.source.language, "spice");
  assertEquals(bundle.symbols.some((symbol) => symbol.kind === "component"), true);
});

Deno.test("SourceAnalysisBundle fingerprint is stable under permutation of set-like collections", async () => {
  const reversed = structuredClone(MODELICA_BUNDLE) as Record<string, unknown>;
  for (const key of ["symbols", "dependencies", "unresolvedConstructs"] as const) {
    reversed[key] = [...(reversed[key] as unknown[])].reverse();
  }
  const policy = reversed.policy as Record<string, unknown>;
  policy.findings = [...(policy.findings as unknown[])].reverse();

  const first = await fingerprintSourceAnalysisBundle(MODELICA_BUNDLE);
  const second = await fingerprintSourceAnalysisBundle(reversed);

  assertEquals(first, second);
  assertEquals(first.algorithm, "sha256");
  assertEquals(first.digest.length, 64);
});

Deno.test("SourceAnalysisBundle rejects surplus fields and malformed source fingerprints", () => {
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        extra: true,
      }),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        source: {
          ...((PYTHON_BUNDLE as Record<string, unknown>).source as Record<
            string,
            unknown
          >),
          fingerprint: { algorithm: "sha256", digest: "A".repeat(64) },
        },
      }),
    TypeError,
    "lowercase",
  );
});

Deno.test("SourceAnalysisBundle rejects duplicate ids and dependency endpoints outside its source", () => {
  const symbols = (PYTHON_BUNDLE as Record<string, unknown>).symbols as unknown[];
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        symbols: [...symbols, { ...symbols[0] as Record<string, unknown> }],
      }),
    TypeError,
    "must not contain duplicates",
  );
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        dependencies: [{
          id: "unknown-to-result",
          kind: "static-value-flow",
          fromSymbolId: "not-in-this-source",
          toSymbolId: "result",
        }],
      }),
    TypeError,
    "must name a symbol",
  );
});

Deno.test("SourceAnalysisBundle rejects invalid spans and enforces policy severity invariants", () => {
  const modelicaPolicy = (MODELICA_BUNDLE as Record<string, unknown>).policy as Record<
    string,
    unknown
  >;
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        symbols: [{
          id: "bad-span",
          kind: "parameter",
          name: "badSpan",
          span: { start: { line: 5, column: 3 }, end: { line: 4, column: 3 } },
        }],
        dependencies: [],
      }),
    TypeError,
    "must not precede",
  );
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(MODELICA_BUNDLE as Record<string, unknown>),
        policy: { ...modelicaPolicy, findings: [] },
      }),
    TypeError,
    "must contain an error",
  );
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        policy: {
          profile: "cad.preview",
          status: "passed",
          findings: [{
            id: "analysis-failed",
            code: "analysis-failed",
            severity: "error",
            message: "An error cannot be admitted in a passed result.",
          }],
        },
      }),
    TypeError,
    "must not contain an error",
  );

  const acceptedWarning = validateSourceAnalysisBundle({
    ...(PYTHON_BUNDLE as Record<string, unknown>),
    policy: {
      profile: "cad.preview",
      status: "passed",
      findings: [{
        id: "style-warning",
        code: "style-warning",
        severity: "warning",
        message: "The identifier does not follow the preferred style.",
      }],
    },
  });
  assertEquals(acceptedWarning.policy.findings[0].severity, "warning");
});

Deno.test("SourceAnalysisBundle rejects explicitly undefined optional fields", () => {
  assertThrows(
    () =>
      validateSourceAnalysisBundle({
        ...(PYTHON_BUNDLE as Record<string, unknown>),
        symbols: [{
          id: "undefined-span",
          kind: "parameter",
          name: "undefinedSpan",
          span: undefined,
        }],
        dependencies: [],
      }),
    TypeError,
  );
});

Deno.test("SourceAnalysisBundle fingerprint rejects invalid input before hashing", () => {
  assertThrows(
    () => fingerprintSourceAnalysisBundle({ schemaVersion: SOURCE_ANALYSIS_SCHEMA }),
    TypeError,
    "source is required",
  );
});
