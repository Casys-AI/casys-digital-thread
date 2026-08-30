import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  loadOverviewThreadWhiteboardPresentation,
  type OverviewThreadWhiteboardPresentationReconciliation,
  type OverviewThreadWhiteboardPresentationState,
  type OverviewThreadWhiteboardPresentationStorage,
  overviewThreadWhiteboardPresentationStorageKey,
  parseOverviewThreadWhiteboardPresentation,
  reconcileOverviewThreadWhiteboardPresentation,
  saveOverviewThreadWhiteboardPresentation,
  serializeOverviewThreadWhiteboardPresentation,
} from "./src/project/overview-thread-whiteboard-persistence.ts";

const PROJECT_ID = "project/demo alpha";
const REQUIREMENTS_GROUP = "group:requirements:system-model";
const BUILD_GROUP = "group:build:hull";
const REQUIREMENT_NODE = "artifact:req-1";
const ACTIVITY_NODE = "project-activity:run-1";
const HULL_NODE = "artifact:hull-1";
const STALE_NODE = "artifact:retired";
const HULL_ASSET = "asset-hull-glb";

const CURRENT: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [REQUIREMENTS_GROUP, BUILD_GROUP],
  nodeKeys: [REQUIREMENT_NODE, ACTIVITY_NODE, HULL_NODE],
  viewerCapabilities: {
    [REQUIREMENT_NODE]: { record: true },
    [ACTIVITY_NODE]: { activity: true },
    [HULL_NODE]: { record: true, cadAssetIds: [HULL_ASSET] },
  },
};

function completeState(): OverviewThreadWhiteboardPresentationState {
  return {
    layoutMode: "hierarchy",
    groupPlacements: {
      [REQUIREMENTS_GROUP]: { x: 42, y: 68, offsetX: 4 },
      [BUILD_GROUP]: { x: 580, y: 236 },
    },
    nodePlacements: {
      [REQUIREMENT_NODE]: { offsetX: 12, offsetY: -6 },
      [HULL_NODE]: { offsetX: -8, offsetY: 14 },
    },
    transform: { x: -184.25, y: 42, k: 0.8 },
    viewers: [
      {
        kind: "record",
        id: `record:${REQUIREMENT_NODE}`,
        nodeKey: REQUIREMENT_NODE,
        geometry: { x: 140, y: 90, width: 340, height: 280 },
        z: 2,
        expanded: false,
      },
      {
        kind: "activity",
        id: `activity:${ACTIVITY_NODE}`,
        nodeKey: ACTIVITY_NODE,
        geometry: { x: 300, y: 340, width: 360, height: 250 },
        z: 3,
        expanded: false,
      },
      {
        kind: "cad",
        id: `cad:${HULL_NODE}:${HULL_ASSET}`,
        nodeKey: HULL_NODE,
        assetId: HULL_ASSET,
        geometry: { x: 8, y: 8, width: 980, height: 540 },
        z: 4,
        expanded: true,
        restoreGeometry: { x: 620, y: 120, width: 360, height: 300 },
      },
    ],
  };
}

Deno.test("whiteboard persistence keys are versioned, encoded and project scoped", () => {
  const key = overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID);
  assertEquals(
    key,
    "casys.project-whiteboard.presentation:v1:project%2Fdemo%20alpha",
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project/demo beta") === key,
    false,
  );
  assertEquals(overviewThreadWhiteboardPresentationStorageKey(""), undefined);
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey(" project/demo"),
    undefined,
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project\nother"),
    undefined,
  );
  assertEquals(
    overviewThreadWhiteboardPresentationStorageKey("project/\ud800"),
    undefined,
  );
});

