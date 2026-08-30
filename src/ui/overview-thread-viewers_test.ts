import { assertEquals, assertStringIncludes } from "@std/assert";

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assertEquals(start >= 0, true, `Missing ${selector}`);
  const end = source.indexOf("\n}", start);
  assertEquals(end > start, true, `Unclosed ${selector}`);
  return source.slice(start, end + 2);
}

Deno.test("overview context gestures stay distinct from exact viewer actions", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const menu = await Deno.readTextFile(
    new URL("./src/ui/dropdown-menu.tsx", import.meta.url),
  );

  assertStringIncludes(menu, "DropdownMenuContextTrigger = Ark.ContextTrigger");
  assertEquals(hero.split("<DropdownMenu\n").length - 1, 1);
  assertStringIncludes(hero, "<OverviewThreadContextMenu");
  assertStringIncludes(hero, "onTriggerValueChange={(details) =>");

  assertStringIncludes(flow, "overviewThreadGroupContextValue(group.key)");
  assertStringIncludes(flow, "overviewThreadNodeContextValue(item.key)");
  assertStringIncludes(flow, "<DropdownMenuContextTrigger");
  assertStringIncludes(hero, "overviewThreadNodeContextValue(item.key)");
  assertStringIncludes(hero, "<DropdownMenuContextTrigger");
  assertEquals(flow.includes("onContextMenu={(event) =>"), false);
  assertEquals(hero.includes("onContextMenu={(event) =>"), false);
  assertEquals(hero.includes("openNodeViewer"), false);
  assertEquals(flow.includes("onOpenViewer"), false);

  assertStringIncludes(hero, 'kind: "inspect-record"');
  assertStringIncludes(hero, 'kind: "inspect-activity"');
  assertStringIncludes(hero, 'kind: "open-evidence"');
  assertStringIncludes(hero, 'kind: "open-cad"');
  assertStringIncludes(hero, "for (const asset of capabilities.cadAssets)");
  assertEquals(hero.includes(".cadAssets[0]"), false);
  assertStringIncludes(hero, "group?.nodeKeys.flatMap");
  assertStringIncludes(hero, 'members.length === 1 ? "record" : "records"');
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
  assertStringIncludes(canvasStyles, ".overview-thread-context-members");
  assertStringIncludes(canvasStyles, "overflow-y: auto;");
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

  assertStringIncludes(hero, "<GltfAssetCanvas");
  assertStringIncludes(hero, "<ToolInspectorPanel");
  assertStringIncludes(hero, "Read-only project activity projection");
  assertEquals(hero.includes("<iframe"), false);
  assertEquals(hero.includes("fetch("), false);
  assertStringIncludes(capabilityModel, ".toSorted((left, right) =>");
  assertStringIncludes(
    capabilityModel,
    "left.label.localeCompare(right.label)",
  );

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
