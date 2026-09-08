import { rememberOverviewThreadHullPositions } from "../../overview-thread-d3-flow-layout.ts";
import type { OverviewThreadD3FlowGroupPlacement } from "../../overview-thread-d3-flow-layout.ts";
import type { OverviewThreadWhiteboardPresentationReconciliation } from "../../overview-thread-whiteboard-persistence.ts";
import {
  createOverviewWhiteboardControllerState,
  reduceOverviewWhiteboard,
} from "./state.ts";
import type {
  OverviewWhiteboardControllerState,
  OverviewWhiteboardEvent,
  OverviewWhiteboardRuntimeState,
  OverviewWhiteboardSnapshotFacts,
} from "./types.ts";
import type { OverviewWhiteboardPersistence } from "./persistence.ts";
import { overviewWhiteboardPersistedState } from "./viewers.ts";

export interface OverviewWhiteboardController {
  getState(): OverviewWhiteboardControllerState;
  apply(event: OverviewWhiteboardEvent): OverviewWhiteboardControllerState;
  changeProject(
    projectId: string | null,
    reconciliation: OverviewThreadWhiteboardPresentationReconciliation,
    viewerSessionsReady: boolean,
  ): OverviewWhiteboardControllerState;
  restoreViewersWhenSessionsReady(
    projectId: string | null,
    reconciliation: OverviewThreadWhiteboardPresentationReconciliation,
  ): OverviewWhiteboardControllerState;
  reconcileSnapshot(
    snapshot: OverviewWhiteboardSnapshotFacts,
  ): OverviewWhiteboardControllerState;
  rememberHullPositions(
    groups: readonly {
      readonly key: string;
      readonly x: number;
      readonly y: number;
    }[],
  ): OverviewWhiteboardControllerState;
  scheduleSave(
    projectId: string,
    reconciliation: OverviewThreadWhiteboardPresentationReconciliation,
  ): void;
  cancelScheduledSave(): void;
  attachPageHide(): () => void;
  canSave(
    projectId: string | undefined,
    viewerSessionsReady: boolean,
  ): projectId is string;
  isTouched(): boolean;
  consumeSkipNextAutoFit(): boolean;
  markTouched(): OverviewWhiteboardControllerState;
}

export function createOverviewWhiteboardController(
  persistence: OverviewWhiteboardPersistence,
  initial: OverviewWhiteboardControllerState =
    createOverviewWhiteboardControllerState(),
): OverviewWhiteboardController {
  let state = initial;

  const apply = (event: OverviewWhiteboardEvent) => {
    state = reduceOverviewWhiteboard(state, event);
    return state;
  };

  return {
    getState() {
      return state;
    },
    apply,
    changeProject(projectId, reconciliation, viewerSessionsReady) {
      persistence.flush();
      const restored = projectId
        ? persistence.load(projectId, reconciliation)
        : undefined;
      return apply({
        type: "project-changed",
        projectId,
        restored,
        viewerSessionsReady,
      });
    },
    restoreViewersWhenSessionsReady(projectId, reconciliation) {
      const hydration = state.presentation.hydration;
      if (
        !hydration ||
        hydration.viewersRestored ||
        hydration.projectId !== projectId
      ) {
        return state;
      }
      const restored = projectId
        ? persistence.load(projectId, reconciliation)
        : undefined;
      return apply({ type: "sessions-ready", restored });
    },
    reconcileSnapshot(snapshot) {
      return apply({ type: "snapshot-reconciled", snapshot });
    },
    rememberHullPositions(groups) {
      const placements = rememberOverviewThreadHullPositions(
        state.presentation.groupPlacements,
        groups,
      );
      if (placements === state.presentation.groupPlacements) return state;
      return apply({
        type: "hull-positions-remembered",
        placements,
      });
    },
    scheduleSave(projectId, reconciliation) {
      persistence.schedule({
        projectId,
        state: overviewWhiteboardPersistedState(state.presentation),
        reconciliation,
      });
    },
    cancelScheduledSave() {
      persistence.cancelTimer();
    },
    attachPageHide() {
      return persistence.attachPageHide();
    },
    canSave(projectId, viewerSessionsReady): projectId is string {
      return canSaveOverviewWhiteboard(
        state.presentation,
        projectId,
        viewerSessionsReady,
      );
    },
    isTouched() {
      return state.session.touched;
    },
    consumeSkipNextAutoFit() {
      if (!state.session.skipNextAutoFit) return false;
      apply({ type: "auto-fit-consumed" });
      return true;
    },
    markTouched() {
      return apply({ type: "interaction-touched" });
    },
  };
}

export function canSaveOverviewWhiteboard(
  presentation: OverviewWhiteboardRuntimeState,
  projectId: string | undefined,
  viewerSessionsReady: boolean,
): projectId is string {
  return Boolean(
    projectId &&
      viewerSessionsReady &&
      presentation.hydration?.viewersRestored &&
      presentation.hydration.projectId === projectId,
  );
}

export function sameHydrationProject(
  presentation: OverviewWhiteboardRuntimeState,
  projectId: string | null,
): boolean {
  return presentation.hydration?.projectId === projectId;
}

export type { OverviewThreadD3FlowGroupPlacement };
