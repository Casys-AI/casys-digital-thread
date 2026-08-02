import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../src/domain/engineering-project-command-service.ts";
import { validateEngineeringProjectThreadReferences } from "../src/domain/engineering-project-validation.ts";
import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";
import { FileApprovedDiscoveryBaselineCaptureStore } from "../src/adapters/file-approved-discovery-baseline-capture-store.ts";
import { ExactInitialBaselineEvidenceValidator } from "../src/adapters/engineering-project-initial-baseline-evidence-validator.ts";
import { FileProjectDiscoveryRevisionStore } from "../src/adapters/project-discovery-store.ts";
import { createEngineeringProjectCommandRuntime } from "../src/adapters/engineering-project-command-runtime.ts";
import {
  executeOperatorProjectCommand,
  ProjectCommandHttpError,
  type ProjectOperatorCommandRequest,
  readOperatorProjectCommand,
} from "../src/adapters/engineering-project-command-http.ts";
import { isExplicitLoopbackHostname } from "../src/adapters/loopback-host.ts";
import {
  type EngineeringWorkbenchSnapshot,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "../src/adapters/engineering-workbench-projector.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../src/adapters/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../src/adapters/thread-snapshot-lineage.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../src/orchestration/operations/registry.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../src/domain/syson-model-seed.ts";
import { INSPECTION_DRONE_ARCHITECTURE_OPERATION } from "../src/domain/inspection-drone-architecture.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../src/adapters/engineering-asset-resolver.ts";
import { projectThreadWorkbenchSnapshot } from "../src/adapters/thread-workbench-projector.ts";
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

export interface NativeWorkbenchHandlerOptions {
  store: ThreadSnapshotStore;
  projectStore: EngineeringProjectRevisionStore;
  projectCommands?: EngineeringProjectCommandService;
  /** EngineeringProject identity; defaults to subjectId only for CM-01 compatibility. */
  projectId?: string;
  /** Active store plus optional exact, versioned project baselines. */
  projectSnapshots?: ExactThreadSnapshotReader;
  subjectId: string;
  html: string;
  componentCatalog?: ThreadComponentCatalog;
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

/**
 * An explicitly supplied subject remains an operator override. Otherwise the
 * persisted project is authoritative: V2 discovery projects intentionally use
 * `project:<projectId>` rather than the historic CM-01 subject convention.
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
    if (url.pathname === "/api/project/commands") {
      if (request.method !== "POST") return methodNotAllowed("POST");
      if (!options.projectCommands) {
        return json({
          error: "operator_commands_disabled",
          message: "Operator commands are disabled for this Workbench.",
        }, 404);
      }
      return await handleOperatorCommand(request, options);
    }
    if (url.pathname === "/api/thread/workbench") {
      if (request.method !== "GET") return methodNotAllowed();
      const project = await options.projectStore.get(configuredProjectId(options));
      if (!project) return projectNotFound(configuredProjectId(options));
      const snapshot = await resolveCurrentThreadSnapshot(project, options);
      if (!snapshot && project.threadSnapshots.length > 0) {
        return json({
          error: "thread_snapshot_not_found",
          subjectId: options.subjectId,
        }, 404);
      }
      const projection = await projectWorkbenchSnapshot(
        project,
        snapshot,
        options,
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
  const initialProject = await options.projectStore.get(
    configuredProjectId(options),
  );
  if (!initialProject) return projectNotFound(configuredProjectId(options));
  let project = initialProject;
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
          const [latestProject, liveUpdates] = await Promise.all([
            options.projectStore.get(configuredProjectId(options)),
            options.liveUpdates?.list(options.subjectId) ?? [],
          ]);
          // A manifest removed during an established stream cannot revoke the
          // last valid event. A reconnect will receive an explicit 404.
          if (latestProject) project = latestProject;
          const snapshot = await resolveCurrentThreadSnapshot(project, options);
          const liveVersion = liveUpdates.at(-1)?.sequence ?? 0;
          const eventId = snapshot
            ? `${project.revision}:${snapshot.revision}:${liveVersion}`
            : `planning:${project.revision}:${liveVersion}`;
          if (eventId !== lastEventId) {
            const projection = await projectWorkbenchSnapshot(
              project,
              snapshot,
              options,
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

async function handleOperatorCommand(
  request: Request,
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  let command: ProjectOperatorCommandRequest | undefined;
  try {
    command = await readOperatorProjectCommand(request);
    if (command.projectId !== configuredProjectId(options)) {
      return json({
        error: "invalid_project_command",
        message:
          `Command project ${command.projectId} does not match this Workbench project ${
            configuredProjectId(options)
          }.`,
      }, 422);
    }
    const project = await executeOperatorProjectCommand(
      options.projectCommands!,
      options.projectStore,
      command,
    );
    const snapshot = await resolveCurrentThreadSnapshot(project, options);
    if (!snapshot && project.threadSnapshots.length > 0) {
      return json({
        error: "thread_snapshot_not_found",
        subjectId: options.subjectId,
      }, 404);
    }
    const projection = await projectWorkbenchSnapshot(
      project,
      snapshot,
      options,
    );
    return json(projection, 200, {
      "X-Casys-Data-Source": workbenchDataSource(projection),
    });
  } catch (error) {
    if (error instanceof ProjectCommandHttpError) {
      return json({ error: error.code, message: error.message }, error.status);
    }
    if (error instanceof EngineeringProjectCommandError) {
      const status = error.code === "entity_not_found" ? 422 : error.httpStatus;
      const body: Record<string, unknown> = {
        error: error.code,
        message: error.message,
      };
      if (error.code === "stale_revision" && command) {
        body.expectedRevision = command.expectedRevision;
        body.actualRevision = (await options.projectStore.get(command.projectId))
          ?.revision;
      }
      return json(body, status);
    }
    console.error(
      `Operator command failed unexpectedly: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return json({
      error: "operator_command_failed",
      message: "The operator command could not be applied.",
    }, 500);
  }
}

async function projectWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot | undefined,
  options: NativeWorkbenchHandlerOptions,
  liveUpdates?: LiveThreadUpdate[],
): Promise<EngineeringWorkbenchSnapshot> {
  if (!snapshot) {
    if (project.threadSnapshots.length > 0) {
      throw new Error(
        "A declared technical baseline could not be resolved for this project.",
      );
    }
    if (project.project.subjectId !== options.subjectId) {
      throw new Error(
        `Engineering project subject ${project.project.subjectId} does not match configured subject ${options.subjectId}.`,
      );
    }
    return projectEngineeringPlanningWorkbenchSnapshot(
      project,
      liveUpdates ?? (await options.liveUpdates?.list(options.subjectId) ?? []),
      { operatorCommandsEnabled: options.projectCommands !== undefined },
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
    (await options.liveUpdates?.list(options.subjectId) ?? []);
  return projectEngineeringWorkbenchSnapshot(
    validatedProject,
    await projectThreadSnapshot(snapshot, options, updates),
    snapshot.revision,
    {
      operatorCommandsEnabled: options.projectCommands !== undefined,
      liveUpdates: updates,
    },
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
): Promise<ThreadSnapshot | undefined> {
  // A project created from approved discovery is intentionally not allowed to
  // borrow whatever happens to be the current subject head. Before the first
  // deterministic operation publishes a declared baseline, it is planning
  // provenance only.
  if (project.threadSnapshots.length === 0) return undefined;
  const [active, declared] = await Promise.all([
    options.store.latest(options.subjectId),
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
  INSPECTION_DRONE_ARCHITECTURE_OPERATION,
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
  liveUpdates?: LiveThreadUpdate[],
) {
  const canonical = projectThreadWorkbenchSnapshot(
    snapshot,
    options.componentCatalog,
  );
  const updates = liveUpdates ??
    (await options.liveUpdates?.list(options.subjectId) ?? []);
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
  const hostname = argument("host") ?? "127.0.0.1";
  const operatorCommandsEnabled = isExplicitLoopbackHostname(hostname);
  const port = integerArgument("port") ?? 5173;
  const snapshotDirectory = argument("snapshot-dir") ??
    "state/local/thread-snapshots";
  const explicitSubjectId = argument("subject");
  const projectId = resolveNativeWorkbenchProjectId(
    argument("project-id"),
    explicitSubjectId,
  );
  const projectPath = argument("project") ??
    `config/projects/${projectId}.project.json`;
  const activeProjectDirectory = argument("active-project-dir") ??
    "state/local/engineering-projects";
  const projectBaselineDirectory = argument("project-baseline-dir") ??
    "config/projects/baselines";
  const projectBaselineAssetDirectory = argument("project-baseline-asset-dir") ??
    `${projectBaselineDirectory}/assets`;
  const htmlPath = argument("html") ??
    "src/ui/dist/thread/native-workbench.html";
  const assetDirectory = argument("asset-dir") ?? "state/local/thread-assets";
  const liveUpdateDirectory = argument("live-update-dir") ??
    "state/local/live-thread-updates";
  const projectDiscoveryDirectory = argument("project-discovery-dir") ??
    "state/local/project-discoveries";
  const approvedDiscoveryCaptureDirectory = argument(
    "approved-discovery-capture-dir",
  ) ?? "state/local/approved-discovery-captures";
  const html = await Deno.readTextFile(htmlPath);
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const discoveries = new FileProjectDiscoveryRevisionStore(
    projectDiscoveryDirectory,
  );
  const captures = new FileApprovedDiscoveryBaselineCaptureStore(
    approvedDiscoveryCaptureDirectory,
  );
  const projectRuntime = await createEngineeringProjectCommandRuntime({
    projectId,
    trackedManifestPath: projectPath,
    activeDirectory: activeProjectDirectory,
    evidenceSnapshots: projectSnapshots,
    planning: { discoveries, operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
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
  const componentCatalogPath = argument("component-catalog") ??
    `config/thread-subjects/${subjectId}.components.json`;
  const componentCatalog = await readOptionalComponentCatalog(componentCatalogPath);
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(assetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const liveUpdates = new FileLiveThreadUpdateStore(liveUpdateDirectory);
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: projectRuntime.projects,
    projectCommands: operatorCommandsEnabled ? projectRuntime.commands : undefined,
    projectId,
    projectSnapshots,
    subjectId,
    html,
    componentCatalog,
    liveUpdates,
    assetReader: (filename) => assetReader.read(filename),
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
      console.log(`Discovery revisions: ${projectDiscoveryDirectory}`);
      console.log(`Documentary captures: ${approvedDiscoveryCaptureDirectory}`);
      console.log(
        operatorCommandsEnabled
          ? "Page loads are read-only; explicit same-origin operator commands mutate only EngineeringProject revisions."
          : "Read-only Workbench: operator commands are disabled on a non-loopback binding.",
      );
    },
  }, handler);
}

async function readOptionalComponentCatalog(
  path: string,
): Promise<ThreadComponentCatalog | undefined> {
  try {
    return validateThreadComponentCatalog(JSON.parse(await Deno.readTextFile(path)));
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

function configuredProjectId(options: NativeWorkbenchHandlerOptions): string {
  return options.projectId ?? options.subjectId;
}

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return Deno.args.find((value) => value.startsWith(prefix))?.slice(
    prefix.length,
  );
}

function integerArgument(name: string): number | undefined {
  const value = argument(name);
  if (value === undefined) return undefined;
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0 || result > 65535) {
    throw new Error(`--${name} must be an integer between 1 and 65535.`);
  }
  return result;
}
