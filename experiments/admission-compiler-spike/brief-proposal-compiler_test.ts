import { assertEquals, assertExists } from "@std/assert";
import { ProjectBriefSourceAnalyzer } from "../../src/adapters/compile/source/project-brief-source-analyzer.ts";
import {
  compileExplicitBriefProposals,
  type ExplicitBriefDeclarations,
  SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE,
} from "./brief-proposal-compiler.ts";
import { INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT } from "./integrated-fixture.ts";

function mutableFixture(): ExplicitBriefDeclarations {
  return structuredClone(SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE);
}

Deno.test("the explicit declarations name the exact analyzed integrated ProjectBrief bytes", async () => {
  const source = SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE.briefSource;
  const bundle = await new ProjectBriefSourceAnalyzer().analyze({
    sourceId: source.id,
    role: "brief",
    language: "plain-text",
    sourceText: INTEGRATED_SUPPORT_BLOCK_BRIEF_SOURCE_TEXT,
  });

  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.source.id, source.id);
  assertEquals(bundle.source.fingerprint, source.fingerprint);
  assertEquals(bundle.unresolvedConstructs, []);
});

Deno.test("explicit SupportBlock declarations compile to the exact production proposal grammars", async () => {
  const result = await compileExplicitBriefProposals(
    SUPPORT_BLOCK_EXPLICIT_BRIEF_FIXTURE,
  );

  assertEquals(result.status, "resolved");
  assertEquals(result.authority, "proposal-only-human-review-required");
  assertEquals(result.diagnostics, []);
  assertExists(result.architecture);
  assertExists(result.requirements);
  assertEquals(result.architecture.operation, {
    id: "model.write-architecture",
    version: "1",
  });
  assertEquals(result.architecture.parameters, [
    {
      key: "architecture.package",
      label: "Architecture package",
      value: "GenericSupport",
    },
    { key: "system.name", label: "System", value: "GenericSupportSystem" },
    {
      key: "component.support.name",
      label: "Support block definition",
      value: "SupportBlock",
    },
    {
      key: "component.support.usage",
      label: "Support block usage",
      value: "supportBlock",
    },
  ]);
  assertEquals(
    result.architecture.rendered.sourceText,
    [
      "package GenericSupport {",
      "  part def GenericSupportSystem {",
      "    part supportBlock : SupportBlock;",
      "  }",
      "  part def SupportBlock {}",
      "}",
    ].join("\n"),
  );
  assertEquals(result.requirements.operation, {
    id: "model.write-requirements",
    version: "1",
  });
  assertEquals(result.requirements.parameters, [
    {
      key: "requirements.containerComponent",
      label: "Requirements target component",
      value: "SupportBlock",
    },
    {
      key: "requirement.displacement.name",
      label: "Displacement requirement",
      value: "SupportBlock maximum displacement limit",
    },
    {
      key: "requirement.displacement.metric",
      label: "Displacement metric",
      value: "support_block_max_displacement",
    },
    {
      key: "requirement.displacement.operator",
      label: "Displacement operator",
      value: "<=",
    },
    {
      key: "requirement.displacement.threshold",
      label: "Maximum displacement",
      value: 2,
      unit: "mm",
    },
    {
      key: "requirement.vonMises.name",
      label: "Von Mises requirement",
      value: "SupportBlock maximum von Mises stress limit",
    },
    {
      key: "requirement.vonMises.metric",
      label: "Von Mises metric",
      value: "support_block_max_von_mises",
    },
    {
      key: "requirement.vonMises.operator",
      label: "Von Mises operator",
      value: "<=",
    },
    {
      key: "requirement.vonMises.threshold",
      label: "Maximum von Mises stress",
      value: 100_000_000,
      unit: "Pa",
    },
  ]);
  assertEquals(
    result.requirements.renderedSysml,
    [
      "requirement SupportBlockRequirements {",
      "  private import SI::*;",
      "  subject target : SupportBlock;",
      "  attribute support_block_max_displacement : LengthValue;",
      "  attribute support_block_max_von_mises : PressureValue;",
      "  require constraint support_block_max_displacement_limit { support_block_max_displacement <= 2 [mm] }",
      "  require constraint support_block_max_von_mises_limit { support_block_max_von_mises <= 100000000 [Pa] }",
      "}",
    ].join("\n"),
  );
  assertEquals(result.fieldProvenance.length, 13);
  assertEquals(
    result.fieldProvenance.find((entry) =>
      entry.proposalField === "requirement.vonMises.threshold"
    ),
    {
      proposalField: "requirement.vonMises.threshold",
      declarationId: "decl-von-mises-threshold",
      dependsOnDeclarationIds: [
        "decl-support-name",
        "decl-von-mises-metric",
      ],
      sourceItemId: "max-von-mises",
      sourceRefs: [{
        kind: "intent",
        reference: "conversation:admission-spike",
      }],
      transformation: "MPa-to-Pa",
    },
  );
});

