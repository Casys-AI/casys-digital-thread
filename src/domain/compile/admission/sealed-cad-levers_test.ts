import { assertEquals } from "@std/assert";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import {
  listSealedAdmissionCadLevers,
  listSealedAdmissionUnnamedCadLiterals,
} from "./sealed-cad-levers.ts";

const ADMISSION = "technical-compilation-admission-" + "a".repeat(64);

Deno.test("listSealedAdmissionCadLevers keeps only uniquely parameterized reachable literals", () => {
  const source = "thickness = 8\nunused = 3\nresult = Box(20, 10, thickness)\n";
  const levers = listSealedAdmissionCadLevers({
    admissionArtifactId: ADMISSION,
    sources: [{ sourceText: source, analysis: analysis() }],
    bindings: [
      parameterizes("parameter.thickness"),
      represents("artifact.result"),
    ],
  });
  assertEquals(levers, [{
    admissionArtifactId: ADMISSION,
    sourceId: "source.cad",
    sourceSymbolId: "parameter.thickness",
    semanticKey: "thickness",
    value: 8,
    parameterBindingId: "binding:source.cad:parameter.thickness:parameterizes",
    parameterSysmlElementId: "sysml.attr.thickness",
  }]);
});

Deno.test("listSealedAdmissionUnnamedCadLiterals hangs constructor photos on the unique represented PartDefinition", () => {
  const source = "thickness = 5\nresult = Box(30, 12, thickness)\n";
  const unnamed = listSealedAdmissionUnnamedCadLiterals({
    admissionArtifactId: ADMISSION,
    sources: [{ sourceText: source, analysis: analysis() }],
    bindings: [
      parameterizes("parameter.thickness"),
      represents("artifact.result"),
    ],
  });
  assertEquals(
    unnamed.map((literal) => [literal.value, literal.representedPartDefinitionId]),
    [
      [30, "sysml.part.arm"],
      [12, "sysml.part.arm"],
    ],
  );
});

Deno.test("listSealedAdmissionCadLevers omits a reachable literal without parameterizes", () => {
  const source = "thickness = 8\nresult = Box(20, 10, thickness)\n";
  assertEquals(
    listSealedAdmissionCadLevers({
      admissionArtifactId: ADMISSION,
      sources: [{ sourceText: source, analysis: analysis() }],
      bindings: [represents("artifact.result")],
    }),
    [],
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
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
      },
      {
        id: "parameter.unused",
        kind: "parameter",
        name: "unused",
        span: { start: { line: 2, column: 0 }, end: { line: 2, column: 6 } },
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

function parameterizes(sourceSymbolId: string) {
  return {
    id: `binding:source.cad:${sourceSymbolId}:parameterizes`,
    sourceId: "source.cad",
    sourceSymbolId,
    sysmlElementId: "sysml.attr.thickness",
    relation: "parameterizes",
  };
}

function represents(sourceSymbolId: string) {
  return {
    id: `binding:source.cad:${sourceSymbolId}:represents`,
    sourceId: "source.cad",
    sourceSymbolId,
    sysmlElementId: "sysml.part.arm",
    relation: "represents",
  };
}
