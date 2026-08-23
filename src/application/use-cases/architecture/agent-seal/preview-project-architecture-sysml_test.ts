import { assertEquals, assertRejects } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../../domain/architecture/renderer/architecture-proposal.ts";
import { QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE } from "../../../../adapters/architecture/agent-seal/qualified-architecture-sysml-analyzer.ts";
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

async function capturedPreview(sourceText: string) {
  const root = await Deno.makeTempDir({ prefix: "architecture-sysml-preview-" });
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
    sourceText,
  });
  const preview = new PreviewProjectArchitectureSysml({ captures });
  return { root, preview, reference };
}

Deno.test("architecture SysML preview reopens a captured source and never omits unresolved", async () => {
  const { root, preview, reference } = await capturedPreview(
    renderArchitectureSysmlWithManifest(proposal).sourceText,
  );
  try {
    const result = await preview.execute({ sourceRef: reference });
    assertEquals(result.status, "ready-for-review");
    assertEquals(result.unresolvedConstructs, []);
    assertEquals(Array.isArray(result.unresolvedConstructs), true);
    assertEquals(result.decisionParameters?.[0]?.key, "architecture.sysml.sourceId");
    assertEquals(
      (result.sourceRef as { source: { id: string } }).source.id,
      "source.architecture",
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("architecture SysML preview returns first-class unresolved constructs from a capture", async () => {
  const { root, preview, reference } = await capturedPreview([
    "package DroneV4 {",
    "  part def DroneSystem {",
    "    part wing : Wing;",
    "    requirement mass;",
    "  }",
    "  part def Wing {}",
    "}",
  ].join("\n"));
  try {
    const result = await preview.execute({ sourceRef: reference });
    assertEquals(result.status, "unresolved");
    assertEquals(result.unresolvedConstructs.length > 0, true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("architecture SysML preview refuses inline sourceText and extra fields", async () => {
  const { root, preview, reference } = await capturedPreview(
    renderArchitectureSysmlWithManifest(proposal).sourceText,
  );
  try {
    await assertRejects(
      () =>
        preview.execute({
          sourceText: "part def Motor {}",
          sourceRef: reference,
        }),
      PreviewProjectArchitectureSysmlError,
    );
    await assertRejects(
      () => preview.execute({ sourceText: "part def Motor {}" }),
      PreviewProjectArchitectureSysmlError,
    );
    const error = await assertRejects(
      () => preview.execute({}),
      PreviewProjectArchitectureSysmlError,
    );
    assertEquals(error.code, "invalid_request");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
