import { assertEquals, assertRejects } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../../domain/architecture/renderer/architecture-proposal.ts";
import {
  QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
  QualifiedArchitectureSysmlAnalyzer,
} from "../../../../adapters/architecture/agent-seal/qualified-architecture-sysml-analyzer.ts";
import { FileByteStore } from "../../../../adapters/shared/cas/file-byte-store.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "../../../../adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts";
import {
  PreviewProjectArchitectureSysml,
  PreviewProjectArchitectureSysmlError,
} from "./preview-project-architecture-sysml.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
]);

Deno.test("architecture SysML preview never omits unresolved and parses renderer text", async () => {
  const preview = new PreviewProjectArchitectureSysml({
    frontend: new QualifiedArchitectureSysmlAnalyzer(),
  });
  const result = await preview.execute({
    sourceId: "source.architecture",
    sourceText: renderArchitectureSysmlWithManifest(proposal).sourceText,
  });
  assertEquals(result.status, "ready-for-review");
  assertEquals(result.unresolvedConstructs, []);
  assertEquals(Array.isArray(result.unresolvedConstructs), true);
  assertEquals(result.decisionParameters, undefined);
});

Deno.test("architecture SysML preview returns first-class unresolved constructs", async () => {
  const preview = new PreviewProjectArchitectureSysml({
    frontend: new QualifiedArchitectureSysmlAnalyzer(),
  });
  const result = await preview.execute({
    sourceId: "source.architecture",
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
  assertEquals(result.status, "unresolved");
  assertEquals(result.unresolvedConstructs.length > 0, true);
});

Deno.test("architecture SysML preview emits seal parameters from a captured reference", async () => {
  const root = await Deno.makeTempDir({ prefix: "architecture-sysml-preview-" });
  try {
    const captures = createArchitectureSysmlSourceAnalysisCaptureService({
      sourceCaptures: new FileByteStore({
        kind: "architecture-sysml-source",
        directory: `${root}/sources`,
        uriNamespace: "architecture-sysml-source",
        label: "architecture SysML source",
      }),
      analysisCaptures: new FileByteStore({
        kind: "architecture-sysml-source-analysis",
        directory: `${root}/analyses`,
        uriNamespace: "architecture-sysml-source-analysis",
        label: "architecture SysML analysis",
      }),
    });
    const reference = await captures.capture({
      profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
      sourceId: "source.architecture",
      sourceText: renderArchitectureSysmlWithManifest(proposal).sourceText,
    });
    const preview = new PreviewProjectArchitectureSysml({
      frontend: new QualifiedArchitectureSysmlAnalyzer(),
      captures,
    });
    const result = await preview.execute({ sourceRef: reference });
    assertEquals(result.status, "ready-for-review");
    assertEquals(result.unresolvedConstructs, []);
    assertEquals(result.decisionParameters?.[0]?.key, "architecture.sysml.sourceId");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("architecture SysML preview rejects a request that names both text and a reference", async () => {
  const preview = new PreviewProjectArchitectureSysml({
    frontend: new QualifiedArchitectureSysmlAnalyzer(),
  });
  await assertRejects(
    () =>
      preview.execute({
        sourceText: "part def Motor {}",
        sourceRef: { kind: "no" },
      }),
    PreviewProjectArchitectureSysmlError,
  );
});
