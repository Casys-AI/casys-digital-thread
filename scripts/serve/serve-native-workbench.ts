import { parseArgs } from "../lib/cli.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/application/ports/out/engineering-project-revision-store.ts";
import {
  collectEngineeringProjectThreadReferenceIssues,
  validateEngineeringProjectSnapshot,
} from "../../src/domain/project/engineering-project-validation.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/shared/stores/file-thread-snapshot-store.ts";
import { FileCockpitFocusStore } from "../../src/adapters/project/file-cockpit-focus-store.ts";
import type { CockpitFocusStore } from "../../src/application/ports/out/project/cockpit-focus-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
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
} from "../../src/adapters/shared/cas/file-capture-store.ts";
import { FileProjectSourceWorkspaceStore } from "../../src/adapters/project-source-workspace/file-project-source-workspace-store.ts";
import { DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY } from "../../src/adapters/project-source-workspace/server-composition.ts";
import {
  requireSysmlSourceAnalysis,
  type SysmlSourceAnalysisReader,
} from "../../src/adapters/architecture/renderer/sysml-source-analysis-capture.ts";
import { GEOMETRY_DRAFT_ASSETS_DIR } from "../../src/adapters/cad/canonical/geometry-draft-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/shared/stores/engineering-project-store.ts";
import { isExplicitLoopbackHostname } from "../../src/adapters/loopback-host.ts";
import {
  type EngineeringWorkbenchSnapshot,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "../../src/adapters/thread/engineering-workbench-projector.ts";
import { REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER } from "../../src/orchestration/operations/path-lanes.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../../src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../../src/adapters/shared/stores/thread-snapshot-lineage.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/architecture/renderer/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/cad/canonical/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/architecture/requirements/requirements-proposal.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../src/domain/architecture/seed/syson-model-seed.ts";
import { COMPILE_SEAL_ADMISSION_OPERATION } from "../../src/domain/compile/admission/technical-compilation-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../src/domain/cad/isolated/build123d-execution-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
} from "../../src/domain/fea/seal-case/fea-proof-proposal.ts";
import { SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION } from "../../src/domain/modelica/qualified-kit/run-proposal.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../src/domain/modelica/admitted/run-proposal.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../src/domain/thread/thread-retirement.ts";
import {
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
} from "../../src/domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
} from "../../src/orchestration/operations/fea-isolated-static-proof.ts";
import {
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
} from "../../src/domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../../src/adapters/engineering-asset-resolver.ts";
import { projectThreadWorkbenchSnapshot } from "../../src/adapters/thread/thread-workbench-projector.ts";
import { FileByteStore } from "../../src/adapters/shared/cas/file-byte-store.ts";
import { fileArchitectureSysmlSealCaptureReader } from "../../src/adapters/architecture/agent-seal/file-architecture-sysml-seal-capture-reader.ts";
import { createArchitectureSysmlSourceAnalysisCaptureService } from "../../src/adapters/architecture/agent-seal/architecture-sysml-source-analysis-composition.ts";
import { enrichThreadWorkbenchWithArchitectureSysmlSeals } from "../../src/adapters/thread/architecture-sysml-seal-workbench-enricher.ts";
import {
  enrichThreadWorkbenchWithTechnicalAdmissions,
  type SealedCadLeverAdmissionReader,
  type TechnicalAdmissionWorkbenchEnricherDependencies,
} from "../../src/adapters/thread/technical-admission-workbench-enricher.ts";
import {
  type EngineeringCaseWorkbenchEnricherDependencies,
  enrichThreadWorkbenchWithEngineeringCases,
} from "../../src/adapters/thread/verification-case-workbench-enricher.ts";
import {
  enrichThreadWorkbenchWithRequirementsTargets,
  type RequirementsCaptureReader,
} from "../../src/adapters/thread/requirements-target-workbench-enricher.ts";
import { CaptureProductStructureTraversal } from "../../src/adapters/architecture/renderer/capture-product-structure-traversal.ts";
import { ProjectProductNavigation } from "../../src/application/use-cases/product-navigation/project-product-navigation.ts";
import type { ProductNavigationUseCase } from "../../src/application/ports/in/product-navigation/product-navigation.ts";
import { WorkbenchProductNavigationEvidenceAttachmentReader } from "../../src/adapters/thread/product-navigation-workbench.ts";
import { ProjectSourceWorkspaceAuthoringAttachmentReader } from "../../src/adapters/project-source-workspace/product-navigation-authoring-attachment-reader.ts";
import {
  PROJECT_SOURCE_WORKSPACE_BOUNDS,
  ProjectSourceWorkspaceError,
} from "../../src/domain/project-source-workspace/types.ts";
import {
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  type ProductExploreResult,
  unavailableExplore,
  unavailableProductNavigationProjection,
} from "../../src/application/ports/in/product-navigation/product-navigation-read-model.ts";
import {
  productStructureElementRef,
  productStructureElementRefsEqual,
  type ProductStructureOccurrenceRef,
} from "../../src/domain/architecture/product-structure-ref.ts";
import {
  enrichThreadWorkbenchWithEvaluationCloseouts,
  type EvaluationCloseoutCaptureReader,
} from "../../src/adapters/thread/evaluation-closeout-workbench-enricher.ts";
import {
  type AssemblyIntegrityWorkbenchCaptureReaders,
  enrichThreadWorkbenchWithAssemblyIntegrity,
} from "../../src/adapters/thread/assembly-integrity-workbench-enricher.ts";
import { readDeclaredCockpitFleet } from "../../src/adapters/thread/cockpit-fleet-projector.ts";
import type { CockpitFleetProjection } from "../../src/presentation/workbench/fleet/projection.ts";
import type { ArchitectureSysmlSealCaptureReader } from "../../src/application/ports/out/architecture/agent-seal/architecture-sysml-seal-capture-reader.ts";
import type { ArchitectureSysmlSourceAnalysisReader } from "../../src/application/ports/out/architecture/agent-seal/architecture-sysml-source-analysis-reader.ts";
import {
  FileLiveThreadUpdateStore,
  type LiveThreadUpdate,
  type LiveThreadUpdateJournal,
  overlayLiveThreadUpdates,
} from "../../src/adapters/shared/stores/live-thread-update-store.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../src/domain/thread/thread-component-catalog.ts";
import type {
  GenericArchitectureCaptureReader,
} from "../../src/adapters/architecture/renderer/product-structure-catalog.ts";
import { resolveGenericProductStructureCatalog } from "../../src/adapters/architecture/renderer/product-structure-catalog.ts";
import type { GenericGeometryCaptureReader } from "../../src/adapters/cad/canonical/geometry-bundle-product-catalog.ts";

// ── Catalog resolution: generic active-project projection ────────────────────

/**
 * Resolve a snapshot-bound component catalog from generic, exact architecture
 * evidence. Archived golden projects do not participate in the active BFF.
 *
 * Exported so it can be unit-tested without an HTTP layer.
 */
export async function resolveSnapshotComponentCatalog(
  snapshot: ThreadSnapshot,
  archCaptures: GenericArchitectureCaptureReader,
  geometryCaptures?: GenericGeometryCaptureReader,
  sysmlSourceAnalysis?: SysmlSourceAnalysisReader,
): Promise<ThreadComponentCatalog | undefined> {
  return await resolveGenericProductStructureCatalog(
    snapshot,
    archCaptures,
    geometryCaptures,
    sysmlSourceAnalysis,
  );
}

