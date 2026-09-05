/**
 * Pure projection of the MCP fleet onto the thread's recorded evidence.
 *
 * No latency, no uptime, no elapsed time — none of those fields exist in
 * the data. The model joins declared fleet servers (from config/mcp-fleet.json
 * via the BFF) with systems actually observed in the thread snapshot.
 * A declared server without exact recorded evidence remains explicitly
 * unavailable. An observed system without an exact declared server remains a
 * separate unmatched row. Neither is presented as healthy or down.
 */

import type {
  CockpitFleetProjection,
} from "../../../presentation/workbench/fleet/projection.ts";
import type {
  EngineeringProjectSnapshot,
} from "../../../domain/project/engineering-project.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/types.ts";

export type FleetFreshness =
  | "fresh"
  | "stale"
  | "running"
  | "failed";

/** Derived visual state of a fleet row — no latency, no uptime. */
export type FleetCardState = "running" | "ok" | "attention" | "unavailable";

/** Result of the literal declared-server id to recorded-system identity join. */
export type FleetIdentityMatch = "exact" | "unmatched" | "unavailable";

export interface FleetCardView {
  readonly id: string;
  readonly displayName: string;
  readonly role: string;
  /** Undefined when no declared fleet manifest is available. */
  readonly required: boolean | undefined;
  /** Undefined means that this declared surface has no project record. */
  readonly freshness: FleetFreshness | undefined;
  readonly state: FleetCardState;
  /** No normalization, display-name alias, provider alias, or substring join. */
  readonly match: FleetIdentityMatch;
  /** ISO string of the most recent graph-node `recordedAt` for this system. */
  readonly lastEvidenceAt: string | undefined;
  readonly stageCount: number;
}

export interface OperationsFleetSummary {
  readonly declared: number;
  readonly observed: number;
  readonly running: number;
}

export interface OperationsFleetView {
  readonly cards: readonly FleetCardView[];
  /** Display names of declared servers with no observed thread evidence. */
  readonly declaredIdle: readonly string[];
  readonly summary: OperationsFleetSummary;
  readonly source: "declared-fleet" | "thread-observed-only";
}

// Internal mutable accumulator while scanning thread data.
interface ObservedSystem {
  readonly id: string;
  readonly label: string;
  freshness: FleetFreshness;
  lastEvidenceAt: string | undefined;
  stageCount: number;
}

/**
 * Build the Operations fleet view.
 *
 * Join strategy: a declared server matches an observed system only when
 * `stage.system === server.id`. This is a literal, case-sensitive identity
 * comparison. Display names are presentation only; normalization, aliases,
 * provider inference, and substring matching are forbidden.
 *
 * When `fleet` is absent the function falls back to rows built solely from
 * observed systems. Their requirement state stays unknown; it is never
 * invented as optional.
 */
export function buildOperationsFleetView(
  fleet: CockpitFleetProjection | undefined,
  thread: ThreadWorkbenchSnapshot,
  _project: EngineeringProjectSnapshot,
): OperationsFleetView {
  const observed = gatherObservedSystems(thread);

  if (fleet === undefined) {
    const cards = [...observed.values()].map(
      (obs): FleetCardView => ({
        id: obs.id,
        displayName: obs.label,
        role: "",
        required: undefined,
        freshness: obs.freshness,
        state: freshnessToState(obs.freshness),
        match: "unavailable",
        lastEvidenceAt: obs.lastEvidenceAt,
        stageCount: obs.stageCount,
      }),
    );
    const running = cards.filter((c) => c.state === "running").length;
    return {
      cards,
      declaredIdle: [],
      source: "thread-observed-only",
      summary: {
        declared: 0,
        observed: cards.length,
        running,
      },
    };
  }

  const cards: FleetCardView[] = [];
  const declaredIdle: string[] = [];
  const matchedObservedIds = new Set<string>();

  for (const server of fleet.servers) {
    const obs = observed.get(server.id);
    if (obs === undefined) {
      declaredIdle.push(server.displayName);
      cards.push({
        id: server.id,
        displayName: server.displayName,
        role: server.role,
        required: server.required,
        freshness: undefined,
        state: "unavailable",
        match: "unmatched",
        lastEvidenceAt: undefined,
        stageCount: 0,
      });
      continue;
    }
    matchedObservedIds.add(obs.id);
    cards.push({
      id: server.id,
      displayName: server.displayName,
      role: server.role,
      required: server.required,
      freshness: obs.freshness,
      state: freshnessToState(obs.freshness),
      match: "exact",
      lastEvidenceAt: obs.lastEvidenceAt,
      stageCount: obs.stageCount,
    });
  }

  // Preserve generic fleet navigation: recorded systems without a literal
  // declared id stay visible as their own unmatched rows. They never lend
  // evidence to a similarly named declared server.
  for (const obs of observed.values()) {
    if (matchedObservedIds.has(obs.id)) continue;
    cards.push({
      id: obs.id,
      displayName: obs.label,
      role: "",
      required: undefined,
      freshness: obs.freshness,
      state: freshnessToState(obs.freshness),
      match: "unmatched",
      lastEvidenceAt: obs.lastEvidenceAt,
      stageCount: obs.stageCount,
    });
  }

  const observedCount =
    cards.filter((card) => card.freshness !== undefined).length;
  const running = cards.filter((c) => c.state === "running").length;
  return {
    cards,
    declaredIdle,
    source: "declared-fleet",
    summary: {
      declared: fleet.servers.length,
      observed: observedCount,
      running,
    },
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function gatherObservedSystems(
  thread: ThreadWorkbenchSnapshot,
): Map<string, ObservedSystem> {
  const map = new Map<string, ObservedSystem>();

  // Flow stages supply freshness and stage count.
  for (const stage of thread.flow) {
    const key = stage.system;
    const existing = map.get(key);
    if (existing) {
      existing.stageCount += 1;
      existing.freshness = aggregateFreshness(
        existing.freshness,
        stage.freshness,
      );
      continue;
    }
    map.set(key, {
      id: key,
      label: stage.system,
      freshness: stage.freshness,
      lastEvidenceAt: undefined,
      stageCount: 1,
    });
  }

  // Graph nodes supply lastEvidenceAt per system.
  for (const node of thread.graph.nodes) {
    const key = node.system;
    const obs = map.get(key);
    if (!obs || node.recordedAt === undefined) continue;
    if (
      obs.lastEvidenceAt === undefined ||
      node.recordedAt > obs.lastEvidenceAt
    ) {
      obs.lastEvidenceAt = node.recordedAt;
    }
  }

  return map;
}

/**
 * Aggregate freshness: a single running stage makes the server running;
 * failed beats stale; stale beats fresh.
 */
function aggregateFreshness(
  current: FleetFreshness,
  next: FleetFreshness,
): FleetFreshness {
  if (current === "running" || next === "running") return "running";
  if (current === "failed" || next === "failed") return "failed";
  if (current === "stale" || next === "stale") return "stale";
  return "fresh";
}

function freshnessToState(freshness: FleetFreshness): FleetCardState {
  if (freshness === "running") return "running";
  if (freshness === "fresh") return "ok";
  return "attention";
}
