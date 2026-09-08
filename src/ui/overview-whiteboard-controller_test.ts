import { assert, assertEquals } from "@std/assert";
import { nextHullViewPlacement } from "./src/project/overview-thread-d3-flow-layout.ts";
import { createOverviewWhiteboardController } from "./src/project/overview/whiteboard/controller.ts";
import { createOverviewWhiteboardPersistence } from "./src/project/overview/whiteboard/persistence.ts";
import {
  createOverviewWhiteboardControllerState,
  reduceOverviewWhiteboard,
} from "./src/project/overview/whiteboard/state.ts";
import {
  mergeRestoredOverviewViewers,
  overviewWhiteboardPersistedState,
} from "./src/project/overview/whiteboard/viewers.ts";
import type {
  OverviewViewerState,
  OverviewWhiteboardControllerState,
  OverviewWhiteboardSnapshotFacts,
} from "./src/project/overview/whiteboard/types.ts";
import {
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  type OverviewThreadWhiteboardPresentationStorage,
  saveOverviewThreadWhiteboardPresentation,
} from "./src/project/overview-thread-whiteboard-persistence.ts";

const PROJECT_A = "project/alpha";
const PROJECT_B = "project/beta";
const NODE = "artifact:hull-1";
const GROUP = "group:build:hull";
const SESSION = `mcp-app:${"b".repeat(64)}`;
const OTHER_SESSION = `mcp-app:${"c".repeat(64)}`;
const VIEWER_ID = `session:${NODE}:${SESSION}`;
const OTHER_ID = `session:${NODE}:${OTHER_SESSION}`;
const ROW_KEY = 'hull-row:["group:build:hull","root"]';
const STALE_ROW_KEY = 'hull-row:["group:retired","gone"]';

const CAPABLE: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [GROUP],
  nodeKeys: [NODE],
  viewerCapabilities: {
    [NODE]: { sessionIds: [SESSION, OTHER_SESSION] },
  },
};

const EMPTY_CAPABILITIES: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [GROUP],
  nodeKeys: [NODE],
  viewerCapabilities: { [NODE]: { sessionIds: [] } },
};

Deno.test("project switch flushes the previous project's pending save then loads the next", () => {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const persistence = createOverviewWhiteboardPersistence({ storage, clock });
  const controller = createOverviewWhiteboardController(persistence);

  seedStorage(
    storage,
    PROJECT_A,
    storedPresentation({
      transform: { x: 10, y: 20, k: 0.8 },
    }),
  );
  seedStorage(
    storage,
    PROJECT_B,
    storedPresentation({
      transform: { x: 1, y: 2, k: 1.5 },
      layoutMode: "radial",
    }),
  );

  controller.changeProject(PROJECT_A, CAPABLE, true);
  controller.apply({
    type: "transform-changed",
    transform: { x: 99, y: 98, k: 0.5 },
    touched: true,
  });
  assert(controller.canSave(PROJECT_A, true));
  controller.scheduleSave(PROJECT_A, CAPABLE);
  assertEquals(storage.writes.length, 2);

  controller.changeProject(PROJECT_B, CAPABLE, true);
  assertEquals(storage.writes.length, 3);
  const savedA = JSON.parse(storage.getItem(storageKey(PROJECT_A))!);
  assertEquals(savedA.state.transform, { x: 99, y: 98, k: 0.5 });
  assertEquals(controller.getState().presentation.transform, {
    x: 1,
    y: 2,
    k: 1.5,
  });
  assertEquals(controller.getState().presentation.layoutMode, "radial");
});

Deno.test("hull view switch replaces stale size instead of merging it", () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, CAPABLE, true);
  controller.apply({
    type: "group-placements-changed",
    placements: {
      [GROUP]: {
        x: 80,
        y: 90,
        width: 400,
        height: 800,
        scrollRow: 3,
        collapsed: false,
        sort: "recent",
        view: "tree",
      },
    },
    markTouched: true,
  });
  const current = controller.getState().presentation.groupPlacements[GROUP];
  controller.apply({
    type: "group-placements-changed",
    placements: {
      [GROUP]: nextHullViewPlacement(current, "matrix"),
    },
    fixedGroupKey: GROUP,
    markTouched: true,
  });
  assertEquals(controller.getState().presentation.groupPlacements[GROUP], {
    x: 80,
    y: 90,
    collapsed: false,
    sort: "recent",
    view: "matrix",
  });
});