export interface NativeWorkbenchHandlerOptions {
  store: ThreadSnapshotStore;
  /** Read-side capability only; project commands stay in the paired MCP. */
  projectStore: Pick<EngineeringProjectRevisionStore, "get">;
  /** EngineeringProject identity; never inferred from a thread subject. */
  projectId?: string;
  /** Agent-selected durable target. The BFF reads it, never mutates it. */
  cockpitFocus?: CockpitFocusStore;
  workspaceId?: string;
  /** Active store plus optional exact, versioned project baselines. */
  projectSnapshots?: ExactThreadSnapshotReader;
  /** Optional for a focused workspace whose durable focus supplies the project. */
  subjectId?: string;
  html?: string;
  /** When set, each GET re-reads the cockpit HTML so a rebuild is visible. */
  htmlPath?: string;
  /**
   * Directory of the Vite multi-file dist (`native-workbench.html` + hashed
   * JS/CSS). Defaults to the directory of `htmlPath`. The browser never
   * receives a command route through these files.
   */
  uiAssetDirectory?: string;
  componentCatalog?: ThreadComponentCatalog;
  componentCatalogForSubject?: (
    subjectId: string,
  ) => Promise<ThreadComponentCatalog | undefined>;
  /**
   * Snapshot-bound catalogs may only be derived from evidence in that exact
   * revision. They take precedence over a static subject catalog when present.
   */
  componentCatalogForSnapshot?: (
    snapshot: ThreadSnapshot,
  ) => Promise<ThreadComponentCatalog | undefined>;
  /**
   * Optional CAS reopen of `model.seal-architecture-sysml@1` Thread documents.
   * The pure projector never reads these stores.
   */
  architectureSysmlSeals?: ArchitectureSysmlSealCaptureReader;
  architectureSysmlSources?: ArchitectureSysmlSourceAnalysisReader;
  /**
   * Optional CAS reopen of `compile.seal-admission@3` Thread documents.
   * The pure projector never reads this store.
   */
  technicalCompilationAdmissions?: SealedCadLeverAdmissionReader;
  /**
   * Optional exact ProjectSourceWorkspace recross for source-file projection.
   * Absent means source-file attachments stay unavailable.
   */
  projectSourceWorkspace?: TechnicalAdmissionWorkbenchEnricherDependencies["workspace"];
  /** Optional exact CAS reopen of `model.write-requirements@1` captures. */
  requirementsCaptures?: RequirementsCaptureReader;
  /**
   * Optional exact architecture-capture/4.0 reopen for the product-navigation
   * GET slice. Same application port as MCP read tools. Workbench stays GET/SSE.
   */
  productStructureCaptures?: GenericArchitectureCaptureReader;
  geometryCaptures?: GenericGeometryCaptureReader;
  sysmlSourceAnalysis?: SysmlSourceAnalysisReader;
  /** Optional exact CAS reopen of supported sealed engineering cases. */
  engineeringCaseCaptures?: EngineeringCaseWorkbenchEnricherDependencies;
  /** Optional exact CAS reopen of provider-free static-mechanical L5 records. */
  evaluationCloseoutCaptures?: EvaluationCloseoutCaptureReader;
  /**
   * Optional exact CAS reopen of the versioned assembly-integrity L3/L4/L5
   * chain. The Workbench remains a GET/SSE projection and never dispatches it.
   */
  assemblyIntegrityCaptures?: AssemblyIntegrityWorkbenchCaptureReaders;
  /** Optional non-canonical activity journal projected into the same feed. */
  liveUpdates?: LiveThreadUpdateJournal;
  assetReader?: (filename: string) => Promise<Uint8Array | undefined>;
  /** Testable boundary for content-addressed, non-canonical geometry previews. */
  draftAssetReader?: (digest: string) => Promise<Uint8Array | undefined>;
  /** Polling only observes persisted snapshots; it never executes a tool. */
  pollIntervalMs?: number;
  /**
   * Declared fleet topology for GET `/api/fleet`. Identity fields only;
   * missing or unreadable manifests resolve to 404 so the cockpit degrades
   * to thread-observed systems. Never live health.
   */
  cockpitFleet?: () => Promise<CockpitFleetProjection | undefined>;
  /**
   * Sanitized persisted-project index for an unfocused Desktop workspace.
   * This is a read-only navigation projection, never a focus mutation.
   */
  projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>;
}

export interface NativeWorkbenchProjectCatalogItem {
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly subjectId: string;
}

export type NativeWorkbenchProjectCatalog =
  | {
    readonly schemaVersion: "native-workbench-project-catalog/1.0";
    readonly state: "available";
    readonly projects: readonly NativeWorkbenchProjectCatalogItem[];
  }
  | {
    readonly schemaVersion: "native-workbench-project-catalog/1.0";
    readonly state: "unavailable";
    readonly projects: readonly [];
    readonly reason: string;
  };

/**
 * A caller that names a project does not also have to know the project's
 * internal thread-subject identity.
 */
export function resolveNativeWorkbenchProjectId(
  explicitProjectId: string | undefined,
  _explicitSubjectId: string | undefined,
): string | undefined {
  return explicitProjectId;
}

export interface NativeWorkbenchStartupTarget {
  readonly hostname: string;
  readonly port: number;
  /** Kept for CLI compatibility; the native Workbench is always read-only. */
  readonly noSeed: true;
  readonly workspaceId?: string;
  readonly projectId?: string;
  readonly explicitSubjectId?: string;
}

/**
 * Resolve the BFF's startup target without touching project state.
 *
 * The Workbench is read-only. It requires an explicit fixed target or a
 * durable cockpit focus; it never substitutes a bootstrap project or seeds a
 * project revision.
 */
export function resolveNativeWorkbenchStartupTarget(
  cliArgs: Readonly<Record<string, string | undefined>>,
): NativeWorkbenchStartupTarget {
  const hostname = cliArgs["host"] ?? "127.0.0.1";
  if (!isExplicitLoopbackHostname(hostname)) {
    throw new TypeError(
      "--host must be an explicit loopback hostname (127.0.0.1, localhost, or ::1).",
    );
  }
  // Preserve strict validation of the legacy flag while keeping startup
  // read-only regardless of whether callers include it.
  booleanFlag("no-seed", cliArgs);
  const workspaceId = cliArgs["workspace-id"];
  const explicitProjectId = cliArgs["project-id"];
  const explicitSubjectId = cliArgs["subject"];
  if (explicitSubjectId !== undefined && explicitProjectId === undefined) {
    throw new TypeError("--subject requires --project-id.");
  }
  if (
    workspaceId === undefined && explicitProjectId === undefined
  ) {
    throw new TypeError(
      "--workspace-id or --project-id is required; no bootstrap project is configured.",
    );
  }
  const focusOnly = workspaceId !== undefined &&
    explicitProjectId === undefined && explicitSubjectId === undefined;
  return {
    hostname,
    port: integerArgument("port", cliArgs) ?? 5175,
    noSeed: true,
    workspaceId,
    projectId: focusOnly ? undefined : resolveNativeWorkbenchProjectId(
      explicitProjectId,
      explicitSubjectId,
    ),
    explicitSubjectId,
  };
}

type ResolvedActiveProject = {
  readonly kind: "project";
  readonly projectId: string;
  readonly project: EngineeringProjectSnapshot;
  readonly subjectId: string;
  readonly componentCatalog?: ThreadComponentCatalog;
};

type ActiveTargetResolution = ResolvedActiveProject;

