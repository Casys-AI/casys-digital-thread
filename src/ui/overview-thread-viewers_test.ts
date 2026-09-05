import { assertEquals, assertStringIncludes } from "@std/assert";

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assertEquals(start >= 0, true, `Missing ${selector}`);
  const end = source.indexOf("\n}", start);
  assertEquals(end > start, true, `Unclosed ${selector}`);
  return source.slice(start, end + 2);
}

Deno.test("overview context menus expose every exact registered App", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertStringIncludes(flow, "DropdownMenuContextTrigger");
  assertStringIncludes(flow, "overviewThreadNodeContextValue(item.key)");
  assertStringIncludes(flow, "overviewThreadGroupContextValue(group.key)");
  assertStringIncludes(hero, "onContextMenuCapture={(event) =>");
  assertStringIncludes(hero, "parseOverviewThreadContextTarget");
  assertStringIncludes(
    hero,
    "for (const session of anchoredSessions)",
  );
  assertStringIncludes(hero, "memberViewerEntries");
  assertStringIncludes(hero, "overviewGroupMembers(group, nodesByKey)");
  assertStringIncludes(hero, "Open hull monitor");
  assertEquals(flow.includes("OverviewThreadInstrument"), false);
  assertEquals(flow.includes("onOpenInstrument"), false);
  assertStringIncludes(hero, "OverviewThreadContextMenu");
  assertEquals(hero.includes("openNodeViewer"), false);
  assertEquals(flow.includes("onOpenViewer"), false);
  assertStringIncludes(flow, "Shift+F10");
});

Deno.test("left-click selection stays graph-only and never opens a native viewer", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const canvasStyles = await Deno.readTextFile(
    new URL("./src/styles/19-project-thread-canvas.css", import.meta.url),
  );
  const flowStyles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );

  const viewerLayerStart = hero.indexOf(
    'className="overview-thread-viewer-layer"',
  );
  const viewerLayerEnd = hero.indexOf("      </div>", viewerLayerStart);
  const viewerLayer = hero.slice(viewerLayerStart, viewerLayerEnd);
  assertEquals(viewerLayerStart >= 0, true);
  assertEquals(viewerLayerEnd > viewerLayerStart, true);
  assertStringIncludes(viewerLayer, "whiteboardTransform.x");
  assertStringIncludes(viewerLayer, "whiteboardTransform.k");
  assertEquals(viewerLayer.includes("<OverviewNodeSelectionCard"), false);
  assertEquals(hero.includes("OverviewNodeSelectionCard"), false);
  assertEquals(hero.includes("overviewSelectionCardGeometry("), false);
  assertStringIncludes(
    hero,
    "setSelectedKey((current) => nextOverviewHeroSelection(current, item.key))",
  );
  assertStringIncludes(hero, "onClick={onToggle}");
  assertStringIncludes(hero, "aria-pressed={selected}");
  assertStringIncludes(hero, "availableSessionIds?.has(viewer.sessionId)");
  assertStringIncludes(hero, "overviewViewerAnchorPoint(");
  assertStringIncludes(hero, "buildOverviewThreadViewerConnectorGeometry(");
  assertEquals(hero.includes("OverviewRecordedNodePanel"), false);
  assertEquals(hero.includes("OverviewActivityNodePanel"), false);

  assertEquals(canvasStyles.includes(".overview-thread-selection-card"), false);
  assertEquals(canvasStyles.includes(".overview-thread-selection-copy"), false);
  assertEquals(
    canvasStyles.includes(".overview-thread-selection-actions"),
    false,
  );
  assertStringIncludes(canvasStyles, ".overview-thread-selection-connector");
  assertStringIncludes(canvasStyles, ".overview-thread-context-menu");
  assertStringIncludes(canvasStyles, ".overview-thread-hull-monitor");
  assertEquals(
    canvasStyles.includes(".project-thread-board #overview-thread-selection"),
    false,
  );
  assertEquals(
    flowStyles.includes(
      '.overview-thread-flow-node[data-state="selected"] .overview-thread-flow-node-tooltip',
    ),
    false,
  );
});

