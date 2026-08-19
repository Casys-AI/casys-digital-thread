import { assertEquals, assertRejects } from "@std/assert";
import {
  parseArchitectureProposalParameters,
  renderArchitectureSysmlWithManifest,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import { QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE } from "./qualified-architecture-sysml-analyzer.ts";
import { FileByteStore } from "../../shared/cas/file-byte-store.ts";
import {
  ArchitectureSysmlSourceAnalysisCaptureError,
} from "./architecture-sysml-source-analysis-capture.ts";
import {
  createArchitectureSysmlSourceAnalysisCaptureService,
} from "./architecture-sysml-source-analysis-composition.ts";

const proposal = parseArchitectureProposalParameters([
  { key: "architecture.package", label: "Package", value: "DroneV4" },
  { key: "system.name", label: "System", value: "DroneSystem" },
  { key: "component.wing.name", label: "Wing", value: "Wing" },
  { key: "component.wing.usage", label: "Wing usage", value: "wing" },
]);

Deno.test("architecture SysML capture persists renderer text and reopens unresolved=[]", async () => {
  const root = await Deno.makeTempDir({ prefix: "architecture-sysml-capture-" });
  try {
    const service = createArchitectureSysmlSourceAnalysisCaptureService({
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
    const sourceText = renderArchitectureSysmlWithManifest(proposal).sourceText;
    const reference = await service.capture({
      profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
      sourceId: "source.architecture",
      sourceText,
    });
    assertEquals(reference.kind, "architecture-sysml-source-analysis");
    assertEquals(
      reference.schemaVersion,
      "architecture-sysml-source-analysis-capture/1.0",
    );
    const reopened = await service.reopen(reference);
    assertEquals(reopened.sourceText, sourceText);
    assertEquals(reopened.analysis.unresolvedConstructs, []);
    assertEquals(reopened.analysis.policy.status, "passed");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("architecture SysML capture rejects commented source after persisting analysis", async () => {
  const root = await Deno.makeTempDir({ prefix: "architecture-sysml-reject-" });
  try {
    const service = createArchitectureSysmlSourceAnalysisCaptureService({
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
    const error = await assertRejects(
      () =>
        service.capture({
          profileId: QUALIFIED_ARCHITECTURE_SYSML_ANALYSIS_PROFILE,
          sourceId: "source.architecture",
          sourceText: "package DroneV4 { // comment\n}",
        }),
      ArchitectureSysmlSourceAnalysisCaptureError,
    );
    assertEquals(error.code, "analysis_rejected");
    assertEquals(error.reference?.analysis.policy.status, "rejected");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
