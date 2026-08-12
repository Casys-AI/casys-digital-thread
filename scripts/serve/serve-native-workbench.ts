import { parseArgs } from "../lib/cli.ts";
import type { ThreadSnapshotStore } from "../../src/domain/thread/thread-snapshot-store.ts";
import type { ThreadSnapshot } from "../../src/domain/thread/thread-snapshot.ts";
import type { EngineeringProjectSnapshot } from "../../src/domain/project/engineering-project.ts";
import type { EngineeringProjectRevisionStore } from "../../src/domain/project/engineering-project-command-service.ts";
import { validateEngineeringProjectThreadReferences } from "../../src/domain/project/engineering-project-validation.ts";
import { fingerprintsEqual } from "../../src/domain/kernel/deterministic-json.ts";
import {
  type ProjectReviewIntent,
  type ProjectReviewIntentRecord,
  validateProjectReviewIntent,
} from "../../src/domain/project/project-review-intent.ts";
import { HttpMcpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/stores/file-thread-snapshot-store.ts";
import {
  FileProjectReviewIntentStore,
  ProjectReviewIntentConflictError,
  type ProjectReviewIntentStore,
} from "../../src/adapters/stores/file-project-review-intent-store.ts";
import {
  type CockpitFocusStore,
  FileCockpitFocusStore,
} from "../../src/adapters/stores/file-cockpit-focus-store.ts";
import {
  ARCHITECTURE_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
  GEOMETRY_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
  SOURCE_ANALYSIS_CAPTURE_DESCRIPTOR,
  SYSML_SOURCE_CAPTURE_DESCRIPTOR,
} from "../../src/adapters/captures/file-capture-store.ts";
import {
  requireSysmlSourceAnalysis,
  type SysmlSourceAnalysisReader,
} from "../../src/adapters/captures/sysml-source-analysis-capture.ts";
import { GEOMETRY_DRAFT_ASSETS_DIR } from "../../src/adapters/captures/geometry-draft-capture.ts";
import { FileEngineeringProjectRevisionStore } from "../../src/adapters/stores/engineering-project-store.ts";
import { isExplicitLoopbackHostname } from "../../src/adapters/loopback-host.ts";
import {
  type EngineeringWorkbenchSnapshot,
  projectEngineeringPlanningWorkbenchSnapshot,
  projectEngineeringWorkbenchSnapshot,
} from "../../src/adapters/projectors/engineering-workbench-projector.ts";
import {
  type ExactThreadSnapshotReader,
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../../src/adapters/stores/engineering-thread-snapshot-resolver.ts";
import { threadSnapshotDescendsFrom } from "../../src/adapters/stores/thread-snapshot-lineage.ts";
import {
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
} from "../../src/orchestration/operations/inspection-drone-v4.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../src/domain/platform/architecture-proposal.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../src/domain/platform/geometry-proposal.ts";
import { MODEL_WRITE_REQUIREMENTS_OPERATION } from "../../src/domain/platform/requirements-proposal.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../../src/domain/platform/syson-model-seed.ts";
import {
  Base64EngineeringAssetReader,
  FileEngineeringAssetReader,
  OrderedEngineeringAssetReader,
} from "../../src/adapters/engineering-asset-resolver.ts";
import { projectThreadWorkbenchSnapshot } from "../../src/adapters/projectors/thread-workbench-projector.ts";
import {
  FileLiveThreadUpdateStore,
  type LiveThreadUpdate,
  type LiveThreadUpdateJournal,
  overlayLiveThreadUpdates,
} from "../../src/adapters/stores/live-thread-update-store.ts";
import {
  type ThreadComponentCatalog,
  validateThreadComponentCatalog,
} from "../../src/domain/thread/thread-component-catalog.ts";
import { resolveInspectionDroneV4ProductStructureCatalog } from "../../src/adapters/projectors/inspection-drone-v4-product-structure-catalog.ts";
import type {
  GenericArchitectureCaptureReader,
} from "../../src/adapters/projectors/product-structure-catalog.ts";
import { resolveGenericProductStructureCatalog } from "../../src/adapters/projectors/product-structure-catalog.ts";
import type { GenericGeometryCaptureReader } from "../../src/adapters/projectors/geometry-bundle-product-catalog.ts";

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
  /** Testable boundary for content-addressed, non-canonical geometry previews. */
  draftAssetReader?: (digest: string) => Promise<Uint8Array | undefined>;
  /** Durable reviewer-to-agent outbox. It has no project mutation method. */
  reviewIntents?: ProjectReviewIntentStore;
  /**
   * Best-effort MCP wake-up emitted only after the durable outbox append has
   * completed. The outbox remains authoritative when no host is subscribed.
   */
  reviewIntentSignal?: {
    notify(record: ProjectReviewIntentRecord): Promise<void>;
  };
  /** Testable/loggable failure seam; signalling never rolls back the outbox. */
  onReviewIntentSignalError?: (error: unknown) => void;
  /** Polling only observes persisted snapshots; it never executes a tool. */
  pollIntervalMs?: number;
}

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
    port: integerArgument("port", cliArgs) ?? 5173,
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
    if (url.pathname === "/api/thread/workbench/events") {
      if (request.method !== "GET") return methodNotAllowed();
      return await snapshotEventStream(request, options);
    }
    if (url.pathname === "/api/review-intents") {
      if (request.method === "GET") {
        return await listProjectReviewIntents(options);
      }
      if (request.method === "POST") {
        return await appendProjectReviewIntent(request, url, options);
      }
      return methodNotAllowed("GET, POST");
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

const REVIEW_INTENT_MAX_BODY_BYTES = 16_384;

async function listProjectReviewIntents(
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.reviewIntents) return reviewIntentOutboxUnavailable();
  let context: ActiveTargetResolution;
  try {
    context = await resolveActiveProject(options);
  } catch (error) {
    if (error instanceof NativeWorkbenchProjectNotFoundError) {
      return projectNotFound(error.projectId);
    }
    throw error;
  }
  return json({
    projectId: context.projectId,
    projectRevision: context.project.revision,
    intents: await options.reviewIntents.list(context.projectId),
  }, 200);
}

async function appendProjectReviewIntent(
  request: Request,
  url: URL,
  options: NativeWorkbenchHandlerOptions,
): Promise<Response> {
  if (!options.reviewIntents) return reviewIntentOutboxUnavailable();
  if (!requestIsSameOrigin(request, url)) {
    return json({ error: "cross_origin_review_intent_forbidden" }, 403);
  }
  if (!requestHasJsonContentType(request)) {
    return json({ error: "review_intent_requires_application_json" }, 415);
  }
  let raw: unknown;
  try {
    raw = await readBoundedJson(request, REVIEW_INTENT_MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof ReviewIntentBodyTooLargeError) {
      return json({ error: "review_intent_body_too_large" }, 413);
    }
    return json({ error: "invalid_review_intent_json" }, 400);
  }

  let intent: ProjectReviewIntent;
  try {
    intent = validateProjectReviewIntent(raw);
  } catch (error) {
    return json({
      error: "invalid_review_intent",
      message: error instanceof Error ? error.message : "Invalid review intent.",
    }, 400);
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
  if (
    intent.projectId !== context.projectId ||
    intent.projectId !== context.project.project.id
  ) {
    return reviewIntentConflict(
      "review_intent_project_mismatch",
      context,
    );
  }
  if (intent.expectedRevision !== context.project.revision) {
    return reviewIntentConflict("review_intent_stale_revision", context);
  }
  const decision = context.project.decisions.find((candidate) =>
    candidate.id === intent.decisionId
  );
  if (!decision || decision.status !== "proposed") {
    return reviewIntentConflict(
      "review_intent_decision_not_proposed",
      context,
    );
  }
  if (
    !decision.inputFingerprint ||
    !fingerprintsEqual(intent.inputFingerprint, decision.inputFingerprint)
  ) {
    return reviewIntentConflict(
      "review_intent_fingerprint_mismatch",
      context,
    );
  }
  const approval = [...decision.approvalIds].reverse().map((approvalId) =>
    context.project.approvals.find((candidate) => candidate.id === approvalId)
  ).find((candidate) => candidate?.status === "pending");
  if (
    !approval || approval.id !== intent.approvalId ||
    approval.decisionId !== decision.id || !approval.inputFingerprint ||
    !fingerprintsEqual(approval.inputFingerprint, intent.inputFingerprint)
  ) {
    return reviewIntentConflict(
      "review_intent_approval_mismatch",
      context,
    );
  }

  try {
    const record = await options.reviewIntents.append(intent);
    let signal: "not-configured" | "sent" | "deferred" = "not-configured";
    if (options.reviewIntentSignal) {
      try {
        await options.reviewIntentSignal.notify(record);
        signal = "sent";
      } catch (error) {
        signal = "deferred";
        options.onReviewIntentSignalError?.(error);
      }
    }
    return json({
      status: "accepted",
      projectId: context.projectId,
      projectRevision: context.project.revision,
      signal,
      record,
    }, 202);
  } catch (error) {
    if (error instanceof ProjectReviewIntentConflictError) {
      return reviewIntentConflict("review_intent_conflict", context);
    }
    throw error;
  }
}

function requestIsSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("Origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === url.origin;
  } catch {
    return false;
  }
}

function requestHasJsonContentType(request: Request): boolean {
  return request.headers.get("Content-Type")?.split(";", 1)[0].trim()
    .toLowerCase() === "application/json";
}

class ReviewIntentBodyTooLargeError extends Error {}

async function readBoundedJson(request: Request, limit: number): Promise<unknown> {
  const declaredLength = request.headers.get("Content-Length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)
  ) {
    throw new ReviewIntentBodyTooLargeError();
  }
  if (!request.body) throw new SyntaxError("missing JSON body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    length += result.value.byteLength;
    if (length > limit) {
      await reader.cancel();
      throw new ReviewIntentBodyTooLargeError();
    }
    chunks.push(result.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function reviewIntentConflict(
  error: string,
  context: ActiveTargetResolution,
): Response {
  return json({
    error,
    projectId: context.projectId,
    currentRevision: context.project.revision,
  }, 409);
}

function reviewIntentOutboxUnavailable(): Response {
  return json({ error: "review_intent_outbox_unavailable" }, 503);
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
  // A known provider-durable operation can make a next ThreadSnapshot durable before
  // completeRun attaches that exact reference to the project. A crash in that
  // narrow interval must not let an undeclared descendant become canonical in
  // the browser. Keep the declared head on screen; projectWorkbenchSnapshot
  // still overlays the bounded live journal onto it. The durable result
  // becomes eligible only after completeRun records its exact reference in
  // immutable project state.
  if (hasUnattachedProviderDurableProjectOperation(project)) return declared;
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
 * These exact server-owned operations persist a provider-derived snapshot
 * before completeRun attaches its reference to immutable project state. A
 * forward head is therefore not browser-canonical while one is still active.
 * Additions are intentionally explicit: a registered operation alone does
 * not establish this persistence ordering.
 */
const PROVIDER_DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS = [
  SYSON_MODEL_SEED_OPERATION,
  INSPECTION_DRONE_V4_ARCHITECTURE_OPERATION,
  INSPECTION_DRONE_V4_PART_DEFINITIONS_OPERATION,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
  MODEL_WRITE_REQUIREMENTS_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
] as const;

function hasUnattachedProviderDurableProjectOperation(
  project: EngineeringProjectSnapshot,
): boolean {
  const workItems = new Map(project.workItems.map((item) => [item.id, item]));
  return project.agentRuns.some((run) => {
    if (!isAwaitingProviderDurableProjectAttachment(run.status)) {
      return false;
    }
    const operation = workItems.get(run.workItemId)?.operation;
    return PROVIDER_DURABLE_BEFORE_PROJECT_ATTACHMENT_OPERATIONS.some((candidate) =>
      operation?.id === candidate.id && operation.version === candidate.version
    );
  });
}

function isAwaitingProviderDurableProjectAttachment(
  status: EngineeringProjectSnapshot["agentRuns"][number]["status"],
): boolean {
  return status === "queued" || status === "running" ||
    status === "waiting-for-decision" || status === "publishing" ||
    // Defensive legacy/recovery guard: older executors could mark a run
    // failed after save(snapshot) succeeded but before readback. A failed
    // provider-durable operation never authorizes an unattached descendant.
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
    headers: {
      "Content-Type": filename.endsWith(".step")
        ? "model/step"
        : filename.endsWith(".glb")
        ? "model/gltf-binary"
        : filename.endsWith(".gltf")
        ? "model/gltf+json"
        : "model/stl",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
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
    headers: {
      "Content-Type": "application/octet-stream",
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
  const reviewIntentDirectory = cliArgs["review-intent-dir"] ??
    "state/local/project-review-intents";
  const reviewIntentMcpUrl = cliArgs["review-intent-mcp-url"] ??
    "http://127.0.0.1:3020/mcp";
  const focusDirectory = cliArgs["focus-dir"] ?? "state/local/cockpit-focus";
  const inspectionDroneV4PartDefinitionsCaptureDirectory =
    cliArgs["inspection-drone-v4-part-definitions-capture-dir"] ??
      "state/local/inspection-drone-v4-part-definitions-captures";
  const architectureCaptureDirectory = cliArgs["architecture-capture-dir"] ??
    ARCHITECTURE_CAPTURE_DESCRIPTOR.directory;
  const geometryCaptureDirectory = cliArgs["geometry-capture-dir"] ??
    GEOMETRY_CAPTURE_DESCRIPTOR.directory;
  const html = await Deno.readTextFile(htmlPath);
  const store = new FileThreadSnapshotStore(snapshotDirectory);
  const projectSnapshots = new OrderedExactThreadSnapshotReader([
    store,
    new FileExactThreadSnapshotDirectory(projectBaselineDirectory),
  ]);
  const cockpitFocus = workspaceId
    ? new FileCockpitFocusStore(focusDirectory)
    : undefined;
  const inspectionDroneV4PartDefinitionsCaptures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_PART_DEFINITIONS_CAPTURE_DESCRIPTOR,
    directory: inspectionDroneV4PartDefinitionsCaptureDirectory,
  });
  const inspectionDroneV4ArchitectureCaptures = new FileCaptureStore({
    ...INSPECTION_DRONE_V4_ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: cliArgs["inspection-drone-v4-architecture-capture-dir"] ??
      "state/local/inspection-drone-v4-architecture-captures",
  });
  const archCaptures = new FileCaptureStore({
    ...ARCHITECTURE_CAPTURE_DESCRIPTOR,
    directory: architectureCaptureDirectory,
  });
  const sysmlSourceCaptures = new FileCaptureStore(SYSML_SOURCE_CAPTURE_DESCRIPTOR);
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
  const reviewIntents = new FileProjectReviewIntentStore(reviewIntentDirectory);
  const reviewIntentMcp = new HttpMcpToolClient({
    mcpUrl: reviewIntentMcpUrl,
    // The durable append already succeeded; keep this best-effort wake-up
    // short so a stopped MCP host cannot hold the Workbench in "Sending".
    timeoutMs: 1_000,
  });
  const handler = createNativeWorkbenchHandler({
    store,
    projectStore,
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
      await resolveInspectionDroneV4ProductStructureCatalog(
        snapshot,
        {
          architecture: inspectionDroneV4ArchitectureCaptures,
          partDefinitions: inspectionDroneV4PartDefinitionsCaptures,
        },
      ) ?? await resolveSnapshotComponentCatalog(
        snapshot,
        archCaptures,
        geometryCaptures,
        sysmlSourceAnalysis,
      ),
    liveUpdates,
    reviewIntents,
    reviewIntentSignal: {
      notify: async (record) => {
        await reviewIntentMcp.callTool({
          name: "project_review_intent_signal",
          arguments: {
            projectId: record.intent.projectId,
            intentId: record.intent.intentId,
          },
        });
      },
    },
    onReviewIntentSignalError: (error) => {
      console.error(
        `Workbench review intent remains durable, but its MCP resource signal was deferred: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
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
      console.log(`Reviewer intent outbox: ${reviewIntentDirectory}`);
      console.log(`Reviewer intent MCP signal: ${reviewIntentMcpUrl}`);
      if (workspaceId) {
        console.log(`Agent-selected cockpit workspace: ${workspaceId}`);
      }
      console.log(
        "Project state: read-only active revisions (no fallback seeding)",
      );
      console.log(
        "Workbench review intents are durable but non-authoritative: project commands and signed human decisions remain in the paired MCP flow.",
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
    if (url.pathname === "/healthz") return await options.native(request);
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
