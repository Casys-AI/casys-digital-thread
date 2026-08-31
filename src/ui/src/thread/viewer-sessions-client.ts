import {
  isThreadViewerSessionsProjection,
  type ThreadViewerSessionsProjection,
} from "../../../presentation/workbench/thread/viewer-sessions.ts";

export type {
  ThreadViewerSession,
  ThreadViewerSessionsProjection,
} from "../../../presentation/workbench/thread/viewer-sessions.ts";

export interface ThreadViewerSessionsClient {
  load(signal?: AbortSignal): Promise<ThreadViewerSessionsProjection>;
  /** Complete server replacements only; partial browser patches are refused. */
  subscribe?(
    onProjection: (projection: ThreadViewerSessionsProjection) => void,
  ): () => void;
}

export type ThreadViewerSessionsFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Read-only browser client for exact viewer-session descriptors.
 *
 * This intentionally has no MCP transport, credential input, command path or
 * refresh action. It reads only exact, browser-safe whole-App descriptors;
 * the spatial shell may fetch and attest their same-origin launch bytes before
 * framing a confined Blob, while the separate App host owns every Apps
 * handshake and session delivery.
 */
export class HttpThreadViewerSessionsClient
  implements ThreadViewerSessionsClient {
  constructor(
    private readonly endpoint: string,
    private readonly eventsEndpoint?: string,
    private readonly fetcher: ThreadViewerSessionsFetch = globalThis.fetch.bind(
      globalThis,
    ),
  ) {}

  async load(signal?: AbortSignal): Promise<ThreadViewerSessionsProjection> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Thread viewer sessions HTTP ${response.status}.`);
    }
    const value: unknown = await response.json();
    if (!isThreadViewerSessionsProjection(value)) {
      throw new Error(
        "The Thread viewer-sessions projection has an unsupported contract.",
      );
    }
    return value;
  }

  subscribe(
    onProjection: (projection: ThreadViewerSessionsProjection) => void,
  ): () => void {
    if (!this.eventsEndpoint || typeof EventSource === "undefined") {
      return () => {};
    }
    const source = new EventSource(this.eventsEndpoint);
    source.addEventListener("viewer-sessions", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!isThreadViewerSessionsProjection(value)) return;
        onProjection(value);
      } catch {
        // A malformed replacement never changes the current exact descriptors.
      }
    });
    return () => source.close();
  }
}

/**
 * Viewer descriptors are useful only for the exact evidence basis currently
 * loaded by the Workbench. A matching label, provider or asset is never a
 * substitute for this complete project/thread identity.
 */
export function viewerSessionsMatchWorkbench(
  projection: ThreadViewerSessionsProjection,
  workbench: {
    readonly surface: "planning" | "documentary" | "evidence";
    readonly project: {
      readonly id: string;
      readonly revision: number;
      readonly project: { readonly id: string; readonly subjectId: string };
    };
    readonly thread?: { readonly id: string };
    readonly alignment?: { readonly currentThreadRevision: number };
  },
): boolean {
  const { basis } = projection;
  if (basis.projectId !== workbench.project.project.id) return false;
  if (
    basis.projectRevision !== workbench.project.revision ||
    basis.subjectId !== workbench.project.project.subjectId
  ) return false;
  if (workbench.surface !== "evidence") return true;
  return basis.thread !== undefined &&
    basis.thread.id === workbench.thread?.id &&
    basis.thread.revision === workbench.alignment?.currentThreadRevision;
}

/** The server sequence is strictly monotonic for one exact projection basis. */
export function shouldAcceptViewerSessionsUpdate(
  current: ThreadViewerSessionsProjection | undefined,
  incoming: ThreadViewerSessionsProjection,
): boolean {
  if (!current) return true;
  if (
    current.basis.projectId !== incoming.basis.projectId ||
    current.basis.projectRevision !== incoming.basis.projectRevision ||
    current.basis.subjectId !== incoming.basis.subjectId ||
    current.basis.thread?.id !== incoming.basis.thread?.id ||
    current.basis.thread?.revision !== incoming.basis.thread?.revision
  ) {
    return true;
  }
  return incoming.sequence > current.sequence;
}
