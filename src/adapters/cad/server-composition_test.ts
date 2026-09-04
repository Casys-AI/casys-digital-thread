import { assertEquals, assertInstanceOf } from "@std/assert";
import { ExportAdmittedProjectGeometry } from "../../application/use-cases/cad/canonical/export-admitted-project-geometry.ts";
import { PrepareProjectBuild123dExecutionReview } from "../../application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts";
import type { IsolatedCodeExecutionLimits } from "../../domain/compile/isolation/isolated-code-execution.ts";
import type { IsolatedCodePolicyRef } from "../../domain/compile/isolation/isolated-code-execution.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { createTechnicalCompilationFoundation } from "../compile/server-composition.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../project-source-workspace/file-project-source-workspace-store.ts";
import { PythonCadSourceAnalyzer } from "./source/python-cad-source-analyzer.ts";
import {
  composePrivateBuild123dGeometrySurfaces,
  createBuild123dCapability,
} from "./server-composition.ts";

const PROFILE = Object.freeze({
  imageReference:
    "casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8",
  policy: Object.freeze<IsolatedCodePolicyRef>({
    id: "build123d-deny-all-v1",
    version: "1.0.0",
    fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
  }),
  limits: Object.freeze<IsolatedCodeExecutionLimits>({
    maxWallTimeMs: 30_000,
    maxCpuTimeMs: 20_000,
    maxMemoryBytes: 1_024 * 1_048_576,
    maxProcesses: 32,
    maxStdoutBytes: 65_536,
    maxStderrBytes: 65_536,
    maxOutputFileBytes: 32 * 1_048_576,
    maxOutputTotalBytes: 32 * 1_048_576,
  }),
});

Deno.test("Build123d profile-only review stays independent of private sandbox admitted export", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-cad-composition-" });
  try {
    const snapshots = new FileThreadSnapshotStore(`${root}/snapshots`);
    const compilation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: testReopenAgentResource(`${root}/agent-resources`),
      workspace: new FileProjectSourceWorkspaceStore(`${root}/workspace`),
    });
    const absent = await createBuild123dCapability({
      recordedAnalysisDirectory: `${root}/analysis`,
      admissions: compilation.technicalCompilationAdmissions,
      snapshots,
    });
    assertEquals(absent.build123dExecution, undefined);
    assertEquals(absent.localProfile, undefined);
    assertEquals(absent.build123dExecutionReview, undefined);

    const reviewOnly = await createBuild123dCapability({
      build123dExecution: { profile: PROFILE },
      recordedAnalysisDirectory: `${root}/analysis`,
      admissions: compilation.technicalCompilationAdmissions,
      snapshots,
    });
    assertInstanceOf(
      reviewOnly.build123dExecutionReview,
      PrepareProjectBuild123dExecutionReview,
    );
    assertEquals(reviewOnly.build123dExecution?.execution, undefined);
    assertEquals(
      reviewOnly.localProfile?.runtimeBackend.imageReference,
      `docker.io/${PROFILE.imageReference}`,
    );

    const geometrySourceAnalysis = {
      sourceCaptures: new FileCaptureStore({
        kind: "geometry-source",
        directory: `${root}/geometry-source`,
        uriNamespace: "geometry-source",
        label: "Geometry source",
      }),
      analysisCaptures: new FileCaptureStore({
        kind: "source-analysis",
        directory: `${root}/source-analysis`,
        uriNamespace: "source-analysis",
        label: "Source analysis",
      }),
      frontend: new PythonCadSourceAnalyzer(),
    } as const;
    const architectureCaptures = new FileCaptureStore({
      kind: "architecture-capture",
      directory: `${root}/architecture`,
      uriNamespace: "architecture-capture",
      label: "Architecture",
    });
    const withSandbox = composePrivateBuild123dGeometrySurfaces({
      projects: {} as never,
      preparation: {} as never,
      geometrySourceAnalysis,
      admissions: compilation.technicalCompilationAdmissions,
      snapshots,
      architectureCaptures,
      geometryDraftCaptureDirectory: `${root}/drafts`,
      geometryDraftAssetDirectory: `${root}/draft-assets`,
      geometryCaptureDirectory: `${root}/geometry-captures`,
    });
    assertInstanceOf(
      withSandbox.admittedGeometryExport,
      ExportAdmittedProjectGeometry,
    );
    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("build123dSandbox" + "McpUrl"), false);
    assertEquals(source.includes("http://127.0.0.1:3024/mcp"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
