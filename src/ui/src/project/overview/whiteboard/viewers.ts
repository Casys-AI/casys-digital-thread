import { separateOverviewThreadViewers } from "../../overview-thread-viewer-geometry.ts";
import type { OverviewThreadViewerGeometry } from "../../overview-thread-viewer-geometry.ts";
import type {
  OverviewThreadWhiteboardPresentationState,
  OverviewThreadWhiteboardPresentationViewer,
} from "../../overview-thread-whiteboard-persistence.ts";
import type { OverviewThreadWhiteboardTransform } from "../../overview-thread-whiteboard-transform.ts";
import type {
  OverviewSessionViewerState,
  OverviewViewerState,
  OverviewWhiteboardLayoutMode,
  OverviewWhiteboardRuntimeState,
} from "./types.ts";

export const OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM = {
  x: 0,
  y: 0,
  k: 1,
} as const satisfies OverviewThreadWhiteboardTransform;

export function overviewViewerId(
  request: {
    readonly kind: "session";
    readonly nodeKey: string;
    readonly sessionId: string;
  },
): string {
  return `${request.kind}:${request.nodeKey}:${request.sessionId}`;
}

export function overviewViewerGeometry(
  viewer: OverviewViewerState,
): OverviewThreadViewerGeometry {
  return {
    x: viewer.x,
    y: viewer.y,
    width: viewer.width,
    height: viewer.height,
  };
}

export function overviewViewerFromPresentation(
  viewer: OverviewThreadWhiteboardPresentationViewer,
): OverviewSessionViewerState {
  const spatial = {
    id: viewer.id,
    nodeKey: viewer.nodeKey,
    ...viewer.geometry,
    z: viewer.z,
    ...(viewer.expanded && viewer.restoreGeometry
      ? { restoreGeometry: viewer.restoreGeometry }
      : {}),
  };
  return {
    ...spatial,
    kind: "session",
    sessionId: viewer.sessionId,
    ...(viewer.presentationRowKey
      ? { presentationRowKey: viewer.presentationRowKey }
      : {}),
  };
}

export function overviewViewerToPresentation(
  viewer: OverviewViewerState,
): OverviewThreadWhiteboardPresentationViewer | undefined {
  if (viewer.kind !== "session") return undefined;
  const spatial = {
    id: viewer.id,
    nodeKey: viewer.nodeKey,
    geometry: overviewViewerGeometry(viewer),
    z: viewer.z,
    expanded: viewer.restoreGeometry !== undefined,
    ...(viewer.restoreGeometry
      ? { restoreGeometry: viewer.restoreGeometry }
      : {}),
    ...(viewer.presentationRowKey
      ? { presentationRowKey: viewer.presentationRowKey }
      : {}),
  };
  return { ...spatial, kind: "session", sessionId: viewer.sessionId };
}

export function overviewWhiteboardPersistedState(
  presentation: Pick<
    OverviewWhiteboardRuntimeState,
    | "layoutMode"
    | "groupPlacements"
    | "nodePlacements"
    | "transform"
    | "viewers"
    | "autoShownNodeKeys"
  >,
): OverviewThreadWhiteboardPresentationState {
  return {
    layoutMode: presentation.layoutMode,
    groupPlacements: presentation.groupPlacements,
    nodePlacements: presentation.nodePlacements,
    transform: presentation.transform,
    viewers: presentation.viewers.flatMap((viewer) => {
      const presented = overviewViewerToPresentation(viewer);
      return presented ? [presented] : [];
    }),
    autoShownNodeKeys: presentation.autoShownNodeKeys,
  };
}

export function overviewViewersFromRestored(
  restored: OverviewThreadWhiteboardPresentationState | undefined,
): readonly OverviewViewerState[] {
  return separateOverviewThreadViewers(
    restored?.viewers.map(overviewViewerFromPresentation) ?? [],
  );
}

export function overviewAutoShownKeysFromRestored(
  restored: OverviewThreadWhiteboardPresentationState | undefined,
): readonly string[] {
  return restored?.autoShownNodeKeys ??
    restored?.viewers.map((viewer) => viewer.nodeKey) ??
    [];
}

/**
 * Late session restore: keep live presentation, admit restored session
 * viewers that were never dismissed, and prefer current geometry.
 */
export function mergeRestoredOverviewViewers(
  current: readonly OverviewViewerState[],
  restored: readonly OverviewViewerState[],
  dismissedIds: ReadonlySet<string>,
): readonly OverviewViewerState[] {
  const currentIds = new Set(current.map((viewer) => viewer.id));
  const added: OverviewViewerState[] = [];
  for (const viewer of restored) {
    if (dismissedIds.has(viewer.id) || currentIds.has(viewer.id)) continue;
    added.push(viewer);
  }
  if (added.length === 0) return current;
  return [...current, ...added];
}

export function mergeAutoShownNodeKeys(
  current: readonly string[],
  restored: readonly string[],
): readonly string[] {
  if (restored.length === 0) return current;
  const seen = new Set(current);
  const extra = restored.filter((key) => !seen.has(key));
  return extra.length === 0 ? current : [...current, ...extra];
}

export function overviewFirstFocusKey(
  layoutMode: OverviewWhiteboardLayoutMode,
  hierarchyFirstKey: string | undefined,
  radialFirstKey: string | undefined,
): string | undefined {
  return layoutMode === "hierarchy" ? hierarchyFirstKey : radialFirstKey;
}
