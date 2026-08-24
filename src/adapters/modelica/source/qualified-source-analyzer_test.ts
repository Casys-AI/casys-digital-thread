import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  TechnicalSourceAnalysisCaptureError,
} from "../../compile/captures/technical-source-analysis-capture.ts";
import {
  technicalSourceAnalysisCaptureStores,
  technicalSourceCaptureInput,
} from "../../../testing/technical-source-capture-test-support.ts";
import {
  createInitialTechnicalSourceAnalysisCaptureService,
} from "../../compile/captures/initial-technical-source-analysis-composition.ts";
import { QUALIFIED_MODELICA_MAX_SOURCE_BYTES } from "./source-analysis-composition.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import {
  SOURCE_ANALYSIS_SCHEMA,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  MODELICA_AST_IDENTITY_SCHEMA,
  modelicaAstSymbolId,
  QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_ID,
  QUALIFIED_MODELICA_SOURCE_ANALYZER_VERSION,
  QualifiedModelicaSourceAnalyzer,
} from "./qualified-source-analyzer.ts";

const SOURCE_ID = "source.modelica.generic-v2";

const SINGLE_STATE_SOURCE = `model WorkshopTemperatureResponse
  parameter Real ambientLevel(unit = "degC") = 20;
  parameter Real ratePerSecond(unit = "K/s") = 1;
  output Real measuredLevel(
    unit = "degC",
    start = 20,
    fixed = true);
equation
  der(measuredLevel) = ratePerSecond;
annotation(experiment(
  StartTime = 0,
  StopTime = 4,
  Interval = 0.2,
  Tolerance = 1e-6));
end WorkshopTemperatureResponse;
`;

const COUPLED_STATE_SOURCE = `model BenchOscillationTrial
  parameter Real inertia(unit = "kg") = 2;
  parameter Real drag(unit = "N.s/m") = 3;
  parameter Real restoringGain(unit = "N/m") = 100;
  parameter Real externalLoad(unit = "N") = 10;
  output Real travel(
    unit = "m",
    start = 0,
    fixed = true);
  output Real travelRate(
    unit = "m/s",
    start = 0,
    fixed = true);
equation
  der(travel) = travelRate;
  der(travelRate) = externalLoad / inertia - drag / inertia * travelRate - restoringGain / inertia * travel;
annotation(experiment(
  StartTime = 0,
  StopTime = 8,
  Interval = 0.1,
  Tolerance = 1e-7));
end BenchOscillationTrial;
`;

const UNSUPPORTED_WHEN_SOURCE = `model EventDrivenTrial
  parameter Real gain(unit = "1/s") = 2;
  output Real response(unit = "1", start = 0, fixed = true);
equation
  when response > 1 then
    response = 0;
  end when;
annotation(experiment(
  StartTime = 0,
  StopTime = 2,
  Interval = 0.1,
  Tolerance = 1e-6));
end EventDrivenTrial;
`;

function analyze(sourceText: string) {
  return new QualifiedModelicaSourceAnalyzer().analyze({
    sourceId: SOURCE_ID,
    role: "modelica-model",
    language: "modelica",
    sourceText,
  });
}

Deno.test("closed-subset-v2 accepts a generic single-state model with arbitrary names", async () => {
  const bundle = await analyze(SINGLE_STATE_SOURCE);
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
    ["WorkshopTemperatureResponse"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "parameter").map((symbol) =>
      symbol.name
    ).sort(),
    ["ambientLevel", "ratePerSecond"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "variable").map((symbol) =>
      symbol.name
    ).sort(),
    ["measuredLevel"],
  );
  const equations = bundle.symbols.filter((symbol) => symbol.kind === "equation");
  assertEquals(equations.length, 1);
  assertEquals(equations[0]?.name, "der(measuredLevel)");
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind !== "artifact").every((symbol) =>
      symbol.span !== undefined
    ),
    true,
  );
  assertEquals(
    bundle.dependencies.every((dependency) => dependency.span !== undefined),
    true,
  );
});

Deno.test("closed-subset-v2 accepts a generic coupled-state model without compiler changes", async () => {
  const bundle = await analyze(COUPLED_STATE_SOURCE);
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.policy.findings, []);
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "artifact").map((symbol) =>
      symbol.name
    ),
    ["BenchOscillationTrial"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "parameter").map((symbol) =>
      symbol.name
    ).sort(),
    ["drag", "externalLoad", "inertia", "restoringGain"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "variable").map((symbol) =>
      symbol.name
    ).sort(),
    ["travel", "travelRate"],
  );
  assertEquals(
    bundle.symbols.filter((symbol) => symbol.kind === "equation").map((symbol) =>
      symbol.name
    ).sort(),
    ["der(travel)", "der(travelRate)"],
  );
});

