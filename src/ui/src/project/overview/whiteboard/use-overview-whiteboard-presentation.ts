import { useEffect, useMemo, useRef, useState } from "react";
import type { OverviewThreadWhiteboardPresentationReconciliation } from "../../overview-thread-whiteboard-persistence.ts";
import type { OverviewThreadWhiteboardTransform } from "../../overview-thread-whiteboard-transform.ts";
import {
  createOverviewWhiteboardController,
  type OverviewWhiteboardController,
  sameHydrationProject,
} from "./controller.ts";
import { createOverviewWhiteboardPersistence } from "./persistence.ts";
import { overviewWhiteboardPersistenceProjectId } from "./persistence.ts";
import type {
  OverviewViewerState,
  OverviewWhiteboardControllerState,
  OverviewWhiteboardEvent,
  OverviewWhiteboardLayoutMode,
  OverviewWhiteboardRuntimeState,
  OverviewWhiteboardSnapshotFacts,
  OverviewWhiteboardUpdater,
} from "./types.ts";

export interface UseOverviewWhiteboardPresentationInput {
  readonly projectId?: string;
  readonly viewerSessionsReady?: boolean;
  readonly reconciliation: OverviewThreadWhiteboardPresentationReconciliation;
}

export interface OverviewWhiteboardPresentationApi {
  readonly presentation: OverviewWhiteboardRuntimeState;
  readonly persistenceProjectId: string | undefined;
  apply(event: OverviewWhiteboardEvent): OverviewWhiteboardControllerState;
  markTouched(): void;
  isTouched(): boolean;
  consumeSkipNextAutoFit(): boolean;
  reconcileSnapshot(snapshot: OverviewWhiteboardSnapshotFacts): void;
  rememberHullPositions(
    groups: readonly {
      readonly key: string;
      readonly x: number;
      readonly y: number;
    }[],
  ): void;
  setLayoutMode(layoutMode: OverviewWhiteboardLayoutMode): void;
  changeLayoutMode(layoutMode: OverviewWhiteboardLayoutMode): void;
  setGroupPlacements(
    placements: OverviewWhiteboardUpdater<
      OverviewWhiteboardRuntimeState["groupPlacements"]
    >,
    options?: {
      readonly fixedGroupKey?: string;
      readonly markTouched?: boolean;
    },
  ): void;
  setNodePlacements(
    placements: OverviewWhiteboardUpdater<
      OverviewWhiteboardRuntimeState["nodePlacements"]
    >,
  ): void;
  setWhiteboardTransform(
    transform: OverviewWhiteboardUpdater<OverviewThreadWhiteboardTransform>,
    options?: { readonly touched?: boolean },
  ): void;
  setViewers(
    viewers: OverviewWhiteboardUpdater<readonly OverviewViewerState[]>,
  ): void;
  setAutoShownNodeKeys(
    keys: OverviewWhiteboardUpdater<readonly string[]>,
  ): void;
  setSelectedKey(
    key: OverviewWhiteboardUpdater<string | undefined>,
  ): void;
  setSelectedRowKey(
    rowKey: OverviewWhiteboardUpdater<string | undefined>,
  ): void;
  setSelectionPinned(pinned: boolean): void;
  closeSelection(): void;
  clearCanvasSelection(): void;
  setHoveredKey(
    key: OverviewWhiteboardUpdater<string | undefined>,
  ): void;
  setFocusedKey(
    key: OverviewWhiteboardUpdater<string | undefined>,
  ): void;
  setFixedGroupKey(key: string | undefined): void;
  resetLayout(transform: OverviewThreadWhiteboardTransform): void;
}

