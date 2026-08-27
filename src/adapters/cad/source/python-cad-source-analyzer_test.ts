import { assert, assertEquals, assertRejects } from "@std/assert";
import type { SourceAnalysisFrontend } from "../../../domain/compile/source/source-analysis-frontend.ts";
import {
  PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
  PYTHON_CAD_SOURCE_ANALYZER_ID,
  PYTHON_CAD_SOURCE_ANALYZER_VERSION,
  PythonCadSourceAnalyzer,
} from "./python-cad-source-analyzer.ts";

const INPUT = {
  sourceId: "cad:assembly",
  role: "cad-script" as const,
  language: "python" as const,
};

Deno.test("PythonCadSourceAnalyzer emits only bounded numeric and result facts", async () => {
  const frontend: SourceAnalysisFrontend = new PythonCadSourceAnalyzer();
  const bundle = await frontend.analyze({
    ...INPUT,
    sourceText: `from build123d import Box
width = 10
height = width * 2
result = Box(width, height, 3)
`,
  });

  assertEquals(bundle.source.fingerprint, {
    algorithm: "sha256",
    digest: "93c9f8b1021fd3b4ba038e75ddedfb216735abf32ceb38d668300b2c1b05f758",
  });
  assertEquals(bundle.analyzer, {
    id: PYTHON_CAD_SOURCE_ANALYZER_ID,
    version: PYTHON_CAD_SOURCE_ANALYZER_VERSION,
  });
  assertEquals(bundle.policy, {
    profile: PYTHON_CAD_SOURCE_ANALYSIS_PROFILE,
    status: "passed",
    findings: [],
  });
  assertEquals(
    bundle.symbols.map(({ kind, name }) => ({ kind, name })),
    [
      { kind: "artifact", name: "result" },
      { kind: "variable", name: "width" },
      { kind: "variable", name: "height" },
    ],
  );
  assertEquals(
    bundle.dependencies.map(({ kind, fromSymbolId, toSymbolId }) => ({
      kind,
      fromSymbolId,
      toSymbolId,
    })),
    [
      {
        kind: "static-value-flow",
        fromSymbolId: "variable:26",
        toSymbolId: "variable:37",
      },
      {
        kind: "structural-incidence",
        fromSymbolId: "variable:26",
        toSymbolId: "artifact:result",
      },
      {
        kind: "structural-incidence",
        fromSymbolId: "variable:37",
        toSymbolId: "artifact:result",
      },
    ],
  );
  assertEquals(
    bundle.unresolvedConstructs.map((construct) => construct.kind),
    ["python-call-expression", "python-import"],
  );
});

Deno.test("PythonCadSourceAnalyzer rejects a Lezer syntax error without symbols or relations", async () => {
  const bundle = await new PythonCadSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: "from build123d import Box\nresult = Box(1,\n",
  });

  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.policy.findings[0]?.code, "python-syntax-error");
  assertEquals(bundle.symbols, []);
  assertEquals(bundle.dependencies, []);
  assertEquals(bundle.unresolvedConstructs, []);
});

Deno.test("PythonCadSourceAnalyzer runs D4 before parsing and refuses a forbidden import", async () => {
  await assertRejects(
    () =>
      new PythonCadSourceAnalyzer().analyze({
        ...INPUT,
        sourceText: "import os\nresult = Box(1, 1, 1)\n",
      }),
    Error,
    "Forbidden identifier 'os'",
  );
});

Deno.test("PythonCadSourceAnalyzer reports ambiguity without inventing relation edges", async () => {
  const bundle = await new PythonCadSourceAnalyzer().analyze({
    ...INPUT,
    sourceText: `from build123d import Box
width = 10
width = 20
profile = [i for i in [1, 2]]
shape.label = "draft"
lookup = profile[0]
def helper():
    return width
if width:
    branch = 1
result = Box(width, 1, 1)
`,
  });

  assertEquals(bundle.dependencies, []);
  const unresolvedKinds = new Set(bundle.unresolvedConstructs.map((item) => item.kind));
  for (
    const kind of [
      "python-import",
      "python-reassignment",
      "python-comprehension",
      "python-attribute",
      "python-subscript",
      "python-function-definition",
      "python-if-statement",
      "python-call-expression",
    ]
  ) {
    assert(unresolvedKinds.has(kind), `expected ${kind}`);
  }
});

Deno.test("PythonCadSourceAnalyzer fingerprints exact UTF-8 text itself and preserves UTF-16 columns", async () => {
  const analyzer = new PythonCadSourceAnalyzer();
  const sourceText = `from build123d import Box
width = 10
result = Box("😀", width, 1)
`;
  const bundle = await analyzer.analyze(
    {
      ...INPUT,
      sourceText,
      // Runtime surplus data cannot alter the frontend's internally computed hash.
      fingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
    } as typeof INPUT & { sourceText: string; fingerprint: unknown },
  );
  const changed = await analyzer.analyze({
    ...INPUT,
    sourceText: `${sourceText}# exact bytes\n`,
  });

  assertEquals(bundle.source.fingerprint.digest === "f".repeat(64), false);
  assert(bundle.source.fingerprint.digest !== changed.source.fingerprint.digest);
  const widthToResult = bundle.dependencies.find((dependency) =>
    dependency.kind === "structural-incidence"
  );
  assertEquals(widthToResult?.span, {
    start: { line: 3, column: 19 },
    end: { line: 3, column: 24 },
  });
});

Deno.test("PythonCadSourceAnalyzer rejects an unsupported source role instead of relabelling it", async () => {
  await assertRejects(
    () =>
      new PythonCadSourceAnalyzer().analyze({
        sourceId: "model:demo",
        role: "modelica-model",
        language: "modelica",
        sourceText: "model Demo end Demo;",
      }),
    TypeError,
    "cad-script",
  );
});
