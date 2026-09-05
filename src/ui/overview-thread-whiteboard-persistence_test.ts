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
const HULL_SESSION = `mcp-app:${"a".repeat(64)}`;

const CURRENT: OverviewThreadWhiteboardPresentationReconciliation = {
  groupKeys: [REQUIREMENTS_GROUP, BUILD_GROUP],
  nodeKeys: [REQUIREMENT_NODE, ACTIVITY_NODE, HULL_NODE],
  viewerCapabilities: {
    [REQUIREMENT_NODE]: { sessionIds: [] },
    [ACTIVITY_NODE]: { sessionIds: [] },
    [HULL_NODE]: { sessionIds: [HULL_SESSION] },
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
        kind: "session",
        id: `session:${HULL_NODE}:${HULL_SESSION}`,
        nodeKey: HULL_NODE,
        sessionId: HULL_SESSION,
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
    "casys.project-whiteboard.presentation:v3:project%2Fdemo%20alpha",
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
  assertStringIncludes(serialized, '"version":3');
  assertStringIncludes(serialized, `"sessionId":"${HULL_SESSION}"`);
  assertEquals(serialized.includes('"uri"'), false);
  assertEquals(serialized.includes('"token"'), false);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(serialized, PROJECT_ID),
    state,
  );

  const envelope = JSON.parse(serialized);
  assertEquals(envelope.projectId, PROJECT_ID);
  assertEquals(envelope.state.viewers[0].expanded, true);
  assertEquals(envelope.state.viewers[0].restoreGeometry, {
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
      { ...firstViewer, expanded: false, restoreGeometry: undefined },
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
  badVersion.version = 1;
  assertEquals(parseEnvelope(badVersion), undefined);

  const unknownStateField = JSON.parse(serialized);
  unknownStateField.state.authoritative = true;
  assertEquals(parseEnvelope(unknownStateField), undefined);

  const badTransform = JSON.parse(serialized);
  badTransform.state.transform.k = 99;
  assertEquals(parseEnvelope(badTransform), undefined);

  const inventedViewerId = JSON.parse(serialized);
  inventedViewerId.state.viewers[0].id = "session:another-node:invented";
  assertEquals(parseEnvelope(inventedViewerId), undefined);

  const unknownViewerKind = JSON.parse(serialized);
  unknownViewerKind.state.viewers[0].kind = "simulation";
  assertEquals(parseEnvelope(unknownViewerKind), undefined);

  const retiredNativeViewerKind = JSON.parse(serialized);
  retiredNativeViewerKind.state.viewers[0].kind = "record";
  assertEquals(parseEnvelope(retiredNativeViewerKind), undefined);

  const expandedWithoutRestore = JSON.parse(serialized);
  delete expandedWithoutRestore.state.viewers[0].restoreGeometry;
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
        kind: "session",
        id: `session:${STALE_NODE}:mcp-app:${"d".repeat(64)}`,
        nodeKey: STALE_NODE,
        sessionId: `mcp-app:${"d".repeat(64)}`,
        geometry: { x: 10, y: 10, width: 300, height: 220 },
        z: 5,
        expanded: false,
      },
      {
        kind: "session",
        id: `session:${HULL_NODE}:mcp-app:${"b".repeat(64)}`,
        nodeKey: HULL_NODE,
        sessionId: `mcp-app:${"b".repeat(64)}`,
        geometry: { x: 20, y: 20, width: 300, height: 220 },
        z: 6,
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

Deno.test("session presentation is rejected without its exact current session key", () => {
  const serialized = serializeOverviewThreadWhiteboardPresentation(
    PROJECT_ID,
    completeState(),
  )!;
  const session = JSON.parse(serialized);
  session.state.viewers[0].sessionId = `mcp-app:${"c".repeat(64)}`;
  assertEquals(parseEnvelope(session), undefined);
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

Deno.test("legacy hull geometry migrates to v3 while retired native viewers are discarded", () => {
  const storage = new MemoryStorage();
  const legacyKey = "casys.project-whiteboard.presentation:v1:project%2Fdemo%20alpha";
  const legacyState = {
    layoutMode: "radial",
    groupPlacements: {
      [BUILD_GROUP]: {
        x: -10_000,
        y: 10_000,
        width: 720,
        height: 480,
        collapsed: true,
        view: "matrix" as const,
        sort: "name" as const,
        scrollRow: 7,
      },
    },
    nodePlacements: {
      [HULL_NODE]: { offsetX: -18, offsetY: 24 },
    },
    transform: { x: 320, y: -180, k: 1.2 },
    viewers: [{
      kind: "cad",
      id: `cad:${HULL_NODE}:retired-asset`,
      nodeKey: HULL_NODE,
      assetId: "retired-asset",
      geometry: { x: 10, y: 20, width: 400, height: 300 },
      z: 3,
      expanded: false,
    }],
  };
  storage.setItem(
    legacyKey,
    JSON.stringify({
      schema: "casys-project-whiteboard-presentation",
      version: 1,
      projectId: PROJECT_ID,
      state: legacyState,
    }),
  );

  const migrated = loadOverviewThreadWhiteboardPresentation(
    storage,
    PROJECT_ID,
    CURRENT,
  );
  assert(migrated);
  assertEquals(migrated.layoutMode, legacyState.layoutMode);
  assertEquals(migrated.groupPlacements, legacyState.groupPlacements);
  assertEquals(migrated.nodePlacements, legacyState.nodePlacements);
  assertEquals(migrated.transform, legacyState.transform);
  assertEquals(migrated.viewers, []);

  const currentKey = overviewThreadWhiteboardPresentationStorageKey(
    PROJECT_ID,
  )!;
  const migratedEnvelope = storage.getItem(currentKey);
  assert(migratedEnvelope);
  assertEquals(
    parseOverviewThreadWhiteboardPresentation(migratedEnvelope, PROJECT_ID),
    migrated,
  );
});

Deno.test("v2 migration keeps only exact current MCP App sessions", () => {
  const storage = new MemoryStorage();
  const state = completeState();
  const legacyKey = "casys.project-whiteboard.presentation:v2:project%2Fdemo%20alpha";
  storage.setItem(
    legacyKey,
    JSON.stringify({
      schema: "casys-project-whiteboard-presentation",
      version: 2,
      projectId: PROJECT_ID,
      state: {
        ...state,
        viewers: [
          {
            kind: "record",
            id: `record:${REQUIREMENT_NODE}`,
            nodeKey: REQUIREMENT_NODE,
            geometry: { x: 20, y: 20, width: 320, height: 220 },
            z: 2,
            expanded: false,
          },
          ...state.viewers,
        ],
      },
    }),
  );

  assertEquals(
    loadOverviewThreadWhiteboardPresentation(storage, PROJECT_ID, CURRENT),
    state,
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
        kind: "session",
        id: `session:${STALE_NODE}:mcp-app:${"e".repeat(64)}`,
        nodeKey: STALE_NODE,
        sessionId: `mcp-app:${"e".repeat(64)}`,
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
      viewer.id === `session:${STALE_NODE}:mcp-app:${"e".repeat(64)}`
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
