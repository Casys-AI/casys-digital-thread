import { assertEquals, assertThrows } from "@std/assert";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import {
  deriveTechnicalCompilationProfileRequests,
  deriveUniqueTechnicalCompilationBindings,
  selectUniqueRepresentedPartDefinition,
} from "./technical-compilation-join.ts";
import {
  PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  type TechnicalCompilationProfileCatalog,
} from "./technical-compilation.ts";

Deno.test("unique catalog role selects the one profile and covers every source", () => {
  const catalog = catalogWith(build123dProfile(), modelicaProfile());
  assertEquals(
    deriveTechnicalCompilationProfileRequests([
      cadSource("source.cad"),
      modelicaSource("source.modelica"),
    ], catalog),
    [{
      profileId: "profile.build123d",
      profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      sourceIds: ["source.cad"],
    }, {
      profileId: "profile.modelica",
      profileVersion: "1.0.0",
      sourceIds: ["source.modelica"],
    }],
  );
});

Deno.test("two CAD sources share the unique Build123d profile request", () => {
  const catalog = catalogWith(build123dProfile());
  assertEquals(
    deriveTechnicalCompilationProfileRequests([
      cadSource("source.arm"),
      cadSource("source.base"),
    ], catalog),
    [{
      profileId: "profile.build123d",
      profileVersion: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
      sourceIds: ["source.arm", "source.base"],
    }],
  );
});

Deno.test("absent or ambiguous compilation profiles fail closed", () => {
  assertThrows(
    () =>
      deriveTechnicalCompilationProfileRequests(
        [cadSource("source.cad")],
        catalogWith(modelicaProfile()),
      ),
    TypeError,
    "no unique compilation profile",
  );
  assertThrows(
    () =>
      deriveTechnicalCompilationProfileRequests(
        [cadSource("source.cad")],
        catalogWith(build123dProfile(), {
          ...build123dProfile(),
          id: "profile.build123d.other",
        }),
      ),
    TypeError,
    "no unique compilation profile",
  );
});

Deno.test("selectUniqueRepresentedPartDefinition keeps only a unique PartDefinition represents", () => {
  const represented = {
    id: "binding:source.cad:artifact.result:represents",
    sourceId: "source.cad",
    sourceSymbolId: "artifact.result",
    sysmlElementId: "sysml.arm",
    sysmlElementKind: "PartDefinition" as const,
    relation: "represents" as const,
  };
  assertEquals(
    selectUniqueRepresentedPartDefinition([represented]),
    { elementId: "sysml.arm" },
  );
  assertEquals(
    selectUniqueRepresentedPartDefinition([{
      ...represented,
      sysmlElementKind: "PartUsage",
    }]),
    undefined,
  );
  assertEquals(
    selectUniqueRepresentedPartDefinition([
      represented,
      { ...represented, id: "binding:other", sysmlElementId: "sysml.other" },
    ]),
    undefined,
  );
});

Deno.test("unique result and unique PartDefinition become represents", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [cadSource("source.cad")],
      [part("sysml.arm", "Arm")],
    ),
    [{
      id: "binding:source.cad:artifact.result:represents",
      sourceId: "source.cad",
      sourceSymbolId: "artifact.result",
      sysmlElementId: "sysml.arm",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

Deno.test("unique Modelica root model and unique PartDefinition become represents", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [modelicaSource("source.modelica")],
      [part("sysml.ramp", "MyRamp")],
    ),
    [{
      id: "binding:source.modelica:artifact.MyRamp:represents",
      sourceId: "source.modelica",
      sourceSymbolId: "artifact.MyRamp",
      sysmlElementId: "sysml.ramp",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

Deno.test("several Modelica artifacts do not invent a represented root", () => {
  const source = modelicaSource("source.modelica");
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [{
        ...source,
        analysis: {
          ...source.analysis,
          symbols: [
            ...source.analysis.symbols,
            {
              id: "artifact.OtherModel",
              kind: "artifact",
              name: "OtherModel",
            },
          ],
        },
      }],
      [part("sysml.ramp", "MyRamp")],
    ),
    [],
  );
});

Deno.test("several PartDefinitions do not invent a result join", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [cadSource("source.cad")],
      [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
    ),
    [],
  );
});

