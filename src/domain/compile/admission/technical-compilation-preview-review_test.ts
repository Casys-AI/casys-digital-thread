import { assertEquals, assertThrows } from "@std/assert";
import { createHash } from "node:crypto";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import { validateModelicaThermalMethodSheet } from "../../modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  assembleTechnicalCompilationJoinGaps,
  assembleThermalMethodSheetCompilationGaps,
  compilationPreviewContent,
  TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY,
} from "./technical-compilation-preview-review.ts";

const CAD_SOURCE_TEXT = "thickness = 2\nresult = Box(20, 10, thickness)\n";
const PHOTO_SOURCE_TEXT = "result = Box(20, 10, 2)\n";
const MODELICA_SOURCE_TEXT = "model Placeholder\nend Placeholder;\n";
const SPICE_SOURCE_TEXT = "Vin in 0 5\nRload in 0 1k\n";
const CAD_SOURCE_FINGERPRINT = fingerprint(CAD_SOURCE_TEXT);
const PHOTO_SOURCE_FINGERPRINT = fingerprint(PHOTO_SOURCE_TEXT);
const MODELICA_SOURCE_FINGERPRINT = fingerprint(MODELICA_SOURCE_TEXT);
const SPICE_SOURCE_FINGERPRINT = fingerprint(SPICE_SOURCE_TEXT);
const CAD_SOURCE_ID = technicalUnitId(CAD_SOURCE_FINGERPRINT);
const PHOTO_SOURCE_ID = technicalUnitId(PHOTO_SOURCE_FINGERPRINT);
const MODELICA_SOURCE_ID = technicalUnitId(MODELICA_SOURCE_FINGERPRINT);
const SPICE_SOURCE_ID = technicalUnitId(SPICE_SOURCE_FINGERPRINT);

Deno.test("photo compile hoists the lever gap without inventing a bind", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "source.no-named-numeric-lever",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: PHOTO_SOURCE_ID,
    }],
    [photoSource()],
    [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
  );
  assertEquals(gaps, [{
    code: "source.no-named-numeric-lever",
    sourceId: PHOTO_SOURCE_ID,
    recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noNamedNumericLever,
  }]);
});

Deno.test("photo plus unbound result keeps both facts", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "binding.missing",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: `${PHOTO_SOURCE_ID}:artifact.result`,
    }, {
      code: "source.no-named-numeric-lever",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: PHOTO_SOURCE_ID,
    }],
    [photoSource()],
    [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
  );
  assertEquals(gaps.map((gap) => gap.code), [
    "binding.missing",
    "source.no-named-numeric-lever",
  ]);
  assertEquals(gaps[0], {
    code: "binding.missing",
    relation: "represents",
    sourceId: PHOTO_SOURCE_ID,
    symbolName: "result",
    symbolKind: "artifact",
    reason: "no-unique-PartDefinition",
    candidateCount: 2,
    recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniquePartDefinition,
  });
});

Deno.test("unbound thickness names the parameter and AttributeUsage count", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "binding.missing",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: `${CAD_SOURCE_ID}:parameter.thickness`,
    }],
    [cadSource()],
    [part("sysml.arm", "Arm")],
  );
  assertEquals(gaps, [{
    code: "binding.missing",
    relation: "parameterizes",
    sourceId: CAD_SOURCE_ID,
    symbolName: "thickness",
    symbolKind: "parameter",
    reason: "no-unique-AttributeUsage",
    candidateCount: 0,
    recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniqueAttributeUsage,
  }]);
});

Deno.test("duplicate AttributeUsage is still no-unique, not a missing name", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "binding.missing",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: `${CAD_SOURCE_ID}:parameter.thickness`,
    }],
    [cadSource()],
    [
      attribute("sysml.thickness.a", "thickness"),
      attribute("sysml.thickness.b", "thickness"),
    ],
  );
  const gap = gaps[0];
  assertEquals(gap?.code, "binding.missing");
  if (gap?.code !== "binding.missing") return;
  assertEquals(gap.candidateCount, 2);
  assertEquals(gap.reason, "no-unique-AttributeUsage");
});

Deno.test("other document diagnostics are not hoisted as join gaps", () => {
  assertEquals(
    assembleTechnicalCompilationJoinGaps(
      [{
        code: "source.analyzer-mismatch",
        profileRef: "profile.build123d@2.0.0",
        subjectRef: CAD_SOURCE_ID,
      }],
      [cadSource()],
      [],
    ),
    [],
  );
});

