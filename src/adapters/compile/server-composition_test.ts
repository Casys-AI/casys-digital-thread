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

Deno.test("technical source capture reopens resourceRef then uses the existing analyzer", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-compile-resource-ref-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const persisted = await persistAgentResourceText(`${root}/agent-resources`, {
      name: "part.py",
      mimeType: "text/x-python",
      text: "from build123d import Box\nresult = Box(1, 2, 3)\n",
    });
    const foundation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: persisted.reopen,
    });
    const review = await foundation.technicalSourceCapture.capture({
      profileId: QUALIFIED_BUILD123D_SOURCE_ANALYSIS_PROFILE,
      sourceId: "source.cad",
      resourceRef: persisted.reference,
    });
    assertEquals(review.schemaVersion, "technical-source-capture-review/1.0");
    const source = review.reference.source as {
      language: string;
      sha256: string;
    };
    assertEquals(source.language, "python");
    assertEquals(source.sha256, persisted.reference.fingerprint.digest);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
