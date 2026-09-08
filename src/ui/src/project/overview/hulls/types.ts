/** One reusable row for the hull and its contextual menu, never a Thread node. */

export type OverviewHullRowRole =
  | "folder"
  | "current"
  | "prior"
  | "non-result"
  | "overlay";

export type OverviewHullRowAvailability =
  | "available"
  | "unavailable"
  | "unresolved";

export interface OverviewHullRowProvenance {
  readonly recordedAt?: string;
  readonly sourceId?: string;
  readonly snapshotId?: string;
  readonly revision?: number | string;
}

export interface OverviewHullContentRow {
  readonly key: string;
  readonly kind: "record" | "navigation" | "source";
  readonly label: string;
  readonly detail?: string;
  readonly depth: number;
  readonly parentKey?: string;
  /**
   * Exact graph node keys this row represents. Empty for grouping. Prefer this
   * over `nodeKey` for raw-to-structured selection.
   */
  readonly graphRefs?: readonly string[];
  /** Graph node to select when this row is a real entity. Absent for grouping. */
  readonly nodeKey?: string;
  /**
   * Exact graph node that owns a registered App session. Action binding only;
   * it is not a parent, cable endpoint, or occurrence identity.
   */
  readonly viewerNodeKey?: string;
  readonly sessionIds: readonly string[];
  /** Provenance cables may land here. Navigation grouping never does. */
  readonly endpoint: boolean;
  /**
   * Presentation-only capability. Never a registered session, nodeKey, or
   * Thread viewer identity.
   */
  readonly nativeAction?: "open-current-brief";
  /**
   * Closed presentation role. Grouping, series members, overlays. Not painted
   * by the hierarchy renderer; adapters and tests remain the consumers.
   */
  readonly role?: OverviewHullRowRole;
  /**
   * Closed availability. Not painted by the hierarchy renderer; unused on
   * purpose until a generic unavailable/unresolved row surface exists.
   */
  readonly availability?: OverviewHullRowAvailability;
  /**
   * Recorded identity metadata. Not painted by the hierarchy renderer;
   * visible text stays `label` / `detail`.
   */
  readonly provenance?: OverviewHullRowProvenance;
  /**
   * Action-model hint. The hierarchy renderer does not read it; keyboard
   * focus stays on the shared flow-item contract.
   */
  readonly selectable?: boolean;
  /**
   * Action-model hint. The hierarchy renderer does not read it; every visible
   * row stays in the shared roving tabindex.
   */
  readonly focusable?: boolean;
}

export interface OverviewHullCount {
  readonly key: string;
  readonly value: number;
}

export interface OverviewHullCounts {
  readonly items: readonly OverviewHullCount[];
  readonly label: string;
}

export interface OverviewHullContent {
  readonly groupKey: string;
  /**
   * Dataset shape only. Hierarchy always paints `rows` through
   * FlowStructureRow, including `records` mode. `tree` means a navigation
   * tree is present; it is not a second renderer.
   */
  readonly mode: "records" | "tree";
  /** Exact server navigation, brief snapshot tree, or the recorded parent tree. */
  readonly rows: readonly OverviewHullContentRow[];
  /** All immutable records remain separately inspectable, including prior captures. */
  readonly records: readonly OverviewHullContentRow[];
  /** Generic header counts. Domain copy such as "2 cases · 3 revisions" stays in the adapter. */
  readonly counts?: OverviewHullCounts;
  /**
   * Restrained overlay from an exact active/blocked Project activity.
   * Planned/completed never set this. Conflicting or missing relations omit it.
   */
  readonly status?: "active" | "blocked";
}

/** Exact graph keys for one row. Explicit empty `graphRefs` stay empty. */
export function overviewHullRowGraphRefs(
  row: Pick<OverviewHullContentRow, "graphRefs" | "nodeKey">,
): readonly string[] {
  if (row.graphRefs !== undefined) return row.graphRefs;
  return row.nodeKey === undefined ? [] : [row.nodeKey];
}

export function overviewHullRowPrimaryGraphRef(
  row: Pick<OverviewHullContentRow, "graphRefs" | "nodeKey">,
): string | undefined {
  return overviewHullRowGraphRefs(row)[0];
}

export function overviewHullCountValue(
  content: OverviewHullContent | undefined,
  key: string,
): number | undefined {
  return content?.counts?.items.find((item) => item.key === key)?.value;
}

export function overviewHullFolderRow(spec: {
  readonly key: string;
  readonly label: string;
  readonly detail?: string;
  readonly depth: number;
  readonly parentKey?: string;
  readonly nativeAction?: "open-current-brief";
}): OverviewHullContentRow {
  return {
    key: spec.key,
    kind: "navigation",
    label: spec.label,
    ...(spec.detail ? { detail: spec.detail } : {}),
    depth: spec.depth,
    ...(spec.parentKey ? { parentKey: spec.parentKey } : {}),
    sessionIds: [],
    endpoint: false,
    graphRefs: [],
    role: "folder",
    selectable: false,
    focusable: true,
    ...(spec.nativeAction ? { nativeAction: spec.nativeAction } : {}),
  };
}
