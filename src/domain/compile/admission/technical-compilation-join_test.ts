import { assertEquals, assertThrows } from "@std/assert";
import { createHash } from "node:crypto";
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
      sourceIds: [technicalSourceId("source.cad")],
    }, {
      profileId: "profile.modelica",
      profileVersion: "1.0.0",
      sourceIds: [technicalSourceId("source.modelica")],
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
      sourceIds: [
        technicalSourceId("source.arm"),
        technicalSourceId("source.base"),
      ].sort(),
    }],
  );
});

Deno.test("unique catalog role selects the one SPICE profile among CAD and Modelica", () => {
  assertEquals(
    deriveTechnicalCompilationProfileRequests(
      [spiceSource("source.spice")],
      catalogWith(build123dProfile(), modelicaProfile(), spiceProfile()),
    ),
    [{
      profileId: "profile.spice",
      profileVersion: "1.0.0",
      sourceIds: [technicalSourceId("source.spice")],
    }],
  );
});

Deno.test("unique SPICE circuit and unique PartDefinition become represents", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached(spiceSource("source.spice"), "sysml.clamp")],
      [part("sysml.clamp", "Clamp")],
    ),
    [{
      id: `binding:${technicalSourceId("source.spice")}:artifact.circuit:represents`,
      sourceId: technicalSourceId("source.spice"),
      sourceSymbolId: "artifact.circuit",
      sysmlElementId: "sysml.clamp",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

Deno.test("unique SPICE .param joins unique AttributeUsage as parameterizes", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached(spiceSourceWithParameter("source.spice", "rseries"), "sysml.clamp")],
      [
        part("sysml.clamp", "Clamp"),
        attribute("sysml.clamp.rseries", "rseries", "sysml.clamp"),
      ],
    ),
    [{
      id: `binding:${technicalSourceId("source.spice")}:artifact.circuit:represents`,
      sourceId: technicalSourceId("source.spice"),
      sourceSymbolId: "artifact.circuit",
      sysmlElementId: "sysml.clamp",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }, {
      id: `binding:${
        technicalSourceId("source.spice")
      }:parameter.rseries:parameterizes`,
      sourceId: technicalSourceId("source.spice"),
      sourceSymbolId: "parameter.rseries",
      sysmlElementId: "sysml.clamp.rseries",
      sysmlElementKind: "AttributeUsage",
      relation: "parameterizes",
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
    id: `binding:${technicalSourceId("source.cad")}:artifact.result:represents`,
    sourceId: technicalSourceId("source.cad"),
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
      [attached(cadSource("source.cad"), "sysml.arm")],
      [part("sysml.arm", "Arm")],
    ),
    [{
      id: `binding:${technicalSourceId("source.cad")}:artifact.result:represents`,
      sourceId: technicalSourceId("source.cad"),
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
      [attached(modelicaSource("source.modelica"), "sysml.ramp")],
      [part("sysml.ramp", "MyRamp")],
    ),
    [{
      id: `binding:${technicalSourceId("source.modelica")}:artifact.MyRamp:represents`,
      sourceId: technicalSourceId("source.modelica"),
      sourceSymbolId: "artifact.MyRamp",
      sysmlElementId: "sysml.ramp",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

Deno.test(
  "multi-part Modelica joins unique parameterizes and does not invent represents",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [attached(
          modelicaSourceWithParameters("source.modelica", ["state", "power"]),
          "sysml.head",
          "PartDefinition",
          "different-basis",
        )],
        [
          part("sysml.head", "Head"),
          part("sysml.driver", "Driver"),
          attribute("sysml.head.state", "state", "sysml.head"),
          attribute("sysml.driver.power", "power", "sysml.driver"),
        ],
      ),
      [{
        id: `binding:${
          technicalSourceId("source.modelica")
        }:parameter.power:parameterizes`,
        sourceId: technicalSourceId("source.modelica"),
        sourceSymbolId: "parameter.power",
        sysmlElementId: "sysml.driver.power",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }, {
        id: `binding:${
          technicalSourceId("source.modelica")
        }:parameter.state:parameterizes`,
        sourceId: technicalSourceId("source.modelica"),
        sourceSymbolId: "parameter.state",
        sysmlElementId: "sysml.head.state",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }],
    );
  },
);

Deno.test("several Modelica artifacts do not invent a represented root", () => {
  const source = modelicaSource("source.modelica");
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached({
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
      }, "sysml.ramp")],
      [part("sysml.ramp", "MyRamp")],
    ),
    [],
  );
});

