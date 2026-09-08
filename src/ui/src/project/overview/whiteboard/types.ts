/**
 * Local whiteboard presentation types only.
 *
 * These identities never become Thread evidence, viewer-session descriptors,
 * or provider inputs. Server snapshots stay outside this module; persisted
 * entries are admitted only after exact reconciliation with that snapshot.
 */

import type {
  OverviewThreadD3FlowGroupPlacement,
  OverviewThreadD3FlowNodePlacement,
} from "../../overview-thread-d3-flow-layout.ts";
import type { OverviewThreadViewerGeometry } from "../../overview-thread-viewer-geometry.ts";
import type {
  OverviewThreadWhiteboardPresentationReconciliation,
  OverviewThreadWhiteboardPresentationState,
} from "../../overview-thread-whiteboard-persistence.ts";
import type { OverviewThreadWhiteboardTransform } from "../../overview-thread-whiteboard-transform.ts";

export type OverviewWhiteboardLayoutMode = "hierarchy" | "radial";

export interface OverviewViewerBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly z: number;
  readonly restoreGeometry?: OverviewThreadViewerGeometry;
}

export interface OverviewSessionViewerState extends OverviewViewerBase {
  readonly kind: "session";
  readonly nodeKey: string;
  /** Stable descriptor key; URL and runtime state are never persisted. */
  readonly sessionId: string;
  /** Visible hull row that opened this viewer; never a Thread identity. */
  readonly presentationRowKey?: string;
}

export interface OverviewCurrentBriefViewerState extends OverviewViewerBase {
  readonly kind: "current-brief";
  readonly briefSnapshotId: string;
  readonly presentationRowKey?: string;
}

export type OverviewViewerState =
  | OverviewSessionViewerState
  | OverviewCurrentBriefViewerState;

export interface OverviewWhiteboardHydration {
  readonly projectId: string | null;
  readonly restored: boolean;
  readonly viewersRestored: boolean;
}

export interface OverviewWhiteboardPendingPersistence {
  readonly projectId: string;
  readonly state: OverviewThreadWhiteboardPresentationState;
  readonly reconciliation: OverviewThreadWhiteboardPresentationReconciliation;
}

export interface OverviewWhiteboardSessionFlags {
  readonly touched: boolean;
  readonly skipNextAutoFit: boolean;
  /**
   * Session viewers closed before the exact replacement arrived. A late
   * restore must not resurrect them.
   */
  readonly dismissedViewerIds: ReadonlySet<string>;
}

export interface OverviewWhiteboardRuntimeState {
  readonly layoutMode: OverviewWhiteboardLayoutMode;
  readonly groupPlacements: Readonly<
    Record<string, OverviewThreadD3FlowGroupPlacement>
  >;
  readonly nodePlacements: Readonly<
    Record<string, OverviewThreadD3FlowNodePlacement>
  >;
  readonly transform: OverviewThreadWhiteboardTransform;
  readonly viewers: readonly OverviewViewerState[];
  readonly autoShownNodeKeys: readonly string[];
  readonly selectedKey?: string;
  readonly selectedRowKey?: string;
  /** Transient reading-aid pin; never persisted. */
  readonly selectionPinned?: boolean;
  readonly hoveredKey?: string;
  readonly focusedKey?: string;
  readonly fixedGroupKey?: string;
  readonly hydration?: OverviewWhiteboardHydration;
}

export interface OverviewWhiteboardControllerState {
  readonly presentation: OverviewWhiteboardRuntimeState;
  readonly session: OverviewWhiteboardSessionFlags;
}

/**
 * Exact facts from the current Thread projection. They are never stored as
 * presentation truth; they only admit, drop, or retarget local state.
 */
export interface OverviewWhiteboardSnapshotFacts {
  readonly displayedKeys: Iterable<string>;
  readonly recordedKeys: Iterable<string>;
  /** Absent while the exact session replacement is unknown, not empty. */
  readonly availableSessionIds?: Iterable<string>;
  readonly currentBriefSnapshotId?: string;
  readonly hierarchyFirstKey?: string;
  readonly radialFirstKey?: string;
  /**
   * Exact hull presentation row keys from the current snapshot. Source and
   * navigation rows are admitted only by this set, never by label.
   */
  readonly availableRowKeys?: Iterable<string>;
}

export type OverviewWhiteboardUpdater<T> = T | ((current: T) => T);

export type OverviewWhiteboardEvent =
  | {
    readonly type: "project-changed";
    readonly projectId: string | null;
    readonly restored?: OverviewThreadWhiteboardPresentationState;
    readonly viewerSessionsReady: boolean;
  }
  | {
    readonly type: "sessions-ready";
    readonly restored?: OverviewThreadWhiteboardPresentationState;
  }
  | {
    readonly type: "snapshot-reconciled";
    readonly snapshot: OverviewWhiteboardSnapshotFacts;
  }
  | {
    readonly type: "hull-positions-remembered";
    readonly placements: Readonly<
      Record<string, OverviewThreadD3FlowGroupPlacement>
    >;
  }
  | {
    readonly type: "layout-mode-changed";
    readonly layoutMode: OverviewWhiteboardLayoutMode;
  }
  | {
    readonly type: "group-placements-changed";
    readonly placements: OverviewWhiteboardUpdater<
      Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>>
    >;
    readonly fixedGroupKey?: string;
    readonly markTouched?: boolean;
  }
  | {
    readonly type: "node-placements-changed";
    readonly placements: OverviewWhiteboardUpdater<
      Readonly<Record<string, OverviewThreadD3FlowNodePlacement>>
    >;
    readonly markTouched?: boolean;
  }
  | {
    readonly type: "transform-changed";
    readonly transform: OverviewWhiteboardUpdater<
      OverviewThreadWhiteboardTransform
    >;
    /** When set, replaces the session touched flag (fit clears it). */
    readonly touched?: boolean;
  }
  | {
    readonly type: "viewers-changed";
    readonly viewers: OverviewWhiteboardUpdater<
      readonly OverviewViewerState[]
    >;
  }
  | {
    readonly type: "auto-shown-changed";
    readonly keys: OverviewWhiteboardUpdater<readonly string[]>;
  }
  | {
    readonly type: "selection-toggled";
    readonly key: string;
  }
  | {
    readonly type: "selected-key-changed";
    readonly key: OverviewWhiteboardUpdater<string | undefined>;
  }
  | {
    readonly type: "selected-row-changed";
    readonly rowKey: OverviewWhiteboardUpdater<string | undefined>;
  }
  | {
    readonly type: "row-activated";
    readonly rowKey?: string;
    readonly mappedKey?: string;
  }
  | {
    readonly type: "selection-pin-changed";
    readonly pinned: boolean;
  }
  | {
    readonly type: "selection-closed";
  }
  | {
    readonly type: "hover-changed";
    readonly key: OverviewWhiteboardUpdater<string | undefined>;
  }
  | {
    readonly type: "focus-changed";
    readonly key: OverviewWhiteboardUpdater<string | undefined>;
  }
  | {
    readonly type: "fixed-group-changed";
    readonly key?: string;
  }
  | {
    readonly type: "canvas-cleared";
  }
  | {
    readonly type: "layout-reset";
    readonly transform: OverviewThreadWhiteboardTransform;
  }
  | {
    readonly type: "auto-fit-consumed";
  }
  | {
    readonly type: "interaction-touched";
  };
