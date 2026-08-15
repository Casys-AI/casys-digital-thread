import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { MODELICA_QUALIFIED_MODEL_SOURCE } from "../execution-profiles/modelica-qualified-kit-v1/run.ts";
import {
  TechnicalSourceAnalysisCaptureError,
} from "../captures/technical-source-analysis-capture.ts";
import { FileByteStore } from "../captures/file-byte-store.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
} from "../compilers/initial-technical-source-analysis-composition.ts";
import {
  QUALIFIED_MODELICA_MAX_SOURCE_BYTES,
} from "../compilers/modelica-source-analysis-composition.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "../../domain/analysis/source-analysis.ts";
import {
  MODELICA_AST_IDENTITY_SCHEMA,
  modelicaAstSymbolId,
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
  QualifiedModelicaSourceAnalyzer,
} from "./qualified-modelica-source-analyzer.ts";

const SOURCE_ID = "source.modelica.linear-ramp";

function analyze(sourceText: string) {
  return new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: SOURCE_ID,
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
}

function withModel(body: string): string {
  return [
    "model LinearThermalRamp",
    '  "Minimal balanced solver-conformance model; not a physical thermal oracle."',
    body,
    "end LinearThermalRamp;",
    "",
  ].join("\n");
}

Deno.test("Le source LinearThermalRamp est reconnu sans unresolved et émet exactement un artifact, deux paramètres, une variable, une équation de type der", async () => {
  const bundle = await analyze(MODELICA_QUALIFIED_MODEL_SOURCE);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.policy.findings, []);
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.analyzer, {
    id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
    version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
  });
  assertEquals(bundle.policy.profile, QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE);
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "artifact").map((symbol) =>
      symbol.name
    ),
    ["LinearThermalRamp"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "parameter").map((symbol) =>
      symbol.name
    ).sort(),
    ["heatingRate", "initialTemperature"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "variable").map((symbol) =>
      symbol.name
    ),
    ["temperatureC"],
  );
  const equations = bundle.symbols.filter((symbol) => symbol.kind === "equation");
  assertEquals(equations.length, 1);
  assertEquals(equations[0]?.name, "der(temperatureC)");
});

Deno.test("Un source vide produit status rejected avec un finding severity error de kind modelica-missing-model-block", async () => {
  const bundle = await analyze("");
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.symbols, []);
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.findings.length, 1);
  assertEquals(bundle.policy.findings[0]?.severity, "error");
  assertEquals(bundle.policy.findings[0]?.code, "modelica-missing-model-block");
});

Deno.test("Un token hors-vocabulaire produit status rejected avec un finding code modelica-lexical-error", async () => {
  const bundle = await analyze("model Foo # not-qualified\nend Foo;\n");
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.findings[0]?.severity, "error");
  assertEquals(bundle.policy.findings[0]?.code, "modelica-lexical-error");
});

Deno.test("Un import produit un unresolved modelica-unsupported-top-level-form et status passed si aucun autre error", async () => {
  const bundle = await analyze(
    `import Modelica.SIunits;\n${MODELICA_QUALIFIED_MODEL_SOURCE}`,
  );
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.policy.findings, []);
  assertEquals(
    bundle.unresolvedConstructs.map((item) => item.kind),
    ["modelica-unsupported-top-level-form"],
  );
  assertEquals(
    bundle.symbols.some((symbol) => symbol.kind === "artifact"),
    true,
  );
});

Deno.test("Deux blocs model produisent un unresolved modelica-multiple-model-blocks", async () => {
  const bundle = await analyze(
    `${MODELICA_QUALIFIED_MODEL_SOURCE}\nmodel Extra\n  parameter Real x = 1;\nequation\n  der(x) = x;\nend Extra;\n`,
  );
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.unresolvedConstructs.map((item) => item.kind),
    ["modelica-multiple-model-blocks"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "artifact").map((symbol) =>
      symbol.name
    ),
    ["LinearThermalRamp"],
  );
});