Deno.test("late sessions merge live viewers and keep user layout", () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  const controller = createOverviewWhiteboardController(persistence);
  seedStorage(
    storage,
    PROJECT_A,
    storedPresentation({
      transform: { x: -40, y: 12, k: 0.7 },
      groupPlacements: { [GROUP]: { x: 80, y: 90 } },
      viewers: [storedViewer(SESSION, { x: 0, y: 0, width: 300, height: 200 })],
    }),
  );

  controller.changeProject(PROJECT_A, EMPTY_CAPABILITIES, false);
  const afterHydrate = controller.getState().presentation;
  assertEquals(afterHydrate.transform, { x: -40, y: 12, k: 0.7 });
  assertEquals(afterHydrate.groupPlacements[GROUP], { x: 80, y: 90 });
  assertEquals(afterHydrate.viewers, []);
  assertEquals(afterHydrate.hydration?.viewersRestored, false);

  controller.apply({
    type: "transform-changed",
    transform: { x: 5, y: 6, k: 1.1 },
    touched: true,
  });
  const live = liveViewer(OTHER_SESSION, {
    x: 50,
    y: 60,
    width: 320,
    height: 220,
  });
  controller.apply({ type: "viewers-changed", viewers: [live] });

  controller.restoreViewersWhenSessionsReady(PROJECT_A, CAPABLE);
  const merged = controller.getState().presentation;
  assertEquals(merged.transform, { x: 5, y: 6, k: 1.1 });
  assertEquals(merged.groupPlacements[GROUP], { x: 80, y: 90 });
  assertEquals(merged.hydration?.viewersRestored, true);
  assertEquals(merged.viewers.map((viewer) => viewer.id), [
    OTHER_ID,
    VIEWER_ID,
  ]);
  const kept = merged.viewers[0];
  assert(kept);
  assertEquals(kept.x, 50);
  assertEquals(kept.y, 60);
});

Deno.test("late restore prefers current geometry and does not resurrect dismissed viewers", () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  const controller = createOverviewWhiteboardController(persistence);
  seedStorage(
    storage,
    PROJECT_A,
    storedPresentation({
      viewers: [storedViewer(SESSION, { x: 0, y: 0, width: 300, height: 200 })],
    }),
  );

  controller.changeProject(PROJECT_A, EMPTY_CAPABILITIES, false);
  const moved = liveViewer(SESSION, { x: 40, y: 80, width: 360, height: 240 });
  controller.apply({ type: "viewers-changed", viewers: [moved] });
  controller.restoreViewersWhenSessionsReady(PROJECT_A, CAPABLE);
  const preferred = controller.getState().presentation.viewers[0];
  assert(preferred);
  assertEquals(preferred.id, VIEWER_ID);
  assertEquals(preferred.x, 40);
  assertEquals(preferred.y, 80);

  controller.apply({ type: "viewers-changed", viewers: [] });
  assertEquals(
    controller.getState().session.dismissedViewerIds.has(VIEWER_ID),
    true,
  );

  const resurrected = mergeRestoredOverviewViewers(
    [],
    [liveViewer(SESSION, { x: 0, y: 0, width: 300, height: 200 })],
    controller.getState().session.dismissedViewerIds,
  );
  assertEquals(resurrected, []);

  controller.changeProject(PROJECT_A, EMPTY_CAPABILITIES, false);
  controller.apply({
    type: "viewers-changed",
    viewers: [liveViewer(SESSION, { x: 1, y: 1, width: 300, height: 200 })],
  });
  controller.apply({ type: "viewers-changed", viewers: [] });
  controller.restoreViewersWhenSessionsReady(PROJECT_A, CAPABLE);
  assertEquals(controller.getState().presentation.viewers, []);
});

Deno.test("snapshot drops stale graph and exact row identities without guessing labels", () => {
  let state = selectedState("artifact:gone", STALE_ROW_KEY, [
    liveViewer(SESSION, { x: 8, y: 8, width: 300, height: 200 }),
  ]);
  const before = state.presentation.viewers;
  const snapshot: OverviewWhiteboardSnapshotFacts = {
    displayedKeys: [NODE],
    recordedKeys: [NODE],
    availableSessionIds: [SESSION],
    availableRowKeys: [ROW_KEY],
    hierarchyFirstKey: NODE,
    radialFirstKey: NODE,
    currentBriefSnapshotId: "brief-1",
  };
  state = reduceOverviewWhiteboard(state, {
    type: "snapshot-reconciled",
    snapshot,
  });
  assertEquals(state.presentation.selectedKey, undefined);
  assertEquals(state.presentation.selectedRowKey, undefined);
  assertEquals(state.presentation.focusedKey, NODE);
  assertEquals(state.presentation.viewers, before);

  const withRow = reduceOverviewWhiteboard(
    selectedState(NODE, ROW_KEY, before),
    {
      type: "snapshot-reconciled",
      snapshot,
    },
  );
  assertEquals(withRow.presentation.selectedKey, NODE);
  assertEquals(withRow.presentation.selectedRowKey, ROW_KEY);
  assertEquals(withRow.presentation.viewers, before);
});

