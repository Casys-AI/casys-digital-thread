import {
  createFocusedWorkspaceHandler,
  createNativeWorkbenchHandler,
  type NativeWorkbenchProjectCatalog,
  resolveSnapshotComponentCatalog,
} from "../../../scripts/serve/serve-native-workbench.ts";
import { FileCockpitFocusStore } from "../../../src/adapters/project/file-cockpit-focus-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
  type CaptureStoreDescriptor,
  DFM_CASE_CAPTURE_DESCRIPTOR,
  EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
  PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
  REQUIREMENTS_CAPTURE_DESCRIPTOR,
  SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
} from "../../../src/adapters/shared/cas/file-capture-store.ts";
import {
  requireSysmlSourceAnalysis,
  type SysmlSourceAnalysisReader,
} from "../../../src/adapters/architecture/renderer/sysml-source-analysis-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../../../src/adapters/shared/stores/engineering-project-store.ts";
import { FileThreadSnapshotStore } from "../../../src/adapters/shared/stores/file-thread-snapshot-store.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../../../src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../../../src/adapters/engineering-asset-resolver.ts";
import { FileLiveThreadUpdateStore } from "../../../src/adapters/shared/stores/live-thread-update-store.ts";
import { FileByteStore } from "../../../src/adapters/shared/cas/file-byte-store.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "../../../src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts";
import { fileArchitectureSysmlSealCaptureReader } from "../../../src/adapters/architecture/agent-seal/file-architecture-sysml-seal-capture-reader.ts";
import type { SealedCadLeverAdmissionReader } from "../../../src/adapters/thread/technical-admission-workbench-enricher.ts";
import type { EngineeringCaseWorkbenchEnricherDependencies } from "../../../src/adapters/thread/verification-case-workbench-enricher.ts";
import type { RequirementsCaptureReader } from "../../../src/adapters/thread/requirements-target-workbench-enricher.ts";
import { FileProjectSourceWorkspaceStore } from "../../../src/adapters/project-source-workspace/file-project-source-workspace-store.ts";
import { DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY } from "../../../src/adapters/project-source-workspace/server-composition.ts";
import type { EvaluationCloseoutCaptureReader } from "../../../src/adapters/thread/evaluation-closeout-workbench-enricher.ts";
import type { AssemblyIntegrityWorkbenchCaptureReaders } from "../../../src/adapters/thread/assembly-integrity-workbench-enricher.ts";
import { readDeclaredCockpitFleet } from "../../../src/adapters/thread/cockpit-fleet-projector.ts";
import { joinWorkspace } from "../sidecar/contracts.ts";
import { WORKBENCH_ACCESS_HEADER, WORKBENCH_WORKSPACE_ID } from "./contracts.ts";

const ACTIVE_PROJECT_DIRECTORY = "state/local/engineering-projects";
const PROJECT_BASELINE_DIRECTORY = "config/projects/baselines";
const PROJECT_BASELINE_ASSET_DIRECTORY = `${PROJECT_BASELINE_DIRECTORY}/assets`;
const THREAD_SNAPSHOT_DIRECTORY = "state/local/thread-snapshots";
const THREAD_ASSET_DIRECTORY = "state/local/thread-assets";
const LIVE_UPDATE_DIRECTORY = "state/local/live-thread-updates";
const FOCUS_DIRECTORY = "state/local/cockpit-focus";
const RECORDED_ANALYSIS_DIRECTORY = "state/local/recorded-analysis";

