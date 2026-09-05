import { assertEquals, assertInstanceOf } from "@std/assert";
import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { createArchitectureFoundation } from "../architecture/server-composition.ts";
import { createTechnicalCompilationFoundation } from "../compile/server-composition.ts";
import { FileProjectSourceWorkspaceStore } from "../project-source-workspace/file-project-source-workspace-store.ts";
import { createRecordedOperationPlanComposition } from "../compile/plans/server-composition.ts";
import type { CalculixIsolatedExecutionComposition } from "./isolated-v3/calculix-isolated-execution-composition.ts";
import { VerifyRunFeaStaticProofV3RunExecutor } from "./isolated-v3/verify-run-fea-static-proof-v3-run-executor.ts";
import { VerifySealProofCaseRunExecutor } from "./seal-case/verify-seal-proof-case-run-executor.ts";
import { createFeaFoundation, createFeaProject } from "./server-composition.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";

Deno.test("FEA @3 requires SysON plus CalculiX runtime and keeps the historical proof CAS", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-fea-composition-" });
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
    const foundation = createFeaFoundation();
    const probe = { algorithm: "sha256" as const, digest: "0".repeat(64) };
    assertEquals(
      foundation.feaProofCaptures.uriFor(probe),
      `casys://fea-proof-case-capture/sha256/${probe.digest}`,
    );
    assertEquals(
      foundation.feaProofCaptures.pathFor(probe).includes(
        "calculix/proof-cases",
      ),
      false,
    );
    assertEquals(
      foundation.feaProofCaptures.pathFor(probe).includes(
        "fea-proof-case-captures",
      ),
      true,
    );

    const plans = createRecordedOperationPlanComposition({
      snapshots,
      feaProofCaptures: foundation.feaProofCaptures,
      sensitivityCatalogOfferCaptures: foundation.sensitivityCatalogOfferCaptures,
      requirementsCaptures: architecture.requirementsCaptures,
      technicalCompilationAdmissionCaptureBytes:
        compilation.technicalCompilationSealBytes,
      admissions: compilation.technicalCompilationAdmissions,
      recordedAnalysisDirectory: `${root}/analysis`,
      canonicalAssetDirectory: `${root}/assets`,
    });
    const runtimeExecution = {
      profiles: { initial: () => Promise.resolve({}) },
      execution: {
        execute: { execute: () => Promise.resolve({}) },
        evidence: {},
        runner: {},
        recovery: {},
        publications: {},
      },
    } as unknown as CalculixIsolatedExecutionComposition;
    const projectOptions = {
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      lease: new FileEngineeringProjectRunLease(`${root}/leases`),
      foundation,
      requirementsCaptures: architecture.requirementsCaptures,
      seedCaptures: architecture.sysonModelSeedCaptures,
      admissions: compilation.technicalCompilationAdmissions,
      recordedPlanResolver: plans.recordedPlanResolver,
      recordedRunPlans: plans.recordedRunPlans,
      recordedAnalysisCas: plans.recordedAnalysisCas,
      recordedAnalysisDirectory: `${root}/analysis`,
      canonicalAssetDirectory: `${root}/assets`,
      resources: testReopenAgentResource(`${root}/agent-resources-fea`),
    };
    const withoutSyson = createFeaProject({
      ...projectOptions,
      calculix: {
        isolatedExecution: runtimeExecution,
        localProfile: undefined,
      },
    });
    assertEquals(withoutSyson.isolatedCalculixRun, undefined);
    assertInstanceOf(
      withoutSyson.genericVerifySealProofCase,
      VerifySealProofCaseRunExecutor,
    );

    const profileOnly = createFeaProject({
      ...projectOptions,
      sysonMcpUrl: "http://127.0.0.1:1/mcp",
      calculix: {
        isolatedExecution: { profiles: runtimeExecution.profiles },
        localProfile: undefined,
      },
    });
    assertEquals(profileOnly.isolatedCalculixRun, undefined);

    const withBoth = createFeaProject({
      ...projectOptions,
      sysonMcpUrl: "http://127.0.0.1:1/mcp",
      calculix: {
        isolatedExecution: runtimeExecution,
        localProfile: undefined,
      },
    });
    assertInstanceOf(
      withBoth.isolatedCalculixRun,
      VerifyRunFeaStaticProofV3RunExecutor,
    );

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("FileCataloguedMechanicalProofCaseReader"), false);
    assertEquals(source.includes("config/mechanical-proof-cases"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