async function resolveActiveProject(
  options: NativeWorkbenchHandlerOptions,
): Promise<ActiveTargetResolution> {
  const focus = await options.cockpitFocus?.get(
    options.workspaceId ?? "primary",
  );
  const projectId = focus?.target.projectId ?? configuredProjectId(options);
  const project = await options.projectStore.get(projectId);
  if (!project) throw new NativeWorkbenchProjectNotFoundError(projectId);
  const subjectId = focus
    ? project.project.subjectId
    : options.subjectId ?? project.project.subjectId;
  if (project.project.subjectId !== subjectId) {
    throw new Error(
      `Engineering project subject ${project.project.subjectId} does not match resolved Workbench subject ${subjectId}.`,
    );
  }
  return {
    kind: "project",
    projectId,
    project,
    subjectId,
    componentCatalog: await options.componentCatalogForSubject?.(subjectId),
  };
}

class NativeWorkbenchProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Engineering project ${projectId} was not found.`);
    this.name = "NativeWorkbenchProjectNotFoundError";
  }
}

/**
 * An explicitly supplied subject remains an operator override. Otherwise the
 * persisted project is authoritative and supplies its own durable subject id.
 */
export async function resolveNativeWorkbenchSubjectId(
  projectId: string,
  explicitSubjectId: string | undefined,
  projectStore: Pick<EngineeringProjectRevisionStore, "get">,
): Promise<string> {
  if (explicitSubjectId !== undefined) return explicitSubjectId;
  const project = await projectStore.get(projectId);
  if (!project) {
    throw new Error(
      `Engineering project ${projectId} was not found while resolving its Workbench subject.`,
    );
  }
  return project.project.subjectId;
}

export function createNativeWorkbenchHandler(
  options: NativeWorkbenchHandlerOptions,
): (request: Request) => Promise<Response> {
  const navigation = composeProductNavigation(options);
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") {
      if (request.method !== "GET") return methodNotAllowed();
      return json({ status: "ok", service: "native-workbench" }, 200);
    }
    if (url.pathname.startsWith("/api/thread/assets/")) {
      if (request.method !== "GET") return methodNotAllowed();
      return serveThreadAsset(url.pathname, options.assetReader);
    }
    if (url.pathname.startsWith("/api/draft-assets/")) {
      if (request.method !== "GET") return methodNotAllowed();
      return serveDraftAsset(url.pathname, options.draftAssetReader);
    }
    if (url.pathname === "/api/fleet") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveCockpitFleet(options);
    }
    if (url.pathname === "/api/projects") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProjectCatalog(options);
    }
    if (url.pathname === "/api/thread/product-navigation") {
      if (request.method !== "GET") return methodNotAllowed();
      return await serveProductNavigationQuery(url, options, navigation);
    }
    if (url.pathname === "/api/thread/workbench/events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await snapshotEventStream(request, options, navigation);
    }
    if (url.pathname === "/api/thread/workbench") {
      if (request.method !== "GET") return methodNotAllowed();
      let context: ActiveTargetResolution;
      try {
        context = await resolveActiveProject(options);
      } catch (error) {
        if (error instanceof NativeWorkbenchProjectNotFoundError) {
          return projectNotFound(error.projectId);
        }
        throw error;
      }
      const snapshot = await resolveCurrentThreadSnapshot(
        context.project,
        options,
        context.subjectId,
      );
      if (!snapshot && context.project.threadSnapshots.length > 0) {
        return json({
          error: "thread_snapshot_not_found",
          subjectId: context.subjectId,
        }, 404);
      }
      const projection = await projectWorkbenchSnapshot(
        context.project,
        snapshot,
        options,
        context.subjectId,
        context.componentCatalog,
        undefined,
        navigation,
      );
      return json(
        projection,
        200,
        {
          "X-Casys-Data-Source": workbenchDataSource(projection),
        },
      );
    }
    if (url.pathname === "/" || url.pathname === "/native-workbench.html") {
      if (request.method !== "GET") return methodNotAllowed();
      const html = options.htmlPath
        ? await Deno.readTextFile(options.htmlPath)
        : options.html ?? "";
      return new Response(html, {
        headers: workbenchDocumentHeaders({
          "Content-Type": "text/html; charset=utf-8",
        }),
      });
    }
    if (request.method === "GET") {
      const asset = await serveWorkbenchUiAsset(url.pathname, options);
      if (asset) return asset;
    }
    return new Response("Not found", { status: 404 });
  };
}

async function snapshotEventStream(
  request: Request,
  options: NativeWorkbenchHandlerOptions,
  navigation: ProductNavigationUseCase | undefined,
): Promise<Response> {
  let initial: ActiveTargetResolution;
  try {
    initial = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  let current = initial;
  const encoder = new TextEncoder();
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  let lastEventId = request.headers.get("Last-Event-ID") ?? "";
  let cancelled = false;
  let lastWrite = Date.now();

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const run = async () => {
        // Deno.serve's legacy request signal aborts after a successful handler
        // return, even while a streaming response is still open. Stream
        // cancellation is the reliable browser-disconnect signal here.
        while (!cancelled) {
          let latestProject: ActiveTargetResolution;
          try {
            latestProject = await resolveActiveProject(options);
          } catch (error) {
            if (!(error instanceof NativeWorkbenchProjectNotFoundError)) {
              throw error;
            }
            await waitForPoll(pollIntervalMs);
            continue;
          }
          if (latestProject.projectId !== current.projectId) {
            const targetId = `focus:project:${latestProject.projectId}`;
            if (targetId !== lastEventId) {
              controller.enqueue(encoder.encode(
                `id: ${targetId}\nevent: cockpit-focus\ndata: ${
                  JSON.stringify({ target: publicFocusTarget(latestProject) })
                }\n\n`,
              ));
              lastEventId = targetId;
              lastWrite = Date.now();
            }
            current = latestProject;
            await waitForPoll(pollIntervalMs);
            continue;
          }
          const liveUpdates = await options.liveUpdates?.list(current.subjectId) ?? [];
          // A manifest removed during an established stream cannot revoke the
          // last valid event. A reconnect will receive an explicit 404.
          current = latestProject;
          const snapshot = await resolveCurrentThreadSnapshot(
            current.project,
            options,
            current.subjectId,
          );
          const liveVersion = liveUpdates.at(-1)?.sequence ?? 0;
          const workspaceIdentity = await currentProjectSourceWorkspaceHeadIdentity(
            current.projectId,
            options,
          );
          const focusPrefix = options.cockpitFocus ? `${current.projectId}:` : "";
          const eventId = snapshot
            ? `${focusPrefix}${current.project.revision}:${snapshot.revision}:${liveVersion}:${workspaceIdentity}`
            : `planning:${focusPrefix}${current.project.revision}:${liveVersion}:${workspaceIdentity}`;
          if (eventId !== lastEventId) {
            const projection = await projectWorkbenchSnapshot(
              current.project,
              snapshot,
              options,
              current.subjectId,
              current.componentCatalog,
              liveUpdates,
              navigation,
            );
            controller.enqueue(encoder.encode(
              `id: ${eventId}\nevent: workbench-snapshot\ndata: ${
                JSON.stringify(projection)
              }\n\n`,
            ));
            lastEventId = eventId;
            lastWrite = Date.now();
          } else if (Date.now() - lastWrite >= 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastWrite = Date.now();
          }
          await waitForPoll(pollIntervalMs);
        }
      };
      void run().then(() => {
        try {
          controller.close();
        } catch {
          // The browser may have cancelled the stream first.
        }
      }).catch((error) => {
        try {
          controller.error(error);
        } catch {
          // The browser may have cancelled the stream first.
        }
      });
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(body, {
    headers: workbenchReadHeaders({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    }),
  });
}

async function currentProjectSourceWorkspaceHeadIdentity(
  projectId: string,
  options: NativeWorkbenchHandlerOptions,
): Promise<string> {
  if (!options.projectSourceWorkspace) return "workspace:none";
  const workspace = await options.projectSourceWorkspace.load(projectId);
  const fingerprint = workspace.lastEventFingerprint;
  return fingerprint
    ? `workspace:${workspace.workspaceRevision}:${fingerprint.algorithm}:${fingerprint.digest}`
    : `workspace:${workspace.workspaceRevision}:empty`;
}

async function projectWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot | undefined,
  options: NativeWorkbenchHandlerOptions,
  subjectId: string,
  componentCatalog?: ThreadComponentCatalog,
  liveUpdates?: LiveThreadUpdate[],
  navigation?: ProductNavigationUseCase,
): Promise<EngineeringWorkbenchSnapshot> {
  if (!snapshot) {
    if (project.threadSnapshots.length > 0) {
      throw new Error(
        "A declared technical baseline could not be resolved for this project.",
      );
    }
    if (project.project.subjectId !== subjectId) {
      throw new Error(
        `Engineering project subject ${project.project.subjectId} does not match resolved Workbench subject ${subjectId}.`,
      );
    }
    return projectEngineeringPlanningWorkbenchSnapshot(
      project,
      liveUpdates ?? (await options.liveUpdates?.list(subjectId) ?? []),
    );
  }
  const declaredSnapshots = await Promise.all(
    project.threadSnapshots.map((reference) =>
      reference.snapshotId === snapshot.id &&
        reference.revision === snapshot.revision
        ? Promise.resolve(snapshot)
        : (options.projectSnapshots ?? options.store).get(reference.snapshotId)
    ),
  );
  // Structural corruption stays fail-fast, but a dangling evidence link (for
  // example a decision left behind by an abandoned work item) must not hide
  // the whole read-only projection: label it on the snapshot instead.
  const validatedProject = validateEngineeringProjectSnapshot(project);
  const unresolvedEvidenceReferences = collectEngineeringProjectThreadReferenceIssues(
    validatedProject,
    declaredSnapshots.filter(
      (candidate): candidate is ThreadSnapshot => candidate !== undefined,
    ),
  ).map((issue) => ({ path: issue.path, message: issue.message }));
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  return projectEngineeringWorkbenchSnapshot(
    validatedProject,
    await projectThreadSnapshot(
      snapshot,
      options,
      validatedProject.project.id,
      subjectId,
      componentCatalog,
      updates,
      navigation,
    ),
    snapshot.revision,
    updates,
    unresolvedEvidenceReferences,
    REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER,
  );
}

async function resolveDeclaredProjectHead(
  project: EngineeringProjectSnapshot,
  options: NativeWorkbenchHandlerOptions,
): Promise<ThreadSnapshot | undefined> {
  const reference =
    [...project.threadSnapshots].sort((left, right) =>
      right.revision - left.revision ||
      right.snapshotId.localeCompare(left.snapshotId)
    )[0];
  if (!reference) return undefined;
  const snapshot = await (options.projectSnapshots ?? options.store).get(
    reference.snapshotId,
  );
  if (
    snapshot &&
    (snapshot.id !== reference.snapshotId ||
      snapshot.revision !== reference.revision ||
      snapshot.subject.id !== reference.subjectId)
  ) {
    throw new Error(
      `Declared ThreadSnapshot ${reference.snapshotId}@${reference.revision} resolved to a different snapshot.`,
    );
  }
  return snapshot;
}

async function resolveCurrentThreadSnapshot(
  project: EngineeringProjectSnapshot,
  options: NativeWorkbenchHandlerOptions,
  subjectId: string,
): Promise<ThreadSnapshot | undefined> {
  // Before the first deterministic operation publishes a declared baseline,
  // an intent-only project is not allowed to borrow a current subject head.
  if (project.threadSnapshots.length === 0) return undefined;
  const [active, declared] = await Promise.all([
    options.store.latest(subjectId),
    resolveDeclaredProjectHead(project, options),
  ]);
  if (!active) return declared;
  if (!declared) return active;
  if (active.revision === declared.revision && active.id !== declared.id) {
    throw new Error(
      `Ambiguous ThreadSnapshot revision ${active.revision}: active ${active.id} conflicts with declared ${declared.id}.`,
    );
  }
  if (active.revision <= declared.revision) return declared;
  // A known durable-writer operation can make a next ThreadSnapshot durable before
  // completeRun attaches that exact reference to the project. A crash in that
  // narrow interval must not let an undeclared descendant become canonical in
  // the browser. Keep the declared head on screen; projectWorkbenchSnapshot
  // still overlays the bounded live journal onto it. The durable result
  // becomes eligible only after completeRun records its exact reference in
  // immutable project state.
  if (hasUnattachedDurableProjectOperation(project)) return declared;
  const lineageSnapshots = new OrderedExactThreadSnapshotReader([
    options.store,
    ...(options.projectSnapshots ? [options.projectSnapshots] : []),
  ]);
  return await threadSnapshotDescendsFrom(
      active,
      declared,
      lineageSnapshots,
    )
    ? active
    : declared;
}

/**
 * These exact server-owned operations persist a Thread successor before
 * completeRun attaches its reference to immutable project state. A
 * forward head is therefore not browser-canonical while one is still active.
 * Additions are intentionally explicit: a registered operation alone does
 * not establish this persistence ordering.
 */
const DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS = [
  SYSON_MODEL_SEED_OPERATION,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  VERIFY_SEAL_PROOF_CASE_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_OPERATION,
  COMPILE_SEAL_ADMISSION_OPERATION,
  DESIGN_EXECUTE_BUILD123D_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V2_OPERATION,
  SIMULATE_RUN_QUALIFIED_MODELICA_KIT_OPERATION,
  SIMULATE_RUN_ADMITTED_MODELICA_OPERATION,
  VERIFY_RUN_FEA_STATIC_PROOF_V3_OPERATION,
  ARCHIVE_LINEAGE_OPERATION,
  ANALYZE_SEAL_SENSITIVITY_STUDY_OPERATION,
  ANALYZE_RUN_FEA_SENSITIVITY_OPERATION,
  MODEL_WRITE_SENSITIVITY_EDGES_OPERATION,
  DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
  DECIDE_REJECT_EVALUATION_CLOSEOUT_OPERATION,
] as const;

function hasUnattachedDurableProjectOperation(
  project: EngineeringProjectSnapshot,
): boolean {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  return project.agentRuns.some((run) => {
    if (!isAwaitingDurableProjectAttachment(run.status)) {
      return false;
    }
    const operation = workItems.get(run.workItemId)?.operation;
    return DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS.some((candidate) =>
      operation?.id === candidate.id && operation.version === candidate.version
    );
  });
}

/** Test seam for the explicit durable-writer allowlist used by the browser. */
export function hasUnattachedDurableProjectOperationForTest(
  project: EngineeringProjectSnapshot,
): boolean {
  return hasUnattachedDurableProjectOperation(project);
}

function isAwaitingDurableProjectAttachment(
  status: EngineeringProjectSnapshot["agentRuns"][number]["status"],
): boolean {
  return status === "queued" || status === "running" ||
    status === "waiting-for-decision" || status === "publishing" ||
    // Defensive legacy/recovery guard: older executors could mark a run
    // failed after save(snapshot) succeeded but before readback. A failed
    // durable-writer operation never authorizes an unattached descendant.
    status === "failed";
}

function workbenchDataSource(projection: EngineeringWorkbenchSnapshot): string {
  if (projection.surface === "planning") {
    return "engineering-project-plan";
  }
  if (projection.surface === "documentary") {
    return "engineering-project-documentary-baseline";
  }
  return projection.thread.live.active.length
    ? "canonical-thread-snapshot+live-updates"
    : "canonical-thread-snapshot";
}

async function projectThreadSnapshot(
  snapshot: ThreadSnapshot,
  options: NativeWorkbenchHandlerOptions,
  projectId: string,
  subjectId: string,
  componentCatalog: ThreadComponentCatalog | undefined,
  liveUpdates?: LiveThreadUpdate[],
  navigation?: ProductNavigationUseCase,
) {
  const evidenceCatalog = await options.componentCatalogForSnapshot?.(snapshot);
  const projected = projectThreadWorkbenchSnapshot(
    snapshot,
    evidenceCatalog ?? componentCatalog ??
      (subjectId === options.subjectId ? options.componentCatalog : undefined),
  );
  const withArchitecture =
    options.architectureSysmlSeals && options.architectureSysmlSources
      ? await enrichThreadWorkbenchWithArchitectureSysmlSeals(projected, {
        seals: options.architectureSysmlSeals,
        sources: options.architectureSysmlSources,
      })
      : projected;
  const withAdmissions = options.technicalCompilationAdmissions
    ? await enrichThreadWorkbenchWithTechnicalAdmissions(
      withArchitecture,
      {
        admissions: options.technicalCompilationAdmissions,
        workspace: options.projectSourceWorkspace,
      },
      { projectId },
    )
    : withArchitecture;
  const withRequirements = options.requirementsCaptures
    ? await enrichThreadWorkbenchWithRequirementsTargets(
      withAdmissions,
      options.requirementsCaptures,
      snapshot,
    )
    : withAdmissions;
  const withEngineeringCases = options.engineeringCaseCaptures
    ? await enrichThreadWorkbenchWithEngineeringCases(
      withRequirements,
      options.engineeringCaseCaptures,
      { projectId },
    )
    : withRequirements;
  const withCases = options.evaluationCloseoutCaptures
    ? await enrichThreadWorkbenchWithEvaluationCloseouts(
      withEngineeringCases,
      options.evaluationCloseoutCaptures,
    )
    : withEngineeringCases;
  const withAssemblyIntegrity = options.assemblyIntegrityCaptures
    ? await enrichThreadWorkbenchWithAssemblyIntegrity(
      withCases,
      options.assemblyIntegrityCaptures,
    )
    : withCases;
  const canonical = navigation
    ? {
      ...withAssemblyIntegrity,
      productNavigation: await navigation.projection({ projectId }),
    }
    : withAssemblyIntegrity;
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  return overlayLiveThreadUpdates(
    canonical,
    snapshot.revision,
    updates,
    updates.at(-1)?.sequence ?? 0,
  );
}

function composeProductNavigation(
  options: NativeWorkbenchHandlerOptions,
): ProductNavigationUseCase | undefined {
  const captures = options.productStructureCaptures;
  if (!captures) return undefined;
  return new ProjectProductNavigation({
    projects: options.projectStore,
    snapshots: options.store,
    traversal: new CaptureProductStructureTraversal(
      captures,
      options.sysmlSourceAnalysis,
    ),
    workspace: options.projectSourceWorkspace,
    evidenceAttachments: new WorkbenchProductNavigationEvidenceAttachmentReader({
      architectureCaptures: captures,
      geometryCaptures: options.geometryCaptures,
      sysmlSourceAnalysis: options.sysmlSourceAnalysis,
      admissions: options.technicalCompilationAdmissions,
      workspace: options.projectSourceWorkspace,
      requirementsCaptures: options.requirementsCaptures,
      engineeringCases: options.engineeringCaseCaptures,
    }),
    authoringAttachments: options.projectSourceWorkspace
      ? new ProjectSourceWorkspaceAuthoringAttachmentReader(
        options.projectSourceWorkspace,
      )
      : undefined,
  });
}

async function serveProductNavigationQuery(
  url: URL,
  options: NativeWorkbenchHandlerOptions,
  navigation: ProductNavigationUseCase | undefined,
): Promise<Response> {
  if (!navigation) {
    return json(unavailableProductNavigationProjection(), 200);
  }
  let context: ActiveTargetResolution;
  try {
    context = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  const projectId = context.projectId;
  const view = url.searchParams.get("view");
  if (view === "authoring-attachments" || view === "context") {
    return await serveInspectQuery(url, navigation, projectId);
  }
  if (view === "children" || view === "neighborhood") {
    const occurrence = occurrenceFromQuery(url);
    if (occurrence === "invalid") return invalidExactElementPath();
    if (occurrence === "missing") {
      return invalidAuthoringAttachmentsQuery(
        "id must be an exact SysML element identity. latest is refused.",
      );
    }
    if (occurrence === "kind-invalid") {
      return invalidAuthoringAttachmentsQuery(
        "kind must be part-definition or part-usage. latest is refused.",
      );
    }
    if (occurrence.kind === "semantic-root") {
      return json(
        exactSemanticRootExplore(
          await navigation.explore({ projectId }),
          occurrence.elementId,
        ),
        200,
      );
    }
    return json(
      await navigation.explore({
        projectId,
        selection: occurrence.occurrence,
      }),
      200,
    );
  }
  if (view === "path") {
    const usagePath = parseExactElementPath(url.searchParams.get("usagePath"));
    if (usagePath === "invalid") return invalidExactElementPath();
    if (usagePath.length === 0) {
      return json(await navigation.explore({ projectId }), 200);
    }
    return json(
      await navigation.explore({
        projectId,
        selection: {
          element: productStructureElementRef(
            "PartUsage",
            usagePath[usagePath.length - 1]!,
          ),
          path: usagePath,
        },
      }),
      200,
    );
  }
  const result = view === "search"
    ? await navigation.search({
      projectId,
      query: {
        kind: "exact-id",
        elementId: url.searchParams.get("id") ?? "",
      },
    })
    : view === "roots"
    ? await navigation.explore({ projectId })
    : view === null || view === ""
    ? await navigation.projection({ projectId })
    : {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "unavailable" as const,
    };
  return json(result, 200);
}

const EXACT_ELEMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function parseExactElementPath(value: string | null): string[] | "invalid" {
  if (value === null || value === "") return [];
  const segments = value.split(",");
  for (const segment of segments) {
    if (
      segment === "" ||
      segment === "latest" ||
      !EXACT_ELEMENT_ID.test(segment)
    ) {
      return "invalid";
    }
  }
  return segments;
}

function invalidExactElementPath(): Response {
  return new Response(
    "Invalid exact element path. Empty segments and latest are refused.",
    { status: 400 },
  );
}

async function serveInspectQuery(
  url: URL,
  navigation: ProductNavigationUseCase,
  projectId: string,
): Promise<Response> {
  const kindParam = url.searchParams.get("kind");
  if (kindParam !== "part-definition" && kindParam !== "part-usage") {
    return invalidAuthoringAttachmentsQuery(
      "kind must be part-definition or part-usage. latest is refused.",
    );
  }
  const nodeId = url.searchParams.get("id") ?? "";
  if (
    nodeId === "" ||
    nodeId === "latest" ||
    !EXACT_ELEMENT_ID.test(nodeId)
  ) {
    return invalidAuthoringAttachmentsQuery(
      "id must be an exact SysML element identity. latest is refused.",
    );
  }
  const path = parseExactElementPath(url.searchParams.get("path"));
  if (path === "invalid") return invalidExactElementPath();
  const pageSize = parseExactPageSize(url.searchParams.get("pageSize"));
  if (pageSize === "invalid") {
    return invalidAuthoringAttachmentsQuery(
      `pageSize must be an integer from 1 to ${PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize}. latest is refused.`,
    );
  }
  const cursor = parseExactCursor(url.searchParams.get("cursor"));
  if (cursor === "invalid") {
    return invalidAuthoringAttachmentsQuery(
      "cursor must be the opaque nextCursor from this view. latest is refused.",
    );
  }
  const selection = kindParam === "part-usage"
    ? {
      kind: "occurrence" as const,
      occurrence: {
        element: productStructureElementRef("PartUsage", nodeId),
        path: path.length === 0 ? [nodeId] : path,
      },
    }
    : {
      kind: "element" as const,
      element: productStructureElementRef("PartDefinition", nodeId),
    };
  try {
    const result = await navigation.inspect({
      projectId,
      selection,
      ...(pageSize === undefined ? {} : { pageSize }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (
      result.status === "unresolved" &&
      result.diagnostics.some((item) => item.code === "cursor.mismatch")
    ) {
      return invalidAuthoringAttachmentsQuery(
        "cursor must be the opaque nextCursor from this view. latest is refused.",
      );
    }
    return json(result, 200);
  } catch (error) {
    if (error instanceof ProjectSourceWorkspaceError) {
      return invalidAuthoringAttachmentsQuery(error.message);
    }
    throw error;
  }
}

function occurrenceFromQuery(url: URL):
  | "invalid"
  | "missing"
  | "kind-invalid"
  | { readonly kind: "semantic-root"; readonly elementId: string }
  | {
    readonly kind: "occurrence";
    readonly occurrence: ProductStructureOccurrenceRef;
  } {
  const kindParam = url.searchParams.get("kind");
  const nodeId = url.searchParams.get("id") ?? "";
  const path = parseExactElementPath(url.searchParams.get("path"));
  if (path === "invalid") return "invalid";
  if (nodeId === "" || nodeId === "latest" || !EXACT_ELEMENT_ID.test(nodeId)) {
    return "missing";
  }
  if (kindParam === "part-usage") {
    return {
      kind: "occurrence",
      occurrence: {
        element: productStructureElementRef("PartUsage", nodeId),
        path: path.length === 0 ? [nodeId] : path,
      },
    };
  }
  if (kindParam !== "part-definition") return "kind-invalid";
  if (path.length !== 0) return "invalid";
  return { kind: "semantic-root", elementId: nodeId };
}

function exactSemanticRootExplore(
  result: ProductExploreResult,
  elementId: string,
): ProductExploreResult {
  if (
    result.status === "observed" &&
    result.focus &&
    productStructureElementRefsEqual(
      result.focus.element,
      productStructureElementRef("PartDefinition", elementId),
    )
  ) {
    return result;
  }
  if (result.status !== "observed") return result;
  return unavailableExplore({
    basis: result.basis,
    status: "unattached",
    diagnostics: [{
      code: "selection.unattached",
      relation: "selection",
      recovery:
        "Pass a PartUsage occurrence published by explore or inspect on this exact basis.",
    }],
  });
}

function parseExactPageSize(value: string | null): number | undefined | "invalid" {
  if (value === null || value === "") return undefined;
  if (value === "latest") return "invalid";
  if (!/^[1-9][0-9]*$/.test(value)) return "invalid";
  const size = Number(value);
  if (
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize
  ) {
    return "invalid";
  }
  return size;
}

function parseExactCursor(value: string | null): string | undefined | "invalid" {
  if (value === null || value === "") return undefined;
  if (value === "latest") return "invalid";
  if (value.length > PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength) {
    return "invalid";
  }
  return value;
}

function invalidAuthoringAttachmentsQuery(message: string): Response {
  return new Response(message, { status: 400 });
}

async function serveThreadAsset(
  pathname: string,
  reader?: (filename: string) => Promise<Uint8Array | undefined>,
): Promise<Response> {
  if (!reader) return new Response("Not found", { status: 404 });
  let filename: string;
  try {
    filename = decodeURIComponent(pathname.slice("/api/thread/assets/".length));
  } catch {
    return new Response("Invalid asset path", { status: 400 });
  }
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return new Response("Invalid asset path", { status: 400 });
  }
  const bytes = await reader(filename);
  if (!bytes) return new Response("Not found", { status: 404 });
  const addressed = /^([a-f0-9]{64})\.(step|glb|gltf|stl)$/.exec(filename);
  if (addressed && await sha256Hex(bytes) !== addressed[1]) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: workbenchReadHeaders({
      "Content-Type": filename.endsWith(".step")
        ? "model/step"
        : filename.endsWith(".glb")
        ? "model/gltf-binary"
        : filename.endsWith(".gltf")
        ? "model/gltf+json"
        : "model/stl",
      "Cache-Control": "no-store",
    }),
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Serve a geometry draft binary asset by its SHA-256 digest.
 *
 * WHY SEPARATE FROM /api/thread/assets — draft assets are keyed by digest
 * (content-addressed) and may be any format (GLB, STEP, STL).  They are
 * never promoted into the ThreadSnapshot until the write executor seals them.
 * This endpoint allows the Workbench preview to render a draft without
 * treating it as evidence.
 *
 * The path segment after the prefix is the bare hex digest.  Only
 * well-formed 64-char hex digests are accepted; any other path returns 400.
 */
async function serveDraftAsset(
  pathname: string,
  reader?: (digest: string) => Promise<Uint8Array | undefined>,
): Promise<Response> {
  const digest = pathname.slice("/api/draft-assets/".length);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    return new Response("Invalid draft asset digest", { status: 400 });
  }
  let bytes: Uint8Array | undefined;
  if (reader) {
    bytes = await reader(digest);
  } else {
    const localPath = `${GEOMETRY_DRAFT_ASSETS_DIR}/${digest}`;
    try {
      bytes = await Deno.readFile(localPath);
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  if (!bytes) return new Response("Draft asset not found", { status: 404 });
  if (await sha256Hex(bytes) !== digest) {
    return new Response("Draft asset fingerprint mismatch", { status: 404 });
  }
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: workbenchReadHeaders({
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
    }),
  });
}

const WORKBENCH_UI_ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function dirnameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash <= 0 ? "." : trimmed.slice(0, slash);
}

function resolveUiAssetDirectory(
  options: NativeWorkbenchHandlerOptions,
): string | undefined {
  if (options.uiAssetDirectory) return options.uiAssetDirectory;
  if (options.htmlPath) return dirnameOf(options.htmlPath);
  return undefined;
}

function workbenchUiAssetContentType(filename: string): string | undefined {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return undefined;
  return WORKBENCH_UI_ASSET_TYPES[filename.slice(dot).toLowerCase()];
}

/**
 * Resolve a hashed Vite asset under the UI dist directory. Rejects traversal,
 * absolute segments, and unknown extensions. This is a read-only file serve.
 */
export function resolveWorkbenchUiAssetPath(
  directory: string,
  pathname: string,
): string | undefined {
  if (!pathname.startsWith("/assets/") || pathname.includes("\0")) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined;
  const segments = decoded.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined;
  }
  if (segments[0] !== "assets") return undefined;
  const filename = segments.at(-1);
  if (!filename || !workbenchUiAssetContentType(filename)) return undefined;
  return `${directory.replace(/\/+$/, "")}/${segments.join("/")}`;
}

async function serveWorkbenchUiAsset(
  pathname: string,
  options: NativeWorkbenchHandlerOptions,
): Promise<Response | undefined> {
  const directory = resolveUiAssetDirectory(options);
  if (!directory) return undefined;
  const path = resolveWorkbenchUiAssetPath(directory, pathname);
  if (!path) return undefined;
  const contentType = workbenchUiAssetContentType(path);
  if (!contentType) return undefined;
  try {
    const bytes = await Deno.readFile(path);
    return new Response(bytes, {
      headers: workbenchReadHeaders({
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      }),
    });
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return new Response("Not found", { status: 404 });
    }
    throw error;
  }
}

function waitForPoll(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.main) {
  const cliArgs = parseArgs(Deno.args);
  const startup = resolveNativeWorkbenchStartupTarget(cliArgs);
  const {
    explicitSubjectId,
    hostname,
    port,
    projectId,
    workspaceId,
  } = startup;
  const snapshotDirectory = cliArgs["snapshot-dir"] ??
    "state/local/thread-snapshots";
  const activeProjectDirectory = cliArgs["active-project-dir"] ??
    "state/local/engineering-projects";
  const projectBaselineDirectory = cliArgs["project-baseline-dir"] ??
    "config/projects/baselines";
  const projectBaselineAssetDirectory = cliArgs["project-baseline-asset-dir"] ??
    `${projectBaselineDirectory}/assets`;
  const htmlPath = cliArgs["html"] ??
    "src/ui/dist/thread/native-workbench.html";
  const assetDirectory = cliArgs["asset-dir"] ?? "state/local/thread-assets";
  const liveUpdateDirectory = cliArgs["live-update-dir"] ??
    "state/local/live-thread-updates";
  const focusDirectory = cliArgs["focus-dir"] ?? "state/local/cockpit-focus";
  const architectureCaptureDirectory = cliArgs["architecture-capture-dir"] ??
    ARCHITECTURE_CAPTURE_DESCRIPTOR.directory;
  const geometryCaptureDirectory = cliArgs["geometry-capture-dir"] ??
    GEOMETRY_CAPTURE_DESCRIPTOR.directory;
  const recordedAnalysisDirectory = cliArgs["recorded-analysis-dir"] ??
    "state/local/recorded-analysis";
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const cockpitFocus = workspaceId
    ? new FileCockpitFocusStore(focusDirectory)
    : undefined;
  const archCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: architectureCaptureDirectory,
  });
  const sysmlSourceCaptures = new FileCaptureStore(
    SYSML_SOURCE_CAPTURE_DESCRIPTOR,
  );
  const sourceAnalysisCaptures = new FileCaptureStore(
    SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  );
  const sysmlSourceAnalysis: SysmlSourceAnalysisReader = {
    reopen: (reference) =>
      requireSysmlSourceAnalysis(reference, {
        sourceCaptures: sysmlSourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
      }),
  };
  const geometryCaptures = new FileCaptureStore({
    ...GEOMETRY_CAPTURE_DESCRIPTOR,
    directory: geometryCaptureDirectory,
  });
  const architectureSysmlDirectory = cliArgs["architecture-sysml-dir"] ??
    "state/local/recorded-analysis/architecture-sysml";
  const architectureSysmlSources = createArchitectureSysmlSourceAnalysisCaptureService({
    sourceCaptures: new FileByteStore({
      kind: "architecture-sysml-source",
      directory: `${architectureSysmlDirectory}/sources`,
      uriNamespace: "architecture-sysml-source",
      label: "Captured architecture SysML source",
    }),
    analysisCaptures: new FileByteStore({
      kind: "architecture-sysml-source-analysis",
      directory: `${architectureSysmlDirectory}/analyses`,
      uriNamespace: "architecture-sysml-source-analysis",
      label: "Captured architecture SysML analysis",
    }),
  });
  const architectureSysmlSeals = fileArchitectureSysmlSealCaptureReader(
    new FileByteStore({
      kind: "architecture-sysml-seal-capture",
      directory: `${architectureSysmlDirectory}/seals`,
      uriNamespace: "architecture-sysml-seal-capture",
      label: "Sealed architecture SysML analysis",
    }),
  );
  const technicalCompilationSealBytes = new FileByteStore({
    kind: "technical-compilation-admission-capture",
    directory: cliArgs["technical-compilation-admission-dir"] ??
      "state/local/recorded-analysis/technical-compilation/seals",
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
    cliArgs["project-source-workspace-dir"] ??
      DEFAULT_PROJECT_SOURCE_WORKSPACE_DIRECTORY,
  );
  const requirementsCaptures: RequirementsCaptureReader = new FileCaptureStore(
    REQUIREMENTS_CAPTURE_DESCRIPTOR,
  );
  const engineeringCaseCaptures: EngineeringCaseWorkbenchEnricherDependencies = {
    mechanicalProof: new FileCaptureStore(
      FEA_PROOF_CASE_CAPTURE_DESCRIPTOR,
    ),
    sensitivityStudy: new FileCaptureStore(
      SENSITIVITY_STUDY_CASE_CAPTURE_DESCRIPTOR,
    ),
    printabilityCheck: new FileCaptureStore(
      PRINTABILITY_CASE_CAPTURE_DESCRIPTOR,
    ),
    printEstimate: new FileCaptureStore(
      PRINT_ESTIMATE_CASE_CAPTURE_DESCRIPTOR,
    ),
    dfmCheck: new FileCaptureStore(DFM_CASE_CAPTURE_DESCRIPTOR),
  };
  const evaluationCloseoutCaptures: EvaluationCloseoutCaptureReader =
    new FileCaptureStore({
      ...EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
      directory: cliArgs["evaluation-closeout-capture-dir"] ??
        `${recordedAnalysisDirectory}/calculix/evaluation-closeout-captures`,
      syncBoundary: recordedAnalysisDirectory,
    });
  const assemblyIntegrityCaptures: AssemblyIntegrityWorkbenchCaptureReaders = {
    observations: new FileCaptureStore(
      ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_DESCRIPTOR,
    ),
    evaluations: new FileCaptureStore(
      ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_DESCRIPTOR,
    ),
    closeouts: new FileCaptureStore(
      ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
    ),
  };
  // The paired MCP owns all project commands and initialisation. The cockpit
  // reads existing immutable revisions and never seeds a fallback.
  const projectStore: EngineeringProjectRevisionStore =
    new FileEngineeringProjectRevisionStore(activeProjectDirectory);
  const subjectId = projectId === undefined
    ? undefined
    : await resolveNativeWorkbenchSubjectId(
      projectId,
      explicitSubjectId,
      projectStore,
    );
  const componentCatalogPath = cliArgs["component-catalog"] ??
    (subjectId === undefined
      ? undefined
      : `config/thread-subjects/${subjectId}.components.json`);
  const componentCatalog = componentCatalogPath === undefined
    ? undefined
    : await readOptionalComponentCatalog(componentCatalogPath);
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(assetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const liveUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore,
    projectId,
    cockpitFocus,
    workspaceId,
    projectSnapshots,
    subjectId,
    htmlPath,
    uiAssetDirectory: dirnameOf(htmlPath),
    componentCatalog,
    componentCatalogForSubject: async (resolvedSubjectId) =>
      await readOptionalComponentCatalog(
        `config/thread-subjects/${resolvedSubjectId}.components.json`,
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
      readDeclaredCockpitFleet(
        cliArgs["fleet-manifest"] ?? "config/mcp-fleet.json",
      ),
  });
  const workspaceHandler = workspaceId === undefined || !cockpitFocus
    ? handler
    : createFocusedWorkspaceHandler({
      focus: cockpitFocus,
      workspaceId,
      native: handler,
    });

  Deno.serve({
    hostname,
    port,
    onListen: ({ hostname, port }) => {
      console.log(`Native Workbench: http://${hostname}:${port}/`);
      console.log(
        subjectId === undefined
          ? "Snapshot subject: selected by durable cockpit focus"
          : `Snapshot subject: ${subjectId}`,
      );
      console.log(
        projectId === undefined
          ? "Engineering project id: selected by durable cockpit focus"
          : `Engineering project id: ${projectId}`,
      );
      console.log(`Active project revisions: ${activeProjectDirectory}`);
      console.log(`Versioned project baselines: ${projectBaselineDirectory}`);
      console.log(
        `Versioned presentation baselines: ${projectBaselineAssetDirectory}`,
      );
      console.log(
        componentCatalogPath === undefined
          ? "Component identities: resolved from the focused subject"
          : `Component identities: ${componentCatalogPath}`,
      );
      console.log(`Live activity journal: ${liveUpdateDirectory}`);
      if (workspaceId) {
        console.log(`Agent-selected cockpit workspace: ${workspaceId}`);
      }
      console.log(
        "Project state: read-only active revisions (no fallback seeding)",
      );
      console.log(
        "Workbench transport is GET + SSE only. Commands and signed decisions remain in the paired MCP conversation.",
      );
    },
  }, workspaceHandler);
}