Deno.test("unknown binding.missing subject fails closed", () => {
  assertThrows(
    () =>
      assembleTechnicalCompilationJoinGaps(
        [{
          code: "binding.missing",
          profileRef: "profile.build123d@2.0.0",
          subjectRef: `${CAD_SOURCE_ID}:parameter.unknown`,
        }],
        [cadSource()],
        [],
      ),
    TypeError,
    "exact parser symbol",
  );
});

Deno.test("preview content lists join recoveries on unresolved", () => {
  const text = compilationPreviewContent({
    status: "unresolved",
    gaps: [{
      code: "binding.missing",
      relation: "parameterizes",
      sourceId: CAD_SOURCE_ID,
      symbolName: "thickness",
      symbolKind: "parameter",
      reason: "no-unique-AttributeUsage",
      candidateCount: 0,
      recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noUniqueAttributeUsage,
    }],
  });
  assertEquals(
    text.includes("binding.missing parameterizes thickness"),
    true,
  );
  assertEquals(text.includes("attribute.<slug>.name"), true);
  assertEquals(text.includes("Do not invent bindings"), true);
});

Deno.test("ready preview content does not invent a next bind", () => {
  const text = compilationPreviewContent({
    status: "ready-for-review",
    draftId: "technical-compilation:project.drip-tray:abcd",
    gaps: [],
  });
  assertEquals(text.includes("technical-compilation:project.drip-tray:abcd"), true);
  assertEquals(text.includes("only from decisionParameters"), true);
  assertEquals(text.includes("binding.missing"), false);
});

Deno.test("ready preview content instructs callers to reuse its exact admission operation", () => {
  const text = compilationPreviewContent({
    status: "ready-for-review",
    draftId: "technical-compilation:project.drip-tray:abcd",
    operation: { id: "compile.seal-admission", version: "3" },
    gaps: [],
  });
  assertEquals(text.includes("compile.seal-admission@3"), true);
  assertEquals(text.includes("Reuse the returned"), true);
  assertEquals(text.includes("verbatim"), true);
  assertEquals(text.includes("project_change_append"), true);
  assertEquals(text.includes("do not reconstruct its sysmlModel binding"), true);
});

function cadSource(): FixtureSource {
  return {
    sourceText: CAD_SOURCE_TEXT,
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: CAD_SOURCE_ID,
        role: "cad-script",
        language: "python",
        fingerprint: CAD_SOURCE_FINGERPRINT,
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
    effectiveUnit: authoredRootEffectiveUnit(
      CAD_SOURCE_ID,
      CAD_SOURCE_FINGERPRINT,
    ),
  };
}

function photoSource(): FixtureSource {
  const cad = cadSource();
  return {
    sourceText: PHOTO_SOURCE_TEXT,
    analysis: {
      ...cad.analysis,
      source: {
        ...cad.analysis.source,
        id: PHOTO_SOURCE_ID,
        fingerprint: PHOTO_SOURCE_FINGERPRINT,
      },
      symbols: [{ id: "artifact.result", kind: "artifact", name: "result" }],
      dependencies: [],
    },
    effectiveUnit: authoredRootEffectiveUnit(
      PHOTO_SOURCE_ID,
      PHOTO_SOURCE_FINGERPRINT,
    ),
  };
}

function part(id: string, name: string) {
  return { id, kind: "PartDefinition", name };
}

function attribute(id: string, name: string) {
  return { id, kind: "AttributeUsage", name };
}

Deno.test(
  "thermal method sheet recrosses unique parameterizes and exact RequirementUsage",
  () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    assertEquals(
      assembleThermalMethodSheetCompilationGaps(
        sheet,
        [modelicaSource()],
        [parameterizesBinding()],
        [
          attribute("placeholder-attribute-usage", "placeholder"),
          { id: "placeholder-requirement", kind: "RequirementUsage" },
        ],
        "modelica-source-qualification",
      ),
      [],
    );
  },
);

Deno.test("absent thermal method sheet does not invent compilation gaps", () => {
  assertEquals(
    assembleThermalMethodSheetCompilationGaps(
      undefined,
      [modelicaSource()],
      [parameterizesBinding()],
      [attribute("placeholder-attribute-usage", "placeholder")],
      "modelica-source-qualification",
    ),
    [],
  );
});