Deno.test("Une déclaration Integer produit un unresolved modelica-unsupported-variable-type", async () => {
  const bundle = await analyze(withModel([
    "  parameter Integer steps = 1;",
    '  parameter Real heatingRate(unit = "K/s") = 1;',
    "  output Real temperatureC;",
    "equation",
    "  der(temperatureC) = heatingRate;",
  ].join("\n")));
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.unresolvedConstructs.map((item) => item.kind),
    ["modelica-unsupported-variable-type"],
  );
});

Deno.test("Une équation when produit un unresolved modelica-unsupported-equation-form", async () => {
  const bundle = await analyze(withModel([
    '  parameter Real heatingRate(unit = "K/s") = 1;',
    "  output Real temperatureC;",
    "equation",
    "  when heatingRate > 0 then",
    "    temperatureC = heatingRate;",
    "  end when;",
  ].join("\n")));
  assertEquals(bundle.policy.status, "passed");
  assertEquals(
    bundle.unresolvedConstructs.map((item) => item.kind),
    ["modelica-unsupported-equation-form"],
  );
});

Deno.test("Un défaut de paramètre non scalaire reste unresolved passed et ne produit pas modelica-end-mismatch", async () => {
  const bundle = await analyze(withModel([
    "  parameter Real x = 1 + 2;",
    "  output Real y;",
    "equation",
    "  der(y) = x;",
  ].join("\n")));
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.policy.findings, []);
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "modelica-expression-not-qualified"
    ),
    true,
  );
  assertEquals(
    bundle.policy.findings.some((item) => item.code === "modelica-end-mismatch"),
    false,
  );
});

Deno.test("Une annotation après un paramètre reste unresolved passed et ne produit pas modelica-end-mismatch", async () => {
  const bundle = await analyze(withModel([
    "  parameter Real x = 1 annotation(Evaluate=true);",
    "  output Real y;",
    "equation",
    "  der(y) = x;",
  ].join("\n")));
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.policy.findings, []);
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "modelica-unsupported-section"
    ),
    true,
  );
  assertEquals(
    bundle.policy.findings.some((item) => item.code === "modelica-end-mismatch"),
    false,
  );
});

Deno.test("Deux paramètres de même nom produisent un bundle passed avec des ids distincts", async () => {
  const bundle = await analyze(withModel([
    "  parameter Real x = 1;",
    "  parameter Real x = 2;",
    "  output Real y;",
    "equation",
    "  der(y) = x;",
  ].join("\n")));
  const parameters = bundle.symbols.filter((symbol) => symbol.kind === "parameter");
  const firstId = await modelicaAstSymbolId(SOURCE_ID, {
    kind: "parameter",
    name: "x",
  });
  const secondId = await modelicaAstSymbolId(SOURCE_ID, {
    kind: "parameter",
    name: "x",
    ordinal: 1,
  });
  assertEquals(bundle.policy.status, "passed");
  assertEquals(parameters.length, 2);
  assertEquals(
    new Set(parameters.map((symbol) => symbol.id)),
    new Set([firstId, secondId]),
  );
  assertEquals(
    bundle.unresolvedConstructs.some((item) =>
      item.kind === "modelica-duplicate-declaration"
    ),
    true,
  );
});

Deno.test("Un end mal apparié produit status rejected", async () => {
  const bundle = await analyze(
    withModel([
      '  parameter Real heatingRate(unit = "K/s") = 1;',
      "  output Real temperatureC;",
      "equation",
      "  der(temperatureC) = heatingRate;",
    ].join("\n")).replace("end LinearThermalRamp;", "end OtherName;"),
  );
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.policy.findings[0]?.severity, "error");
  assertEquals(bundle.policy.findings[0]?.code, "modelica-end-mismatch");
});

