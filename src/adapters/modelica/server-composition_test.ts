import { assertEquals, assertInstanceOf } from "@std/assert";
import type { IsolatedCodeExecutionLimits } from "../../domain/compile/isolation/isolated-code-execution.ts";
import type { IsolatedCodePolicyRef } from "../../domain/compile/isolation/isolated-code-execution.ts";
import { createEngineeringProjectCommandRuntime } from "../project/engineering-project-command-runtime.ts";
import { FileCaptureStore } from "../shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../shared/stores/file-thread-snapshot-store.ts";
import { createArchitectureFoundation } from "../architecture/server-composition.ts";
import {
  createTechnicalCompilationFoundation,
  createTechnicalCompilationProject,
} from "../compile/server-composition.ts";
import { VerifyEvaluateAdmittedModelicaObservationsRunExecutor } from "./evaluation/verify-evaluate-admitted-modelica-observations-run-executor.ts";
import {
  createAdmittedModelicaCapability,
  createModelicaProject,
  createModelicaThermalMethodSheetJoin,
  createQualifiedModelicaCapability,
} from "./server-composition.ts";
import { testReopenAgentResource } from "../../testing/agent-resource-test-support.ts";
import { FileProjectSourceWorkspaceStore } from "../project-source-workspace/file-project-source-workspace-store.ts";

const LIMITS = Object.freeze<IsolatedCodeExecutionLimits>({
  maxWallTimeMs: 120_000,
  maxCpuTimeMs: 120_000,
  maxMemoryBytes: 3 * 1_073_741_824,
  maxProcesses: 64,
  maxStdoutBytes: 1_048_576,
  maxStderrBytes: 1_048_576,
  maxOutputFileBytes: 16 * 1_048_576,
  maxOutputTotalBytes: 17 * 1_048_576,
});

const POLICY = Object.freeze<IsolatedCodePolicyRef>({
  id: "modelica-deny-all-v1",
  version: "1.0.0",
  fingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
});

Deno.test("Modelica kit and admitted stay distinct; L4 evaluation requires SysON", async () => {
  const root = await Deno.makeTempDir({ prefix: "casys-modelica-composition-" });
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
    const qualified = await createQualifiedModelicaCapability({
      modelicaIsolatedExecution: {
        profile: {
          imageReference: `casys/modelica-microsandbox-worker@sha256:${"a".repeat(64)}`,
          policy: POLICY,
          limits: LIMITS,
          engine: {
            name: "OpenModelica",
            version: "1.27.0",
            mslVersion: "4.1.0",
          },
        },
      },
      recordedAnalysisDirectory: `${root}/analysis`,
      qualificationRoot: `${root}/qualification`,
      qualificationCaptureFingerprint: {
        algorithm: "sha256",
        digest: "d".repeat(64),
      },
    });
    const admitted = await createAdmittedModelicaCapability({
      admittedModelicaExecution: {
        profile: {
          imageReference: `casys/modelica-microsandbox-worker@sha256:${"e".repeat(64)}`,
          policy: POLICY,
          limits: LIMITS,
        },
      },
      recordedAnalysisDirectory: `${root}/analysis`,
    });
    assertEquals(qualified.isolatedExecution !== undefined, true);
    assertEquals(qualified.isolatedExecution?.execution, undefined);
    assertEquals(admitted.execution !== undefined, true);
    assertEquals(admitted.execution?.execution, undefined);
    const probe = { algorithm: "sha256" as const, digest: "0".repeat(64) };
    assertEquals(
      admitted.captures.uriFor(probe).includes(
        "modelica-admitted-execution-capture",
      ),
      true,
    );
    assertEquals(
      admitted.captures.uriFor(probe).includes("isolated-execution"),
      false,
    );

    const thermal = createModelicaThermalMethodSheetJoin({
      recordedAnalysisDirectory: `${root}/analysis`,
      snapshots,
    });
    const projectOptions = {
      projects: runtime.projects,
      commands: runtime.commands,
      snapshots,
      executionSnapshots: snapshots,
      planSnapshots: snapshots,
      plans: {
        read: () => Promise.reject(new Error("unused Modelica ROP reader")),
      },
      capabilityRuntime: {
        requireExecution: () => Promise.resolve(undefined),
      },
      capabilityRuntimeSession: {
        begin: () => Promise.reject(new Error("unused Modelica JIT session")),
        releaseRecorded: () => Promise.resolve(),
      },
      lease: new FileEngineeringProjectRunLease(`${root}/modelica-leases`),
      recordedAnalysisDirectory: `${root}/analysis`,
      admissions: compilation.technicalCompilationAdmissions,
      basisResolver: compilationProject.technicalCompilationBasis,
      technicalSourceAnalysisCaptures: compilation.technicalSourceAnalysisCaptures,
      thermal,
      qualified,
      admitted,
    };
    const withoutSyson = createModelicaProject(projectOptions);
    assertEquals(
      withoutSyson.verifyEvaluateAdmittedModelicaObservations,
      undefined,
    );
    assertEquals(
      withoutSyson.admittedModelicaEvaluationCloseoutReview !== undefined,
      true,
    );
    assertEquals(withoutSyson.simulateRunQualifiedModelicaKit, undefined);
    assertEquals(withoutSyson.simulateRunAdmittedModelica, undefined);
    const withSyson = createModelicaProject({
      ...projectOptions,
      sysonMcpUrl: "http://127.0.0.1:1/mcp",
    });
    assertInstanceOf(
      withSyson.verifyEvaluateAdmittedModelicaObservations,
      VerifyEvaluateAdmittedModelicaObservationsRunExecutor,
    );

    const source = await Deno.readTextFile(
      new URL("./server-composition.ts", import.meta.url),
    );
    assertEquals(source.includes("CreateConsoleServerOptions"), false);
    assertEquals(source.includes("isolatedOutputCasObjectStore"), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
