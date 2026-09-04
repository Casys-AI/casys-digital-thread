import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Overview thread selection toggles graph focus without opening a viewer", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const selectionStart = source.indexOf("function nextOverviewHeroSelection(");
  const selectionEnd = source.indexOf("function HeroNode(", selectionStart);
  const selection = source.slice(selectionStart, selectionEnd);
  assertEquals(selectionStart >= 0, true);
  assertEquals(selectionEnd > selectionStart, true);
  assertStringIncludes(
    selection,
    "return current === requested ? undefined : requested;",
  );
});

Deno.test("Overview thread keeps navigation explicit and keyboard accessible", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const svgStart = source.indexOf("<svg");
  const svgEnd = source.indexOf("</svg>", svgStart);
  const svg = source.slice(svgStart, svgEnd);

  assertEquals(svgStart >= 0, true);
  assertEquals(svgEnd > svgStart, true);
  assertEquals(svg.includes("onClick={onOpenEvidence}"), false);
  assertStringIncludes(source, 'role="group"');
  assertStringIncludes(source, 'role="button"');
  assertStringIncludes(source, "tabIndex={tabIndex}");
  assertStringIncludes(source, "aria-pressed={selected}");
  assertEquals(source.includes("aria-controls={selected"), false);
  assertStringIncludes(source, 'event.key === "Enter"');
  assertStringIncludes(source, 'event.key === "ArrowUp"');
  assertStringIncludes(source, 'event.key === "ArrowRight"');
  assertStringIncludes(source, "directionalOverviewNode(");
  assertStringIncludes(source, "buildOverviewThreadD3Layout(");
  assertStringIncludes(source, 'label: "Open in Verification"');
  assertStringIncludes(source, "onOpenEvidence(action.reference)");
  assertEquals(source.includes("Engineering thread network"), false);
  assertEquals(source.includes("visible nodes"), false);
  assertEquals(source.includes("cable bundles"), false);
  assertEquals(source.includes("projected paths"), false);
});

Deno.test("Overview hierarchy arrow navigation follows the two-dimensional node matrix", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const navigationStart = source.indexOf(
    "function directionalOverviewFlowNode(",
  );
  const navigationEnd = source.indexOf("function HeroNode(", navigationStart);
  const navigation = source.slice(navigationStart, navigationEnd);

  assertEquals(navigationStart >= 0, true);
  assertEquals(navigationEnd > navigationStart, true);
  assertStringIncludes(navigation, "candidate.centerX - current.centerX");
  assertStringIncludes(navigation, "candidate.centerY - current.centerY");
  assertStringIncludes(navigation, "Math.hypot(primary, secondary)");
  assertStringIncludes(navigation, "return candidates[0]?.candidate;");
  assertEquals(navigation.includes("node.lane === current.lane"), false);
  assertEquals(navigation.includes("OVERVIEW_LANES"), false);
  assertEquals(navigation.includes("% laneNodes.length"), false);

  assertStringIncludes(
    source,
    'useState<OverviewLayoutMode>("hierarchy")',
  );
  assertStringIncludes(source, "<OverviewThreadD3Flow");
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("radial")}');
  assertStringIncludes(source, 'onClick={() => changeLayoutMode("hierarchy")}');
});

Deno.test("Overview hierarchy keeps dots compact while surfacing grounded group and node text", async () => {
  const renderer = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );

  assertStringIncludes(renderer, "overview-thread-flow-group-label");
  assertStringIncludes(renderer, "flowGroupCaption(group)");
  assertStringIncludes(renderer, "flowNodeDescription(item)");
  assertStringIncludes(renderer, 'data-inspection={selectedKey ? "selected"');
  assertEquals(renderer.includes("flowCardLines"), false);
  assertEquals(renderer.includes("overview-thread-flow-node-card"), false);
  assertStringIncludes(styles, '[data-inspection="hover"]');
  assertStringIncludes(styles, ".overview-thread-flow-node-tooltip > span");
});

