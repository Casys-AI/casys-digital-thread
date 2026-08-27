/**
 * Build123d capability and CAD project contributions.
 *
 * Profile-only configuration exposes review facts. Isolated execution is
 * wired only when the empty runtime marker is present. Private sandbox
 * admitted export is composed separately from local isolated execution.
 */

import { ExportAdmittedProjectGeometry } from "../../application/use-cases/cad/canonical/export-admitted-project-geometry.ts";
import { PrepareProjectBuild123dExecutionReview } from "../../application/use-cases/cad/isolated/prepare-project-build123d-execution-review.ts";
import { PrepareProjectIsolatedGeometrySealReview } from "../../application/use-cases/cad/sealed-isolated/prepare-project-isolated-geometry-seal-review.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import type { IsolatedOutputPublicationReader } from "../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type { EngineeringProjectCommandService } from "../../application/use-cases/project/engineering-project-command-service.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { parseExactArchitectureCapture } from "../architecture/renderer/architecture-capture.ts";
import type { SysmlSourceAnalysisCaptureService } from "../architecture/renderer/sysml-source-analysis-capture.ts";
import type { CaptureBackedTechnicalCompilationAdmissionReader } from "../compile/admission/capture-backed-technical-compilation-admission-reader.ts";
import { FileByteStore } from "../shared/cas/file-byte-store.ts";
import { fileTextCaptureStore } from "../shared/cas/file-text-capture-store.ts";
import {
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
  GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR,
} from "../shared/cas/file-capture-store.ts";
import { FileIsolatedOutputCas } from "../shared/cas/file-isolated-output-cas.ts";
import { HttpMcpToolClient } from "../shared/mcp/http-mcp-tool-client.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { AdmissionBackedGeometryExportAdapter } from "./canonical/admission-backed-geometry-export-adapter.ts";
import {
  DESIGN_WRITE_GEOMETRY_OPERATION,
  DesignWriteGeometryRunExecutor,
} from "./canonical/design-write-geometry-run-executor.ts";
import { GeometryModuleAssemblyOutputValidator } from "./module-assembly/geometry-module-assembly-output-validator.ts";
import type { Build123dExecutionServerOptions } from "./isolated/build123d-execution-composition.ts";
import type { Build123dExecutionComposition } from "./isolated/build123d-execution-composition.ts";
import {
  FileBuild123dExecutionCaptureStore,
  FileBuild123dExecutionDraftStore,
} from "./isolated/build123d-execution-evidence.ts";
import { FileBuild123dExecutionAttemptStore } from "./isolated/file-build123d-execution-attempt-store.ts";
import {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  DesignExecuteBuild123dRunExecutor,
} from "./isolated/design-execute-build123d-run-executor.ts";
import {
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  DesignSealIsolatedGeometryRunExecutor,
  type IsolatedGeometrySealCaptureStore,
} from "./sealed-isolated/design-seal-isolated-geometry-run-executor.ts";
import { PythonCadSourceAnalyzer } from "./source/python-cad-source-analyzer.ts";
import type { GeometrySourceAnalysisCaptureDependencies } from "./source/geometry-source-analysis-capture.ts";

export {
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  DESIGN_SEAL_ISOLATED_GEOMETRY_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
};

export interface Build123dCapabilityOptions {
  readonly build123dExecution?: Build123dExecutionServerOptions;
  readonly recordedAnalysisDirectory: string;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  };
}

export interface Build123dCapability {
  readonly build123dExecution: Build123dExecutionComposition | undefined;
  readonly build123dExecutionReview:
    | PrepareProjectBuild123dExecutionReview
    | undefined;
  readonly build123dExecutionCaptures: FileBuild123dExecutionCaptureStore;
  readonly isolatedOutputPublications: IsolatedOutputPublicationReader;
  readonly isolatedGeometrySeals: IsolatedGeometrySealCaptureStore;
  readonly isolatedGeometrySealReview: PrepareProjectIsolatedGeometrySealReview;
}

