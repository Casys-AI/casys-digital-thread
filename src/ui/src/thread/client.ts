import { COFFEE_MACHINE_THREAD_FIXTURE } from "./fixture.ts";
import {
  isThreadWorkbenchSnapshot,
  type ThreadWorkbenchSnapshot,
} from "./types.ts";

export interface ThreadWorkbenchClient {
  readonly source: "injected" | "http" | "fixture";
  load(signal?: AbortSignal): Promise<ThreadWorkbenchSnapshot>;
  /** Optional server-pushed replacement snapshots for live evidence following. */
  subscribe?(
    onSnapshot: (snapshot: ThreadWorkbenchSnapshot) => void,
    onStatus?: (status: ThreadStreamStatus) => void,
  ): () => void;
}

export type ThreadStreamStatus = "connecting" | "live" | "reconnecting";

export interface ThreadWorkbenchBootstrap {
  projection?: unknown;
  endpoint?: string;
}

export type ThreadFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class StaticThreadWorkbenchClient implements ThreadWorkbenchClient {
  constructor(
    private readonly projection: ThreadWorkbenchSnapshot,
    readonly source: "injected" | "fixture",
  ) {}

  load(): Promise<ThreadWorkbenchSnapshot> {
    return Promise.resolve(this.projection);
  }
}

/**
 * Read-only browser client for the future digital-thread BFF.
 *
 * It performs a normal HTTP GET. It has no MCP client, credentials, tool
 * names, or implicit recompute behavior.
 */
export class HttpThreadWorkbenchClient implements ThreadWorkbenchClient {
  readonly source = "http" as const;

  constructor(
    private readonly endpoint: string,
    private readonly fetcher: ThreadFetch = globalThis.fetch.bind(globalThis),
    private readonly eventsEndpoint?: string,
  ) {}

  async load(signal?: AbortSignal): Promise<ThreadWorkbenchSnapshot> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Thread snapshot HTTP ${response.status}.`);
    }
    const value: unknown = await response.json();
    if (!isThreadWorkbenchSnapshot(value)) {
      throw new Error(
        "The ThreadWorkbench projection has an unsupported contract.",
      );
    }
    return value;
  }

  subscribe(
    onSnapshot: (snapshot: ThreadWorkbenchSnapshot) => void,
    onStatus?: (status: ThreadStreamStatus) => void,
  ): () => void {
    if (!this.eventsEndpoint || typeof EventSource === "undefined") {
      return () => {};
    }
    onStatus?.("connecting");
    const source = new EventSource(this.eventsEndpoint);
    source.addEventListener("open", () => onStatus?.("live"));
    source.addEventListener("thread-snapshot", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!isThreadWorkbenchSnapshot(value)) return;
        onSnapshot(value);
        onStatus?.("live");
      } catch {
        // A malformed event is ignored; the last valid snapshot remains visible.
      }
    });
    source.addEventListener("error", () => onStatus?.("reconnecting"));
    return () => source.close();
  }
}

export function createThreadWorkbenchClient(
  bootstrap?: ThreadWorkbenchBootstrap,
): ThreadWorkbenchClient {
  if (bootstrap?.projection !== undefined) {
    if (!isThreadWorkbenchSnapshot(bootstrap.projection)) {
      throw new Error(
        "The injected ThreadWorkbench projection has an unsupported contract.",
      );
    }
    return new StaticThreadWorkbenchClient(bootstrap.projection, "injected");
  }
  if (bootstrap?.endpoint) {
    return new HttpThreadWorkbenchClient(bootstrap.endpoint);
  }
  return new StaticThreadWorkbenchClient(
    COFFEE_MACHINE_THREAD_FIXTURE,
    "fixture",
  );
}