interface FocusedWorkspaceHandlerOptions {
  readonly focus: CockpitFocusStore;
  readonly workspaceId: string;
  readonly native: (request: Request) => Promise<Response>;
  readonly projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>;
}

/**
 * Same-origin workspace router. The root is always the canonical native
 * cockpit; focus selects one project from its first framing revision onward.
 */
export function createFocusedWorkspaceHandler(
  options: FocusedWorkspaceHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return await options.native(request);
    if (request.method !== "GET") return methodNotAllowed();
    if (url.pathname.startsWith("/assets/")) {
      return await options.native(request);
    }
    if (url.pathname === "/api/projects") return await options.native(request);
    const focus = await options.focus.get(options.workspaceId);
    if (!focus) {
      return await cockpitFocusUnavailable(
        options.workspaceId,
        request,
        options.projectCatalog,
      );
    }
    if (
      url.pathname === "/" || url.pathname === "/native-workbench.html"
    ) {
      // The canonical cockpit owns the root before and after approval. The
      // browser reads the durable focus through its read-only API, never by a
      // focus command or a second application URL.
      const rootRequest = url.pathname === "/" ? request : requestAtRoot(request);
      return await options.native(rootRequest);
    }
    return await options.native(request);
  };
}

function requestAtRoot(request: Request): Request {
  const url = new URL(request.url);
  url.pathname = "/";
  return new Request(url, { method: "GET", headers: request.headers });
}