Deno.test("Overview hierarchy integrates stage progress and semantic activity states", async () => {
  const renderer = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );

  assertStringIncludes(renderer, "export interface OverviewThreadStageSummary");
  assertStringIncludes(renderer, "readonly lane: EngineeringPathLaneId");
  assertStringIncludes(renderer, "overview-thread-flow-stage-title");
  assertStringIncludes(renderer, "overview-thread-flow-stage-count");
  assertStringIncludes(renderer, "overview-thread-flow-stage-status");
  assertStringIncludes(renderer, "overview-thread-flow-activity-legend");
  assertStringIncludes(renderer, "activityStatuses.length > 0");
  assertStringIncludes(renderer, 'data-status={item.kind === "activity"');
  assertStringIncludes(renderer, 'return "IN PROGRESS"');
  assertStringIncludes(renderer, 'return "PENDING"');
  assertStringIncludes(renderer, 'return "BLOCKED"');

  assertStringIncludes(styles, '[data-status="planned"]');
  assertStringIncludes(styles, '[data-status="active"]');
  assertStringIncludes(styles, '[data-status="blocked"]');
  assertStringIncludes(styles, "border-style: dashed");
  assertStringIncludes(styles, "var(--ui-success)");
  assertStringIncludes(styles, "var(--ui-destructive)");

  assertStringIncludes(hero, "readonly immersive?: boolean");
  assertStringIncludes(
    hero,
    "readonly stages?: readonly OverviewThreadStageSummary[]",
  );
  assertStringIncludes(hero, "minHeight: 560");
  assertStringIncludes(hero, "topInset: 64");
  assertStringIncludes(hero, "bottomInset: 104");
  assertStringIncludes(hero, "stages={stages}");
  assertStringIncludes(hero, "showLaneStrip={!immersive}");
});

Deno.test("Overview immersive mode behaves as a fixed zoomable whiteboard", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const wheelStart = source.indexOf("const handleWhiteboardWheel = (");
  const wheelEnd = source.indexOf("const beginCanvasPan = (", wheelStart);
  const wheel = source.slice(wheelStart, wheelEnd);
  assertEquals(wheelStart >= 0, true);
  assertEquals(wheelEnd > wheelStart, true);
  assertStringIncludes(wheel, "event.preventDefault();");
  assertStringIncludes(wheel, "zoomOverviewThreadWhiteboardByWheel(");
  assertStringIncludes(wheel, "event.clientX - viewportBounds.left");
  assertStringIncludes(wheel, "event.clientY - viewportBounds.top");
  assertStringIncludes(
    wheel,
    "{ minScale: bounds.minScale, maxScale: bounds.maxScale }",
  );
  assertEquals(wheel.includes("{ bounds }"), false);

  const panStart = wheelEnd;
  const panEnd = source.indexOf("const moveFocus = (", panStart);
  const pan = source.slice(panStart, panEnd);
  assertEquals(panEnd > panStart, true);
  assertStringIncludes(pan, "target.closest(");
  assertStringIncludes(pan, ".overview-thread-viewer");
  assertStringIncludes(pan, "event.currentTarget.setPointerCapture(");
  assertStringIncludes(pan, "panOverviewThreadWhiteboard(");
  assertStringIncludes(
    pan,
    "panOverviewThreadWhiteboard(current, delta)",
  );
  assertStringIncludes(pan, "event.currentTarget.releasePointerCapture(");

  assertStringIncludes(source, 'aria-label="Digital thread whiteboard"');
  assertStringIncludes(source, "onWheel={handleWhiteboardWheel}");
  assertStringIncludes(source, "onPointerDown={beginCanvasPan}");
  assertStringIncludes(source, "onPointerMove={moveCanvasPan}");
  assertStringIncludes(source, "onPointerUp={endCanvasPan}");
  assertStringIncludes(source, 'className="overview-thread-whiteboard-world"');
  assertStringIncludes(source, "translate3d(${whiteboardTransform.x}px");
  assertStringIncludes(source, "scale(${whiteboardTransform.k})");
  assertStringIncludes(source, "fitOverviewThreadWhiteboardTransform(");
  assertStringIncludes(source, "resetOverviewThreadWhiteboardTransform(");
  assertStringIncludes(
    source,
    "normalizeOverviewThreadWhiteboardTransform(current, bounds)",
  );
  assertStringIncludes(source, 'data-whiteboard-grid="true"');
  assertStringIncludes(
    source,
    "style={overviewWhiteboardViewportStyle(whiteboardTransform)}",
  );

  const blankClearStart = source.indexOf("onPointerDownCapture={(event) =>");
  const blankClearEnd = source.indexOf(
    'className="overview-thread-layout-switch"',
    blankClearStart,
  );
  const blankClear = source.slice(blankClearStart, blankClearEnd);
  assertEquals(blankClearStart >= 0, true);
  assertEquals(blankClearEnd > blankClearStart, true);
  assertStringIncludes(blankClear, "setSelectedKey(undefined);");
  assertStringIncludes(blankClear, "setHoveredKey(undefined);");
  assertStringIncludes(blankClear, ".overview-thread-flow-node");
  assertStringIncludes(blankClear, ".overview-thread-viewer");
});

