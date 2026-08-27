import { assertEquals, assertInstanceOf } from "@std/assert";
import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileLiveThreadUpdateStore } from "../shared/stores/live-thread-update-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { ArchitectureSysmlSourceAnalysisCaptureService } from "./agent-seal/architecture-sysml-source-analysis-capture.ts";
import { ModelSealArchitectureSysmlRunExecutor } from "./agent-seal/model-seal-architecture-sysml-run-executor.ts";
import { ModelWriteArchitectureRunExecutor } from "./renderer/model-write-architecture-run-executor.ts";
import { SysmlSourceAnalysisCaptureService } from "./renderer/sysml-source-analysis-capture.ts";
import { ModelWriteRequirementsRunExecutor } from "./requirements/model-write-requirements-run-executor.ts";
import {
  createArchitectureFoundation,
  createArchitectureProject,
} from "./server-composition.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";

Deno.test("architecture composition seals without SysON and writes only when a SysON URL is supplied", async () => {
  const root = await Deno.makeTempDir({
    prefix: "casys-architecture-composition-",
  });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const runtime = await createEngineeringProjectCommandRuntime({
      activeDirectory: `${root}/projects`,
      evidenceSnapshots: snapshots,
    });
    const foundation = createArchitectureFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      sourceAnalysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${root}/source-analysis`,
        uriNamespace: "source-analysis",
        label: "Source analysis",
      }),
      sysmlSourceCaptureDirectory: `${root}/sysml`,
      sysonModelSeedCaptureDirectory: `${root}/seed`,
      architectureCaptureDirectory: `${root}/architecture`,
      requirementsCaptureDirectory: `${root}/requirements`,
      resources: testReopenAgentResource(`${root}/agent-resources`),
    });
    const shared = {
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      liveUpdates: new FileLiveThreadUpdateStore(`${root}/live`),
      foundation,
      sysonModelSeedAttemptDirectory: `${root}/seed-attempts`,
      architectureAttemptDirectory: `${root}/architecture-attempts`,
      partDefinitionsCaptureDirectory: `${root}/part-defs`,
      partDefinitionsPublicationDirectory: `${root}/part-pubs`,
      requirementsAttemptDirectory: `${root}/requirements-attempts`,
    };
    const withoutSyson = createArchitectureProject(shared);
    assertInstanceOf(
      withoutSyson.modelSealArchitectureSysml,
      ModelSealArchitectureSysmlRunExecutor,
    );
    assertEquals(withoutSyson.genericModelWriteArchitecture, undefined);
    assertEquals(withoutSyson.genericModelWriteRequirements, undefined);
    assertEquals(withoutSyson.genericModelCapturePartDefinitions, undefined);
    assertEquals(withoutSyson.sysonModelSeed, undefined);

    const withSyson = createArchitectureProject({
      ...shared,
      sysonMcpUrl: "http://127.0.0.1:1/mcp",
    });
    assertInstanceOf(
      withSyson.genericModelWriteArchitecture,
      ModelWriteArchitectureRunExecutor,
    );
    assertInstanceOf(
      withSyson.genericModelWriteRequirements,
      ModelWriteRequirementsRunExecutor,
    );
    assertInstanceOf(
      withSyson.modelSealArchitectureSysml,
      ModelSealArchitectureSysmlRunExecutor,
    );

    assertInstanceOf(
      foundation.sysmlSourceAnalysis,
      SysmlSourceAnalysisCaptureService,
    );
    assertInstanceOf(
      foundation.architectureSysmlSourceAnalysis,
      ArchitectureSysmlSourceAnalysisCaptureService,
    );
    const probe = { algorithm: "sha256" as const, digest: "0".repeat(64) };
    assertEquals(
      foundation.requirementsCaptures.uriFor(probe),
      `casys://requirements-capture/sha256/${probe.digest}`,
    );

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
