import { COFFEE_MACHINE_ENGINEERING_WORKBENCH_FIXTURE } from "../project/fixture.ts";
import type {
  OperatorCommandCapabilities,
  ProjectCommandRequest,
} from "../project/command-contract.ts";
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
  /** Explicit human command channel. Its absence is a read-only capability. */
  command?(
    request: ProjectCommandRequest,
    signal?: AbortSignal,
  ): Promise<EngineeringWorkbenchSnapshot>;
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
 * Reads use normal HTTP GET. Explicit human commands are only enabled by the
 * returned capability; there is no MCP client, credential, tool name, or
 * implicit recompute behavior in the browser.
 */
export class HttpThreadWorkbenchClient implements ThreadWorkbenchClient {
  readonly source = "http" as const;
  private operatorCommands?: OperatorCommandCapabilities;

  constructor(
    private readonly endpoint: string,
    private readonly fetcher: ThreadFetch = globalThis.fetch.bind(globalThis),
    private readonly eventsEndpoint?: string,
  ) {}

  async load(signal?: AbortSignal): Promise<EngineeringWorkbenchSnapshot> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
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
    this.operatorCommands = value.capabilities?.operatorCommands;
    return value;
  }

  async command(
    request: ProjectCommandRequest,
    signal?: AbortSignal,
  ): Promise<EngineeringWorkbenchSnapshot> {
    const capability = this.operatorCommands;
    if (!capability?.enabled) {
      throw new Error("Operator commands are disabled for this Workbench.");
    }
    if (!capability.intents.includes(request.command.type)) {
      throw new Error(
        `Operator command ${request.command.type} is not allowed by the server.`,
      );
    }
    const response = await this.fetcher(capability.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        [capability.explicitIntentHeader]: "explicit",
      },
      body: JSON.stringify(request),
      signal,
    });
    if (response.status === 409) {
      const conflict = await readJsonRecord(response);
      throw new ProjectCommandConflictError(
        typeof conflict?.actualRevision === "number"
          ? conflict.actualRevision
          : undefined,
      );
    }
    if (!response.ok) {
      const failure = await readJsonRecord(response);
      throw new ProjectCommandHttpError(
        response.status,
        typeof failure?.message === "string"
          ? failure.message
          : `Engineering project command HTTP ${response.status}.`,
      );
    }
    const value: unknown = await response.json();
    if (!isEngineeringWorkbenchSnapshot(value)) {
      throw new Error(
        "The command response has an unsupported EngineeringWorkbench contract.",
      );
    }
    this.operatorCommands = value.capabilities?.operatorCommands;
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
    source.addEventListener("thread-snapshot", (event) => {
      try {
        const value: unknown = JSON.parse((event as MessageEvent<string>).data);
        if (!isEngineeringWorkbenchSnapshot(value)) return;
        this.operatorCommands = value.capabilities?.operatorCommands;
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

export class ProjectCommandConflictError extends Error {
  readonly status = 409;

  constructor(readonly actualRevision?: number) {
    super("The engineering project changed before this command was applied.");
    this.name = "ProjectCommandConflictError";
  }
}

export class ProjectCommandHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ProjectCommandHttpError";
  }
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
