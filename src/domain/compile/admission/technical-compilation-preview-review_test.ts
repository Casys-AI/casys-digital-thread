import { assertEquals, assertThrows } from "@std/assert";
import type { SourceAnalysisBundle } from "../source/source-analysis.ts";
import { validateModelicaThermalMethodSheet } from "../../modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  assembleTechnicalCompilationJoinGaps,
  assembleThermalMethodSheetCompilationGaps,
  compilationPreviewContent,
  TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY,
} from "./technical-compilation-preview-review.ts";

Deno.test("photo compile hoists the lever gap without inventing a bind", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "source.no-named-numeric-lever",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: "source.cad",
    }],
    [photoSource("source.cad")],
    [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
  );
  assertEquals(gaps, [{
    code: "source.no-named-numeric-lever",
    sourceId: "source.cad",
    recovery: TECHNICAL_COMPILATION_JOIN_GAP_RECOVERY.noNamedNumericLever,
  }]);
});

Deno.test("photo plus unbound result keeps both facts", () => {
  const gaps = assembleTechnicalCompilationJoinGaps(
    [{
      code: "binding.missing",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: "source.cad:artifact.result",
    }, {
      code: "source.no-named-numeric-lever",
      profileRef: "profile.build123d@2.0.0",
      subjectRef: "source.cad",
    }],
    [photoSource("source.cad")],
    [part("sysml.arm", "Arm"), part("sysml.base", "Base")],
  );
  assertEquals(gaps.map((gap) => gap.code), [
    "binding.missing",
    "source.no-named-numeric-lever",
  ]);
  assertEquals(gaps[0], {
    code: "binding.missing",
    relation: "represents",
    sourceId: "source.cad",
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
      subjectRef: "source.cad:parameter.thickness",
    }],
    [cadSource("source.cad")],
    [part("sysml.arm", "Arm")],
  );
  assertEquals(gaps, [{
    code: "binding.missing",
    relation: "parameterizes",
    sourceId: "source.cad",
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
      subjectRef: "source.cad:parameter.thickness",
    }],
    [cadSource("source.cad")],
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
        subjectRef: "source.cad",
      }],
      [cadSource("source.cad")],
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
          subjectRef: "source.cad:parameter.unknown",
        }],
        [cadSource("source.cad")],
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
      sourceId: "source.cad",
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

function cadSource(id: string): {
  sourceText: string;
  analysis: SourceAnalysisBundle;
} {
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

function photoSource(id: string): {
  sourceText: string;
  analysis: SourceAnalysisBundle;
} {
  const cad = cadSource(id);
  return {
    sourceText: "result = Box(20, 10, 2)\n",
    analysis: {
      ...cad.analysis,
      symbols: [{ id: "artifact.result", kind: "artifact", name: "result" }],
      dependencies: [],
    },
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

function modelicaSource(): {
  sourceText: string;
  analysis: SourceAnalysisBundle;
} {
  return {
    sourceText: "model Placeholder\nend Placeholder;\n",
    analysis: {
      schemaVersion: "source-analysis/1.0",
      source: {
        id: "placeholder-module",
        role: "modelica-model",
        language: "modelica",
        fingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
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
  };
}

function parameterizesBinding() {
  return {
    id: "binding:placeholder-module:placeholder-parameter:parameterizes",
    sourceId: "placeholder-module",
    sourceSymbolId: "placeholder-parameter",
    sysmlElementId: "placeholder-attribute-usage",
    sysmlElementKind: "AttributeUsage",
    relation: "parameterizes" as const,
  };
}
