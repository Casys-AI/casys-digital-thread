import type { ProjectDiscoverySnapshot } from "../../../domain/project-discovery.ts";
import {
  PROJECT_DISCOVERY_INTENT_HEADER,
  type ProjectDiscoveryOperatorCommandRequest,
} from "./discovery-command-contract.ts";
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
  command(
    request: ProjectDiscoveryOperatorCommandRequest,
    signal?: AbortSignal,
  ): Promise<ProjectDiscoverySnapshot>;
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
    private readonly commandsEndpoint: string,
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

  async command(
    request: ProjectDiscoveryOperatorCommandRequest,
    signal?: AbortSignal,
  ): Promise<ProjectDiscoverySnapshot> {
    const response = await this.fetcher(this.commandsEndpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [PROJECT_DISCOVERY_INTENT_HEADER]: "explicit",
      },
      body: JSON.stringify(request),
      signal,
    });
    if (response.status === 409) {
      const failure = await readJsonRecord(response);
      throw new ProjectDiscoveryConflictError(
        typeof failure?.actualRevision === "number"
          ? failure.actualRevision
          : undefined,
      );
    }
    if (!response.ok) {
      const failure = await readJsonRecord(response);
      throw new ProjectDiscoveryHttpError(
        response.status,
        typeof failure?.message === "string"
          ? failure.message
          : `Project discovery command HTTP ${response.status}.`,
      );
    }
    return readSnapshot(
      await response.json(),
      "The discovery command returned an unsupported contract.",
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

export class ProjectDiscoveryConflictError extends Error {
  readonly status = 409;

  constructor(readonly actualRevision?: number) {
    super("The project discovery changed before this command was applied.");
    this.name = "ProjectDiscoveryConflictError";
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

async function readJsonRecord(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function nativeEventSourceFactory():
  | ProjectDiscoveryEventSourceFactory
  | undefined {
  if (typeof EventSource === "undefined") return undefined;
  return (endpoint) => new EventSource(endpoint);
}
