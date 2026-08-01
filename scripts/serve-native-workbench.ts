import type { ThreadSnapshotStore } from "../src/domain/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../src/domain/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../src/domain/engineering-project.ts";
import { validateEngineeringProjectThreadReferences } from "../src/domain/engineering-project-validation.ts";
import { FileThreadSnapshotStore } from "../src/adapters/file-thread-snapshot-store.ts";
import {
  type EngineeringProjectStore,
  FileEngineeringProjectStore,
} from "../src/adapters/engineering-project-store.ts";
import { projectEngineeringWorkbenchSnapshot } from "../src/adapters/engineering-workbench-projector.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../src/adapters/engineering-thread-snapshot-resolver.ts";
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
  projectStore: EngineeringProjectStore;
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
      const [project, activeSnapshot] = await Promise.all([
        options.projectStore.get(),
        options.store.latest(options.subjectId),
      ]);
      if (!project) return projectNotFound(options.subjectId);
      const snapshot = activeSnapshot ??
        await resolveDeclaredProjectHead(project, options);
      if (!snapshot) {
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
          "X-Casys-Data-Source": projection.thread.live.active.length
            ? "canonical-thread-snapshot+live-updates"
            : "canonical-thread-snapshot",
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
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
          "X-Content-Type-Options": "nosniff",
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
  const initialProject = await options.projectStore.get();
  if (!initialProject) return projectNotFound(options.subjectId);
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
          const [activeSnapshot, latestProject, liveUpdates] = await Promise.all([
            options.store.latest(options.subjectId),
            options.projectStore.get(),
            options.liveUpdates?.list(options.subjectId) ?? [],
          ]);
          // A manifest removed during an established stream cannot revoke the
          // last valid event. A reconnect will receive an explicit 404.
          if (latestProject) project = latestProject;
          const snapshot = activeSnapshot ??
            await resolveDeclaredProjectHead(project, options);
          const liveVersion = liveUpdates.at(-1)?.sequence ?? 0;
          const eventId = snapshot
            ? `${project.revision}:${snapshot.revision}:${liveVersion}`
            : "";
          if (snapshot && eventId !== lastEventId) {
            const projection = await projectWorkbenchSnapshot(
              project,
              snapshot,
              options,
              liveUpdates,
            );
            controller.enqueue(encoder.encode(
              `id: ${eventId}\nevent: thread-snapshot\ndata: ${
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
  snapshot: ThreadSnapshot,
  options: NativeWorkbenchHandlerOptions,
  liveUpdates?: LiveThreadUpdate[],
) {
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
  return projectEngineeringWorkbenchSnapshot(
    validatedProject,
    await projectThreadSnapshot(snapshot, options, liveUpdates),
    snapshot.revision,
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
  return await (options.projectSnapshots ?? options.store).get(
    reference.snapshotId,
  );
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
  const port = integerArgument("port") ?? 5173;
  const snapshotDirectory = argument("snapshot-dir") ??
    "state/local/thread-snapshots";
  const subjectId = argument("subject") ?? "coffee-machine-cm01";
  const projectPath = argument("project") ??
    `config/projects/${subjectId}.project.json`;
  const projectBaselineDirectory = argument("project-baseline-dir") ??
    "config/projects/baselines";
  const projectBaselineAssetDirectory = argument("project-baseline-asset-dir") ??
    `${projectBaselineDirectory}/assets`;
  const htmlPath = argument("html") ??
    "src/ui/dist/thread/native-workbench.html";
  const componentCatalogPath = argument("component-catalog") ??
    `config/thread-subjects/${subjectId}.components.json`;
  const assetDirectory = argument("asset-dir") ?? "state/local/thread-assets";
  const liveUpdateDirectory = argument("live-update-dir") ??
    "state/local/live-thread-updates";
  const html = await Deno.readTextFile(htmlPath);
  const componentCatalog = validateThreadComponentCatalog(
    JSON.parse(await Deno.readTextFile(componentCatalogPath)),
  );
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const assetReader = new OrderedEngineeringAssetReader([
    new FileEngineeringAssetReader(assetDirectory),
    new Base64EngineeringAssetReader(projectBaselineAssetDirectory),
  ]);
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore: new FileEngineeringProjectStore(projectPath),
    projectSnapshots: new OrderedExactThreadSnapshotReader([
      store,
      new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
    ]),
    subjectId,
    html,
    componentCatalog,
    liveUpdates: new FileLiveThreadUpdateStore(liveUpdateDirectory),
    assetReader: (filename) => assetReader.read(filename),
  });

  Deno.serve({
    hostname,
    port,
    onListen: ({ hostname, port }) => {
      console.log(`Native Workbench: http://${hostname}:${port}/`);
      console.log(`Snapshot subject: ${subjectId}`);
      console.log(`Engineering project: ${projectPath}`);
      console.log(`Versioned project baselines: ${projectBaselineDirectory}`);
      console.log(
        `Versioned presentation baselines: ${projectBaselineAssetDirectory}`,
      );
      console.log(`Component identities: ${componentCatalogPath}`);
      console.log(`Live activity journal: ${liveUpdateDirectory}`);
      console.log("Read-only: page loads never execute an engineering tool.");
    },
  }, handler);
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

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: { Allow: "GET" },
  });
}

function projectNotFound(subjectId: string): Response {
  return json({
    error: "engineering_project_not_found",
    subjectId,
  }, 404);
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
