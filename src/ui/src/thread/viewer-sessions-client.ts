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
 * This intentionally has no MCP vocabulary, credential input, command path,
 * refresh action or iframe integration. The BFF remains responsible for
 * resolving and redacting the recorded viewer descriptors.
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
    readonly project: {
      readonly id: string;
      readonly revision: number;
      readonly project: { readonly subjectId: string };
    };
    readonly thread: { readonly id: string };
    readonly alignment: { readonly currentThreadRevision: number };
  },
): boolean {
  const { basis } = projection;
  return basis.projectId === workbench.project.id &&
    basis.projectRevision === workbench.project.revision &&
    basis.subjectId === workbench.project.project.subjectId &&
    basis.thread?.id === workbench.thread.id &&
    basis.thread?.revision === workbench.alignment.currentThreadRevision;
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