Deno.test("Les mêmes 8 lignes LinearThermalRamp produisent les mêmes ids de symboles avant et après bump de version mineure (garantie bit-identical)", async () => {
  const first = await analyze(MODELICA_QUALIFIED_MODEL_SOURCE);
  const second = await analyze(MODELICA_QUALIFIED_MODEL_SOURCE);
  assertEquals(
    first.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
    second.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
  );
  const artifact = first.symbols.find((symbol) => symbol.kind === "artifact");
  const heatingRate = first.symbols.find((symbol) =>
    symbol.kind === "parameter" && symbol.name === "heatingRate"
  );
  const temperatureC = first.symbols.find((symbol) => symbol.kind === "variable");
  const equation = first.symbols.find((symbol) => symbol.kind === "equation");
  assertEquals(
    artifact?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "model",
      name: "LinearThermalRamp",
    }),
  );
  assertEquals(
    heatingRate?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "parameter",
      name: "heatingRate",
    }),
  );
  assertEquals(
    temperatureC?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "variable",
      name: "temperatureC",
    }),
  );
  assertEquals(
    equation?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "equation",
      ordinal: 0,
      discriminator: "der",
    }),
  );
  const versioned = await sha256Fingerprint({
    schemaVersion: MODELICA_AST_IDENTITY_SCHEMA,
    sourceId: SOURCE_ID,
    kind: "model",
    name: "LinearThermalRamp",
    analyzerVersion: "1.1.0",
  });
  assertEquals(artifact?.id === versioned.digest, false);
});

Deno.test("validateSourceAnalysisBundle rejette un bundle dont status passed porte un finding severity error", () => {
  const error = assertThrows(
    () =>
      validateSourceAnalysisBundle({
        schemaVersion: SOURCE_ANALYSIS_SCHEMA,
        source: {
          id: SOURCE_ID,
          role: "modelica-model",
          language: "modelica",
          fingerprint: {
            algorithm: "sha256",
            digest: "0".repeat(64),
          },
        },
        analyzer: {
          id: QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
          version: QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
        },
        policy: {
          profile: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
          status: "passed",
          findings: [{
            id: "finding:modelica-lexical-error",
            code: "modelica-lexical-error",
            severity: "error",
            message: "An error cannot be admitted in a passed result.",
          }],
        },
        symbols: [],
        dependencies: [],
        unresolvedConstructs: [],
      }),
    TypeError,
    "must not contain an error",
  );
  assertEquals(error instanceof TypeError, true);
});

Deno.test("Un source qui dépasse 262 144 octets est rejeté avant l'analyse par la couche capture", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "qualified-modelica-source-cap-",
  });
  try {
    const service = createInitialTechnicalSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "technical-source",
        directory: `${directory}/source`,
        uriNamespace: "modelica-source-cap-test",
        label: "modelica source cap",
      }),
      analysisCaptures: new FileByteStore({
        kind: "technical-source-analysis",
        directory: `${directory}/analysis`,
        uriNamespace: "modelica-analysis-cap-test",
        label: "modelica analysis cap",
      }),
    });
    const oversized = `${"x".repeat(QUALIFIED_MODELICA_MAX_SOURCE_BYTES + 1)}`;
    const error = await assertRejects(
      () =>
        service.capture({
          profileId: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
          sourceId: SOURCE_ID,
          sourceText: oversized,
        }),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "source_size_limit_exceeded");
    assertEquals(error.reference, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Les dépendances structural-incidence couvrent exactement les paramètres et variables du modèle vers l'artifact", async () => {
  const bundle = await analyze(MODELICA_QUALIFIED_MODEL_SOURCE);
  const artifact = bundle.symbols.find((symbol) => symbol.kind === "artifact");
  const members = bundle.symbols.filter((symbol) =>
    symbol.kind === "parameter" || symbol.kind === "variable"
  );
  const incidences = bundle.dependencies.filter((dependency) =>
    dependency.kind === "structural-incidence"
  );
  assertEquals(artifact !== undefined, true);
  assertEquals(incidences.length, members.length);
  assertEquals(
    new Set(incidences.map((dependency) => dependency.fromSymbolId)),
    new Set(members.map((symbol) => symbol.id)),
  );
  assertEquals(
    incidences.every((dependency) => dependency.toSymbolId === artifact?.id),
    true,
  );
});