Deno.test("no-op hover and focus keep controller identity so saves are not rescheduled", () => {
  const initial = createOverviewWhiteboardControllerState();
  const hovered = reduceOverviewWhiteboard(initial, {
    type: "hover-changed",
    key: NODE,
  });
  const again = reduceOverviewWhiteboard(hovered, {
    type: "hover-changed",
    key: NODE,
  });
  assertEquals(again, hovered);

  const focused = reduceOverviewWhiteboard(hovered, {
    type: "focus-changed",
    key: NODE,
  });
  const focusedAgain = reduceOverviewWhiteboard(focused, {
    type: "focus-changed",
    key: NODE,
  });
  assertEquals(focusedAgain, focused);
});

Deno.test("current-brief viewers stay out of persisted presentation", () => {
  const state = createOverviewWhiteboardControllerState();
  const withBrief = reduceOverviewWhiteboard(state, {
    type: "viewers-changed",
    viewers: [{
      kind: "current-brief",
      id: "current-brief:snap-1",
      briefSnapshotId: "snap-1",
      x: 12,
      y: 14,
      width: 400,
      height: 300,
      z: 2,
    }],
  });
  const persisted = overviewWhiteboardPersistedState(withBrief.presentation);
  assertEquals(persisted.viewers, []);
});

Deno.test("debounced save flushes on pagehide and exact sessions stay fail-closed", () => {
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const persistence = createOverviewWhiteboardPersistence({ storage, clock });
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, CAPABLE, true);
  controller.apply({
    type: "viewers-changed",
    viewers: [liveViewer(SESSION, { x: 9, y: 9, width: 300, height: 200 })],
  });
  controller.scheduleSave(PROJECT_A, CAPABLE);
  assertEquals(storage.writes.length, 0);
  clock.fireTimers();
  assertEquals(storage.writes.length, 1);

  controller.apply({
    type: "transform-changed",
    transform: { x: 3, y: 4, k: 1.2 },
    touched: true,
  });
  controller.scheduleSave(PROJECT_A, CAPABLE);
  const detach = controller.attachPageHide();
  clock.firePagehide();
  assertEquals(storage.writes.length, 2);
  detach();
});

Deno.test("fail-closed restore omits viewers whose exact session is absent", () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  seedStorage(
    storage,
    PROJECT_A,
    storedPresentation({
      viewers: [storedViewer(SESSION, { x: 0, y: 0, width: 300, height: 200 })],
    }),
  );
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, EMPTY_CAPABILITIES, true);
  assertEquals(controller.getState().presentation.viewers, []);
});

class MemoryStorage implements OverviewThreadWhiteboardPresentationStorage {
  readonly #values = new Map<string, string>();
  readonly writes: string[] = [];

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes.push(key);
    this.#values.set(key, value);
  }
}

class FakeClock {
  readonly #timers = new Map<number, () => void>();
  readonly #listeners = new Set<() => void>();
  #next = 1;

  setTimeout(callback: () => void, _delayMs: number): number {
    const id = this.#next++;
    this.#timers.set(id, callback);
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  addEventListener(_type: "pagehide", listener: () => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: "pagehide", listener: () => void): void {
    this.#listeners.delete(listener);
  }

  fireTimers(): void {
    const callbacks = [...this.#timers.values()];
    this.#timers.clear();
    for (const callback of callbacks) callback();
  }

  firePagehide(): void {
    for (const listener of this.#listeners) listener();
  }
}

function seedStorage(
  storage: OverviewThreadWhiteboardPresentationStorage,
  projectId: string,
  state: OverviewThreadWhiteboardPresentationState,
): void {
  saveOverviewThreadWhiteboardPresentation(storage, projectId, state, CAPABLE);
}

function storageKey(projectId: string): string {
  return `casys.project-whiteboard.presentation:v4:${
    encodeURIComponent(projectId)
  }`;
}

function storedPresentation(
  patch: Partial<OverviewThreadWhiteboardPresentationState> = {},
): OverviewThreadWhiteboardPresentationState {
  return {
    layoutMode: "hierarchy",
    groupPlacements: {},
    nodePlacements: {},
    transform: { x: 0, y: 0, k: 1 },
    viewers: [],
    ...patch,
  };
}

function storedViewer(
  sessionId: string,
  geometry: { x: number; y: number; width: number; height: number },
) {
  return {
    kind: "session" as const,
    id: `session:${NODE}:${sessionId}`,
    nodeKey: NODE,
    sessionId,
    geometry,
    z: 1,
    expanded: false,
  };
}

function liveViewer(
  sessionId: string,
  geometry: { x: number; y: number; width: number; height: number },
): OverviewViewerState {
  return {
    kind: "session",
    id: `session:${NODE}:${sessionId}`,
    nodeKey: NODE,
    sessionId,
    ...geometry,
    z: 1,
  };
}

function selectedState(
  selectedKey: string | undefined,
  selectedRowKey: string | undefined,
  viewers: readonly OverviewViewerState[],
): OverviewWhiteboardControllerState {
  const state = createOverviewWhiteboardControllerState();
  return {
    presentation: {
      ...state.presentation,
      selectedKey,
      selectedRowKey,
      focusedKey: selectedKey,
      viewers,
    },
    session: state.session,
  };
}
