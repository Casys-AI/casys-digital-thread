import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import { isProjectDiscoverySnapshot } from "./discovery-contract.ts";

export type ProjectDiscoveryStreamStatus =
  | "connecting"
  | "live"
  | "reconnecting";

export interface ProjectDiscoveryClient {
  load(signal?: AbortSignal): Promise<ProjectDiscoverySnapshot>;
  subscribe(
    onSnapshot: (snapshot: ProjectDiscoverySnapshot) => void,
    onStatus?: (status: ProjectDiscoveryStreamStatus) => void,
  ): () => void;
}

export type ProjectDiscoveryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ProjectDiscoveryEventSource {
  addEventListener(
    type: string,
    listener: (event: Event) => void,
  ): void;
  close(): void;
}

export type ProjectDiscoveryEventSourceFactory = (
  endpoint: string,
) => ProjectDiscoveryEventSource;

/** HTTP/SSE client for one immutable ProjectDiscovery revision stream. */
export class HttpProjectDiscoveryClient implements ProjectDiscoveryClient {
  constructor(
    private readonly endpoint: string,
    private readonly eventsEndpoint: string,
    private readonly fetcher: ProjectDiscoveryFetch = globalThis.fetch.bind(
      globalThis,
    ),
    private readonly eventSourceFactory:
      | ProjectDiscoveryEventSourceFactory
      | undefined = nativeEventSourceFactory(),
  ) {}

  async load(signal?: AbortSignal): Promise<ProjectDiscoverySnapshot> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new ProjectDiscoveryHttpError(
        response.status,
        `Project discovery HTTP ${response.status}.`,
      );
    }
    return readSnapshot(
      await response.json(),
      "The project discovery endpoint returned an unsupported contract.",
    );
  }

  subscribe(
    onSnapshot: (snapshot: ProjectDiscoverySnapshot) => void,
    onStatus?: (status: ProjectDiscoveryStreamStatus) => void,
  ): () => void {
    if (!this.eventSourceFactory) return () => {};

    onStatus?.("connecting");
    const source = this.eventSourceFactory(this.eventsEndpoint);
    source.addEventListener("open", () => onStatus?.("live"));
    source.addEventListener("project-discovery-snapshot", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!isProjectDiscoverySnapshot(value)) return;
        onSnapshot(value);
        onStatus?.("live");
      } catch {
        // Preserve the last valid revision when an event is malformed.
      }
    });
    source.addEventListener("error", () => onStatus?.("reconnecting"));
    return () => source.close();
  }
}

export class ProjectDiscoveryHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProjectDiscoveryHttpError";
  }
}

function readSnapshot(
  value: unknown,
  message: string,
): ProjectDiscoverySnapshot {
  if (!isProjectDiscoverySnapshot(value)) throw new Error(message);
  return value;
}

function nativeEventSourceFactory():
  | ProjectDiscoveryEventSourceFactory
  | undefined {
  if (typeof EventSource === "undefined") return undefined;
  return (endpoint) => new EventSource(endpoint);
}
