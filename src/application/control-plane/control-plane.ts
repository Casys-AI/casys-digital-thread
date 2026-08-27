import { buildServerRecord } from "./server-drift.ts";
import type { ConsoleMode, ConsoleSnapshot } from "./read-model/console-snapshot.ts";
import type { RunDetail, RunSummary } from "./read-model/engineering-run.ts";
import type { ServerRecord } from "./read-model/fleet-drift.ts";
import type { DesiredServer, FleetManifest } from "./read-model/fleet-manifest.ts";
import type { FleetCounts } from "./read-model/fleet-snapshot.ts";
import type {
  ObservedContainer,
  ObservedServer,
} from "./read-model/fleet-observation.ts";
import type { Availability } from "./read-model/status.ts";
import type { ContainerObserver, McpProbe, McpProbeResult } from "./ports.ts";

export interface ControlPlaneSnapshotOptions {
  /** Ignore the short-lived in-memory snapshot cache. */
  refresh?: boolean;
}

export interface ControlPlaneOptions {
  manifest: FleetManifest;
  probe: McpProbe;
  docker: ContainerObserver;
  now?: () => Date;
  monotonicNow?: () => number;
  cacheTtlMs?: number;
  runs: readonly RunDetail[];
}

export class ControlPlaneNotFoundError extends Error {
  constructor(kind: "server" | "run", id: string) {
    super(`Unknown ${kind} id: ${id}`);
    this.name = "ControlPlaneNotFoundError";
  }
}

/**
 * Fleet and indexed-run application service for the `console_*` ops tools.
 * Not a human dashboard: the retired Console MCP App is not registered, and
 * `preview:browser` still refuses.
 */
export class ControlPlane {
  readonly #manifest: FleetManifest;
  readonly #probe: McpProbe;
  readonly #docker: ContainerObserver;
  readonly #now: () => Date;
  readonly #monotonicNow: () => number;
  readonly #cacheTtlMs: number;
  readonly #runs: readonly RunDetail[];
  #cache?: { expiresAt: number; value: ConsoleSnapshot };
  #inFlight?: Promise<ConsoleSnapshot>;

  constructor(options: ControlPlaneOptions) {
    this.#manifest = options.manifest;
    this.#probe = options.probe;
    this.#docker = options.docker;
    this.#now = options.now ?? (() => new Date());
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.#cacheTtlMs = options.cacheTtlMs ?? 5_000;
    this.#runs = options.runs;
  }

  async snapshot(
    options: ControlPlaneSnapshotOptions = {},
  ): Promise<ConsoleSnapshot> {
    const current = this.#monotonicNow();
    if (!options.refresh && this.#cache && this.#cache.expiresAt > current) {
      return structuredClone(this.#cache.value);
    }
    if (!options.refresh && this.#inFlight) {
      return structuredClone(await this.#inFlight);
    }

    const build = this.#buildSnapshot();
    this.#inFlight = build;
    try {
      const value = await build;
      this.#cache = {
        expiresAt: this.#monotonicNow() + this.#cacheTtlMs,
        value,
      };
      return structuredClone(value);
    } finally {
      if (this.#inFlight === build) this.#inFlight = undefined;
    }
  }

  async serverDetail(id: string): Promise<ServerRecord> {
    if (!this.#manifest.servers.some((server) => server.id === id)) {
      throw new ControlPlaneNotFoundError("server", id);
    }
    const snapshot = await this.snapshot();
    const server = snapshot.fleet.servers.find((entry) => entry.id === id);
    if (!server) throw new ControlPlaneNotFoundError("server", id);
    return server;
  }

  runList(): Promise<RunSummary[]> {
    return Promise.resolve(
      this.#runs.map(toRunSummary)
        .sort(compareRunsByEvidenceTime)
        .map((run) => structuredClone(run)),
    );
  }

  runDetail(id: string): Promise<RunDetail> {
    const run = this.#runs.find((entry) => entry.id === id);
    if (!run) return Promise.reject(new ControlPlaneNotFoundError("run", id));
    return Promise.resolve(structuredClone(run));
  }

  async #buildSnapshot(): Promise<ConsoleSnapshot> {
    const generatedAt = this.#now().toISOString();
    const [probeResults, containers, runs] = await Promise.all([
      Promise.all(
        this.#manifest.servers.map((server) => this.#safeProbe(server)),
      ),
      this.#safeDockerObservation(),
      this.runList(),
    ]);

    const servers = this.#manifest.servers.map((desired, index) => {
      const observed: ObservedServer = {
        ...probeResults[index],
        container: containers.get(desired.id) ??
          unavailableContainer("No Docker observation returned."),
      };
      return buildServerRecord(desired, observed);
    });
    const counts = fleetCounts(servers);
    const fleetStatus = fleetAvailability(counts);
    const mode = consoleMode(runs);