Deno.test("generic variable RHS names emit static value flows into both ODEs", async () => {
  const bundle = await analyze(COUPLED_STATE_SOURCE);
  const travel = bundle.symbols.find((symbol) =>
    symbol.kind === "variable" && symbol.name === "travel"
  )!;
  const travelRate = bundle.symbols.find((symbol) =>
    symbol.kind === "variable" && symbol.name === "travelRate"
  )!;
  const externalLoad = bundle.symbols.find((symbol) =>
    symbol.kind === "parameter" && symbol.name === "externalLoad"
  )!;
  const travelEquation = bundle.symbols.find((symbol) =>
    symbol.kind === "equation" && symbol.name === "der(travel)"
  )!;
  const travelRateEquation = bundle.symbols.find((symbol) =>
    symbol.kind === "equation" && symbol.name === "der(travelRate)"
  )!;
  const staticFlows = bundle.dependencies.filter((dependency) =>
    dependency.kind === "static-value-flow"
  );

  assertEquals(
    staticFlows.some((dependency) =>
      dependency.fromSymbolId === travelRate.id &&
      dependency.toSymbolId === travelEquation.id
    ),
    true,
  );
  assertEquals(
    staticFlows.some((dependency) =>
      dependency.fromSymbolId === travel.id &&
      dependency.toSymbolId === travelRateEquation.id
    ),
    true,
  );
  assertEquals(
    staticFlows.some((dependency) =>
      dependency.fromSymbolId === externalLoad.id &&
      dependency.toSymbolId === travelRateEquation.id
    ),
    true,
  );
});

Deno.test("closed-subset-v2 rejects a construct outside the executable grammar before admission", async () => {
  const bundle = await analyze(UNSUPPORTED_WHEN_SOURCE);
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.symbols, []);
  assertEquals(bundle.dependencies, []);
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.findings, [{
    id: "finding:modelica-closed-subset-v2-rejected",
    code: "modelica-closed-subset-v2-rejected",
    severity: "error",
    message: "The source is outside the executable Modelica closed-subset-v2 grammar.",
  }]);
});

Deno.test("the same authorized v2 source produces deterministic symbol ids", async () => {
  const first = await analyze(SINGLE_STATE_SOURCE);
  const second = await analyze(SINGLE_STATE_SOURCE);
  assertEquals(
    first.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
    second.symbols.map((symbol) => [symbol.kind, symbol.name, symbol.id]),
  );
  const artifact = first.symbols.find((symbol) => symbol.kind === "artifact");
  const ratePerSecond = first.symbols.find((symbol) =>
    symbol.kind === "parameter" && symbol.name === "ratePerSecond"
  );
  const measuredLevel = first.symbols.find((symbol) => symbol.kind === "variable");
  const equation = first.symbols.find((symbol) => symbol.kind === "equation");
  assertEquals(
    artifact?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "model",
      name: "WorkshopTemperatureResponse",
    }),
  );
  assertEquals(
    ratePerSecond?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "parameter",
      name: "ratePerSecond",
    }),
  );
  assertEquals(
    measuredLevel?.id,
    await modelicaAstSymbolId(SOURCE_ID, {
      kind: "variable",
      name: "measuredLevel",
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
    name: "WorkshopTemperatureResponse",
    analyzerVersion: "2.1.0",
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
    const service = createInitialTechnicalSourceAnalysisCaptureService(
      technicalSourceAnalysisCaptureStores(directory),
    );
    const oversized = `${"x".repeat(QUALIFIED_MODELICA_MAX_SOURCE_BYTES + 1)}`;
    const error = await assertRejects(
      () =>
        service.capture(technicalSourceCaptureInput({
          profileId: QUALIFIED_MODELICA_SOURCE_ANALYSIS_PROFILE,
          sourceId: SOURCE_ID,
          sourceText: oversized,
        })),
      TechnicalSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "source_size_limit_exceeded");
    assertEquals(error.reference, undefined);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("Les dépendances structural-incidence couvrent exactement les paramètres et variables du modèle vers l'artifact", async () => {
  const bundle = await analyze(SINGLE_STATE_SOURCE);
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