Deno.test(
  "multi-part CAD binds result to the exact common owner of reachable lever attributes",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [cadSource("source.cad")],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.arm.thickness", "thickness", "sysml.arm"),
        ],
      ),
      [{
        id: "binding:source.cad:artifact.result:represents",
        sourceId: "source.cad",
        sourceSymbolId: "artifact.result",
        sysmlElementId: "sysml.arm",
        sysmlElementKind: "PartDefinition",
        relation: "represents",
      }, {
        id: "binding:source.cad:parameter.thickness:parameterizes",
        sourceId: "source.cad",
        sourceSymbolId: "parameter.thickness",
        sysmlElementId: "sysml.arm.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }],
    );
  },
);

Deno.test(
  "multi-part CAD leaves result unbound when a reachable lever has no exact owner",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [cadSource("source.cad")],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.thickness", "thickness"),
        ],
      ),
      [{
        id: "binding:source.cad:parameter.thickness:parameterizes",
        sourceId: "source.cad",
        sourceSymbolId: "parameter.thickness",
        sysmlElementId: "sysml.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }],
    );
  },
);

Deno.test(
  "multi-part CAD leaves result unbound when reachable lever owners differ",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [cadSourceWithTwoReachableLevers("source.cad")],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.arm.thickness", "thickness", "sysml.arm"),
          attribute("sysml.base.width", "width", "sysml.base"),
        ],
      ),
      [{
        id: "binding:source.cad:parameter.thickness:parameterizes",
        sourceId: "source.cad",
        sourceSymbolId: "parameter.thickness",
        sysmlElementId: "sysml.arm.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }, {
        id: "binding:source.cad:parameter.width:parameterizes",
        sourceId: "source.cad",
        sourceSymbolId: "parameter.width",
        sysmlElementId: "sysml.base.width",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }],
    );
  },
);

Deno.test(
  "multi-part CAD leaves result unbound when a reachable lever has no AttributeUsage bind",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [cadSource("source.cad")],
        [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
      ),
      [],
    );
  },
);

Deno.test("unique AttributeUsage name joins a parameter as parameterizes", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [cadSource("source.cad")],
      [attribute("sysml.thickness", "thickness")],
    ),
    [{
      id: "binding:source.cad:parameter.thickness:parameterizes",
      sourceId: "source.cad",
      sourceSymbolId: "parameter.thickness",
      sysmlElementId: "sysml.thickness",
      sysmlElementKind: "AttributeUsage",
      relation: "parameterizes",
    }],
  );
});

Deno.test("missing, renamed, or duplicate AttributeUsage stays unbound", () => {
  const source = [cadSource("source.cad")];
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(source, [
      attribute("sysml.width", "width"),
    ]),
    [],
  );
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(source, [
      attribute("sysml.thickness.a", "thickness"),
      attribute("sysml.thickness.b", "thickness"),
    ]),
    [],
  );
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(source, [
      part("sysml.arm", "Arm"),
    ]),
    [{
      id: "binding:source.cad:artifact.result:represents",
      sourceId: "source.cad",
      sourceSymbolId: "artifact.result",
      sysmlElementId: "sysml.arm",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

function cadSource(id: string): { sourceText: string; analysis: SourceAnalysisBundle } {
  return {
    sourceText: "thickness = 2\nresult = Box(20, 10, thickness)\n",
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id,
        role: "cad-script",
        language: "python",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      },
      analyzer: { id: "test.ast", version: "1.0.0" },
      policy: { profile: "policy.python-safe", status: "passed", findings: [] },
      symbols: [
        {
          id: "parameter.thickness",
          kind: "parameter",
          name: "thickness",
          span: { start: { line: 1, column: 0 }, end: { line: 1, column: 9 } },
        },
        { id: "artifact.result", kind: "artifact", name: "result" },
      ],
      dependencies: [{
        id: "dependency.thickness.result",
        kind: "structural-incidence",
        fromSymbolId: "parameter.thickness",
        toSymbolId: "artifact.result",
      }],
      unresolvedConstructs: [],
    },
  };
}

