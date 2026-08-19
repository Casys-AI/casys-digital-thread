import { assertEquals } from "@std/assert";
import type { SourceAnalysisBundle } from "./source-analysis.ts";
import { listUnnamedCadConstructorLiterals } from "./unnamed-cad-literals.ts";

Deno.test("listUnnamedCadConstructorLiterals keeps Box argument literals and skips the named lever RHS", () => {
  const source = [
    "from build123d import Box",
    "thickness = 5",
    "result = Box(30, 12, thickness)",
    "",
  ].join("\n");
  const found = listUnnamedCadConstructorLiterals(source, analysis());
  assertEquals(
    found.map((
      literal,
    ) => [literal.value, literal.span.start.line, literal.span.start.column]),
    [
      [30, 3, 13],
      [12, 3, 17],
    ],
  );
});

Deno.test("listUnnamedCadConstructorLiterals ignores a dead constructor that does not reach result", () => {
  const source = [
    "from build123d import Box",
    "unused = Box(1, 2, 3)",
    "thickness = 5",
    "result = Box(30, 12, thickness)",
    "",
  ].join("\n");
  const found = listUnnamedCadConstructorLiterals(source, analysis());
  assertEquals(found.map((literal) => literal.value), [30, 12]);
});

Deno.test("listUnnamedCadConstructorLiterals lists every positional photo when nothing is named", () => {
  const source = "from build123d import Box\nresult = Box(30, 12, 5)\n";
  const photo = {
    ...analysis(),
    symbols: [{ id: "artifact.result", kind: "artifact" as const, name: "result" }],
    dependencies: [],
  };
  assertEquals(
    listUnnamedCadConstructorLiterals(source, photo).map((literal) => literal.value),
    [30, 12, 5],
  );
});

function analysis(): SourceAnalysisBundle {
  return {
    schemaVersion: "source-analysis/1.0",
    source: {
      id: "source.cad",
      role: "cad-script",
      language: "python",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    analyzer: { id: "build123d-qualified-lezer", version: "1.6.0" },
    policy: {
      profile: "build123d-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [
      {
        id: "parameter.thickness",
        kind: "parameter",
        name: "thickness",
        span: { start: { line: 2, column: 0 }, end: { line: 2, column: 9 } },
      },
      { id: "artifact.result", kind: "artifact", name: "result" },
    ],
    dependencies: [{
      id: "dep.thickness.result",
      kind: "static-value-flow",
      fromSymbolId: "parameter.thickness",
      toSymbolId: "artifact.result",
    }],
    unresolvedConstructs: [],
  };
}
