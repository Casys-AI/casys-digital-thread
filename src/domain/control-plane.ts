import type { DockerObserver } from "../adapters/docker-observer.ts";
import type { McpProbe, McpProbeResult } from "../adapters/http-mcp-probe.ts";
import { buildServerRecord } from "./drift.ts";
import type {
  Availability,
  ConsoleMode,
  ConsoleSnapshot,
  DesiredServer,
  FleetCounts,
  FleetManifest,
  ObservedContainer,
  ObservedRunCatalog,
  ObservedServer,
  RunDetail,
  RunSummary,
  ServerRecord,
  SnapshotOptions,
  WorkbenchPanel,
  WorkbenchSnapshot,
} from "./types.ts";

export interface ControlPlaneOptions {
  manifest: FleetManifest;
  probe: McpProbe;
  docker: DockerObserver;
  now?: () => Date;
  monotonicNow?: () => number;
  cacheTtlMs?: number;
  runs: readonly RunDetail[];
  observedRuns?: ObservedRunCatalog;
}

export class ControlPlaneNotFoundError extends Error {
  constructor(kind: "server" | "run", id: string) {
    super(`Unknown ${kind} id: ${id}`);
    this.name = "ControlPlaneNotFoundError";
  }
}

export class ControlPlane {
  readonly #manifest: FleetManifest;
  readonly #probe: McpProbe;
  readonly #docker: DockerObserver;
  readonly #now: () => Date;
  readonly #monotonicNow: () => number;
  readonly #cacheTtlMs: number;
  readonly #runs: readonly RunDetail[];
  readonly #observedRuns?: ObservedRunCatalog;
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
    this.#observedRuns = options.observedRuns;
  }

  async snapshot(options: SnapshotOptions = {}): Promise<ConsoleSnapshot> {
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

  async runList(): Promise<RunSummary[]> {
    const observed = this.#observedRuns ? await this.#safeObservedRunList() : [];
    // The modelica owner keeps its catalog deterministic by run id. The
    // console is an operator surface, so present evidence by its actual
    // completion/start time instead; legacy records without timing stay last.
    return [...observed, ...this.#runs.map(toRunSummary)]
      .sort(compareRunsByEvidenceTime)
      .map((run) => structuredClone(run));
  }

  async runDetail(id: string): Promise<RunDetail> {
    const run = this.#runs.find((entry) => entry.id === id);
    if (run) return structuredClone(run);
    const observed = this.#observedRuns
      ? await this.#observedRuns.detail(id)
      : undefined;
    if (!observed) throw new ControlPlaneNotFoundError("run", id);
    return structuredClone(observed);
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
      schemaVersion: "1.0",
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
      workbench: buildWorkbench(this.#manifest, servers),
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

  async #safeObservedRunList(): Promise<readonly RunSummary[]> {
    try {
      return await this.#observedRuns!.list();
    } catch {
      // Fleet observation reports the owner service's reachability. A failed
      // supplementary run index must not replace honest checked-in evidence
      // with a guessed or synthetic record.
      return [];
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

function buildWorkbench(
  manifest: FleetManifest,
  servers: ServerRecord[],
): WorkbenchSnapshot {
  const panels: WorkbenchPanel[] = (manifest.workbench ?? []).map((panel) => {
    const source = panel.sourceServerId
      ? servers.find((server) => server.id === panel.sourceServerId)
      : undefined;
    let availability: Availability = source?.observed.status ?? "unknown";
    if (
      panel.kind === "mcp-app" && source?.observed.mcp.reachable &&
      panel.resourceUri &&
      !source.observed.mcp.viewerUris.includes(panel.resourceUri)
    ) {
      availability = "unavailable";
    }
    return {
      ...panel,
      availability,
      demo: source?.demo ?? false,
    };
  });
  const healthy = panels.filter((panel) => panel.availability === "healthy")
    .length;
  const status: Availability = panels.length === 0
    ? "unknown"
    : healthy === panels.length
    ? "healthy"
    : healthy === 0
    ? "unavailable"
    : "degraded";
  return {
    status,
    panels,
    synchronization: {
      enabled: false,
      events: ["requirement.select", "artifact.select", "result.select"],
      note:
        "Cross-panel synchronization is declared for the workbench but is not activated by this read-only MVP.",
    },
  };
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