function cadSourceWithTwoReachableLevers(
  id: string,
): { sourceText: string; analysis: SourceAnalysisBundle } {
  return {
    sourceText: "width = 20\nthickness = 2\nresult = Box(width, 10, thickness)\n",
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id,
        role: "cad-script",
        language: "python",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      },
      analyzer: { id: "test.ast", version: "1.0.0" },
      policy: { profile: "policy.python-safe", status: "passed", findings: [] },
      symbols: [{
        id: "parameter.width",
        kind: "parameter",
        name: "width",
        span: { start: { line: 1, column: 0 }, end: { line: 1, column: 5 } },
      }, {
        id: "parameter.thickness",
        kind: "parameter",
        name: "thickness",
        span: { start: { line: 2, column: 0 }, end: { line: 2, column: 9 } },
      }, {
        id: "artifact.result",
        kind: "artifact",
        name: "result",
      }],
      dependencies: [{
        id: "dependency.width.result",
        kind: "structural-incidence",
        fromSymbolId: "parameter.width",
        toSymbolId: "artifact.result",
      }, {
        id: "dependency.thickness.result",
        kind: "structural-incidence",
        fromSymbolId: "parameter.thickness",
        toSymbolId: "artifact.result",
      }],
      unresolvedConstructs: [],
    },
  };
}

function modelicaSource(id: string): {
  sourceText: string;
  analysis: SourceAnalysisBundle;
} {
  const cad = cadSource(id);
  return {
    sourceText: "model X end X;",
    analysis: {
      ...cad.analysis,
      source: {
        ...cad.analysis.source,
        role: "modelica-model",
        language: "modelica",
      },
      symbols: cad.analysis.symbols.map((symbol) =>
        symbol.kind === "artifact"
          ? { ...symbol, id: "artifact.MyRamp", name: "MyRamp" }
          : symbol
      ),
      dependencies: cad.analysis.dependencies.map((dependency) =>
        dependency.toSymbolId === "artifact.result"
          ? { ...dependency, toSymbolId: "artifact.MyRamp" }
          : dependency
      ),
    },
  };
}

function catalogWith(
  ...profiles: TechnicalCompilationProfileCatalog["profiles"]
): TechnicalCompilationProfileCatalog {
  return {
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles,
  };
}

function build123dProfile(): TechnicalCompilationProfileCatalog["profiles"][number] {
  return {
    id: "profile.build123d",
    version: PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION,
    target: "build123d-source",
    sourceRole: "cad-script",
    language: "python",
    analyzer: { id: "test.ast", version: "1.0.0" },
    analysisPolicyProfile: "policy.python-safe",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
}

function modelicaProfile(): TechnicalCompilationProfileCatalog["profiles"][number] {
  return {
    id: "profile.modelica",
    version: "1.0.0",
    target: "modelica-source-qualification",
    sourceRole: "modelica-model",
    language: "modelica",
    analyzer: { id: "test.ast", version: "1.0.0" },
    analysisPolicyProfile: "policy.modelica-safe",
    requiredBindingSymbolKinds: ["artifact", "parameter"],
  };
}

function part(id: string, name: string) {
  return { id, kind: "PartDefinition", name };
}

function attribute(id: string, name: string, parentElementId?: string) {
  return {
    id,
    kind: "AttributeUsage",
    name,
    ...(parentElementId === undefined ? {} : { parentElementId }),
  };
}
