/** One reusable row for the hull and its contextual menu, never a Thread node. */
export interface OverviewHullContentRow {
  readonly key: string;
  readonly kind: "record" | "navigation" | "source";
  readonly label: string;
  readonly detail?: string;
  readonly depth: number;
  readonly parentKey?: string;
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
}

export interface OverviewHullContent {
  readonly groupKey: string;
  readonly mode: "records" | "tree";
  /** Exact server navigation, brief snapshot tree, or the recorded parent tree. */
  readonly rows: readonly OverviewHullContentRow[];
  /** All immutable records remain separately inspectable, including prior captures. */
  readonly records: readonly OverviewHullContentRow[];
}

/** Geometry a hull needs to place the same rows in tree, list, and points. */
export interface OverviewHullRowBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly headerHeight: number;
  readonly footerHeight: number;
  readonly view: "tree" | "list" | "matrix";
  readonly columns: number;
  readonly visibleRows: number;
  readonly scrollRow: number;
  readonly collapsed: boolean;
}
