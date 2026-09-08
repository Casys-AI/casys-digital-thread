import type { OverviewThreadWhiteboardPresentationState } from "../../overview-thread-whiteboard-persistence.ts";
import type {
  OverviewViewerState,
  OverviewWhiteboardControllerState,
  OverviewWhiteboardEvent,
  OverviewWhiteboardRuntimeState,
  OverviewWhiteboardSessionFlags,
  OverviewWhiteboardSnapshotFacts,
  OverviewWhiteboardUpdater,
} from "./types.ts";
import {
  mergeAutoShownNodeKeys,
  mergeRestoredOverviewViewers,
  OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
  overviewAutoShownKeysFromRestored,
  overviewFirstFocusKey,
  overviewViewersFromRestored,
} from "./viewers.ts";

export const EMPTY_DISMISSED_VIEWER_IDS: ReadonlySet<string> = new Set();

export const INITIAL_OVERVIEW_WHITEBOARD_PRESENTATION:
  OverviewWhiteboardRuntimeState = {
    layoutMode: "hierarchy",
    groupPlacements: {},
    nodePlacements: {},
    transform: OVERVIEW_WHITEBOARD_INITIAL_TRANSFORM,
    viewers: [],
    autoShownNodeKeys: [],
  };

export const INITIAL_OVERVIEW_WHITEBOARD_SESSION:
  OverviewWhiteboardSessionFlags = {
    touched: false,
    skipNextAutoFit: false,
    dismissedViewerIds: EMPTY_DISMISSED_VIEWER_IDS,
  };

export function createOverviewWhiteboardControllerState(): OverviewWhiteboardControllerState {
  return {
    presentation: INITIAL_OVERVIEW_WHITEBOARD_PRESENTATION,
    session: INITIAL_OVERVIEW_WHITEBOARD_SESSION,
  };
}

export function nextOverviewHeroSelection(
  current: string | undefined,
  requested: string,
  pinned = false,
): string | undefined {
  if (current === requested) return pinned ? current : undefined;
  return requested;
}

