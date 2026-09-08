import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { createOverviewWhiteboardController } from "./src/project/overview/whiteboard/controller.ts";
import {
  createOverviewWhiteboardPersistence,
  OVERVIEW_WHITEBOARD_SAVE_DELAY_MS,
} from "./src/project/overview/whiteboard/persistence.ts";
import {
  overviewViewerToPresentation,
  overviewWhiteboardPersistedState,
} from "./src/project/overview/whiteboard/viewers.ts";
import type { OverviewViewerState } from "./src/project/overview/whiteboard/types.ts";
import {
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  type OverviewThreadWhiteboardPresentationStorage,
  saveOverviewThreadWhiteboardPresentation,
} from "./src/project/overview-thread-whiteboard-persistence.ts";

const PROJECT_A = "project/alpha";
const NODE = "artifact:hull-1";
const GROUP = "group:build:hull";
const SESSION = `mcp-app:${"b".repeat(64)}`;

const CAPABLE: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [GROUP],
  nodeKeys: [NODE],
  viewerCapabilities: { [NODE]: { sessionIds: [SESSION] } },
};

const EMPTY_CAPABILITIES: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [GROUP],
  nodeKeys: [NODE],
  viewerCapabilities: { [NODE]: { sessionIds: [] } },
};

Deno.test("Project whiteboard hydrates exact local presentation state before auto-fit", async () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  seedStorage(
    storage,
    storedPresentation({
      layoutMode: "radial",
      transform: { x: -12, y: 8, k: 0.75 },
      groupPlacements: { [GROUP]: { x: 40, y: 50 } },
      nodePlacements: { [NODE]: { offsetX: 2, offsetY: -3 } },
    }),
  );
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, CAPABLE, true);
  const presentation = controller.getState().presentation;
  assertEquals(presentation.layoutMode, "radial");
  assertEquals(presentation.transform, { x: -12, y: 8, k: 0.75 });
  assertEquals(presentation.groupPlacements[GROUP], { x: 40, y: 50 });
  assertEquals(presentation.nodePlacements[NODE], {
    offsetX: 2,
    offsetY: -3,
  });
  assertEquals(controller.getState().session.skipNextAutoFit, true);
  assertEquals(controller.consumeSkipNextAutoFit(), true);
  assertEquals(controller.consumeSkipNextAutoFit(), false);

  const hero = await heroSource();
  const hook = await hookSource();
  assertStringIncludes(
    hero,
    "  projectId,\n  viewerSessions,\n  viewerSessionsReady = true,",
  );
  assertStringIncludes(hero, "useOverviewWhiteboardPresentation(");
  assertStringIncludes(hero, "consumeSkipNextAutoFit");
  assertStringIncludes(hook, "controller.changeProject(");
  const consume = hero.indexOf("consumeSkipNextAutoFitRef.current()");
  const fit = hero.indexOf("fitOverviewThreadWhiteboardTransform(");
  assert(consume >= 0);
  assert(fit > consume);
});

Deno.test("Project whiteboard persistence follows the stable project identity across revisions", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(overview, "projectId={project.project.id}");
  assertEquals(overview.includes("projectId={project.id}"), false);
});

Deno.test("Project whiteboard reconciles viewers from current exact Thread capabilities", async () => {
  const sessionViewer: OverviewViewerState = {
    kind: "session",
    id: `session:${NODE}:${SESSION}`,
    nodeKey: NODE,
    sessionId: SESSION,
    x: 8,
    y: 8,
    width: 300,
    height: 200,
    z: 4,
    restoreGeometry: { x: 20, y: 30, width: 260, height: 180 },
  };
  const presented = overviewViewerToPresentation(sessionViewer);
  assert(presented);
  assertEquals(presented.sessionId, SESSION);
  assertEquals(presented.geometry, {
    x: 8,
    y: 8,
    width: 300,
    height: 200,
  });
  assertEquals(presented.expanded, true);
  assertEquals("assetId" in presented, false);

  const persisted = overviewWhiteboardPersistedState({
    layoutMode: "hierarchy",
    groupPlacements: {},
    nodePlacements: {},
    transform: { x: 0, y: 0, k: 1 },
    viewers: [
      sessionViewer,
      {
        kind: "current-brief",
        id: "current-brief:snap",
        briefSnapshotId: "snap",
        x: 1,
        y: 1,
        width: 200,
        height: 200,
        z: 1,
      },
    ],
    autoShownNodeKeys: [NODE],
  });
  assertEquals(persisted.viewers.length, 1);
  assertEquals(persisted.viewers[0]?.sessionId, SESSION);

  const hero = await heroSource();
  assertStringIncludes(
    hero,
    "overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey)",
  );
  assertStringIncludes(
    hero,
    "sessionIds: (viewerSessionsByNodeKey.get(item.key) ?? []).map(",
  );
  assertEquals(
    hero.includes("resolveOverviewThreadViewerCapabilities"),
    false,
  );
  assertEquals(hero.includes("record: true"), false);
  assertEquals(hero.includes("activity: true"), false);
  assertEquals(hero.includes("cadAssetIds:"), false);
  assertStringIncludes(
    hero,
    "viewerCapabilities: persistenceViewerCapabilities",
  );
});