Deno.test("Whiteboard viewers remain free spatial objects and Fit recovers the whole scene", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const drag = sourceSection(
    source,
    "const beginViewerDrag = (",
    "const endViewerDrag = (",
  );
  assertStringIncludes(drag, "event.button !== 0");
  assertStringIncludes(drag, "normalizeOverviewThreadViewerGeometry(");
  assertStringIncludes(drag, "overviewViewerGeometryConstraints()");
  assertEquals(drag.includes("worldSize:"), false);

  const fit = sourceSection(
    source,
    "const fitWhiteboard = () => {",
    "const changeLayoutMode = (",
  );
  assertStringIncludes(fit, "worldRef.current,");
  assertStringIncludes(fit, "viewers,");

  const bounds = sourceSection(
    source,
    "function readOverviewWhiteboardBounds(",
    "function overviewViewerGeometry(",
  );
  assertStringIncludes(bounds, "overviewThreadWhiteboardContentBounds(");
  assertStringIncludes(bounds, "viewer.restoreGeometry ??");
  assertStringIncludes(bounds, "overviewViewerGeometry(viewer)");

  const viewer = sourceSection(
    source,
    "function OverviewFloatingViewer({",
    "function overviewViewerTitle(",
  );
  assertStringIncludes(viewer, "event.target !== event.currentTarget");
});