export function reduceOverviewWhiteboard(
  current: OverviewWhiteboardControllerState,
  event: OverviewWhiteboardEvent,
): OverviewWhiteboardControllerState {
  switch (event.type) {
    case "project-changed":
      return applyProjectChanged(event);
    case "sessions-ready":
      return applySessionsReady(current, event.restored);
    case "snapshot-reconciled":
      return applySnapshotReconciled(current, event.snapshot);
    case "hull-positions-remembered":
      return withPresentation(current, {
        groupPlacements: event.placements,
      });
    case "layout-mode-changed":
      if (event.layoutMode === current.presentation.layoutMode) {
        return current;
      }
      return {
        presentation: {
          ...current.presentation,
          layoutMode: event.layoutMode,
        },
        session: { ...current.session, touched: false },
      };
    case "group-placements-changed": {
      const groupPlacements = resolveUpdater(
        current.presentation.groupPlacements,
        event.placements,
      );
      const fixedGroupKey = event.fixedGroupKey !== undefined
        ? event.fixedGroupKey
        : current.presentation.fixedGroupKey;
      const touched = event.markTouched ? true : current.session.touched;
      if (
        groupPlacements === current.presentation.groupPlacements &&
        fixedGroupKey === current.presentation.fixedGroupKey &&
        touched === current.session.touched
      ) {
        return current;
      }
      return {
        presentation: {
          ...current.presentation,
          groupPlacements,
          fixedGroupKey,
        },
        session: touched === current.session.touched
          ? current.session
          : { ...current.session, touched },
      };
    }
    case "node-placements-changed": {
      const nodePlacements = resolveUpdater(
        current.presentation.nodePlacements,
        event.placements,
      );
      const touched = event.markTouched ? true : current.session.touched;
      if (
        nodePlacements === current.presentation.nodePlacements &&
        touched === current.session.touched
      ) {
        return current;
      }
      return {
        presentation: {
          ...current.presentation,
          nodePlacements,
        },
        session: touched === current.session.touched
          ? current.session
          : { ...current.session, touched },
      };
    }
    case "transform-changed": {
      const transform = resolveUpdater(
        current.presentation.transform,
        event.transform,
      );
      const touched = event.touched ?? current.session.touched;
      if (
        transform === current.presentation.transform &&
        touched === current.session.touched
      ) {
        return current;
      }
      return {
        presentation: {
          ...current.presentation,
          transform,
        },
        session: touched === current.session.touched
          ? current.session
          : { ...current.session, touched },
      };
    }
    case "viewers-changed": {
      const viewers = resolveUpdater(
        current.presentation.viewers,
        event.viewers,
      );
      if (viewers === current.presentation.viewers) return current;
      const dismissedViewerIds = nextDismissedViewerIds(
        current.session.dismissedViewerIds,
        current.presentation.viewers,
        viewers,
      );
      return {
        presentation: { ...current.presentation, viewers },
        session: dismissedViewerIds === current.session.dismissedViewerIds
          ? current.session
          : { ...current.session, dismissedViewerIds },
      };
    }
    case "auto-shown-changed":
      return withPresentation(current, {
        autoShownNodeKeys: resolveUpdater(
          current.presentation.autoShownNodeKeys,
          event.keys,
        ),
      });
    case "selection-toggled": {
      const selectedKey = nextOverviewHeroSelection(
        current.presentation.selectedKey,
        event.key,
        current.presentation.selectionPinned === true,
      );
      const sameKey = selectedKey === current.presentation.selectedKey;
      return withPresentation(current, {
        selectedRowKey: sameKey
          ? current.presentation.selectedRowKey
          : undefined,
        selectedKey,
        selectionPinned: sameKey && selectedKey
          ? current.presentation.selectionPinned
          : undefined,
      });
    }
    case "selected-key-changed": {
      const selectedKey = resolveUpdater(
        current.presentation.selectedKey,
        event.key,
      );
      const keyChanged = selectedKey !== current.presentation.selectedKey;
      return withPresentation(current, {
        selectedKey,
        ...(keyChanged ? { selectionPinned: undefined } : {}),
      });
    }
    case "selected-row-changed": {
      const selectedRowKey = resolveUpdater(
        current.presentation.selectedRowKey,
        event.rowKey,
      );
      const rowChanged = selectedRowKey !== current.presentation.selectedRowKey;
      return withPresentation(current, {
        selectedRowKey,
        ...(rowChanged && selectedRowKey ? { selectionPinned: undefined } : {}),
      });
    }
    case "row-activated":
      return applyRowActivated(current, event.rowKey, event.mappedKey);
    case "selection-pin-changed":
      return applySelectionPinChanged(current, event.pinned);
    case "selection-closed":
      return withPresentation(current, {
        selectedKey: undefined,
        selectedRowKey: undefined,
        selectionPinned: undefined,
      });
    case "hover-changed":
      return withPresentation(current, {
        hoveredKey: resolveUpdater(
          current.presentation.hoveredKey,
          event.key,
        ),
      });
    case "focus-changed":
      return withPresentation(current, {
        focusedKey: resolveUpdater(
          current.presentation.focusedKey,
          event.key,
        ),
      });
    case "fixed-group-changed":
      return withPresentation(current, { fixedGroupKey: event.key });
    case "canvas-cleared":
      if (current.presentation.selectionPinned) {
        return withPresentation(current, { hoveredKey: undefined });
      }
      return withPresentation(current, {
        selectedKey: undefined,
        hoveredKey: undefined,
        selectedRowKey: undefined,
        selectionPinned: undefined,
      });
    case "layout-reset":
      return {
        presentation: {
          ...current.presentation,
          fixedGroupKey: undefined,
          groupPlacements: {},
          nodePlacements: {},
          transform: event.transform,
        },
        session: { ...current.session, touched: false },
      };
    case "auto-fit-consumed":
      if (!current.session.skipNextAutoFit) return current;
      return {
        presentation: current.presentation,
        session: { ...current.session, skipNextAutoFit: false },
      };
    case "interaction-touched":
      if (current.session.touched) return current;
      return {
        presentation: current.presentation,
        session: { ...current.session, touched: true },
      };
  }
}