export interface CadProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly executionSnapshots: ThreadSnapshotStore & {
    getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
    latest(subjectId: string): Promise<ThreadSnapshot | undefined>;
    save(snapshot: ThreadSnapshot): Promise<unknown>;
  };
  readonly writeSnapshots: ThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly capability: Build123dCapability;
  /**
   * Optional publication-gated reader for geometry-module assembly STEP/GLB.
   * Never taken from Build123d `isolatedOutputPublications`. Absent means
   * module sealing fails closed. Leaf `design.write-geometry@1` is unchanged.
   */
  readonly moduleAssembly?: IsolatedOutputPublicationReader;
  readonly admissions: CaptureBackedTechnicalCompilationAdmissionReader;
  readonly recordedAnalysisDirectory: string;
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisCaptureService;
  readonly geometryDraftCaptureDirectory: string;
  readonly geometryCaptureDirectory: string;
}

export interface CadProject {
  readonly designExecuteBuild123d: DesignExecuteBuild123dRunExecutor | undefined;
  readonly designSealIsolatedGeometry: DesignSealIsolatedGeometryRunExecutor;
  readonly genericDesignWriteGeometry: DesignWriteGeometryRunExecutor;
  readonly geometrySourceAnalysis: GeometrySourceAnalysisCaptureDependencies;
}

export interface PrivateBuild123dGeometrySurfaces {
  readonly admittedGeometryExport:
    | ExportAdmittedProjectGeometry
    | undefined;
}

export async function createBuild123dCapability(
  options: Build123dCapabilityOptions,
): Promise<Build123dCapability> {
  const build123dExecution = options.build123dExecution === undefined
    ? undefined
    : await (await import(
      "./isolated/build123d-execution-composition.ts"
    )).createBuild123dExecutionComposition(options.build123dExecution, {
      outputCasDirectory: `${options.recordedAnalysisDirectory}/build123d/outputs`,
    });
  const build123dExecutionReview = build123dExecution === undefined
    ? undefined
    : new PrepareProjectBuild123dExecutionReview({
      admissions: options.admissions,
      profiles: build123dExecution.profiles,
    });
  const build123dExecutionCaptures = new FileBuild123dExecutionCaptureStore(
    `${options.recordedAnalysisDirectory}/build123d/captures`,
  );
  const isolatedOutputPublications = build123dExecution?.execution?.publications ??
    new FileIsolatedOutputCas(
      `${options.recordedAnalysisDirectory}/build123d/outputs`,
    );
  const isolatedGeometrySealBytes = new FileByteStore({
    kind: "isolated-geometry-seal-capture",
    directory: `${options.recordedAnalysisDirectory}/isolated-geometry-seals`,
    uriNamespace: "isolated-geometry-seal-capture",
    label: "Sealed isolated geometry document",
  });
  const isolatedGeometrySeals = fileTextCaptureStore(isolatedGeometrySealBytes);
  const isolatedGeometrySealReview = new PrepareProjectIsolatedGeometrySealReview({
    snapshots: options.snapshots,
    captures: build123dExecutionCaptures,
  });
  return {
    build123dExecution,
    build123dExecutionReview,
    build123dExecutionCaptures,
    isolatedOutputPublications,
    isolatedGeometrySeals,
    isolatedGeometrySealReview,
  };
}