Deno.test("the same explicit brief declarations produce the same compilation fingerprint", async () => {
  const first = await compileExplicitBriefProposals(mutableFixture());
  const second = await compileExplicitBriefProposals(mutableFixture());
  assertEquals(first, second);
  assertEquals(first.compilationFingerprint.digest.length, 64);
});

Deno.test("a missing brief field remains unresolved and emits no proposal", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.filter((declaration) =>
    declaration.field !== "requirement.displacement.threshold"
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "missing-declaration",
    field: "requirement.displacement.threshold",
    declarationIds: [],
    message:
      "No explicit brief declaration exists for requirement.displacement.threshold.",
  }]);
});

Deno.test("an ambiguous brief field remains unresolved and names both declarations", async () => {
  const input = mutableFixture();
  const original = input.declarations.find((declaration) =>
    declaration.field === "system.name"
  )!;
  const declarations = [
    ...input.declarations,
    { ...original, id: "decl-system-conflict", value: "OtherSystem" },
  ];
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.diagnostics, [{
    code: "ambiguous-declaration",
    field: "system.name",
    declarationIds: ["decl-system", "decl-system-conflict"],
    message: "More than one explicit brief declaration exists for system.name.",
  }]);
});

Deno.test("a threshold without the exact declared unit remains unresolved", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "requirement.vonMises.threshold"
      ? { ...declaration, unit: null }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.diagnostics, [{
    code: "unsupported-unit",
    field: "requirement.vonMises.threshold",
    declarationIds: ["decl-von-mises-threshold"],
    message: "requirement.vonMises.threshold must explicitly use MPa in this spike.",
  }]);
});

Deno.test("the requirements target without its SupportBlock dependency remains unresolved", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "requirements.containerComponent"
      ? { ...declaration, dependsOnDeclarationIds: [] }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "missing-explicit-dependency",
    field: "requirements.containerComponent",
    declarationIds: ["decl-requirements-target"],
    message:
      "requirements.containerComponent must explicitly depend on the SupportBlock declaration.",
  }]);
});

Deno.test("a unit attached to a non-threshold declaration remains unresolved", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "system.name"
      ? { ...declaration, unit: "bogus" }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "unsupported-unit",
    field: "system.name",
    declarationIds: ["decl-system"],
    message: "system.name must explicitly declare unit null.",
  }]);
});

Deno.test("an unknown dependency remains unresolved without throwing", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "component.support.usage"
      ? {
        ...declaration,
        dependsOnDeclarationIds: [
          ...declaration.dependsOnDeclarationIds,
          "decl-does-not-exist",
        ],
      }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "unknown-dependency",
    field: "component.support.usage",
    declarationIds: ["decl-support-usage"],
    message: "component.support.usage names unknown dependencies: decl-does-not-exist.",
  }]);
});

Deno.test("a value rejected by the production architecture grammar remains unresolved", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "architecture.package"
      ? { ...declaration, value: "not-a-SysML-identifier" }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "proposal-grammar-rejected",
    field: "architecture.package",
    declarationIds: [
      "decl-package",
      "decl-system",
      "decl-support-name",
      "decl-support-usage",
    ],
    message:
      "The production architecture proposal grammar or renderer rejected the explicit declarations.",
  }]);
});

