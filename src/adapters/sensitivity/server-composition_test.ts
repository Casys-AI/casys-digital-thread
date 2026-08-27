import { assertEquals, assertInstanceOf } from "@std/assert";
import { PreviewProjectTechnicalCompilation } from "../../application/use-cases/compile/admission/preview-project-technical-compilation.ts";

import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import type { Build123dExecutionComposition } from "../cad/isolated/build123d-execution-composition.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { createArchitectureFoundation } from "../architecture/server-composition.ts";
import {
  createTechnicalCompilationFoundation,
  createTechnicalCompilationPreview,
  createTechnicalCompilationProject,
} from "../compile/server-composition.ts";
import { createFeaFoundation } from "../fea/server-composition.ts";
import { AnalyzeRunFeaSensitivityRunExecutor } from "./live-fea/analyze-run-fea-sensitivity-run-executor.ts";
import { DesignApplyVectorCorrectionRunExecutor } from "./vector-correction/design-apply-vector-correction-run-executor.ts";
import { VerifyEvaluateSensitivityBaseRunExecutor } from "./base-evaluation/verify-evaluate-sensitivity-base-run-executor.ts";
import { createSensitivityComposition } from "./server-composition.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../project-source-workspace/file-project-source-workspace-store.ts";

Deno.test("sensitivity live-FEA and base evaluation stay gated; vector correction is not a proof-run grant", async () => {
  const root = await Deno.makeTempDir({
    prefix: "casys-sensitivity-composition-",
  });
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
    const compilation = createTechnicalCompilationFoundation({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
      resources: testReopenAgentResource(`${root}/agent-resources-compile`),
      workspace: new FileProjectSourceWorkspaceStore(`${root}/workspace`),
    });
    const compilationProject = createTechnicalCompilationProject({
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      foundation: compilation,
      architectureCaptures: architecture.genericArchitectureCaptures,
      seedCaptures: architecture.sysonModelSeedCaptures,
      requirementsCaptures: architecture.requirementsCaptures,
    });
    const preview = createTechnicalCompilationPreview({
      foundation: compilation,
      basisResolver: compilationProject.technicalCompilationBasis,
      projects: runtime.projects,
      methodSheets: { read: () => Promise.resolve(undefined) },
    });
    const fea = createFeaFoundation();
    const baseOptions = {
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/sensitivity-leases`),
      admissions: compilation.technicalCompilationAdmissions,
      technicalCompilationPreview: preview,
      feaProofCaptures: fea.feaProofCaptures,
      sensitivityCatalogOfferCaptures: fea.sensitivityCatalogOfferCaptures,
      sysonModelSeedCaptures: architecture.sysonModelSeedCaptures,
      sensitivityStepCacheDirectory: `${root}/step-cache`,
    };

    const ungated = createSensitivityComposition({
      ...baseOptions,
      build123dExecution: undefined,
    });
    assertEquals(ungated.analyzeRunFeaSensitivity, undefined);
    assertEquals(ungated.verifyEvaluateSensitivityBase, undefined);
    assertInstanceOf(
      ungated.designApplyVectorCorrection,
      DesignApplyVectorCorrectionRunExecutor,
    );
    assertEquals(
      ungated.verifyEvaluateSensitivityBase ===
        (ungated.designApplyVectorCorrection as unknown as
          | VerifyEvaluateSensitivityBaseRunExecutor
          | undefined),
      false,
    );
    assertInstanceOf(preview, PreviewProjectTechnicalCompilation);
    const unusedCapture = compilation.technicalSourceAnalysis;
    assertEquals(typeof unusedCapture.capture, "function");

    const live = createSensitivityComposition({
      ...baseOptions,
      build123dExecution: {
        profiles: {},
        execution: {
          runner: { run: () => Promise.resolve({}) },
          recovery: {},
          publications: {},
        },
      } as unknown as Build123dExecutionComposition,
      calculixMcpUrl: "http://127.0.0.1:1/mcp",
      sysonMcpUrl: "http://127.0.0.1:1/mcp",
    });
    assertInstanceOf(
      live.analyzeRunFeaSensitivity,
      AnalyzeRunFeaSensitivityRunExecutor,
    );
    assertInstanceOf(
      live.verifyEvaluateSensitivityBase,
      VerifyEvaluateSensitivityBaseRunExecutor,
    );
    assertEquals(
      live.analyzeRunFeaSensitivity ===
        (live
          .designApplyVectorCorrection as unknown as AnalyzeRunFeaSensitivityRunExecutor),
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