Deno.test("exact PartUsage attachment binds represents to that usage, not a PartDefinition", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached(cadSource("source.cad"), "usage.arm", "PartUsage")],
      [
        part("sysml.arm", "Arm"),
        { id: "usage.arm", kind: "PartUsage", name: "arm" },
      ],
    ),
    [{
      id: `binding:${technicalSourceId("source.cad")}:artifact.result:represents`,
      sourceId: technicalSourceId("source.cad"),
      sourceSymbolId: "artifact.result",
      sysmlElementId: "usage.arm",
      sysmlElementKind: "PartUsage",
      relation: "represents",
    }],
  );
});

Deno.test("several PartDefinitions do not invent a result join without an exact attachment", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached(
        cadSource("source.cad"),
        "sysml.arm",
        "PartDefinition",
        "different-basis",
      )],
      [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
    ),
    [],
  );
});

Deno.test(
  "exact attachment target binds represents independently of AttributeUsage parents",
  () => {
    assertEquals(
      deriveUniqueTechnicalCompilationBindings(
        [attached(cadSource("source.cad"), "sysml.arm")],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.arm.thickness", "thickness", "sysml.arm"),
        ],
      ),
      [{
        id: `binding:${technicalSourceId("source.cad")}:artifact.result:represents`,
        sourceId: technicalSourceId("source.cad"),
        sourceSymbolId: "artifact.result",
        sysmlElementId: "sysml.arm",
        sysmlElementKind: "PartDefinition",
        relation: "represents",
      }, {
        id: `binding:${
          technicalSourceId("source.cad")
        }:parameter.thickness:parameterizes`,
        sourceId: technicalSourceId("source.cad"),
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
        [attached(
          cadSource("source.cad"),
          "sysml.arm",
          "PartDefinition",
          "different-basis",
        )],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.thickness", "thickness"),
        ],
      ),
      [{
        id: `binding:${
          technicalSourceId("source.cad")
        }:parameter.thickness:parameterizes`,
        sourceId: technicalSourceId("source.cad"),
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
        [attached(
          cadSourceWithTwoReachableLevers("source.cad"),
          "sysml.arm",
          "PartDefinition",
          "different-basis",
        )],
        [
          part("sysml.arm", "Arm"),
          part("sysml.base", "Base"),
          attribute("sysml.arm.thickness", "thickness", "sysml.arm"),
          attribute("sysml.base.width", "width", "sysml.base"),
        ],
      ),
      [{
        id: `binding:${
          technicalSourceId("source.cad")
        }:parameter.thickness:parameterizes`,
        sourceId: technicalSourceId("source.cad"),
        sourceSymbolId: "parameter.thickness",
        sysmlElementId: "sysml.arm.thickness",
        sysmlElementKind: "AttributeUsage",
        relation: "parameterizes",
      }, {
        id: `binding:${technicalSourceId("source.cad")}:parameter.width:parameterizes`,
        sourceId: technicalSourceId("source.cad"),
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
        [attached(
          cadSource("source.cad"),
          "sysml.arm",
          "PartDefinition",
          "different-basis",
        )],
        [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
      ),
      [],
    );
  },
);

Deno.test("unique AttributeUsage name joins a parameter as parameterizes and does not infer the file attachment", () => {
  assertEquals(
    deriveUniqueTechnicalCompilationBindings(
      [attached(
        cadSource("source.cad"),
        "sysml.arm",
        "PartDefinition",
        "different-basis",
      )],
      [attribute("sysml.thickness", "thickness")],
    ),
    [{
      id: `binding:${
        technicalSourceId("source.cad")
      }:parameter.thickness:parameterizes`,
      sourceId: technicalSourceId("source.cad"),
      sourceSymbolId: "parameter.thickness",
      sysmlElementId: "sysml.thickness",
      sysmlElementKind: "AttributeUsage",
      relation: "parameterizes",
    }],
  );
});

Deno.test("missing, renamed, or duplicate AttributeUsage stays unbound", () => {
  const source = [attached(cadSource("source.cad"), "sysml.arm")];
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
      id: `binding:${technicalSourceId("source.cad")}:artifact.result:represents`,
      sourceId: technicalSourceId("source.cad"),
      sourceSymbolId: "artifact.result",
      sysmlElementId: "sysml.arm",
      sysmlElementKind: "PartDefinition",
      relation: "represents",
    }],
  );
});

interface FixtureSource {
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly effectiveUnit: {
    readonly kind: "authored-root";
    readonly closureKind: "root-only";
    readonly unitId: string;
    readonly closureFingerprint: {
      readonly algorithm: "sha256";
      readonly digest: string;
    };
    readonly scriptFingerprint: {
      readonly algorithm: "sha256";
      readonly digest: string;
    };
  };
}