function applyProjectChanged(
  event: Extract<OverviewWhiteboardEvent, { readonly type: "project-changed" }>,
): OverviewWhiteboardControllerState {
  const restored = event.restored;
  const presentation = restored
    ? {
      ...INITIAL_OVERVIEW_WHITEBOARD_PRESENTATION,
      layoutMode: restored.layoutMode,
      groupPlacements: restored.groupPlacements,
      nodePlacements: restored.nodePlacements,
      transform: restored.transform,
      viewers: overviewViewersFromRestored(restored),
      autoShownNodeKeys: overviewAutoShownKeysFromRestored(restored),
      hydration: {
        projectId: event.projectId,
        restored: true,
        viewersRestored: event.viewerSessionsReady,
      },
    }
    : {
      ...INITIAL_OVERVIEW_WHITEBOARD_PRESENTATION,
      hydration: {
        projectId: event.projectId,
        restored: false,
        viewersRestored: event.viewerSessionsReady,
      },
    };
  return {
    presentation,
    session: {
      touched: restored !== undefined,
      skipNextAutoFit: restored !== undefined,
      dismissedViewerIds: EMPTY_DISMISSED_VIEWER_IDS,
    },
  };
}

function applySessionsReady(
  current: OverviewWhiteboardControllerState,
  restored: OverviewThreadWhiteboardPresentationState | undefined,
): OverviewWhiteboardControllerState {
  const hydration = current.presentation.hydration;
  if (!hydration || hydration.viewersRestored) return current;
  const restoredViewers = overviewViewersFromRestored(restored);
  const viewers = mergeRestoredOverviewViewers(
    current.presentation.viewers,
    restoredViewers,
    current.session.dismissedViewerIds,
  );
  const autoShownNodeKeys = mergeAutoShownNodeKeys(
    current.presentation.autoShownNodeKeys,
    overviewAutoShownKeysFromRestored(restored),
  );
  return {
    presentation: {
      ...current.presentation,
      viewers,
      autoShownNodeKeys,
      hydration: { ...hydration, viewersRestored: true },
    },
    session: current.session,
  };
}

function applySnapshotReconciled(
  current: OverviewWhiteboardControllerState,
  snapshot: OverviewWhiteboardSnapshotFacts,
): OverviewWhiteboardControllerState {
  const displayedKeys = new Set(snapshot.displayedKeys);
  const recordedKeys = new Set(snapshot.recordedKeys);
  const availableSessionIds = snapshot.availableSessionIds
    ? new Set(snapshot.availableSessionIds)
    : undefined;
  const availableRowKeys = snapshot.availableRowKeys
    ? new Set(snapshot.availableRowKeys)
    : undefined;
  const firstKey = overviewFirstFocusKey(
    current.presentation.layoutMode,
    snapshot.hierarchyFirstKey,
    snapshot.radialFirstKey,
  );
  const selectedKey = current.presentation.selectedKey &&
      !displayedKeys.has(current.presentation.selectedKey)
    ? undefined
    : current.presentation.selectedKey;
  const selectedRowKey = current.presentation.selectedRowKey &&
      availableRowKeys &&
      !availableRowKeys.has(current.presentation.selectedRowKey)
    ? undefined
    : current.presentation.selectedRowKey;
  const selectionPinned = current.presentation.selectionPinned &&
      selectedKey === current.presentation.selectedKey &&
      selectedRowKey === current.presentation.selectedRowKey &&
      (selectedKey !== undefined || selectedRowKey !== undefined)
    ? true
    : undefined;
  const hoveredKey = current.presentation.hoveredKey &&
      !displayedKeys.has(current.presentation.hoveredKey)
    ? undefined
    : current.presentation.hoveredKey;
  const focusedKey = current.presentation.focusedKey &&
      displayedKeys.has(current.presentation.focusedKey)
    ? current.presentation.focusedKey
    : firstKey;
  const nextViewers = current.presentation.viewers.filter((viewer) =>
    viewerSurvivesSnapshot(
      viewer,
      recordedKeys,
      availableSessionIds,
      snapshot.currentBriefSnapshotId,
    )
  );
  const viewers = nextViewers.length === current.presentation.viewers.length
    ? current.presentation.viewers
    : nextViewers;
  return withPresentation(current, {
    selectedKey,
    selectedRowKey,
    selectionPinned,
    hoveredKey,
    focusedKey,
    viewers,
  });
}