Deno.test("a value rejected by the production requirements grammar remains unresolved", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "requirement.displacement.name"
      ? { ...declaration, value: 7 }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(result.diagnostics, [{
    code: "proposal-grammar-rejected",
    field: "requirements.containerComponent",
    declarationIds: [
      "decl-requirements-target",
      "decl-displacement-name",
      "decl-displacement-metric",
      "decl-displacement-operator",
      "decl-displacement-threshold",
      "decl-von-mises-name",
      "decl-von-mises-metric",
      "decl-von-mises-operator",
      "decl-von-mises-threshold",
    ],
    message:
      "The production requirements proposal grammar or renderer rejected the explicit declarations.",
  }]);
});

Deno.test("changed ProjectBrief item identity, kind, dependencies, sources, or statement never compiles", async () => {
  const base = mutableFixture();
  const cases: readonly {
    readonly name: string;
    readonly code: string;
    readonly brief: unknown;
  }[] = [
    {
      name: "item id",
      code: "brief-item-binding-mismatch",
      brief: {
        ...base.brief,
        items: base.brief.items.map((item) => {
          if (item.id === "support-block") {
            return { ...item, id: "support-block-renamed" };
          }
          return item.dependsOnItemIds
            ? {
              ...item,
              dependsOnItemIds: item.dependsOnItemIds.map((id) =>
                id === "support-block" ? "support-block-renamed" : id
              ),
            }
            : item;
        }),
      },
    },
    {
      name: "item kind",
      code: "brief-item-kind-mismatch",
      brief: {
        ...base.brief,
        items: base.brief.items.map((item) =>
          item.id === "support-block" ? { ...item, kind: "exclusion" } : item
        ),
      },
    },
    {
      name: "gate dependencies",
      code: "brief-item-dependency-mismatch",
      brief: {
        ...base.brief,
        items: base.brief.items.map((item) =>
          item.id === "mechanical-verification"
            ? { ...item, dependsOnItemIds: ["architecture", "support-block"] }
            : item
        ),
      },
    },
    {
      name: "source ref",
      code: "brief-item-source-mismatch",
      brief: {
        ...base.brief,
        items: base.brief.items.map((item) =>
          item.id === "max-displacement"
            ? {
              ...item,
              sourceRefs: [{
                kind: "intent",
                reference: "conversation:tampered",
              }],
            }
            : item
        ),
      },
    },
    {
      name: "statement",
      code: "brief-item-content-mismatch",
      brief: {
        ...base.brief,
        items: base.brief.items.map((item) =>
          item.id === "system"
            ? { ...item, statement: "A different unreviewed statement." }
            : item
        ),
      },
    },
  ];

  for (const testCase of cases) {
    const result = await compileExplicitBriefProposals({
      ...base,
      brief: testCase.brief,
    });
    assertEquals(result.status, "unresolved", testCase.name);
    assertEquals(result.architecture, undefined, testCase.name);
    assertEquals(result.requirements, undefined, testCase.name);
    assertEquals(
      result.diagnostics.some((diagnostic) => diagnostic.code === testCase.code),
      true,
      testCase.name,
    );
  }
});

Deno.test("a declaration bound to another valid brief item never compiles", async () => {
  const input = mutableFixture();
  const declarations = input.declarations.map((declaration) =>
    declaration.field === "system.name"
      ? {
        ...declaration,
        sourceItemId: "architecture",
        sourceRefs: input.brief.items.find((item) => item.id === "architecture")!
          .sourceRefs,
      }
      : declaration
  );
  const result = await compileExplicitBriefProposals({ ...input, declarations });

  assertEquals(result.status, "unresolved");
  assertEquals(result.architecture, undefined);
  assertEquals(result.requirements, undefined);
  assertEquals(
    result.diagnostics.some((diagnostic) =>
      diagnostic.code === "brief-item-binding-mismatch" &&
      diagnostic.field === "system.name"
    ),
    true,
  );
});