export function createCadProject(options: CadProjectOptions): CadProject {
  const { capability } = options;
  const isolatedExecution = capability.build123dExecution?.execution;
  const designExecuteBuild123d = isolatedExecution === undefined ||
      capability.build123dExecution === undefined
    ? undefined
    : new DesignExecuteBuild123dRunExecutor({
      projects: options.projects,
      commands: options.commands,
      snapshots: options.executionSnapshots,
      admissions: options.admissions,
      profiles: capability.build123dExecution.profiles,
      runner: isolatedExecution.runner,
      recovery: isolatedExecution.recovery,
      publications: isolatedExecution.publications,
      attempts: new FileBuild123dExecutionAttemptStore(
        `${options.recordedAnalysisDirectory}/build123d/attempts`,
      ),
      drafts: new FileBuild123dExecutionDraftStore(
        `${options.recordedAnalysisDirectory}/build123d/drafts`,
      ),
      captures: capability.build123dExecutionCaptures,
      lease: options.lease,
    });
  const designSealIsolatedGeometry = new DesignSealIsolatedGeometryRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.executionSnapshots,
    executionCaptures: capability.build123dExecutionCaptures,
    publications: capability.isolatedOutputPublications,
    captures: capability.isolatedGeometrySeals,
    lease: options.lease,
  });
  const geometrySourceAnalysis = {
    sourceCaptures: new FileCaptureStore(GEOMETRY_SOURCE_CAPTURE_DESCRIPTOR),
    analysisCaptures: options.sourceAnalysisCaptures,
    frontend: new PythonCadSourceAnalyzer(),
  } as const;
  const genericDesignWriteGeometry = new DesignWriteGeometryRunExecutor({
    projects: options.projects,
    commands: options.commands,
    snapshots: options.writeSnapshots,
    architectureCaptures: options.architectureCaptures,
    sysmlSourceAnalysis: options.sysmlSourceAnalysis,
    geometryDraftCaptures: new FileCaptureStore({
      ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
      directory: options.geometryDraftCaptureDirectory,
    }),
    geometrySourceCaptures: geometrySourceAnalysis.sourceCaptures,
    sourceAnalysisCaptures: geometrySourceAnalysis.analysisCaptures,
    geometryCaptures: new FileCaptureStore({
      ...GEOMETRY_CAPTURE_DESCRIPTOR,
      directory: options.geometryCaptureDirectory,
    }),
    admissions: options.admissions,
    moduleAssemblyPublications: options.moduleAssembly,
    moduleAssemblyOutputValidator: new GeometryModuleAssemblyOutputValidator(),
    lease: options.lease,
    now: () => new Date().toISOString(),
  });
  return {
    designExecuteBuild123d,
    designSealIsolatedGeometry,
    genericDesignWriteGeometry,
    geometrySourceAnalysis,
  };
}

/**
 * WHY THE SANDBOX INSTANCE AND NOT THE TRUSTED ONE — admitted export
 * reopens sealed CAD bytes. A fingerprint proves identity after sealing,
 * never causal provenance. The sandbox owns a private export volume, so
 * those bytes never touch evidence. No sandbox entry ⇒ no admitted-export
 * tool. It is not gated on --local-execution.
 */
export function composePrivateBuild123dGeometrySurfaces(
  build123dSandboxMcpUrl: string | undefined,
  geometrySourceAnalysis: GeometrySourceAnalysisCaptureDependencies,
  admissions: CaptureBackedTechnicalCompilationAdmissionReader,
  snapshots: Pick<ThreadSnapshotStore, "get">,
  architectureCaptures: FileCaptureStore<"architecture-capture">,
  geometryDraftCaptureDirectory: string,
  geometryCaptureDirectory: string,
): PrivateBuild123dGeometrySurfaces {
  if (!build123dSandboxMcpUrl) {
    return { admittedGeometryExport: undefined };
  }
  const client = new HttpMcpToolClient({
    mcpUrl: build123dSandboxMcpUrl,
    timeoutMs: 120_000,
  });
  const draftCaptures = new FileCaptureStore({
    ...GEOMETRY_DRAFT_CAPTURE_DESCRIPTOR,
    directory: geometryDraftCaptureDirectory,
  });
  const geometryCaptures = new FileCaptureStore({
    ...GEOMETRY_CAPTURE_DESCRIPTOR,
    directory: geometryCaptureDirectory,
  });
  return {
    admittedGeometryExport: new ExportAdmittedProjectGeometry({
      admissions,
      snapshots,
      geometryCaptures,
      architecture: {
        async read(fingerprint) {
          const text = await architectureCaptures.read(fingerprint);
          if (!text) return undefined;
          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            return undefined;
          }
          try {
            const capture = parseExactArchitectureCapture(parsed);
            return {
              partDefinitions: capture.partDefinitions.map((definition) => ({
                id: definition.id,
                label: definition.label,
                usages: definition.usages.map((usage) => ({
                  id: usage.id,
                  label: usage.label,
                  targetId: usage.targetId,
                })),
              })),
            };
          } catch {
            return undefined;
          }
        },
      },
      exporter: new AdmissionBackedGeometryExportAdapter({
        client,
        draftCaptures,
        sourceAnalysis: geometrySourceAnalysis,
        build123dService: "mcp-build123d-sandbox",
      }),
    }),
  };
}
