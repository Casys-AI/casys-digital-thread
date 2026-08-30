import { assert, assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Project whiteboard hydrates exact local presentation state before auto-fit", async () => {
  const source = await heroSource();

  assertStringIncludes(source, "  projectId,\n  activities = [],");
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

Deno.test("Project whiteboard reconciles viewers from current exact Thread capabilities", async () => {
  const source = await heroSource();

  assertStringIncludes(
    source,
    "overviewThreadD3FlowGroupIdentity(item.lane, item.groupKey)",
  );
  assertStringIncludes(source, "result[item.key] = { activity: true };");
  assertStringIncludes(
    source,
    "const capabilities = resolveOverviewThreadViewerCapabilities(\n        thread,\n        item.node,",
  );
  assertStringIncludes(
    source,
    "cadAssetIds: capabilities.cadAssets.map((asset) => asset.id)",
  );
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
  assertStringIncludes(conversion, "assetId: viewer.assetId");
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
    "window.setTimeout(\n      () => flushPersistenceRef.current(),\n      OVERVIEW_WHITEBOARD_SAVE_DELAY_MS,",
  );
  assertStringIncludes(source, 'window.addEventListener("pagehide", flush);');
  assertStringIncludes(
    source,
    'window.removeEventListener("pagehide", flush);',
  );
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("hierarchy")}');
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("radial")}');
});

function heroSource(): Promise<string> {
  return Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
}
