import { assertEquals } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
  QualifiedArchitectureSysmlAnalyzer,
} from "./qualified-architecture-sysml-analyzer.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
  { key: "component.motor.name", label: "Motor", value: "Motor" },
  { key: "component.motor.usage", label: "Motor usage", value: "motor" },
  { key: "component.motor.parent", label: "Motor parent", value: "Wing" },
]);

Deno.test("qualified architecture SysML analyzer parses renderer output with unresolved=[]", async () => {
  const analyzer = new QualifiedArchitectureSysmlAnalyzer();
  for (
    const rendered of [
      renderArchitectureSysmlWithManifest(proposal),
      renderArchitectureSysmlWithManifest(proposal, {
        kind: "part-def",
        packageName: "DroneV4",
        componentName: "Motor",
      }),
      renderArchitectureSysmlWithManifest(proposal, {
        kind: "usage",
        packageName: "DroneV4",
        componentName: "Wing",
        usageName: "wing",
        parentName: "DroneSystem",
      }),
    ]
  ) {
    const bundle = await analyzer.analyze({
      sourceId: "source.architecture",
      role: "sysml-model",
      language: "sysml-v2",
      sourceText: rendered.sourceText,
    });
    assertEquals(bundle.policy.profile, QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE);
    assertEquals(bundle.policy.status, "passed");
    assertEquals(bundle.unresolvedConstructs, []);
    const symbolIds = new Set(bundle.symbols.map((symbol) => symbol.id));
    for (const dependency of bundle.dependencies) {
      assertEquals(symbolIds.has(dependency.fromSymbolId), true);
      assertEquals(symbolIds.has(dependency.toSymbolId), true);
      assertEquals(dependency.fromSymbolId === dependency.toSymbolId, false);
      assertEquals(
        bundle.symbols.some((symbol) => symbol.id === symbol.name),
        false,
      );
    }
  }
});

Deno.test("qualified architecture SysML analyzer binds usages to definition ids, never labels", async () => {
  const rendered = renderArchitectureSysmlWithManifest(proposal);
  const bundle = await new QualifiedArchitectureSysmlAnalyzer().analyze({
    sourceId: "source.architecture",
    role: "sysml-model",
    language: "sysml-v2",
    sourceText: rendered.sourceText,
  });
  const wingUsage = bundle.symbols.find((symbol) => symbol.name === "wing");
  const wingDef = bundle.symbols.find((symbol) =>
    symbol.name === "Wing" && symbol.kind === "component" &&
    symbol.span !== undefined
  );
  const relation = bundle.dependencies.find((dependency) =>
    dependency.fromSymbolId === wingUsage?.id
  );
  assertEquals(relation?.toSymbolId, wingDef?.id);
  assertEquals(relation?.kind, "structural-incidence");
});

Deno.test("qualified architecture SysML analyzer keeps extra constructs as unresolved", async () => {
  const bundle = await new QualifiedArchitectureSysmlAnalyzer().analyze({
    sourceId: "source.architecture",
    role: "sysml-model",
    language: "sysml-v2",
    sourceText: [
      "package DroneV4 {",
      "  part def DroneSystem {",
      "    part wing : Wing;",
      "    requirement mass;",
      "  }",
      "  part def Wing {}",
      "}",
    ].join("\n"),
  });
  assertEquals(bundle.policy.status, "passed");
  assertEquals(bundle.unresolvedConstructs.length > 0, true);
  assertEquals(
    bundle.unresolvedConstructs.every((item) => item.id.startsWith("unresolved:")),
    true,
  );
});

Deno.test("qualified architecture SysML analyzer rejects comments as lexical findings", async () => {
  const bundle = await new QualifiedArchitectureSysmlAnalyzer().analyze({
    sourceId: "source.architecture",
    role: "sysml-model",
    language: "sysml-v2",
    sourceText: "package DroneV4 { // comment\n}",
  });
  assertEquals(bundle.policy.status, "rejected");
  assertEquals(bundle.unresolvedConstructs, []);
  assertEquals(bundle.policy.findings[0]?.code, "sysml-lexical-error");
});
