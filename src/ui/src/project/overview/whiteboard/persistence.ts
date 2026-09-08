import {
  loadOverviewThreadWhiteboardPresentation,
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  type OverviewThreadWhiteboardPresentationStorage,
  overviewThreadWhiteboardPresentationStorageKey,
  saveOverviewThreadWhiteboardPresentation,
} from "../../overview-thread-whiteboard-persistence.ts";
import type { OverviewWhiteboardPendingPersistence } from "./types.ts";

export const OVERVIEW_WHITEBOARD_SAVE_DELAY_MS = 240;

export interface OverviewWhiteboardPersistenceClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
  addEventListener?(type: "pagehide", listener: () => void): void;
  removeEventListener?(type: "pagehide", listener: () => void): void;
}

export interface OverviewWhiteboardPersistenceOptions {
  readonly storage?: OverviewThreadWhiteboardPresentationStorage;
  readonly clock?: OverviewWhiteboardPersistenceClock;
  readonly saveDelayMs?: number;
}

export interface OverviewWhiteboardPersistence {
  readonly saveDelayMs: number;
  load(
    projectId: string,
    reconciliation: OverviewThreadWhiteboardPresentationReconciliation,
  ): OverviewThreadWhiteboardPresentationState | undefined;
  schedule(pending: OverviewWhiteboardPendingPersistence): void;
  flush(): void;
  cancelTimer(): void;
  attachPageHide(): () => void;
  pending(): OverviewWhiteboardPendingPersistence | undefined;
}

export function overviewWhiteboardPersistenceProjectId(
  projectId: string | undefined,
): string | undefined {
  return projectId &&
      overviewThreadWhiteboardPresentationStorageKey(projectId)
    ? projectId
    : undefined;
}

export function overviewWhiteboardBrowserStorage():
  | OverviewThreadWhiteboardPresentationStorage
  | undefined {
  if (!("localStorage" in globalThis)) return undefined;
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function createOverviewWhiteboardPersistence(
  options: OverviewWhiteboardPersistenceOptions = {},
): OverviewWhiteboardPersistence {
  const clock = options.clock ?? defaultClock();
  const saveDelayMs = options.saveDelayMs ?? OVERVIEW_WHITEBOARD_SAVE_DELAY_MS;
  let pending: OverviewWhiteboardPendingPersistence | undefined;
  let timer: unknown;

  const flush = () => {
    cancelTimer();
    const next = pending;
    pending = undefined;
    const storage = options.storage ?? overviewWhiteboardBrowserStorage();
    if (!next || !storage) return;
    saveOverviewThreadWhiteboardPresentation(
      storage,
      next.projectId,
      next.state,
      next.reconciliation,
    );
  };

  const cancelTimer = () => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };

  return {
    saveDelayMs,
    load(projectId, reconciliation) {
      const storage = options.storage ?? overviewWhiteboardBrowserStorage();
      if (!storage) return undefined;
      return loadOverviewThreadWhiteboardPresentation(
        storage,
        projectId,
        reconciliation,
      );
    },
    schedule(next) {
      pending = next;
      cancelTimer();
      timer = clock.setTimeout(flush, saveDelayMs);
    },
    flush,
    cancelTimer,
    attachPageHide() {
      const listener = () => flush();
      clock.addEventListener?.("pagehide", listener);
      return () => {
        clock.removeEventListener?.("pagehide", listener);
        flush();
      };
    },
    pending() {
      return pending;
    },
  };
}

function defaultClock(): OverviewWhiteboardPersistenceClock {
  return {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(
        handle as ReturnType<typeof globalThis.setTimeout>,
      );
    },
    addEventListener: (type, listener) => {
      globalThis.addEventListener(type, listener);
    },
    removeEventListener: (type, listener) => {
      globalThis.removeEventListener(type, listener);
    },
  };
}