Deno.test("Overview hierarchy drags whole group surfaces or labels while constraining nodes", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const renderer = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );

  assertStringIncludes(hero, "groupPlacements,");
  assertStringIncludes(hero, "nodePlacements,");
  assertStringIncludes(hero, "onMoveGroup={(key, position) =>");
  assertStringIncludes(hero, "setGroupPlacements((current) => ({");
  assertStringIncludes(hero, "onMoveNode={(key, delta) =>");
  assertStringIncludes(hero, "setNodePlacements((current) => ({");
  assertStringIncludes(hero, "setGroupPlacements({});");
  assertStringIncludes(hero, "setNodePlacements({});");

  const flowLayoutStart = hero.indexOf("const flowLayout = useMemo(");
  const flowLayoutEnd = hero.indexOf(
    "useEffect(() => {",
    flowLayoutStart,
  );
  const flowLayout = hero.slice(flowLayoutStart, flowLayoutEnd);
  assertEquals(flowLayoutStart >= 0, true);
  assertEquals(flowLayoutEnd > flowLayoutStart, true);
  assertStringIncludes(flowLayout, "groupPlacements,");
  assertStringIncludes(flowLayout, "nodePlacements,");
  const dependencyStart = flowLayout.lastIndexOf("[");
  const dependencies = flowLayout.slice(dependencyStart);
  assertEquals(dependencyStart >= 0, true);
  assertStringIncludes(dependencies, "groupPlacements");
  assertStringIncludes(dependencies, "nodePlacements");

  const surfaceStart = renderer.indexOf(
    '<g className="overview-thread-flow-groups">',
  );
  const surfaceEnd = renderer.indexOf(
    "<FlowSegmentLayer",
    surfaceStart,
  );
  const groupSurfaces = renderer.slice(surfaceStart, surfaceEnd);
  assertEquals(surfaceStart >= 0, true);
  assertEquals(surfaceEnd > surfaceStart, true);
  assertStringIncludes(groupSurfaces, "<rect");
  assertStringIncludes(
    groupSurfaces,
    'data-draggable={onMoveGroup ? "true" : "false"}',
  );
  assertStringIncludes(
    groupSurfaces,
    'beginDrag("group", group.key, event)',
  );
  assertStringIncludes(groupSurfaces, "onPointerMove={moveDrag}");
  assertStringIncludes(groupSurfaces, "onPointerUp={endDrag}");

  const labelStart = renderer.indexOf(
    '<div className="overview-thread-flow-group-labels">',
  );
  const labelEnd = renderer.indexOf(
    '<div className="overview-thread-flow-nodes">',
    labelStart,
  );
  const groupLabels = renderer.slice(labelStart, labelEnd);
  assertEquals(labelStart >= 0, true);
  assertEquals(labelEnd > labelStart, true);
  assertStringIncludes(
    groupLabels,
    'className="overview-thread-flow-group-label"',
  );
  assertStringIncludes(groupLabels, 'beginDrag("group", group.key, event)');
  assertStringIncludes(
    groupLabels,
    'aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"',
  );
  assertStringIncludes(groupLabels, "DropdownMenuContextTrigger");

  assertStringIncludes(renderer, "const FLOW_DRAG_THRESHOLD_PX = 4;");
  assertStringIncludes(renderer, "Math.hypot(clientDeltaX, clientDeltaY)");
  assertStringIncludes(renderer, 'beginDrag("node", position.key, event)');
  assertStringIncludes(renderer, "event.currentTarget.setPointerCapture(");
  assertStringIncludes(renderer, "minimumX = group.x;");
  assertStringIncludes(renderer, "minimumY = group.y;");
  assertStringIncludes(renderer, "group.x + group.width - node.width");
  assertStringIncludes(renderer, "group.y + group.height - node.height");

  assertStringIncludes(
    styles,
    '.overview-thread-flow-groups rect[data-draggable="true"]',
  );
  assertStringIncludes(styles, "pointer-events: all;");
  assertStringIncludes(styles, ".overview-thread-flow-group-label");
  assertStringIncludes(styles, "pointer-events: auto;");
});

