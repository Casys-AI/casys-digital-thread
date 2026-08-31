import type { ThreadFreshnessStatus } from "../../../domain/thread/thread-snapshot.ts";
import type { OverviewHeroNode } from "./overview-thread-hero-model.ts";

/**
 * The instrument: one artefact, one reading, no internal navigation.
 *
 * An instrument is not a window. It has no title bar — the whole card is the
 * handle — and it never grows tabs or a sidebar: a second artefact is a second
 * instrument. That constraint is what keeps it mountable in three places
 * without forking — anchored on the board, parked in the gutter, or full-frame
 * inside an MCP app.
 */

/** What the instrument is currently showing about its artefact. */
export type OverviewThreadInstrumentState =
  | "loading"
  | "live"
  | "settled"
  | "failed"
  /** The snapshot moved under it; what it shows is no longer current. */
  | "stale";

/**
 * Skin of the same instrument, chosen to suit the content. This is a prop, not
 * a component: the anatomy, status dot and hover actions are shared.
 */
export type OverviewThreadInstrumentChrome =
  /** Crisp edge and drop shadow: curves, records, CAD. */
  | "instrument"
  /** Borderless, pinned: human annotations and briefs. */
  | "pinned-paper"
  /** The identifier becomes a tab: requirements, verdicts. */
  | "tabbed-plate"
  /** Round gauge for one tracked value: margins, safety factors. */
  | "porthole";

export interface OverviewThreadInstrument {
  readonly key: string;
  /** Node this instrument is anchored to, in the board's own vocabulary. */
  readonly nodeKey: string;
  readonly title: string;
  /** One line under the title: revision, run, quantity. */
  readonly detail?: string;
  readonly state: OverviewThreadInstrumentState;
  /** Wall-clock of the reading, already formatted for display. */
  readonly at?: string;
  readonly chrome: OverviewThreadInstrumentChrome;
}

/**
 * Below this board scale an instrument degenerates into a chip. Nothing
 * disappears and nothing floats above the world: it is the same object, read
 * at a distance.
 */
export const OVERVIEW_THREAD_INSTRUMENT_CHIP_SCALE = 0.6;

export type OverviewThreadInstrumentPresentation = "expanded" | "chip";

export function overviewThreadInstrumentPresentation(
  scale: number,
): OverviewThreadInstrumentPresentation {
  if (!Number.isFinite(scale)) return "expanded";
  return scale < OVERVIEW_THREAD_INSTRUMENT_CHIP_SCALE ? "chip" : "expanded";
}

/** Status caption. The card says it; nothing is announced by a toast. */
export function overviewThreadInstrumentCaption(
  instrument: OverviewThreadInstrument,
): string {
  switch (instrument.state) {
    case "loading":
      return "chargement";
    case "live":
      return "live";
    case "settled":
      return instrument.at ? `settled ${instrument.at}` : "settled";
    case "failed":
      return "échec";
    case "stale":
      return "périmé";
  }
}

/** A live instrument follows its tail; every other state is a fixed reading. */
export function overviewThreadInstrumentFollowsTail(
  instrument: OverviewThreadInstrument,
): boolean {
  return instrument.state === "live";
}

export function overviewThreadInstrumentKey(nodeKey: string): string {
  return `instrument:${nodeKey}`;
}

/**
 * Read one board node as an instrument.
 *
 * The state is taken from the record's own freshness — never inferred from
 * how the node looks. A node the snapshot calls `running` reads as live; one
 * it calls `stale` says so on the card rather than pretending to be current.
 */
export function overviewThreadInstrumentFromHeroNode(
  item: OverviewHeroNode,
): OverviewThreadInstrument {
  if (item.kind === "activity") {
    return {
      key: overviewThreadInstrumentKey(item.key),
      nodeKey: item.key,
      title: item.activity.title,
      state: item.activity.status === "active"
        ? "live"
        : item.activity.status === "blocked"
        ? "failed"
        : "settled",
      chrome: "pinned-paper",
    };
  }
  const node = item.node;
  return {
    key: overviewThreadInstrumentKey(item.key),
    nodeKey: item.key,
    title: node.label,
    detail: node.summary,
    state: instrumentStateFromFreshness(node.freshness),
    at: overviewThreadInstrumentTime(node.recordedAt),
    chrome: "instrument",
  };
}

function instrumentStateFromFreshness(
  freshness: ThreadFreshnessStatus,
): OverviewThreadInstrumentState {
  switch (freshness) {
    case "running":
      return "live";
    case "stale":
      return "stale";
    case "failed":
      return "failed";
    case "fresh":
      return "settled";
  }
}

/** Wall-clock only: an instrument shows a time, never a full timestamp. */
export function overviewThreadInstrumentTime(
  recordedAt: string | undefined,
): string | undefined {
  if (!recordedAt) return undefined;
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${String(parsed.getHours()).padStart(2, "0")}:${
    String(parsed.getMinutes()).padStart(2, "0")
  }`;
}