export function createPackagedWorkbenchBff(
  accessToken: string,
  controlPlaneRoot: string,
): (request: Request) => Promise<Response> {
  const activeProjectDirectory = rooted(controlPlaneRoot, ACTIVE_PROJECT_DIRECTORY);
  const projectBaselineDirectory = rooted(
    controlPlaneRoot,
    PROJECT_BASELINE_DIRECTORY,
  );
  const projectBaselineAssetDirectory = rooted(
    controlPlaneRoot,
    PROJECT_BASELINE_ASSET_DIRECTORY,
  );
  const threadSnapshotDirectory = rooted(controlPlaneRoot, THREAD_SNAPSHOT_DIRECTORY);
  const threadAssetDirectory = rooted(controlPlaneRoot, THREAD_ASSET_DIRECTORY);
  const liveUpdateDirectory = rooted(controlPlaneRoot, LIVE_UPDATE_DIRECTORY);
  const focusDirectory = rooted(controlPlaneRoot, FOCUS_DIRECTORY);
  const recordedAnalysisDirectory = rooted(
    controlPlaneRoot,
    RECORDED_ANALYSIS_DIRECTORY,
  );
  const store = new FileThreadSnapshotStore(threadSnapshotDirectory);
  const projectStore = new FileEngineeringProjectRevisionStore(
    activeProjectDirectory,
  );
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const focus = new FileCockpitFocusStore(focusDirectory);
  const archCaptures = captureAt(controlPlaneRoot, ARCHITECTURE_CAPTURE_DESCRIPTOR);
  const geometryCaptures = captureAt(controlPlaneRoot, GEOMETRY_CAPTURE_DESCRIPTOR);
  const sysmlSourceCaptures = captureAt(
    controlPlaneRoot,
    SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  );
  const sourceAnalysisCaptures = new FileCaptureStore(
    rootedCapture(controlPlaneRoot, SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR),
  );
  const sysmlSourceAnalysis: SysmlSourceAnalysisReader = {
    reopen: (reference) =>
      requireSysmlSourceAnalysis(reference, {
        sourceCaptures: sysmlSourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
      }),
  };
  const architectureSysmlDirectory = rooted(
    recordedAnalysisDirectory,
    "architecture-sysml",
  );
  const architectureSysmlSources = createArchitectureSysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "architecture-sysml-source",
      directory: rooted(architectureSysmlDirectory, "sources"),
      uriNamespace: "architecture-sysml-source",
      label: "Captured architecture SysML source",
    }),
    analysisCaptures: new FileByteStore({
      kind: "architecture-sysml-source-analysis",
      directory: rooted(architectureSysmlDirectory, "analyses"),
      uriNamespace: "architecture-sysml-source-analysis",
      label: "Captured architecture SysML analysis",
    }),
  });
  const architectureSysmlSeals = fileArchitectureSysmlSealCaptureReader(
    new FileByteStore({
      kind: "architecture-sysml-seal-capture",
      directory: rooted(architectureSysmlDirectory, "seals"),
      uriNamespace: "architecture-sysml-seal-capture",
      label: "Sealed architecture SysML analysis",
    }),
  );
  const technicalCompilationSealBytes = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: rooted(recordedAnalysisDirectory, "technical-compilation/seals"),
    uriNamespace: "technical-compilation-admission-capture",
    label: "Sealed technical compilation admission",
  });
  const technicalCompilationAdmissions: SealedCadLeverAdmissionReader = {
    read: async (fingerprint) => {
      const stored = await technicalCompilationSealBytes.read(fingerprint);
      return stored === undefined
        ? undefined
        : new TextDecoder("utf-8", { fatal: true }).decode(stored.copy());
    },
  };
  const projectSourceWorkspace = new FileProjectSourceWorkspaceStore(
    rooted(controlPlaneRoot, DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY),
  );
  const requirementsCaptures: RequirementsCaptureReader = captureAt(
    controlPlaneRoot,
    REQUIREMENTS_CAPTURE_DESCRIPTOR,
  );
  const engineeringCaseCaptures: EngineeringCaseWorkbenchEnricherDependencies = {
    mechanicalProof: captureAt(controlPlaneRoot, FEA_PROOF_CASE_CAPTURE_DESCRIPTOR),
    sensitivityStudy: new FileCaptureStore(
      rootedCapture(controlPlaneRoot, SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR),
    ),
    printabilityCheck: captureAt(
      controlPlaneRoot,
      PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
    ),
    printEstimate: captureAt(
      controlPlaneRoot,
      PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
    ),
    dfmCheck: captureAt(controlPlaneRoot, DFM_CASE_CAPTURE_DESCRIPTOR),
  };
  const evaluationCloseoutCaptures: EvaluationCloseoutCaptureReader =
    new FileCaptureStore({
      ...EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
      directory: rooted(
        recordedAnalysisDirectory,
        "calculix/evaluation-closeout-captures",
      ),
      syncBoundary: recordedAnalysisDirectory,
    });
  const assemblyIntegrityCaptures: AssemblyIntegrityWorkbenchCaptureReaders = {
    observations: captureAt(
      controlPlaneRoot,
      ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
    ),
    evaluations: captureAt(
      controlPlaneRoot,
      ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
    ),
    closeouts: captureAt(
      controlPlaneRoot,
      ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
    ),
  };
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(threadAssetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const liveUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  const uiDirectory = fileUrlPath(
    new URL("../../../src/ui/dist/thread", import.meta.url),
  );
  const native = createNativeWorkbenchHandler({
    store,
    projectStore,
    cockpitFocus: focus,
    workspaceId: WORKBENCH_WORKSPACE_ID,
    projectSnapshots,
    htmlPath: rooted(uiDirectory, "native-workbench.html"),
    uiAssetDirectory: uiDirectory,
    componentCatalogForSubject: async (subjectId) =>
      await readOptionalComponentCatalog(
        rooted(
          controlPlaneRoot,
          `config/thread-subjects/${subjectId}.components.json`,
        ),
      ),
    componentCatalogForSnapshot: async (snapshot) =>
      await resolveSnapshotComponentCatalog(
        snapshot,
        archCaptures,
        geometryCaptures,
        sysmlSourceAnalysis,
      ),
    architectureSysmlSeals,
    architectureSysmlSources,
    technicalCompilationAdmissions,
    projectSourceWorkspace,
    requirementsCaptures,
    productStructureCaptures: archCaptures,
    geometryCaptures,
    sysmlSourceAnalysis,
    engineeringCaseCaptures,
    evaluationCloseoutCaptures,
    assemblyIntegrityCaptures,
    liveUpdates,
    assetReader: (filename) => assetReader.read(filename),
    cockpitFleet: () =>
      readDeclaredCockpitFleet(rooted(controlPlaneRoot, "config/mcp-fleet.json")),
    projectCatalog: () =>
      readPersistedProjectCatalog(projectStore, activeProjectDirectory),
  });
  const focused = createFocusedWorkspaceHandler({
    focus,
    workspaceId: WORKBENCH_WORKSPACE_ID,
    native,
    projectCatalog: () =>
      readPersistedProjectCatalog(projectStore, activeProjectDirectory),
  });
  return async (request) => {
    if (request.headers.get(WORKBENCH_ACCESS_HEADER) !== accessToken) {
      return new Response("Not found", {
        status: 404,
        headers: {
          "Cache-Control": "no-store",
          "Cross-Origin-Resource-Policy": "same-origin",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return await focused(request);
  };
}

async function readPersistedProjectCatalog(
  store: FileEngineeringProjectRevisionStore,
  directory: string,
): Promise<NativeWorkbenchProjectCatalog> {
  try {
    const projects = [];
    try {
      for await (const entry of Deno.readDir(directory)) {
        if (!entry.isDirectory || entry.isSymlink) continue;
        let projectId: string;
        try {
          projectId = decodeURIComponent(entry.name);
        } catch {
          throw new Error("A persisted project directory has an invalid identity.");
        }
        const project = await store.get(projectId);
        if (!project) {
          throw new Error(`Persisted project ${projectId} has no published revision.`);
        }
        projects.push({
          id: project.project.id,
          name: project.project.name,
          revision: project.revision,
          subjectId: project.project.subjectId,
        });
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    projects.sort((left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
    );
    return Object.freeze({
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "available",
      projects: Object.freeze(projects),
    });
  } catch {
    return Object.freeze({
      schemaVersion: "native-workbench-project-catalog/1.0",
      state: "unavailable",
      projects: [] as const,
      reason: "Persisted project revisions could not be reopened exactly.",
    });
  }
}

function captureAt<Kind extends string>(
  controlPlaneRoot: string,
  descriptor: CaptureStoreDescriptor<Kind>,
): FileCaptureStore<Kind> {
  return new FileCaptureStore(rootedCapture(controlPlaneRoot, descriptor));
}

function rootedCapture<Kind extends string>(
  controlPlaneRoot: string,
  descriptor: CaptureStoreDescriptor<Kind>,
): CaptureStoreDescriptor<Kind> {
  return {
    ...descriptor,
    directory: rooted(controlPlaneRoot, descriptor.directory),
    ...(descriptor.syncBoundary === undefined ? {} : {
      syncBoundary: rooted(controlPlaneRoot, descriptor.syncBoundary),
    }),
  };
}

function rooted(controlPlaneRoot: string, relative: string): string {
  const separator = controlPlaneRoot.includes("\\") &&
      !controlPlaneRoot.includes("/")
    ? "\\"
    : "/";
  return joinWorkspace(
    controlPlaneRoot,
    relative.replace(/^\.\//, "").replace(/[\\/]+/gu, separator),
  );
}

function fileUrlPath(url: URL): string {
  const pathname = decodeURIComponent(url.pathname);
  return /^\/[A-Za-z]:\//u.test(pathname)
    ? pathname.slice(1).replace(/\//gu, "\\")
    : pathname;
}

async function readOptionalComponentCatalog(path: string) {
  try {
    const { validateThreadComponentCatalog } = await import(
      "../../../src/domain/thread/thread-component-catalog.ts"
    );
    return validateThreadComponentCatalog(JSON.parse(await Deno.readTextFile(path)));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}
