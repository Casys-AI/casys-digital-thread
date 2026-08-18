import { assertEquals } from "@std/assert";
import type { SourceAnalysisBundle } from "./source-analysis.ts";
import {
  diagnoseBehaveCadLevers,
  listGeometryAffectingNamedNumericLevers,
  listNamedNumericLevers,
} from "./named-cad-levers.ts";

Deno.test(
  "listNamedNumericLevers reads module-level finite literals and refuses expressions",
  () => {
    const source = [
      "from build123d import Box",
      "arm_thickness = 10",
      "scale = -1.5",
      "summed = thickness_a + thickness_b",
      "result = Box(20, 10, 5)",
      "",
    ].join("\n");
    assertEquals(listNamedNumericLevers(source), [
      { semanticKey: "arm_thickness", value: 10 },
      { semanticKey: "scale", value: -1.5 },
    ]);
  },
);

Deno.test(
  "listNamedNumericLevers ignores indented assignments and trailing expressions",
  () => {
    const source = [
      "def build():",
      "    hidden = 4",
      "visible = 8  # trailing comment stays a lever",
      "composed = 8 + 1",
      "",
    ].join("\n");
    assertEquals(listNamedNumericLevers(source), [
      { semanticKey: "visible", value: 8 },
    ]);
  },
);

Deno.test(
  "diagnoseBehaveCadLevers is unresolved when the source is only a constructor photo",
  () => {
    const photo = "from build123d import Box\nresult = Box(20, 10, 5)\n";
    const diagnosis = diagnoseBehaveCadLevers(
      photo,
      analysis([artifactSymbol()], []),
      [represents("artifact.result")],
    );
    assertEquals(diagnosis.status, "unresolved");
    assertEquals(diagnosis.code, "source.no-named-numeric-lever");
    assertEquals(diagnosis.levers, []);
  },
);

Deno.test(
  "diagnoseBehaveCadLevers is ok when a bound literal reaches result",
  () => {
    const source = "thickness = 2.0\nresult = Box(20, 10, thickness)\n";
    const diagnosis = diagnoseBehaveCadLevers(
      source,
      analysis(
        [parameterSymbol("parameter.thickness", "thickness"), artifactSymbol()],
        [dependency("parameter.thickness", "artifact.result")],
      ),
      [
        parameterizes("parameter.thickness"),
        represents("artifact.result"),
      ],
    );
    assertEquals(diagnosis.status, "ok");
    assertEquals(diagnosis.levers, [
      causalLever("parameter.thickness", "thickness", 2),
    ]);
    assertEquals(diagnosis.code, undefined);
  },
);

Deno.test(
  "qualified decimal spellings remain causal CAD levers",
  () => {
    for (
      const [literal, expected] of [
        ["1_000", 1_000],
        [".5", 0.5],
        ["+1", 1],
        ["1e-3", 0.001],
      ] as const
    ) {
      const source = `thickness = ${literal}\nresult = Box(20, 10, thickness)\n`;
      const diagnosis = diagnoseBehaveCadLevers(
        source,
        analysis(
          [parameterSymbol("parameter.thickness", "thickness"), artifactSymbol()],
          [dependency("parameter.thickness", "artifact.result")],
        ),
        [
          parameterizes("parameter.thickness"),
          represents("artifact.result"),
        ],
      );
      assertEquals(diagnosis.status, "ok");
      assertEquals(diagnosis.levers, [
        causalLever("parameter.thickness", "thickness", expected),
      ]);
    }
  },
);

Deno.test(
  "a named literal that cannot reach result is not a CAD lever",
  () => {
    const source = "unused = 1\nresult = Box(20, 10, 2)\n";
    const bundle = analysis(
      [parameterSymbol("parameter.unused", "unused"), artifactSymbol()],
      [],
    );
    assertEquals(
      listGeometryAffectingNamedNumericLevers(source, bundle, [
        parameterizes("parameter.unused"),
        represents("artifact.result"),
      ]),
      [],
    );
  },
);

Deno.test(
  "a bound literal remains a lever through a transitive geometry dependency",
  () => {
    const source = [
      "thickness = 2",
      "arm = Box(20, 10, thickness)",
      "result = arm",
      "",
    ].join("\n");
    const bundle = analysis(
      [
        parameterSymbol("parameter.thickness", "thickness"),
        {
          id: "artifact.arm",
          kind: "artifact",
          name: "arm",
        },
        artifactSymbol(),
      ],
      [
        dependency("parameter.thickness", "artifact.arm"),
        dependency("artifact.arm", "artifact.result"),
      ],
    );
    assertEquals(
      listGeometryAffectingNamedNumericLevers(source, bundle, [
        parameterizes("parameter.thickness"),
        represents("artifact.arm"),
        represents("artifact.result"),
      ]),
      [causalLever("parameter.thickness", "thickness", 2)],
    );
  },
);

function analysis(
  symbols: SourceAnalysisBundle["symbols"],
  dependencies: SourceAnalysisBundle["dependencies"],
): SourceAnalysisBundle {
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
    symbols,
    dependencies,
    unresolvedConstructs: [],
  };
}

function parameterSymbol(id: string, name: string) {
  return {
    id,
    kind: "parameter" as const,
    name,
    span: {
      start: { line: 1, column: 0 },
      end: { line: 1, column: name.length },
    },
  };
}

function artifactSymbol() {
  return {
    id: "artifact.result",
    kind: "artifact" as const,
    name: "result",
  };
}

function dependency(fromSymbolId: string, toSymbolId: string) {
  return {
    id: `dependency.${fromSymbolId}.${toSymbolId}`,
    kind: "structural-incidence" as const,
    fromSymbolId,
    toSymbolId,
  };
}

function parameterizes(sourceSymbolId: string) {
  return {
    id: `binding.${sourceSymbolId}`,
    sourceId: "source.cad",
    sourceSymbolId,
    sysmlElementId: `sysml.${sourceSymbolId}`,
    relation: "parameterizes",
  };
}

function represents(sourceSymbolId: string) {
  return {
    id: `binding.${sourceSymbolId}`,
    sourceId: "source.cad",
    sourceSymbolId,
    sysmlElementId: `sysml.${sourceSymbolId}`,
    relation: "represents",
  };
}

function causalLever(sourceSymbolId: string, semanticKey: string, value: number) {
  return {
    semanticKey,
    value,
    sourceId: "source.cad",
    sourceSymbolId,
    parameterBindingId: `binding.${sourceSymbolId}`,
    parameterSysmlElementId: `sysml.${sourceSymbolId}`,
    resultSymbolId: "artifact.result",
  };
}