    return {
      schemaVersion: "2.0",
      generatedAt,
      mode,
      fleet: {
        status: fleetStatus,
        counts,
        servers,
      },
      runs: {
        items: runs,
      },
    };
  }

  async #safeProbe(server: DesiredServer): Promise<McpProbeResult> {
    try {
      return await this.#probe.probe(server);
    } catch (error) {
      const message = errorMessage(error);
      return {
        checkedAt: this.#now().toISOString(),
        status: "unavailable",
        mcp: {
          reachable: false,
          tools: [],
          resourceUris: [],
          viewerUris: [],
          error: message,
        },
        error: `Probe failed: ${message}`,
      };
    }
  }

  async #safeDockerObservation(): Promise<Map<string, ObservedContainer>> {
    try {
      return await this.#docker.observe(this.#manifest.servers);
    } catch (error) {
      const message = errorMessage(error);
      return new Map(
        this.#manifest.servers.map((server) => [
          server.id,
          unavailableContainer(`Docker observation failed: ${message}`),
        ]),
      );
    }
  }
}

function fleetCounts(servers: ServerRecord[]): FleetCounts {
  const counts: FleetCounts = {
    total: servers.length,
    healthy: 0,
    degraded: 0,
    unavailable: 0,
    unknown: 0,
    drift: 0,
  };
  for (const server of servers) {
    counts[server.observed.status]++;
    if (server.drift.status === "drift") counts.drift++;
  }
  return counts;
}

function fleetAvailability(counts: FleetCounts): Availability {
  if (counts.total === 0) return "unknown";
  if (counts.healthy === counts.total) return "healthy";
  if (counts.unavailable === counts.total) return "unavailable";
  return "degraded";
}

function consoleMode(runs: readonly RunSummary[]): ConsoleMode {
  // Fleet data in this service always comes from real probes, including honest
  // unavailable observations. Combining that live truth with a demo run is
  // mixed mode, never a wholly synthetic demo snapshot.
  return runs.some((run) => run.source === "demo") ? "mixed" : "live";
}

function toRunSummary(run: RunDetail): RunSummary {
  return {
    id: run.id,
    name: run.name,
    subject: run.subject,
    status: run.status,
    verdictStatus: run.verdictStatus,
    source: run.source,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    passedRequirements: run.passedRequirements,
    failedRequirements: run.failedRequirements,
    unresolvedRequirements: run.unresolvedRequirements,
  };
}

function compareRunsByEvidenceTime(left: RunSummary, right: RunSummary): number {
  const leftTime = left.completedAt ?? left.startedAt;
  const rightTime = right.completedAt ?? right.startedAt;
  if (leftTime && rightTime) {
    const timeOrder = rightTime.localeCompare(leftTime);
    if (timeOrder !== 0) return timeOrder;
  } else if (leftTime) {
    return -1;
  } else if (rightTime) {
    return 1;
  }
  return left.id.localeCompare(right.id);
}

function unavailableContainer(message: string): ObservedContainer {
  return {
    runtimeAvailable: false,
    present: false,
    error: message,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