function attached(
  source: FixtureSource,
  elementId: string,
  elementKind = "PartDefinition",
  alignment: "exact" | "different-basis" | "target-missing" = "exact",
) {
  return {
    ...source,
    attachmentTarget: { elementId, elementKind },
    attachmentAlignment: alignment,
  };
}

function cadSource(id: string): FixtureSource {
  const sourceText = "thickness = 2\nresult = Box(20, 10, thickness)\n";
  return fixtureSource(id, sourceText, {
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
  });
}

function cadSourceWithTwoReachableLevers(id: string): FixtureSource {
  const sourceText = "width = 20\nthickness = 2\nresult = Box(width, 10, thickness)\n";
  return fixtureSource(id, sourceText, {
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
  });
}

function modelicaSourceWithParameters(
  id: string,
  names: readonly string[],
): FixtureSource {
  const sourceText = "model Root end Root;";
  return fixtureSource(id, sourceText, {
    schemaVersion: "source-analysis/1.0",
    source: {
      id,
      role: "modelica-model",
      language: "modelica",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    analyzer: { id: "test.ast", version: "1.0.0" },
    policy: { profile: "policy.modelica-safe", status: "passed", findings: [] },
    symbols: [
      { id: "artifact.Root", kind: "artifact", name: "Root" },
      ...names.map((name) => ({
        id: `parameter.${name}`,
        kind: "parameter" as const,
        name,
      })),
    ],
    dependencies: names.map((name) => ({
      id: `dependency.${name}.Root`,
      kind: "structural-incidence" as const,
      fromSymbolId: `parameter.${name}`,
      toSymbolId: "artifact.Root",
    })),
    unresolvedConstructs: [],
  });
}

function spiceSource(id: string): FixtureSource {
  const sourceText = "Vin in 0 5\nRload in 0 1k\n";
  return fixtureSource(id, sourceText, {
    schemaVersion: "source-analysis/1.0",
    source: {
      id,
      role: "spice-circuit",
      language: "spice",
      fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
    },
    analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
    policy: {
      profile: "spice-circuit-closed-subset-v1",
      status: "passed",
      findings: [],
    },
    symbols: [
      { id: "artifact.circuit", kind: "artifact", name: "circuit" },
    ],
    dependencies: [],
    unresolvedConstructs: [],
  });
}

function spiceSourceWithParameter(id: string, name: string): FixtureSource {
  const source = spiceSource(id);
  const sourceText = `Vin in 0 5\nRload in 0 {${name}}\n.param ${name}=1000\n`;
  return fixtureSource(id, sourceText, {
    ...source.analysis,
    symbols: [
      ...source.analysis.symbols,
      { id: `parameter.${name}`, kind: "parameter", name },
    ],
  });
}

function modelicaSource(id: string): FixtureSource {
  const cad = cadSource(id);
  const sourceText = "model X end X;";
  return fixtureSource(id, sourceText, {
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
  });
}

function fixtureSource(
  id: string,
  sourceText: string,
  analysis: SourceAnalysisBundle,
): FixtureSource {
  const sourceId = technicalSourceId(id);
  const closureFingerprint = fingerprint(`closure:${id}`);
  const scriptFingerprint = fingerprint(sourceText);
  return {
    sourceText,
    analysis: {
      ...analysis,
      source: {
        ...analysis.source,
        id: sourceId,
        fingerprint: scriptFingerprint,
      },
    },
    effectiveUnit: {
      kind: "authored-root",
      closureKind: "root-only",
      unitId: sourceId,
      closureFingerprint,
      scriptFingerprint,
    },
  };
}

function technicalSourceId(id: string): string {
  return id.startsWith("technical-unit:")
    ? id
    : `technical-unit:${fingerprint(`closure:${id}`).digest}`;
}

function fingerprint(text: string) {
  return {
    algorithm: "sha256" as const,
    digest: createHash("sha256").update(text, "utf8").digest("hex"),
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

function spiceProfile(): TechnicalCompilationProfileCatalog["profiles"][number] {
  return {
    id: "profile.spice",
    version: "1.0.0",
    target: "spice-circuit-source",
    sourceRole: "spice-circuit",
    language: "spice",
    analyzer: { id: "test.ast", version: "1.0.0" },
    analysisPolicyProfile: "policy.spice-safe",
    requiredBindingSymbolKinds: ["parameter"],
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