Deno.test("whiteboard presentation round-trips every spatial field without granting authority", () => {
  const state = completeState();
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    state,
  );
  assert(serialized);
  assertStringIncludes(
    serialized,
    '"schema":"casys-project-whiteboard-presentation"',
  );
  assertStringIncludes(serialized, '"version":1');
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, PROJECT_ID),
    state,
  );

  const envelope = JSON.parse(serialized);
  assertEquals(envelope.projectId, PROJECT_ID);
  assertEquals(envelope.state.viewers[2].expanded, true);
  assertEquals(envelope.state.viewers[2].restoreGeometry, {
    x: 620,
    y: 120,
    width: 360,
    height: 300,
  });

  const explicitUndefined = completeState();
  const firstViewer = explicitUndefined.viewers[0];
  assert(firstViewer);
  const withRuntimeOptional: OverviewThreadWhiteboardPresentationState = {
    ...explicitUndefined,
    viewers: [
      { ...firstViewer, restoreGeometry: undefined },
      ...explicitUndefined.viewers.slice(1),
    ],
  };
  assert(
    serializeOverviewThreadWhiteboardPresentation(
      PROJECT_ID,
      withRuntimeOptional,
    ),
  );
});

Deno.test("off-graph viewers and camera positions survive a project reload", () => {
  const state = completeState();
  const offGraph: OverviewThreadWhiteboardPresentationState = {
    ...state,
    transform: { x: 4_800, y: -3_200, k: 0.4 },
    viewers: state.viewers.map((viewer, index) => ({
      ...viewer,
      geometry: {
        ...viewer.geometry,
        x: index === 0 ? -2_400 : 3_600 + index * 500,
        y: index === 1 ? -1_800 : 2_100 + index * 300,
      },
      ...(viewer.restoreGeometry
        ? {
          restoreGeometry: {
            ...viewer.restoreGeometry,
            x: -3_200,
            y: 4_400,
          },
        }
        : {}),
    })),
  };
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    offGraph,
  );
  assert(serialized);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, PROJECT_ID),
    offGraph,
  );
});

Deno.test("parser fails closed on malformed, cross-project, stale-schema and invented viewer entries", () => {
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    completeState(),
  )!;
  assertEquals(
    parseOverviewThreadWhiteboardPresentation("not json", PROJECT_ID),
    undefined,
  );
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, "project/other"),
    undefined,
  );

  const badVersion = JSON.parse(serialized);
  badVersion.version = 2;
  assertEquals(parseEnvelope(badVersion), undefined);

  const unknownStateField = JSON.parse(serialized);
  unknownStateField.state.authoritative = true;
  assertEquals(parseEnvelope(unknownStateField), undefined);

  const badTransform = JSON.parse(serialized);
  badTransform.state.transform.k = 99;
  assertEquals(parseEnvelope(badTransform), undefined);

  const inventedViewerId = JSON.parse(serialized);
  inventedViewerId.state.viewers[0].id = "record:another-node";
  assertEquals(parseEnvelope(inventedViewerId), undefined);

  const unknownViewerKind = JSON.parse(serialized);
  unknownViewerKind.state.viewers[0].kind = "simulation";
  assertEquals(parseEnvelope(unknownViewerKind), undefined);

  const expandedWithoutRestore = JSON.parse(serialized);
  delete expandedWithoutRestore.state.viewers[2].restoreGeometry;
  assertEquals(parseEnvelope(expandedWithoutRestore), undefined);

  const duplicateViewer = JSON.parse(serialized);
  duplicateViewer.state.viewers.push(duplicateViewer.state.viewers[0]);
  assertEquals(parseEnvelope(duplicateViewer), undefined);

  const emptyPlacement = JSON.parse(serialized);
  emptyPlacement.state.nodePlacements[HULL_NODE] = {};
  assertEquals(parseEnvelope(emptyPlacement), undefined);
});