async function serveCockpitFleet(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.cockpitFleet) {
    return json({ error: "fleet_unavailable" }, 404);
  }
  const projection = await options.cockpitFleet();
  if (!projection) {
    return json({ error: "fleet_unavailable" }, 404);
  }
  return json(projection, 200);
}

async function serveProjectCatalog(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.projectCatalog) {
    return json(
      {
        schemaVersion: "native-workbench-project-catalog/1.0",
        state: "unavailable",
        projects: [],
        reason: "Persisted project catalog is unavailable.",
      } satisfies NativeWorkbenchProjectCatalog,
      503,
    );
  }
  const catalog = await options.projectCatalog();
  return json(catalog, catalog.state === "available" ? 200 : 503);
}

async function readOptionalComponentCatalog(
  path: string,
): Promise<ThreadComponentCatalog | undefined> {
  try {
    return validateThreadComponentCatalog(
      JSON.parse(await Deno.readTextFile(path)),
    );
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function json(
  value: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return Response.json(value, {
    status,
    headers: workbenchReadHeaders({
      "Cache-Control": "no-store",
      ...headers,
    }),
  });
}

function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: workbenchReadHeaders({ Allow: allow }),
  });
}

function projectNotFound(projectId: string): Response {
  return json({
    error: "engineering_project_not_found",
    projectId,
  }, 404);
}