Deno.test(
  "thermal method sheet parameter without unique parameterizes is a named gap",
  () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const gaps = assembleThermalMethodSheetCompilationGaps(
      sheet,
      [modelicaSource()],
      [],
      [{ id: "placeholder-requirement", kind: "RequirementUsage" }],
      "modelica-source-qualification",
    );
    assertEquals(gaps, [{
      code: "thermal-method-sheet.parameter.unresolved",
      modelSymbolId: "placeholder-parameter",
      attributeUsageId: "placeholder-attribute-usage",
      reason: "no-unique-parameterizes",
      recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.thermalParameterizes,
    }]);
  },
);

Deno.test(
  "thermal method sheet recross does not contaminate SPICE or CAD compilation",
  () => {
    const sheet = validateModelicaThermalMethodSheet(
      validThermalMethodSheetPlaceholder(),
    );
    const elements = [
      attribute("placeholder-attribute-usage", "placeholder"),
      { id: "placeholder-requirement", kind: "RequirementUsage" },
    ];
    assertEquals(
      assembleThermalMethodSheetCompilationGaps(
        sheet,
        [spiceSource()],
        [],
        elements,
        "spice-circuit-source",
      ),
      [],
    );
    assertEquals(
      assembleThermalMethodSheetCompilationGaps(
        sheet,
        [cadSource()],
        [],
        elements,
        "build123d-source",
      ),
      [],
    );
    assertEquals(
      assembleThermalMethodSheetCompilationGaps(
        sheet,
        [modelicaSource()],
        [],
        elements,
        "spice-circuit-source",
      ),
      [],
    );
    assertEquals(
      assembleThermalMethodSheetCompilationGaps(
        sheet,
        [modelicaSource()],
        [],
        elements,
      ),
      [],
    );
  },
);

function modelicaSource(): FixtureSource {
  return {
    sourceText: MODELICA_SOURCE_TEXT,
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: MODELICA_SOURCE_ID,
        role: "modelica-model",
        language: "modelica",
        fingerprint: MODELICA_SOURCE_FINGERPRINT,
      },
      analyzer: { id: "modelica-closed-subset", version: "2.0.0" },
      policy: {
        profile: "modelica-closed-subset-v2",
        status: "passed",
        findings: [],
      },
      symbols: [
        { id: "placeholder-parameter", kind: "parameter", name: "param" },
        { id: "placeholder-output", kind: "variable", name: "output" },
      ],
      dependencies: [],
      unresolvedConstructs: [],
    },
    effectiveUnit: authoredRootEffectiveUnit(
      MODELICA_SOURCE_ID,
      MODELICA_SOURCE_FINGERPRINT,
    ),
  };
}

function parameterizesBinding() {
  return {
    id: `binding:${MODELICA_SOURCE_ID}:placeholder-parameter:parameterizes`,
    sourceId: MODELICA_SOURCE_ID,
    sourceSymbolId: "placeholder-parameter",
    sysmlElementId: "placeholder-attribute-usage",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes" as const,
  };
}

function spiceSource(): FixtureSource {
  return {
    sourceText: SPICE_SOURCE_TEXT,
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: SPICE_SOURCE_ID,
        role: "spice-circuit",
        language: "spice",
        fingerprint: SPICE_SOURCE_FINGERPRINT,
      },
      analyzer: { id: "spice-circuit-closed-subset", version: "1.0.0" },
      policy: {
        profile: "spice-circuit-closed-subset-v1",
        status: "passed",
        findings: [],
      },
      symbols: [{ id: "artifact.circuit", kind: "artifact", name: "circuit" }],
      dependencies: [],
      unresolvedConstructs: [],
    },
    effectiveUnit: authoredRootEffectiveUnit(
      SPICE_SOURCE_ID,
      SPICE_SOURCE_FINGERPRINT,
    ),
  };
}

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

function authoredRootEffectiveUnit(
  unitId: string,
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
) {
  return {
    kind: "authored-root" as const,
    closureKind: "root-only" as const,
    unitId,
    closureFingerprint: fingerprint,
    scriptFingerprint: fingerprint,
  };
}

function technicalUnitId(
  fingerprint: { readonly algorithm: "sha256"; readonly digest: string },
): string {
  return `technical-unit:${fingerprint.digest}`;
}

function fingerprint(text: string) {
  return {
    algorithm: "sha256" as const,
    digest: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}