Deno.test("Overview dynamic cables coalesce drag frames, flush the final point, and settle accessibly", async () => {
  const renderer = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );

  const commit = sourceSection(
    renderer,
    "const commitPendingDrag = () => {",
    "const beginDrag = (",
  );
  assertStringIncludes(commit, "const nextX = drag.pendingX;");
  assertStringIncludes(commit, "const nextY = drag.pendingY;");
  assertStringIncludes(commit, "drag.pendingX = undefined;");
  assertStringIncludes(commit, "drag.pendingY = undefined;");
  assertStringIncludes(
    commit,
    "onMoveGroup?.(drag.key, { x: nextX, y: nextY });",
  );
  assertStringIncludes(commit, "x: nextX - drag.appliedX");
  assertStringIncludes(commit, "y: nextY - drag.appliedY");
  assertStringIncludes(commit, "drag.appliedX = nextX;");
  assertStringIncludes(commit, "drag.appliedY = nextY;");
  assertBefore(
    commit,
    "const nextX = drag.pendingX;",
    "drag.pendingX = undefined;",
  );
  assertBefore(commit, "drag.pendingY = undefined;", "onMoveGroup?.(");
  assertBefore(commit, "onMoveNode?.(", "drag.appliedX = nextX;");

  const liveDrag = sourceSection(
    renderer,
    "const moveDrag = (",
    "const endDrag = (",
  );
  assertStringIncludes(liveDrag, "drag.pendingX = nextX;");
  assertStringIncludes(liveDrag, "drag.pendingY = nextY;");
  assertStringIncludes(liveDrag, "if (dragFrameRef.current === undefined)");
  assertStringIncludes(liveDrag, "globalThis.requestAnimationFrame(");
  assertStringIncludes(liveDrag, "commitPendingDrag");
  assertEquals(
    occurrenceCount(liveDrag, "globalThis.requestAnimationFrame("),
    1,
    "Many pointer moves may schedule only one outstanding animation frame",
  );
  assertBefore(liveDrag, "drag.pendingY = nextY;", "requestAnimationFrame(");

  const endDrag = sourceSection(
    renderer,
    "const endDrag = (",
    "const toggleUnlessDragged = (",
  );
  assertStringIncludes(endDrag, "globalThis.cancelAnimationFrame(");
  assertStringIncludes(endDrag, "dragFrameRef.current = undefined;");
  assertStringIncludes(endDrag, "commitPendingDrag();");
  assertStringIncludes(endDrag, "dragRef.current = undefined;");
  assertStringIncludes(endDrag, "setDragging(undefined);");
  assertBefore(endDrag, "cancelAnimationFrame(", "commitPendingDrag();");
  assertBefore(endDrag, "commitPendingDrag();", "dragRef.current = undefined;");

  assertStringIncludes(renderer, "setDragging({ kind, key });");
  assertStringIncludes(
    renderer,
    'data-dragging={dragging ? "true" : "false"}',
  );
  assertStringIncludes(
    styles,
    '.overview-thread-flow[data-dragging="true"] .overview-thread-flow-segment[data-drag-route="idle"]',
  );
  assertStringIncludes(
    styles,
    '.overview-thread-flow[data-dragging="true"] .overview-thread-flow-segment[data-drag-route="connected"]',
  );

  assertStringIncludes(renderer, "<FlowSegmentLayer");
  assertStringIncludes(renderer, "movingNodeKeys={movingNodeKeys}");
  assertStringIncludes(renderer, "dragging={Boolean(dragging)}");
  assertStringIncludes(renderer, "reducedMotion={reducedMotion}");

  const segmentLayer = sourceSection(
    renderer,
    "function FlowSegmentLayer({",
    "function overviewFlowSegmentPresentations(",
  );
  assertStringIncludes(
    segmentLayer,
    "const sceneRef = useRef(new OverviewFlowMotionScene());",
  );
  assertStringIncludes(segmentLayer, "sceneRef.current.reconcile(");
  assertStringIncludes(segmentLayer, "overviewFlowMotionPath(");
  assertStringIncludes(segmentLayer, "pinEndpoints: connectedToDrag");
  assertStringIncludes(segmentLayer, "globalThis.document.createElementNS(");
  assertStringIncludes(
    segmentLayer,
    'path.setAttribute("stroke-linejoin", "round");',
  );
  assertStringIncludes(
    segmentLayer,
    'element.path.setAttribute("d", renderedD);',
  );
  assertStringIncludes(segmentLayer, "sceneRef.current.advance(");
  assertStringIncludes(segmentLayer, "sceneRef.current.needsAnimation()");
  assertStringIncludes(
    segmentLayer,
    "globalThis.requestAnimationFrame((now) =>",
  );
  assertEquals(
    occurrenceCount(segmentLayer, "globalThis.requestAnimationFrame("),
    1,
    "The complete cable scene must share one outstanding animation clock",
  );
  assertStringIncludes(segmentLayer, "globalThis.cancelAnimationFrame(");
  assertStringIncludes(
    segmentLayer,
    'return <g ref={layerRef} className="overview-thread-flow-segments" />;',
  );
  assertEquals(
    renderer.includes("interpolateString"),
    false,
    "Cable motion must interpolate numeric geometry, not SVG path strings",
  );

  const reducedMotion = sourceSection(
    renderer,
    "function usePrefersReducedMotion(): boolean {",
    "/**",
  );
  assertStringIncludes(
    reducedMotion,
    'globalThis.matchMedia("(prefers-reduced-motion: reduce)")',
  );
  assertStringIncludes(
    reducedMotion,
    'query.addEventListener("change", update)',
  );
  assertStringIncludes(
    reducedMotion,
    'query.removeEventListener("change", update)',
  );
  assertStringIncludes(styles, "@media (prefers-reduced-motion: reduce)");
  assertStringIncludes(styles, "transition: none;");
});

