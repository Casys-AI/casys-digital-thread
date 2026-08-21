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
    });
    const foundation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
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