function publicFocusTarget(target: ActiveTargetResolution): {
  kind: "project";
  projectId: string;
} {
  return { kind: "project", projectId: target.projectId };
}

async function cockpitFocusUnavailable(
  workspaceId: string,
  request: Request,
  projectCatalog?: () => Promise<NativeWorkbenchProjectCatalog>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return json({
      error: "cockpit_focus_not_selected",
      workspaceId,
      message:
        "The paired agent has not selected a durable project for this cockpit workspace yet.",
    }, 409);
  }
  const catalog = projectCatalog ? await projectCatalog() : {
    schemaVersion: "native-workbench-project-catalog/1.0" as const,
    state: "unavailable" as const,
    projects: [] as const,
    reason: "Persisted project catalog is unavailable.",
  };
  const projects = catalog.state === "available"
    ? catalog.projects.map((project) =>
      `<li><strong>${escapeHtml(project.name)}</strong><br><code>${
        escapeHtml(project.id)
      }</code> · revision ${project.revision}</li>`
    ).join("")
    : `<li><strong>unavailable</strong> — ${escapeHtml(catalog.reason)}</li>`;
  const empty = catalog.state === "available" && catalog.projects.length === 0
    ? "<p>No persisted engineering project is available.</p>"
    : `<ul>${projects}</ul>`;
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cockpit awaiting project context</title><style>body{font:16px system-ui;max-width:52rem;margin:8vh auto;padding:0 1.5rem;color:#1c2126;background:#f5f2ea}main{padding:2rem;border:1px solid #d4cdc0;background:#fbf8f1}code{overflow-wrap:anywhere}li+li{margin-top:1rem}</style><main><p>Casys Digital Thread</p><h1>Opening project context</h1><p>Your paired agent has not selected a durable project for this workspace. No engineering tool is running.</p><h2>Persisted projects</h2>${empty}<p>Select focus through the paired MCP conversation; this read-only Workbench has no project command.</p></main></html>`,
    {
      status: 200,
      headers: workbenchDocumentHeaders({
        "Content-Type": "text/html; charset=utf-8",
      }),
    },
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const WORKBENCH_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; object-src 'none'; script-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; media-src 'none'; " +
  "worker-src 'none'; manifest-src 'none'";

function workbenchReadHeaders(
  headers: Readonly<Record<string, string>> = {},
): Headers {
  return new Headers({
    "Cache-Control": "no-store",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...headers,
  });
}

function workbenchDocumentHeaders(
  headers: Readonly<Record<string, string>> = {},
): Headers {
  const result = workbenchReadHeaders(headers);
  result.set("Content-Security-Policy", WORKBENCH_CSP);
  return result;
}

function configuredProjectId(options: NativeWorkbenchHandlerOptions): string {
  const projectId = options.projectId;
  if (projectId === undefined) {
    throw new Error(
      "Native Workbench requires a durable cockpit focus or a fixed project.",
    );
  }
  return projectId;
}

function booleanFlag(
  name: string,
  cliArgs: Readonly<Record<string, string | undefined>>,
): boolean {
  const value = cliArgs[name];
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError(`--${name} must be a boolean flag.`);
}

function integerArgument(
  name: string,
  cliArgs: Readonly<Record<string, string | undefined>>,
): number | undefined {
  const value = cliArgs[name];
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 65535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return result;
}