Deno.test("overview viewers stay read-only, spatially tethered, and keyboard reachable", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/20-project-thread-viewers.css", import.meta.url),
  );
  const geometry = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-viewer-geometry.ts",
      import.meta.url,
    ),
  );
  const capabilityModel = await Deno.readTextFile(
    new URL("./src/project/overview-thread-viewer-model.ts", import.meta.url),
  );
  const appFrame = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame.tsx", import.meta.url),
  );

  assertEquals(hero.includes("<GltfAssetCanvas"), false);
  assertEquals(hero.includes("<RecordInspectorPanel"), false);
  assertEquals(hero.includes("Read-only project activity projection"), false);
  assertEquals(hero.includes('kind: "record"'), false);
  assertEquals(hero.includes('kind: "activity"'), false);
  assertStringIncludes(hero, "<McpAppFrame");
  assertStringIncludes(appFrame, 'document.createElement("iframe")');
  assertStringIncludes(
    appFrame,
    'setAttribute("sandbox", "allow-scripts")',
  );
  assertStringIncludes(appFrame, 'frameNode.referrerPolicy = "no-referrer"');
  assertEquals(hero.includes("fetch("), false);
  assertStringIncludes(capabilityModel, "Zero is unavailable");
  assertEquals(capabilityModel.includes("inspectRecord"), false);
  assertEquals(capabilityModel.includes("cadAssets"), false);

  assertStringIncludes(hero, "readonly nodeKey: string;");
  assertStringIncludes(hero, "whiteboardWorldSize");
  assertStringIncludes(hero, "data-anchor-node={viewer.nodeKey}");
  assertStringIncludes(hero, "left: viewer.x");
  assertStringIncludes(hero, "top: viewer.y");
  assertStringIncludes(hero, "width: viewer.width");
  assertStringIncludes(hero, "height: viewer.height");
  assertStringIncludes(hero, 'className="overview-thread-viewer-connectors"');
  assertStringIncludes(hero, 'className="overview-thread-viewer-connector"');
  assertStringIncludes(hero, 'className="overview-thread-viewer-anchor"');
  assertStringIncludes(hero, "onWheel={(event) => event.stopPropagation()}");
  assertStringIncludes(hero, "const toggleViewerExpanded = (viewerId: string)");
  assertStringIncludes(hero, 'viewer.restoreGeometry ? "Restore" : "Expand"');
  assertStringIncludes(hero, 'className="overview-thread-viewer-resize"');
  assertStringIncludes(hero, "onResizeByKeyboard(event.key)");
  assertStringIncludes(hero, "onMoveByKeyboard(event.key)");

  const viewerLayerRule = cssRule(styles, ".overview-thread-viewer-layer");
  assertStringIncludes(viewerLayerRule, "position: absolute;");
  assertStringIncludes(viewerLayerRule, "pointer-events: none;");
  const viewerRule = cssRule(styles, ".overview-thread-viewer");
  assertStringIncludes(viewerRule, "pointer-events: auto;");
  assertStringIncludes(styles, "cursor: nwse-resize;");
  assertEquals(styles.includes("position: fixed"), false);

  assertStringIncludes(geometry, 'from "d3-shape"');
  assertStringIncludes(geometry, ".curve(curveBumpX)");
  assertStringIncludes(
    geometry,
    "export function buildOverviewThreadViewerConnectorGeometry(",
  );
});

Deno.test("viewer-session cards host only current exact whole-App descriptors", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const persistence = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-whiteboard-persistence.ts",
      import.meta.url,
    ),
  );
  const nativePreview = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const sessionClient = await Deno.readTextFile(
    new URL("./src/thread/viewer-sessions-client.ts", import.meta.url),
  );
  const appFrame = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame.tsx", import.meta.url),
  );

  assertStringIncludes(hero, "viewerSessions?.sessions ?? []");
  assertStringIncludes(hero, "overviewThreadGraphRefKey(session.anchor)");
  assertStringIncludes(hero, 'kind: "open-session"');
  assertStringIncludes(
    hero,
    "for (const session of anchoredSessions)",
  );
  assertEquals(
    hero.includes("uniqueOverviewThreadViewerSession(anchoredSessions)"),
    false,
  );
  assertStringIncludes(
    hero,
    "Open App · ${session.app.id}@${session.app.version}",
  );
  assertStringIncludes(hero, 'viewerSession?.kind === "mcp-app"');
  assertEquals(hero.includes("<GltfAssetCanvas"), false);
  assertStringIncludes(hero, "session={viewerSession}");
  assertStringIncludes(appFrame, "loadVerifiedMcpAppDocument");
  assertStringIncludes(appFrame, "frameNode.src = document.url");
  assertEquals(appFrame.includes("frameNode.src = session.launchUri"), false);
  assertEquals(appFrame.includes("src={session.launchUri}"), false);
  assertStringIncludes(
    appFrame,
    'setAttribute("sandbox", "allow-scripts")',
  );
  assertEquals(appFrame.includes("allow-same-origin"), false);
  assertEquals(hero.includes("fetch("), false);
  assertEquals(hero.includes("postMessage("), false);
  assertStringIncludes(persistence, "readonly sessionId: string;");
  assertStringIncludes(persistence, "hasExactSessionId");
  assertEquals(persistence.includes('readonly kind: "record"'), false);
  assertEquals(persistence.includes('readonly kind: "activity"'), false);
  assertEquals(persistence.includes("sessionUrl"), false);
  assertEquals(persistence.includes("launchUri"), false);
  assertEquals(persistence.includes("interactiveToken"), false);
  assertStringIncludes(nativePreview, '"/api/thread/viewer-sessions"');
  assertStringIncludes(nativePreview, '"/api/thread/viewer-sessions/events"');
  assertStringIncludes(sessionClient, 'method: "GET"');
  assertStringIncludes(sessionClient, 'addEventListener("viewer-sessions"');
  assertEquals(sessionClient.includes("POST"), false);
  assertEquals(sessionClient.includes("callTool"), false);
});