Deno.test("Whiteboard overlay plane keeps MCP viewers and hull monitor transform-synchronised", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const viewportStart = source.indexOf(
    'className="overview-thread-viewport"',
  );
  const worldStart = source.indexOf(
    'className="overview-thread-whiteboard-world"',
    viewportStart,
  );
  const worldClose = source.indexOf(
    "{(viewers.length > 0 ||",
    worldStart,
  );
  const viewerStart = source.indexOf(
    'className="overview-thread-viewer-layer"',
    worldClose,
  );
  const viewportClose = source.indexOf(
    "{unroutedEdgeCount > 0 && (",
    viewerStart,
  );
  assertEquals(viewportStart >= 0, true);
  assertEquals(worldStart > viewportStart, true);
  assertEquals(worldClose > worldStart, true);
  assertEquals(viewerStart > worldClose, true);
  assertEquals(viewportClose > viewerStart, true);

  const graphWorld = source.slice(worldStart, worldClose);
  const viewerPlane = source.slice(viewerStart, viewportClose);
  assertStringIncludes(graphWorld, "<OverviewThreadD3Flow");
  assertEquals(
    graphWorld.includes('className="overview-thread-viewer-layer"'),
    false,
  );
  assertStringIncludes(
    graphWorld,
    "`translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`",
  );
  assertEquals(viewerPlane.includes("<OverviewThreadD3Flow"), false);
  assertStringIncludes(viewerPlane, "width: whiteboardWorldSize.width");
  assertStringIncludes(viewerPlane, "height: whiteboardWorldSize.height");
  assertStringIncludes(
    viewerPlane,
    "`translate3d(${whiteboardTransform.x}px, ${whiteboardTransform.y}px, 0) scale(${whiteboardTransform.k})`",
  );
  assertStringIncludes(
    viewerPlane,
    'className="overview-thread-viewer-connectors"',
  );
  assertStringIncludes(
    viewerPlane,
    "viewBox={`0 0 ${whiteboardWorldSize.width} ${whiteboardWorldSize.height}`}",
  );
  assertStringIncludes(viewerPlane, "overviewViewerAnchorPoint(");
  assertStringIncludes(viewerPlane, "viewer.nodeKey");
  assertStringIncludes(
    viewerPlane,
    "buildOverviewThreadViewerConnectorGeometry(",
  );
  assertStringIncludes(viewerPlane, "<OverviewFloatingViewer");
  assertEquals(viewerPlane.includes("<OverviewNodeSelectionCard"), false);
  assertEquals(source.includes("selectedCard"), false);
  assertStringIncludes(viewerPlane, "<OverviewHullMonitorCard");
  assertEquals(source.includes("OverviewContextMenuState"), false);
  assertEquals(source.includes("requestContextMenu"), false);
  assertStringIncludes(source, "overview-thread-context-menu");
  assertStringIncludes(source, "memberViewerEntries");
  assertEquals(source.includes('role="menu"'), false);
});

Deno.test("Project keeps the graph and its HUDs inside one non-scrolling whiteboard", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/19-project-thread-canvas.css", import.meta.url),
  );

  const workbenchRule = cssRule(
    styles,
    ".thread-workbench:has(> #project-workspace-panel.project-thread-page)",
  );
  assertStringIncludes(workbenchRule, "height: 100dvh;");
  assertStringIncludes(workbenchRule, "overflow: hidden;");
  assertStringIncludes(workbenchRule, "overscroll-behavior: none;");

  const pageRule = cssRule(
    styles,
    ".thread-workbench > #project-workspace-panel.overview-2a.project-thread-page",
  );
  assertStringIncludes(pageRule, "height: calc(100dvh - 56px);");
  assertStringIncludes(pageRule, "max-height: calc(100dvh - 56px);");
  assertStringIncludes(pageRule, "overflow: hidden;");

  const viewportRule = cssRule(
    styles,
    ".project-thread-board .overview-thread-hero-immersive > .overview-thread-viewport",
  );
  assertStringIncludes(viewportRule, "height: 100%;");
  assertStringIncludes(viewportRule, "overflow: hidden;");
  assertStringIncludes(viewportRule, "touch-action: none;");

  const worldRule = cssRule(
    styles,
    ".project-thread-board .overview-thread-whiteboard-world",
  );
  assertStringIncludes(worldRule, "position: absolute;");
  assertStringIncludes(worldRule, "transform-origin: 0 0;");

  assertStringIncludes(
    overview,
    'data-surface="digital-thread-whiteboard"',
  );
  assertStringIncludes(overview, "<OverviewThreadHero");
  assertStringIncludes(overview, "immersive");
  assertStringIncludes(overview, 'className="project-thread-top-hud"');
  assertStringIncludes(overview, 'className="project-thread-bottom-hud"');
  assertEquals(overview.includes("<GltfAssetCanvas"), false);
});