Deno.test("reconciliation retains only current exact groups, nodes and viewer capabilities", () => {
  const state = completeState();
  const withStaleEntries: OverviewThreadWhiteboardPresentationState = {
    ...state,
    groupPlacements: {
      ...state.groupPlacements,
      "group:retired": { x: 900, y: 900 },
    },
    nodePlacements: {
      ...state.nodePlacements,
      [STALE_NODE]: { offsetX: 99, offsetY: 99 },
    },
    viewers: [
      ...state.viewers,
      {
        kind: "record",
        id: `record:${STALE_NODE}`,
        nodeKey: STALE_NODE,
        geometry: { x: 10, y: 10, width: 300, height: 220 },
        z: 5,
        expanded: false,
      },
      {
        kind: "cad",
        id: `cad:${HULL_NODE}:asset-unrelated-glb`,
        nodeKey: HULL_NODE,
        assetId: "asset-unrelated-glb",
        geometry: { x: 20, y: 20, width: 300, height: 220 },
        z: 6,
        expanded: false,
      },
      {
        kind: "record",
        id: `record:${ACTIVITY_NODE}`,
        nodeKey: ACTIVITY_NODE,
        geometry: { x: 30, y: 30, width: 300, height: 220 },
        z: 7,
        expanded: false,
      },
    ],
  };

  const reconciled = reconcileOverviewThreadWhiteboardPresentation(
    withStaleEntries,
    CURRENT,
  );

  assertEquals(Object.keys(reconciled.groupPlacements), [
    REQUIREMENTS_GROUP,
    BUILD_GROUP,
  ]);
  assertEquals(Object.keys(reconciled.nodePlacements), [
    REQUIREMENT_NODE,
    HULL_NODE,
  ]);
  assertEquals(
    reconciled.viewers.map((viewer) => viewer.id),
    state.viewers.map((viewer) => viewer.id),
  );
  assertEquals(reconciled.transform, state.transform);
  assertEquals(reconciled.layoutMode, state.layoutMode);
});

Deno.test("local load and save reconcile before storage and contain storage failures", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  assertEquals(
    saveOverviewThreadWhiteboardPresentation(
      storage,
      PROJECT_ID,
      state,
      CURRENT,
    ),
    true,
  );
  const expectedKey = overviewThreadWhiteboardPresentationStorageKey(
    PROJECT_ID,
  )!;
  assertEquals(storage.writes, [expectedKey]);
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, PROJECT_ID, CURRENT),
    state,
  );
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, "project/other", CURRENT),
    undefined,
  );

  const blockedStorage: OverviewThreadWhiteboardPresentationStorage = {
    getItem() {
      throw new DOMException("blocked", "SecurityError");
    },
    setItem() {
      throw new DOMException("full", "QuotaExceededError");
    },
  };
  assertEquals(
    loadOverviewThreadWhiteboardPresentation(
      blockedStorage,
      PROJECT_ID,
      CURRENT,
    ),
    undefined,
  );
  assertEquals(
    saveOverviewThreadWhiteboardPresentation(
      blockedStorage,
      PROJECT_ID,
      state,
      CURRENT,
    ),
    false,
  );
});

Deno.test("save removes stale local entries before the next reload", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  const staleState: OverviewThreadWhiteboardPresentationState = {
    ...state,
    groupPlacements: {
      ...state.groupPlacements,
      "group:old": { x: 10, y: 20 },
    },
    viewers: [
      ...state.viewers,
      {
        kind: "record",
        id: `record:${STALE_NODE}`,
        nodeKey: STALE_NODE,
        geometry: { x: 10, y: 10, width: 300, height: 220 },
        z: 9,
        expanded: false,
      },
    ],
  };
  assert(
    saveOverviewThreadWhiteboardPresentation(
      storage,
      PROJECT_ID,
      staleState,
      CURRENT,
    ),
  );
  const stored = JSON.parse(
    storage.getItem(
      overviewThreadWhiteboardPresentationStorageKey(PROJECT_ID)!,
    )!,
  );
  assertEquals(stored.state.groupPlacements["group:old"], undefined);
  assertEquals(
    stored.state.viewers.some((viewer: { id: string }) =>
      viewer.id === `record:${STALE_NODE}`
    ),
    false,
  );
});

function parseEnvelope(value: unknown) {
  return parseOverviewThreadWhiteboardPresentation(
    JSON.stringify(value),
    PROJECT_ID,
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
