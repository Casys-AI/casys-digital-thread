import { assertEquals, assertInstanceOf, assertStrictEquals } from "@std/assert";
import { PreviewProjectTechnicalCompilation } from "../../application/use-cases/compile/admission/preview-project-technical-compilation.ts";
import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { createArchitectureFoundation } from "../architecture/server-composition.ts";
import {
  createTechnicalCompilationFoundation,
  createTechnicalCompilationPreview,
  createTechnicalCompilationProject,
} from "./server-composition.ts";
import { CompileSealAdmissionRunExecutor } from "./executors/compile-seal-admission-run-executor.ts";
import { CaptureBackedTechnicalCompilationAdmissionReader } from "./admission/capture-backed-technical-compilation-admission-reader.ts";
import {
  persistAgentResourceText,
  testReopenAgentResource,
} from "../../testing/agent-resource-test-support.ts";
import { QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE } from "../cad/source/qualified-build123d-source-analyzer.ts";
import { FileProjectSourceWorkspaceStore } from "../project-source-workspace/file-project-source-workspace-store.ts";
import { ProjectSourceWorkspaceUseCases } from "../../application/use-cases/project-source-workspace/project-source-workspace-use-cases.ts";

Deno.test("compilation composition shares one admission CAS and keeps preview off the seal path", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-compile-composition-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const runtime = await createEngineeringProjectCommandRuntime({
      activeDirectory: `${root}/projects`,
      evidenceSnapshots: snapshots,
    });
    const architecture = createArchitectureFoundation({
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
    const foundation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: testReopenAgentResource(`${root}/agent-resources-compile`),
      workspace: new FileProjectSourceWorkspaceStore(`${root}/workspace`),
    });
    const project = createTechnicalCompilationProject({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      foundation,
      architectureCaptures: architecture.genericArchitectureCaptures,
      seedCaptures: architecture.sysonModelSeedCaptures,
      requirementsCaptures: architecture.requirementsCaptures,
    });
    const preview = createTechnicalCompilationPreview({
      foundation,
      basisResolver: project.technicalCompilationBasis,
      projects: runtime.projects,
      methodSheets: { read: () => Promise.resolve(undefined) },
    });

    assertInstanceOf(
      foundation.technicalCompilationAdmissions,
      CaptureBackedTechnicalCompilationAdmissionReader,
    );
    assertInstanceOf(project.compileSealAdmission, CompileSealAdmissionRunExecutor);
    assertInstanceOf(preview, PreviewProjectTechnicalCompilation);
    assertEquals(
      preview ===
        (project.compileSealAdmission as unknown as PreviewProjectTechnicalCompilation),
      false,
    );
    assertStrictEquals(
      project.compileSealAdmission === undefined,
      false,
    );

    const probe = { algorithm: "sha256" as const, digest: "0".repeat(64) };
    assertEquals(
      await foundation.technicalCompilationSeals.read(probe),
      undefined,
    );
    assertEquals(
      await foundation.technicalCompilationAdmissions.read === undefined,
      false,
    );

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("technical source capture reopens a workspace file revision then uses the existing analyzer", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-compile-resource-ref-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const persisted = await persistAgentResourceText(`${root}/agent-resources`, {
      name: "part.py",
      mimeType: "text/x-python",
      text: "from build123d import Box\nresult = Box(1, 2, 3)\n",
    });
    const workspace = new FileProjectSourceWorkspaceStore(`${root}/workspace`);
    const foundation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: persisted.reopen,
      workspace,
    });
    const projectId = "project.cad";
    const files = new ProjectSourceWorkspaceUseCases({
      projects: {
        get: (id) => Promise.resolve(id === projectId ? { id } : undefined),
      },
      workspace,
      resources: persisted.reopen,
    });
    await files.putModule({
      projectId,
      mutationId: "module-root",
      expectedWorkspaceRevision: 0,
      mutation: {
        kind: "module_put",
        moduleId: "mod.root",
        slug: "src",
        displayName: "Sources",
      },
    });
    await files.putFile({
      projectId,
      mutationId: "put-source.cad",
      expectedWorkspaceRevision: 1,
      mutation: {
        kind: "file_put",
        fileId: "source.cad",
        moduleId: "mod.root",
        logicalName: "part.py",
        role: "cad-script",
        dependencies: [],
        resourceRef: persisted.reference,
        captureRequest: { profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE },
      },
    });
    const review = await foundation.technicalSourceCapture.capture({
      projectId,
      workspaceRevision: 2,
      fileId: "source.cad",
      fileRevision: 1,
    });
    assertEquals(review.schemaVersion, "technical-source-capture-review/2.0");
    assertEquals(
      review.reference.schemaVersion,
      "technical-source-analysis-capture-locator/2.0",
    );
    assertEquals(review.parser.status, "passed");
    assertEquals(review.parser.profile, QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
