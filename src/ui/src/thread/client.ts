import { COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE } from "../project/fixture.ts";
import {
  type EngineeringWorkbenchSnapshot,
  isEngineeringWorkbenchSnapshot,
} from "./types.ts";

export interface ThreadWorkbenchClient {
  readonly source: "injected" | "http" | "fixture";
  load(signal?: AbortSignal): Promise<EngineeringWorkbenchSnapshot>;
  /** Optional server-pushed replacement workbench states. */
  subscribe?(
    onSnapshot: (snapshot: EngineeringWorkbenchSnapshot) => void,
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
    private readonly projection: EngineeringWorkbenchSnapshot,
    readonly source: "injected" | "fixture",
  ) {}

  load(): Promise<EngineeringWorkbenchSnapshot> {
    return Promise.resolve(this.projection);
  }
}

/**
 * Browser client for the digital-thread BFF.
 *
 * Reads use normal HTTP GET and SSE. There is no MCP client, credential, tool
 * name, write channel or implicit recompute behavior in the browser.
 */
export class HttpThreadWorkbenchClient implements ThreadWorkbenchClient {
  readonly source = "http" as const;

  constructor(
    private readonly endpoint: string,
    private readonly fetcher: ThreadFetch = globalThis.fetch.bind(globalThis),
    private readonly eventsEndpoint?: string,
  ) {}

  async load(signal?: AbortSignal): Promise<EngineeringWorkbenchSnapshot> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Engineering Workbench HTTP ${response.status}.`);
    }
    const value: unknown = await response.json();
    if (!isEngineeringWorkbenchSnapshot(value)) {
      throw new Error(
        "The EngineeringWorkbench projection has an unsupported contract.",
      );
    }
    return value;
  }

  subscribe(
    onSnapshot: (snapshot: EngineeringWorkbenchSnapshot) => void,
    onStatus?: (status: ThreadStreamStatus) => void,
  ): () => void {
    if (!this.eventsEndpoint || typeof EventSource === "undefined") {
      return () => {};
    }
    onStatus?.("connecting");
    const source = new EventSource(this.eventsEndpoint);
    source.addEventListener("open", () => onStatus?.("live"));
    source.addEventListener("workbench-snapshot", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!isEngineeringWorkbenchSnapshot(value)) return;
        onSnapshot(value);
        onStatus?.("live");
      } catch {
        // A malformed event is ignored; the last valid snapshot remains visible.
      }
    });
    source.addEventListener("error", () => onStatus?.("reconnecting"));
    source.addEventListener("cockpit-focus", () => {
      // A paired agent changed the durable workspace target. The root serves
      // the next full native surface; the browser does not select it itself.
      globalThis.location?.reload();
    });
    return () => source.close();
  }
}

export function createThreadWorkbenchClient(
  bootstrap?: ThreadWorkbenchBootstrap,
): ThreadWorkbenchClient {
  if (bootstrap?.projection !== undefined) {
    if (!isEngineeringWorkbenchSnapshot(bootstrap.projection)) {
      throw new Error(
        "The injected EngineeringWorkbench projection has an unsupported contract.",
      );
    }
    return new StaticThreadWorkbenchClient(bootstrap.projection, "injected");
  }
  if (bootstrap?.endpoint) {
    return new HttpThreadWorkbenchClient(bootstrap.endpoint);
  }
  return new StaticThreadWorkbenchClient(
    COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE,
    "fixture",
  );
}