Deno.test("Project whiteboard debounces local saves and flushes them on pagehide", async () => {
  assertEquals(OVERVIEW_WHITEBOARD_SAVE_DELAY_MS, 240);
  const storage = new MemoryStorage();
  const clock = new FakeClock();
  const persistence = createOverviewWhiteboardPersistence({ storage, clock });
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, CAPABLE, true);
  controller.apply({
    type: "transform-changed",
    transform: { x: 3, y: 4, k: 1.2 },
    touched: true,
  });
  assert(controller.canSave(PROJECT_A, true));
  controller.scheduleSave(PROJECT_A, CAPABLE);
  assertEquals(storage.writes.length, 0);
  clock.fireTimers();
  assertEquals(storage.writes.length, 1);

  controller.apply({
    type: "layout-mode-changed",
    layoutMode: "radial",
  });
  controller.scheduleSave(PROJECT_A, CAPABLE);
  const detach = controller.attachPageHide();
  clock.firePagehide();
  assertEquals(storage.writes.length, 2);
  const saved = JSON.parse(storage.getItem(storageKey(PROJECT_A))!);
  assertEquals(saved.state.layoutMode, "radial");
  detach();

  const hook = await hookSource();
  const hero = await heroSource();
  assertStringIncludes(hook, "controller.scheduleSave(");
  assertStringIncludes(hook, "controller.attachPageHide()");
  assertStringIncludes(hero, 'onClick={() => changeLayoutMode("hierarchy")}');
  assertStringIncludes(hero, 'onClick={() => changeLayoutMode("radial")}');
});

Deno.test("whiteboard waits for exact sessions before restoring viewers or saving", async () => {
  const storage = new MemoryStorage();
  const persistence = createOverviewWhiteboardPersistence({ storage });
  seedStorage(
    storage,
    storedPresentation({
      viewers: [{
        kind: "session",
        id: `session:${NODE}:${SESSION}`,
        nodeKey: NODE,
        sessionId: SESSION,
        geometry: { x: 9, y: 9, width: 300, height: 200 },
        z: 1,
        expanded: false,
      }],
    }),
  );
  const controller = createOverviewWhiteboardController(persistence);
  controller.changeProject(PROJECT_A, EMPTY_CAPABILITIES, false);
  assertEquals(controller.getState().presentation.viewers, []);
  assertEquals(
    controller.getState().presentation.hydration?.viewersRestored,
    false,
  );
  assertEquals(controller.canSave(PROJECT_A, false), false);
  assertEquals(controller.canSave(PROJECT_A, true), false);

  controller.restoreViewersWhenSessionsReady(PROJECT_A, CAPABLE);
  assertEquals(
    controller.getState().presentation.hydration?.viewersRestored,
    true,
  );
  assertEquals(
    controller.getState().presentation.viewers.flatMap((viewer) =>
      viewer.kind === "session" ? [viewer.sessionId] : []
    ),
    [SESSION],
  );
  assertEquals(controller.canSave(PROJECT_A, true), true);

  const hero = await heroSource();
  const hook = await hookSource();
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  assertStringIncludes(workbench, "viewerSessionsReady={!viewerSessionsClient");
  assertStringIncludes(
    workbench,
    "viewerSessionsMatchWorkbench(viewerSessions, workbench)",
  );
  assertStringIncludes(overview, "viewerSessionsReady={viewerSessionsReady}");
  assertStringIncludes(hook, "restoreViewersWhenSessionsReady(");
  assertStringIncludes(hook, "controller.canSave(");
  assertStringIncludes(hero, "viewerSessionsReady");
  assertStringIncludes(hero, "persistenceHydration?.viewersRestored");
});

function heroSource(): Promise<string> {
  return Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
}

function hookSource(): Promise<string> {
  return Deno.readTextFile(
    new URL(
      "./src/project/overview/whiteboard/use-overview-whiteboard-presentation.ts",
      import.meta.url,
    ),
  );
}

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
  state: OverviewThreadWhiteboardPresentationState,
): void {
  saveOverviewThreadWhiteboardPresentation(
    storage,
    PROJECT_A,
    state,
    CAPABLE,
  );
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