Deno.test("Overview activity markers stay distinct from recorded Verification navigation", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  const actionModelStart = source.indexOf(
    "function overviewNodeContextActions(",
  );
  const actionModelEnd = source.indexOf(
    "function overviewContextActionValue(",
    actionModelStart,
  );
  const actionModel = source.slice(actionModelStart, actionModelEnd);
  assertEquals(actionModelStart >= 0, true);
  assertEquals(actionModelEnd > actionModelStart, true);
  assertStringIncludes(actionModel, 'label: "Open Activity"');
  assertStringIncludes(actionModel, 'label: "Open in Verification"');
  assertStringIncludes(
    actionModel,
    "viewerSessionsByNodeKey.get(item.key) ?? []",
  );
  assertStringIncludes(actionModel, "for (const session of anchoredSessions)");
  assertStringIncludes(actionModel, 'kind: "open-session"');
  assertEquals(actionModel.includes("capabilities.cadAssets"), false);

  const markerStart = source.indexOf("function ActivityMarker(");
  const markerEnd = source.indexOf(
    "function overviewNodeContextActions(",
    markerStart,
  );
  const marker = source.slice(markerStart, markerEnd);
  assertEquals(markerStart >= 0, true);
  assertEquals(markerEnd > markerStart, true);
  assertEquals(marker.includes("selected"), false);
  assertStringIncludes(marker, 'width="8"');
  assertStringIncludes(marker, 'height="8"');
  assertStringIncludes(marker, "activityMarkerColor(status)");
  assertStringIncludes(marker, 'status === "planned"');
  assertStringIncludes(marker, 'status === "active"');
  assertStringIncludes(marker, 'status === "blocked"');
  assertStringIncludes(marker, "var(--thread-muted)");
  assertStringIncludes(marker, "var(--ui-destructive)");
  assertStringIncludes(source, "PENDING");
  assertStringIncludes(source, "IN PROGRESS");
  assertStringIncludes(source, "BLOCKED");
  assertStringIncludes(
    source,
    "A static D3 hierarchical edge-bundling view of recorded",
  );

  assertStringIncludes(overview, "activities={projectPath.activities}");
  assertStringIncludes(overview, "onOpenActivity={openOverviewActivity}");
  assertStringIncludes(overview, "onOpenEvidence={openOverviewEvidence}");
});

Deno.test("Overview Product destination uses the unique project route", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(source, 'onClick={() => onNavigate("product")}');
  assertEquals(source.includes("ProductWorkspaceFacet"), false);
  assertEquals(source.includes("onOpenProductFacet"), false);
  assertEquals(source.includes("openProductFacet"), false);
});

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(selector);
  assertEquals(start >= 0, true, `Missing CSS selector ${selector}`);
  const bodyStart = source.indexOf("{", start);
  const end = source.indexOf("}", bodyStart);
  assertEquals(bodyStart > start, true, `Missing CSS body for ${selector}`);
  assertEquals(end > bodyStart, true, `Missing CSS close for ${selector}`);
  return source.slice(bodyStart + 1, end);
}

function sourceSection(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assertEquals(start >= 0, true, `Missing source marker ${startMarker}`);
  assertEquals(end > start, true, `Missing source marker ${endMarker}`);
  return source.slice(start, end);
}

function occurrenceCount(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function assertBefore(source: string, earlier: string, later: string): void {
  const earlierIndex = source.indexOf(earlier);
  const laterIndex = source.indexOf(later);
  assertEquals(earlierIndex >= 0, true, `Missing source marker ${earlier}`);
  assertEquals(
    laterIndex > earlierIndex,
    true,
    `${earlier} must precede ${later}`,
  );
}
