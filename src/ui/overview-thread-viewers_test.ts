import { assertEquals, assertStringIncludes } from "@std/assert";

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assertEquals(start >= 0, true, `Missing ${selector}`);
  const end = source.indexOf("\n}", start);
  assertEquals(end > start, true, `Unclosed ${selector}`);
  return source.slice(start, end + 2);
}

Deno.test("overview context gestures open only one exact registered App", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertStringIncludes(flow, "onContextMenu={(event) =>");
  assertStringIncludes(flow, "onRequestExactApp();");
  assertStringIncludes(hero, "onContextMenu={(event) =>");
  assertStringIncludes(hero, "requestExactApp(item.key)");
  assertStringIncludes(
    hero,
    "uniqueOverviewThreadViewerSession(sessions)",
  );
  assertStringIncludes(
    hero,
    'state: sessions.length === 0 ? "unavailable" : "ambiguous"',
  );
  assertEquals(flow.includes("DropdownMenuContextTrigger"), false);
  assertEquals(hero.includes("OverviewThreadContextMenu"), false);
  assertEquals(hero.includes("openNodeViewer"), false);
  assertEquals(flow.includes("onOpenViewer"), false);
  assertStringIncludes(flow, 'event.key === "ContextMenu"');
  assertStringIncludes(flow, 'event.shiftKey && event.key === "F10"');
  assertStringIncludes(hero, 'event.key === "ContextMenu"');
});

Deno.test("selection details are a compact anchored whiteboard card", async () => {
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
  assertStringIncludes(viewerLayer, "<OverviewNodeSelectionCard");
  assertStringIncludes(hero, "overviewViewerAnchorPoint(");
  assertStringIncludes(hero, "overviewSelectionCardGeometry(");
  assertStringIncludes(hero, "buildOverviewThreadViewerConnectorGeometry(");
  assertEquals(hero.includes("OverviewRecordedNodePanel"), false);
  assertEquals(hero.includes("OverviewActivityNodePanel"), false);

  const cardRule = cssRule(canvasStyles, ".overview-thread-selection-card");
  assertStringIncludes(cardRule, "position: absolute;");
  assertStringIncludes(cardRule, "pointer-events: auto;");
  assertStringIncludes(canvasStyles, ".overview-thread-selection-connector");
  assertEquals(canvasStyles.includes(".overview-thread-context-menu"), false);
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
  assertStringIncludes(hero, "<RecordInspectorPanel");
  assertStringIncludes(hero, "Read-only project activity projection");
  assertStringIncludes(hero, "<McpAppFrame");
  assertStringIncludes(appFrame, 'document.createElement("iframe")');
  assertStringIncludes(
    appFrame,
    'setAttribute("sandbox", "allow-scripts")',
  );
  assertStringIncludes(appFrame, 'frameNode.referrerPolicy = "no-referrer"');
  assertEquals(hero.includes("fetch("), false);
  assertStringIncludes(
    capabilityModel,
    "Domain viewer capabilities are never inferred here.",
  );
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
    "uniqueOverviewThreadViewerSession(anchoredSessions)",
  );
  assertEquals(hero.includes("for (const session of anchoredSessions)"), false);
  assertStringIncludes(
    hero,
    "Open App · ${session.app.id}@${session.app.version}",
  );
  assertStringIncludes(hero, 'viewer.kind === "session"');
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