export function useOverviewWhiteboardPresentation(
  input: UseOverviewWhiteboardPresentationInput,
): OverviewWhiteboardPresentationApi {
  const viewerSessionsReady = input.viewerSessionsReady ?? true;
  const persistenceProjectId = overviewWhiteboardPersistenceProjectId(
    input.projectId,
  );
  const controllerRef = useRef<OverviewWhiteboardController | undefined>(
    undefined,
  );
  if (!controllerRef.current) {
    controllerRef.current = createOverviewWhiteboardController(
      createOverviewWhiteboardPersistence(),
    );
  }
  const controller = controllerRef.current;
  const reconciliationRef = useRef(input.reconciliation);
  reconciliationRef.current = input.reconciliation;
  const presentationRef = useRef(controller.getState().presentation);
  const [presentation, setPresentation] = useState(
    presentationRef.current,
  );

  const publish = (next = controller.getState()) => {
    if (next.presentation !== presentationRef.current) {
      presentationRef.current = next.presentation;
      setPresentation(next.presentation);
    }
    return next;
  };

  const apply = (event: OverviewWhiteboardEvent) =>
    publish(controller.apply(event));

  useEffect(() => {
    publish(controller.changeProject(
      persistenceProjectId ?? null,
      reconciliationRef.current,
      viewerSessionsReady,
    ));
  }, [controller, persistenceProjectId]);

  useEffect(() => {
    if (!viewerSessionsReady) return;
    publish(controller.restoreViewersWhenSessionsReady(
      persistenceProjectId ?? null,
      reconciliationRef.current,
    ));
  }, [
    controller,
    presentation.hydration,
    persistenceProjectId,
    viewerSessionsReady,
  ]);

  useEffect(() => {
    if (
      !controller.canSave(persistenceProjectId, viewerSessionsReady)
    ) return;
    controller.scheduleSave(
      persistenceProjectId,
      input.reconciliation,
    );
    return () => controller.cancelScheduledSave();
  }, [
    controller,
    input.reconciliation,
    persistenceProjectId,
    presentation.autoShownNodeKeys,
    presentation.groupPlacements,
    presentation.hydration,
    presentation.layoutMode,
    presentation.nodePlacements,
    presentation.transform,
    presentation.viewers,
    viewerSessionsReady,
  ]);

  useEffect(() => controller.attachPageHide(), [controller]);

  return useMemo((): OverviewWhiteboardPresentationApi => ({
    presentation,
    persistenceProjectId,
    apply,
    markTouched() {
      controller.markTouched();
    },
    isTouched() {
      return controller.isTouched();
    },
    consumeSkipNextAutoFit() {
      return controller.consumeSkipNextAutoFit();
    },
    reconcileSnapshot(snapshot) {
      publish(controller.reconcileSnapshot(snapshot));
    },
    rememberHullPositions(groups) {
      const current = controller.getState().presentation;
      if (
        !sameHydrationProject(
          current,
          persistenceProjectId ?? null,
        ) ||
        current.groupPlacements !== presentation.groupPlacements ||
        current.nodePlacements !== presentation.nodePlacements ||
        current.fixedGroupKey !== presentation.fixedGroupKey
      ) return;
      // Project hydration can run before the canvas effect from the same
      // render. Do not overwrite restored placement with that older layout.
      publish(controller.rememberHullPositions(groups));
    },
    setLayoutMode(layoutMode) {
      apply({ type: "layout-mode-changed", layoutMode });
    },
    changeLayoutMode(layoutMode) {
      apply({ type: "layout-mode-changed", layoutMode });
    },
    setGroupPlacements(placements, options) {
      apply({
        type: "group-placements-changed",
        placements,
        ...(options?.fixedGroupKey !== undefined
          ? { fixedGroupKey: options.fixedGroupKey }
          : {}),
        ...(options?.markTouched ? { markTouched: true } : {}),
      });
    },
    setNodePlacements(placements) {
      apply({ type: "node-placements-changed", placements });
    },
    setWhiteboardTransform(transform, options) {
      apply({
        type: "transform-changed",
        transform,
        ...(options?.touched !== undefined ? { touched: options.touched } : {}),
      });
    },
    setViewers(viewers) {
      apply({ type: "viewers-changed", viewers });
    },
    setAutoShownNodeKeys(keys) {
      apply({ type: "auto-shown-changed", keys });
    },
    setSelectedKey(key) {
      apply({ type: "selected-key-changed", key });
    },
    setSelectedRowKey(rowKey) {
      apply({ type: "selected-row-changed", rowKey });
    },
    setSelectionPinned(pinned) {
      apply({ type: "selection-pin-changed", pinned });
    },
    closeSelection() {
      apply({ type: "selection-closed" });
    },
    clearCanvasSelection() {
      apply({ type: "canvas-cleared" });
    },
    setHoveredKey(key) {
      apply({ type: "hover-changed", key });
    },
    setFocusedKey(key) {
      apply({ type: "focus-changed", key });
    },
    setFixedGroupKey(key) {
      apply({ type: "fixed-group-changed", key });
    },
    resetLayout(transform) {
      apply({ type: "layout-reset", transform });
    },
  }), [
    apply,
    controller,
    persistenceProjectId,
    presentation,
    publish,
  ]);
}
