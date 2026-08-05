import { parseArgs } from "./cli.ts";
import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../src/domain/engineering-project-command-service.ts";
import { validateEngineeringProjectThreadReferences } from "../src/domain/engineering-project-validation.ts";
import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";
import {
  type CockpitFocusStore,
  FileCockpitFocusStore,
} from "../src/adapters/file-cockpit-focus-store.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../src/adapters/file-capture-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../src/adapters/validators/engineering-project-initial-baseline-evidence-validator.ts";
import { createEngineeringProjectCommandRuntime } from "../src/adapters/engineering-project-command-runtime.ts";
import {
  type EngineeringWorkbenchSnapshot,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "../src/adapters/projectors/engineering-workbench-projector.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../src/adapters/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../src/adapters/thread-snapshot-lineage.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../src/orchestration/operations/registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../src/domain/syson-model-seed.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../src/adapters/engineering-asset-resolver.ts";
import { projectThreadWorkbenchSnapshot } from "../src/adapters/projectors/thread-workbench-projector.ts";
import {
  FileLiveThreadUpdateStore,
  type LiveThreadUpdate,
  type LiveThreadUpdateJournal,
  overlayLiveThreadUpdates,
} from "../src/adapters/live-thread-update-store.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../src/domain/thread-component-catalog.ts";
import { resolveCoffeeMachineCm01V3ProductStructureCatalog } from "../src/adapters/projectors/cm01-v3-product-structure-catalog.ts";

export interface NativeWorkbenchHandlerOptions {
  store: ThreadSnapshotStore;
  projectStore: EngineeringProjectRevisionStore;
  /** EngineeringProject identity; defaults to subjectId only for CM-01 compatibility. */
  projectId?: string;
  /** Agent-selected durable target. The BFF reads it, never mutates it. */
  cockpitFocus?: CockpitFocusStore;
  workspaceId?: string;
  /** Active store plus optional exact, versioned project baselines. */
  projectSnapshots?: ExactThreadSnapshotReader;
  subjectId: string;
  html: string;
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
  /** Optional non-canonical activity journal projected into the same feed. */
  liveUpdates?: LiveThreadUpdateJournal;
  assetReader?: (filename: string) => Promise<Uint8Array | undefined>;
  /** Polling only observes persisted snapshots; it never executes a tool. */
  pollIntervalMs?: number;
}

/**
 * CM-01 remains the no-argument preview, but a caller that names a project
 * must not also have to know the project's internal thread-subject identity.
 */
export const NATIVE_WORKBENCH_LEGACY_PROJECT_ID = "coffee-machine-cm01";

export function resolveNativeWorkbenchProjectId(
  explicitProjectId: string | undefined,
  explicitSubjectId: string | undefined,
): string {
  return explicitProjectId ?? explicitSubjectId ??
    NATIVE_WORKBENCH_LEGACY_PROJECT_ID;
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
  const subjectId = focus ? project.project.subjectId : options.subjectId;
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
  return async (request) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/thread/assets/")) {
      if (request.method !== "GET") return methodNotAllowed();
      return serveThreadAsset(url.pathname, options.assetReader);
    }
    if (url.pathname === "/api/thread/workbench/events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await snapshotEventStream(request, options);
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
      return new Response(options.html, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  };
}

async function snapshotEventStream(
  request: Request,
  options: NativeWorkbenchHandlerOptions,
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
          const focusPrefix = options.cockpitFocus ? `${current.projectId}:` : "";
          const eventId = snapshot
            ? `${focusPrefix}${current.project.revision}:${snapshot.revision}:${liveVersion}`
            : `planning:${focusPrefix}${current.project.revision}:${liveVersion}`;
          if (eventId !== lastEventId) {
            const projection = await projectWorkbenchSnapshot(
              current.project,
              snapshot,
              options,
              current.subjectId,
              current.componentCatalog,
              liveUpdates,
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
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function projectWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot | undefined,
  options: NativeWorkbenchHandlerOptions,
  subjectId: string,
  componentCatalog?: ThreadComponentCatalog,
  liveUpdates?: LiveThreadUpdate[],
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
  const validatedProject = validateEngineeringProjectThreadReferences(
    project,
    declaredSnapshots.filter(
      (candidate): candidate is ThreadSnapshot => candidate !== undefined,
    ),
  );
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  return projectEngineeringWorkbenchSnapshot(
    validatedProject,
    await projectThreadSnapshot(
      snapshot,
      options,
      subjectId,
      componentCatalog,
      updates,
    ),
    snapshot.revision,
    updates,
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
  // A guarded operation can make a next ThreadSnapshot durable before
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

const DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS = [
  SYSON_MODEL_SEED_OPERATION,
] as const;

function hasUnattachedDurableProjectOperation(
  project: EngineeringProjectSnapshot,
): boolean {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  return project.agentRuns.some((run) => {
    if (
      ![
        "running",
        "waiting-for-decision",
        "publishing",
      ].includes(run.status)
    ) {
      return false;
    }
    const operation = workItems.get(run.workItemId)?.operation;
    return DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS.some((candidate) =>
      operation?.id === candidate.id && operation.version === candidate.version
    );
  });
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
  subjectId: string,
  componentCatalog: ThreadComponentCatalog | undefined,
  liveUpdates?: LiveThreadUpdate[],
) {
  const evidenceCatalog = await options.componentCatalogForSnapshot?.(snapshot);
  const canonical = projectThreadWorkbenchSnapshot(
    snapshot,
    evidenceCatalog ?? componentCatalog ??
      (subjectId === options.subjectId ? options.componentCatalog : undefined),
  );
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(subjectId) ?? []);
  return overlayLiveThreadUpdates(
    canonical,
    snapshot.revision,
    updates,
    updates.at(-1)?.sequence ?? 0,
  );
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
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || !filename.endsWith(".stl")) {
    return new Response("Invalid asset path", { status: 400 });
  }
  const bytes = await reader(filename);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: {
      "Content-Type": "model/stl",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function waitForPoll(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

if (import.meta.main) {
  const cliArgs = parseArgs(Deno.args);
  const hostname = cliArgs["host"] ?? "127.0.0.1";
  const port = integerArgument("port", cliArgs) ?? 5173;
  const snapshotDirectory = cliArgs["snapshot-dir"] ??
    "state/local/thread-snapshots";
  const explicitSubjectId = cliArgs["subject"];
  const projectId = resolveNativeWorkbenchProjectId(
    cliArgs["project-id"],
    explicitSubjectId,
  );
  const projectPath = cliArgs["project"] ??
    `config/projects/${projectId}.project.json`;
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
  const workspaceId = cliArgs["workspace-id"];
  const approvedBriefCaptureDirectory = cliArgs["approved-brief-capture-dir"] ??
    "state/local/approved-brief-captures";
  const cm01ArchitectureCaptureDirectory = cliArgs["cm01-architecture-capture-dir"] ??
    "state/local/coffee-machine-cm01-v3-architecture-captures";
  const html = await Deno.readTextFile(htmlPath);
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const cockpitFocus = workspaceId
    ? new FileCockpitFocusStore(focusDirectory)
    : undefined;
  const captures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: approvedBriefCaptureDirectory,
  });
  const cm01ArchitectureCaptures = new FileCaptureStore({
    ...COFFEE_MACHINE_CM01_V3_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: cm01ArchitectureCaptureDirectory,
  });
  const projectRuntime = await createEngineeringProjectCommandRuntime({
    projectId,
    trackedManifestPath: projectPath,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: projectSnapshots,
    planning: {
      operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY,
    },
    initialEvidenceValidator: new ExactInitialBaselineEvidenceValidator(
      store,
      captures,
    ),
  });
  const subjectId = await resolveNativeWorkbenchSubjectId(
    projectId,
    explicitSubjectId,
    projectRuntime.projects,
  );
  const componentCatalogPath = cliArgs["component-catalog"] ??
    `config/thread-subjects/${subjectId}.components.json`;
  const componentCatalog = await readOptionalComponentCatalog(
    componentCatalogPath,
  );
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(assetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const liveUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: projectRuntime.projects,
    projectId,
    cockpitFocus,
    workspaceId,
    projectSnapshots,
    subjectId,
    html,
    componentCatalog,
    componentCatalogForSubject: async (resolvedSubjectId) =>
      await readOptionalComponentCatalog(
        `config/thread-subjects/${resolvedSubjectId}.components.json`,
      ),
    componentCatalogForSnapshot: async (snapshot) =>
      await resolveCoffeeMachineCm01V3ProductStructureCatalog(
        snapshot,
        cm01ArchitectureCaptures,
      ),
    liveUpdates,
    assetReader: (filename) => assetReader.read(filename),
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
      console.log(`Snapshot subject: ${subjectId}`);
      console.log(`Engineering project id: ${projectId}`);
      console.log(`Engineering project: ${projectPath}`);
      console.log(`Active project revisions: ${activeProjectDirectory}`);
      console.log(`Versioned project baselines: ${projectBaselineDirectory}`);
      console.log(
        `Versioned presentation baselines: ${projectBaselineAssetDirectory}`,
      );
      console.log(`Component identities: ${componentCatalogPath}`);
      console.log(`Live activity journal: ${liveUpdateDirectory}`);
      if (workspaceId) {
        console.log(`Agent-selected cockpit workspace: ${workspaceId}`);
      }
      console.log(
        `Documentary baseline captures: ${approvedBriefCaptureDirectory}`,
      );
      console.log(
        "Read-only Workbench: project commands and human decisions flow through the paired MCP conversation.",
      );
    },
  }, workspaceHandler);
}

interface FocusedWorkspaceHandlerOptions {
  readonly focus: CockpitFocusStore;
  readonly workspaceId: string;
  readonly native: (request: Request) => Promise<Response>;
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
    const focus = await options.focus.get(options.workspaceId);
    if (!focus) return cockpitFocusUnavailable(options.workspaceId, request);
    if (
      url.pathname === "/" || url.pathname === "/native-workbench.html"
    ) {
      if (request.method !== "GET") return methodNotAllowed();
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
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function methodNotAllowed(allow = "GET"): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: allow },
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

function cockpitFocusUnavailable(
  workspaceId: string,
  request: Request,
): Response {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) {
    return json({
      error: "cockpit_focus_not_selected",
      workspaceId,
      message:
        "The paired agent has not selected a durable project for this cockpit workspace yet.",
    }, 409);
  }
  return new Response(
    `<!doctype html><title>Cockpit awaiting project context</title><main><h1>Opening project context</h1><p>Your paired agent has not selected a project for this workspace yet. Continue the conversation; no engineering tool is running.</p></main>`,
    {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    },
  );
}

function configuredProjectId(options: NativeWorkbenchHandlerOptions): string {
  return options.projectId ?? options.subjectId;
}

function integerArgument(
  name: string,
  cliArgs: Record<string, string | undefined>,
): number | undefined {
  const value = cliArgs[name];
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 65535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return result;
}
