import { assert, assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Project whiteboard hydrates exact local presentation state before auto-fit", async () => {
  const source = await heroSource();

  assertStringIncludes(
    source,
    "  projectId,\n  viewerSessions,\n  activities = [],",
  );
  assertStringIncludes(
    source,
    "loadOverviewThreadWhiteboardPresentation(\n        storage,\n        persistenceProjectId,\n        persistenceReconciliationRef.current,",
  );
  for (
    const restoration of [
      "setLayoutMode(restored.layoutMode);",
      "setGroupPlacements(restored.groupPlacements);",
      "setNodePlacements(restored.nodePlacements);",
      "setWhiteboardTransform(restored.transform);",
      "setViewers(restored.viewers.map(overviewViewerFromPresentation));",
    ]
  ) {
    assertStringIncludes(source, restoration);
  }

  const hydration = source.indexOf(
    "loadOverviewThreadWhiteboardPresentation(",
  );
  const autoFitGate = source.indexOf("if (skipNextAutoFitRef.current)");
  const fit = source.indexOf(
    "setWhiteboardTransform(\n        bounds\n          ? fitOverviewThreadWhiteboardTransform(bounds)",
  );
  assert(hydration >= 0);
  assert(autoFitGate > hydration);
  assert(fit > autoFitGate);
  assertStringIncludes(
    source,
    "persistenceHydration?.projectId !== (persistenceProjectId ?? null)",
  );
  assertStringIncludes(
    source,
    "skipNextAutoFitRef.current = restored !== undefined;",
  );
});

Deno.test("Project whiteboard persistence follows the stable project identity across revisions", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(overview, "projectId={project.project.id}");
  assertEquals(overview.includes("projectId={project.id}"), false);
});

Deno.test("Project whiteboard reconciles viewers from current exact Thread capabilities", async () => {
  const source = await heroSource();

  assertStringIncludes(
    source,
    "overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey)",
  );
  assertStringIncludes(
    source,
    "sessionIds: (viewerSessionsByNodeKey.get(item.key) ?? []).map(",
  );
  assertEquals(
    source.includes("resolveOverviewThreadViewerCapabilities"),
    false,
  );
  assertEquals(source.includes("record: true"), false);
  assertEquals(source.includes("activity: true"), false);
  assertEquals(source.includes("cadAssetIds:"), false);
  assertStringIncludes(
    source,
    "viewerCapabilities: persistenceViewerCapabilities",
  );

  const conversion = source.slice(
    source.indexOf("function overviewViewerToPresentation("),
    source.indexOf("function nextOverviewHeroSelection("),
  );
  assertStringIncludes(conversion, "geometry: overviewViewerGeometry(viewer)");
  assertStringIncludes(
    conversion,
    "expanded: viewer.restoreGeometry !== undefined",
  );
  assertStringIncludes(conversion, "sessionId: viewer.sessionId");
  assertEquals(conversion.includes("assetId: viewer.assetId"), false);
  assertEquals(conversion.includes('kind: "chat"'), false);
});

Deno.test("Project whiteboard debounces local saves and flushes them on pagehide", async () => {
  const source = await heroSource();

  assertStringIncludes(
    source,
    "const OVERVIEW_WHITEBOARD_SAVE_DELAY_MS = 240;",
  );
  assertStringIncludes(
    source,
    "pendingPersistenceRef.current = {\n      projectId: persistenceProjectId,",
  );
  assertStringIncludes(
    source,
    "saveOverviewThreadWhiteboardPresentation(\n      storage,\n      pending.projectId,",
  );
  assertStringIncludes(
    source,
    "globalThis.setTimeout(\n      () => flushPersistenceRef.current(),\n      OVERVIEW_WHITEBOARD_SAVE_DELAY_MS,",
  );
  assertStringIncludes(
    source,
    'globalThis.addEventListener("pagehide", flush);',
  );
  assertStringIncludes(
    source,
    'globalThis.removeEventListener("pagehide", flush);',
  );
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("hierarchy")}');
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("radial")}');
});

function heroSource(): Promise<string> {
  return Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
}