function applyRowActivated(
  current: OverviewWhiteboardControllerState,
  rowKey: string | undefined,
  mappedKey: string | undefined,
): OverviewWhiteboardControllerState {
  const pinned = current.presentation.selectionPinned === true;
  if (
    pinned &&
    rowKey !== undefined &&
    rowKey === current.presentation.selectedRowKey
  ) {
    return current;
  }
  if (rowKey !== undefined && rowKey === current.presentation.selectedRowKey) {
    return withPresentation(current, {
      selectedRowKey: undefined,
      selectedKey: undefined,
      focusedKey: undefined,
      selectionPinned: undefined,
    });
  }
  return withPresentation(current, {
    selectedRowKey: rowKey,
    selectedKey: mappedKey,
    focusedKey: mappedKey ??
      (rowKey ? current.presentation.focusedKey : undefined),
    selectionPinned: undefined,
  });
}

function applySelectionPinChanged(
  current: OverviewWhiteboardControllerState,
  pinned: boolean,
): OverviewWhiteboardControllerState {
  if (
    pinned &&
    current.presentation.selectedKey === undefined &&
    current.presentation.selectedRowKey === undefined
  ) {
    return current;
  }
  const selectionPinned = pinned ? true : undefined;
  if (selectionPinned === current.presentation.selectionPinned) {
    return current;
  }
  return withPresentation(current, { selectionPinned });
}

function viewerSurvivesSnapshot(
  viewer: OverviewViewerState,
  recordedKeys: ReadonlySet<string>,
  availableSessionIds: ReadonlySet<string> | undefined,
  currentBriefSnapshotId: string | undefined,
): boolean {
  if (viewer.kind === "current-brief") {
    return currentBriefSnapshotId === viewer.briefSnapshotId;
  }
  return recordedKeys.has(viewer.nodeKey) &&
    (availableSessionIds?.has(viewer.sessionId) ?? true);
}

function nextDismissedViewerIds(
  current: ReadonlySet<string>,
  previousViewers: readonly OverviewViewerState[],
  nextViewers: readonly OverviewViewerState[],
): ReadonlySet<string> {
  const nextIds = new Set(nextViewers.map((viewer) => viewer.id));
  let changed = false;
  const dismissed = new Set(current);
  for (const viewer of previousViewers) {
    if (!nextIds.has(viewer.id) && !dismissed.has(viewer.id)) {
      dismissed.add(viewer.id);
      changed = true;
    }
  }
  for (const viewer of nextViewers) {
    if (dismissed.has(viewer.id)) {
      dismissed.delete(viewer.id);
      changed = true;
    }
  }
  return changed ? dismissed : current;
}

function withPresentation(
  current: OverviewWhiteboardControllerState,
  patch: Partial<OverviewWhiteboardRuntimeState>,
): OverviewWhiteboardControllerState {
  for (
    const key of Object.keys(patch) as (
      keyof OverviewWhiteboardRuntimeState
    )[]
  ) {
    if (current.presentation[key] !== patch[key]) {
      return {
        presentation: { ...current.presentation, ...patch },
        session: current.session,
      };
    }
  }
  return current;
}

function resolveUpdater<T>(
  current: T,
  update: OverviewWhiteboardUpdater<T>,
): T {
  return typeof update === "function"
    ? (update as (value: T) => T)(current)
    : update;
}
