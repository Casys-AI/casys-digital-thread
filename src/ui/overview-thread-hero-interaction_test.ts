import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  createOverviewWhiteboardControllerState,
  nextOverviewHeroSelection,
  reduceOverviewWhiteboard,
} from "./src/project/overview/whiteboard/state.ts";

Deno.test("Overview thread selection toggles graph focus without opening a viewer", async () => {
  assertEquals(
    nextOverviewHeroSelection("artifact:a", "artifact:a"),
    undefined,
  );
  assertEquals(
    nextOverviewHeroSelection("artifact:a", "artifact:b"),
    "artifact:b",
  );
  const selected = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "selection-toggled", key: "artifact:a" },
  );
  assertEquals(selected.presentation.selectedKey, "artifact:a");
  const cleared = reduceOverviewWhiteboard(selected, {
    type: "selection-toggled",
    key: "artifact:a",
  });
  assertEquals(cleared.presentation.selectedKey, undefined);

  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const toggle = source.slice(
    source.indexOf("const toggleSelection ="),
    source.indexOf("const bringViewerFront ="),
  );
  assertStringIncludes(
    toggle,
    'apply({ type: "selection-toggled", key: item.key })',
  );
  assertEquals(toggle.includes("openViewer("), false);
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

  assertStringIncludes(source, "whiteboard.changeLayoutMode(next)");
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
  assertStringIncludes(renderer, "data-inspection={inspection.mode}");
  assertEquals(renderer.includes("aria-controls={selected"), false);
  assertEquals(renderer.includes("aria-expanded={selected}"), false);
  assertEquals(renderer.includes("flowCardLines"), false);
  assertEquals(renderer.includes("overview-thread-flow-node-card"), false);
  assertStringIncludes(styles, '[data-inspection="hover"]');
  assertEquals(
    styles.includes(".overview-thread-flow-node-tooltip > span"),
    false,
  );
  assertStringIncludes(renderer, "overviewFlowSegmentPresentations(");
  const segments = await Deno.readTextFile(
    new URL("./src/project/overview/flow/segments.ts", import.meta.url),
  );
  assertStringIncludes(segments, "flowSegmentState(");
  const highlight = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-d3-flow-highlight.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(
    highlight,
    "route.segmentKeys.includes(segment.key)",
  );
  assertStringIncludes(renderer, "structureRowTooltip(");
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  assertStringIncludes(recipes, "group-hover:block group-focus-visible:block");
  assertEquals(
    styles.includes(
      ".overview-thread-flow-structure-row:hover .overview-thread-flow-node-tooltip",
    ),
    false,
  );
  assertStringIncludes(renderer, "<FlowItemSurface");
  assertEquals(
    styles.includes(
      '[data-hull-row-view="matrix"] > :not(.overview-thread-flow-node-tooltip)',
    ),
    false,
  );
});

Deno.test("hull view switch uses nextHullViewPlacement instead of merging stale size", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  assertStringIncludes(source, "nextHullViewPlacement(");
  assertStringIncludes(source, "onSetGroupView={(key, view) => {");
  assertEquals(source.includes("changeHullPlacement(key, { view })"), false);
  assertStringIncludes(source, "onResizeGroup={(key, size) => {");
  assertStringIncludes(source, "changeHullPlacement(key, size)");
});

Deno.test("hierarchy pending keeps the whiteboard and only candidate hulls busy", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertEquals(hero.includes("OverviewWhiteboardHierarchySkeleton"), false);
  assertEquals(hero.includes("overview-thread-hierarchy-skeleton"), false);
  assertEquals(hero.includes("viewerHierarchyPending ? null"), false);
  assertEquals(
    hero.includes(
      'aria-busy={viewerHierarchyPending && layoutMode === "hierarchy"}',
    ),
    false,
  );
  assertStringIncludes(
    hero,
    "pendingHierarchyGroupKeys={pendingHierarchyGroupKeys}",
  );
  assertStringIncludes(
    hero,
    "overviewHullHierarchyPendingPlaceholders(view.nodes, hullContents)",
  );
  assertEquals(
    hero.includes(
      "viewerHierarchyPending\n        ? overviewHullHierarchyPendingPlaceholders",
    ),
    false,
  );
  assertStringIncludes(hero, "viewerHierarchyPending");
  assertStringIncludes(hero, "candidateStructuredRowCounts.keys()");
  assertStringIncludes(hero, "overviewHullStructureRowCounts(");
  assertEquals(
    hero.includes('content.mode === "tree"'),
    false,
  );
  assertEquals(hero.includes("withOverviewCurrentBriefContent("), false);
  assertStringIncludes(flow, "FlowHullPendingRows");
  assertStringIncludes(flow, 'data-whiteboard-flow-pending="true"');
  assertStringIncludes(
    flow,
    "aria-busy={pendingHierarchyGroupKeys?.has(group.key)",
  );
  assertEquals(
    flow.includes('if (content?.mode !== "tree") return null;'),
    false,
  );
  assertStringIncludes(flow, "if (!content || content.rows.length === 0)");
  assertStringIncludes(flow, "pendingGroup.structureRowCount");
  const nodesStart = flow.indexOf("{layout.nodes.map((position) => {");
  const nodesEnd = flow.indexOf("function FlowHullPendingRows(", nodesStart);
  const nodePaint = flow.slice(nodesStart, nodesEnd);
  assertEquals(nodesStart >= 0, true);
  assertEquals(nodesEnd > nodesStart, true);
  assertStringIncludes(nodePaint, "pendingGroup.structureRowCount");
  assertStringIncludes(nodePaint, "return null;");
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
  assertStringIncludes(renderer, "notableActivityStatuses.length > 0");
  assertStringIncludes(renderer, 'status !== "planned"');
  assertStringIncludes(renderer, "data-status={activityStatus}");
  const captions = await Deno.readTextFile(
    new URL(
      "./src/project/overview/activity-status-caption.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(captions, 'return "IN PROGRESS"');
  assertStringIncludes(captions, 'return "Planned"');
  assertEquals(captions.includes('return "PENDING"'), false);
  assertStringIncludes(captions, 'return "BLOCKED"');
  assertStringIncludes(renderer, "overviewActivityStatusCaption");
  assertEquals(renderer.includes('return "PENDING"'), false);
  assertStringIncludes(
    renderer,
    "`Activity \\u00b7 ${flowStatusCaption(item.activity.status)}`",
  );
  assertStringIncludes(
    renderer,
    "Inspect activity ${item.activity.title}",
  );
  assertEquals(renderer.includes("Inspect current activity"), false);
  assertEquals(renderer.includes("Current activity"), false);

  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  assertStringIncludes(recipes, 'status: "planned"');
  assertStringIncludes(recipes, 'status: "active"');
  assertStringIncludes(recipes, 'status: "blocked"');
  assertStringIncludes(recipes, "border-dashed");
  assertStringIncludes(recipes, "var(--ui-success)");
  assertStringIncludes(recipes, "var(--ui-destructive)");
  assertEquals(
    styles.includes(
      '.overview-thread-flow-node[data-kind="activity"] .overview-thread-flow-node-dot',
    ),
    false,
  );
  assertEquals(
    styles.includes(".overview-thread-flow-activity-label {"),
    false,
  );

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
  assertIdentityClass(source, "overview-thread-whiteboard-world");
  assertStringIncludes(source, "translate3d(${whiteboardTransform.x}px");
  assertStringIncludes(source, "scale(${whiteboardTransform.k})");
  assertStringIncludes(source, "fitOverviewThreadWhiteboardTransform(");
  assertStringIncludes(source, "resetOverviewThreadWhiteboardTransform(");
  assertStringIncludes(
    source,
    "nextOverviewWhiteboardTransformOnObservedResize({",
  );
  assertStringIncludes(source, "viewportChanged");
  assertEquals(
    source.includes(
      "normalizeOverviewThreadWhiteboardTransform(current, bounds)",
    ),
    false,
  );
  assertStringIncludes(source, 'data-whiteboard-grid="true"');
  assertStringIncludes(
    source,
    "style={overviewWhiteboardViewportStyle(whiteboardTransform)}",
  );
  assertIdentityClass(source, "overview-thread-layout-switch");
  assertStringIncludes(source, "whiteboardToolbar");

  const blankClearStart = source.indexOf("onPointerDownCapture={(event) =>");
  const blankClearEnd = source.indexOf(
    '"overview-thread-layout-switch"',
    blankClearStart,
  );
  const blankClear = source.slice(blankClearStart, blankClearEnd);
  assertEquals(blankClearStart >= 0, true);
  assertEquals(blankClearEnd > blankClearStart, true);
  assertEquals(blankClear.includes("setSelectedKey(undefined)"), false);
  assertEquals(blankClear.includes("setSelectedRowKey(undefined)"), false);
  assertEquals(blankClear.includes("clearCanvasSelection("), false);
  assertStringIncludes(pan, "overviewCanvasPointerBecamePan(");
  assertStringIncludes(
    pan,
    'if (!wasPan && event.type === "pointerup") clearCanvasSelection()',
  );
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
    "function overviewThreadFlowSceneRects(",
  );
  assertStringIncludes(bounds, "overviewThreadWhiteboardContentBounds(");
  assertStringIncludes(bounds, "viewer.restoreGeometry ??");
  assertStringIncludes(bounds, "overviewViewerGeometry(viewer)");
  assertStringIncludes(
    source,
    'from "./overview/whiteboard/index.ts"',
  );

  const viewer = sourceSection(
    source,
    "function OverviewFloatingViewer({",
    "function overviewViewerTitle(",
  );
  assertStringIncludes(viewer, "event.target !== event.currentTarget");
});

Deno.test("Hull monitor keeps pointer drag and supports bounded keyboard movement", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const movement = sourceSection(
    source,
    "const moveHullMonitorByKeyboard = (",
    "const toggleViewerExpanded = (",
  );
  assertStringIncludes(movement, "overviewDirectionDelta(direction, 18)");
  assertStringIncludes(
    movement,
    "overviewThreadViewerScreenDeltaToWorld(",
  );
  assertStringIncludes(movement, "normalizeOverviewThreadViewerGeometry(");
  assertStringIncludes(movement, "overviewViewerGeometryConstraints()");

  const monitor = sourceSection(
    source,
    "function OverviewHullMonitorCard({",
    "function OverviewFloatingViewer({",
  );
  assertStringIncludes(monitor, "onMoveByKeyboard");
  assertStringIncludes(
    monitor,
    'aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"',
  );
  assertStringIncludes(monitor, "with drag or arrow keys");
  assertStringIncludes(monitor, "onPointerDown={onDragStart}");
  assertStringIncludes(monitor, "onPointerMove={onDrag}");
  assertStringIncludes(monitor, "event.preventDefault()");
  assertStringIncludes(monitor, "onMoveByKeyboard(event.key)");
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
  const hullChrome = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/hull-chrome.tsx",
      import.meta.url,
    ),
  );
  assertIdentityClass(hullChrome, "overview-thread-flow-group-band");
  assertIdentityClass(hullChrome, "overview-thread-flow-group-fold");
  assertStringIncludes(renderer, "OverviewFlowGroupFold");
  assertStringIncludes(hero, "onMoveGroup={(key, position) =>");
  assertStringIncludes(hero, "setGroupPlacements((current) => ({");
  assertStringIncludes(hero, "onMoveNode={(key, delta) =>");
  assertStringIncludes(hero, "setNodePlacements((current) => ({");
  assertStringIncludes(hero, "resetLayout(");

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
  assertStringIncludes(renderer, "minimumY = group.y + group.headerHeight;");
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
    "function structureRowTooltip(",
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
    '"overview-thread-whiteboard-world"',
    viewportStart,
  );
  const worldClose = source.indexOf(
    "{(viewers.length > 0 ||",
    worldStart,
  );
  const viewerStart = source.indexOf(
    '"overview-thread-viewer-layer"',
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
    graphWorld.includes("overview-thread-viewer-layer"),
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
  assertIdentityClass(viewerPlane, "overview-thread-viewer-connectors");
  assertStringIncludes(
    viewerPlane,
    'whiteboardViewerPart({ part: "connectors" })',
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
  assertEquals(marker.includes("activityMarkerColor"), false);
  assertStringIncludes(marker, "fill={color}");
  assertStringIncludes(marker, 'stroke="#ffffff"');
  assertStringIncludes(marker, 'status === "planned"');
  assertEquals(marker.includes("var(--ui-destructive)"), false);
  assertEquals(marker.includes("var(--ui-success)"), false);
  assertStringIncludes(source, "overviewActivityStatusCaption");
  assertEquals(source.includes("PENDING"), false);
  assertEquals(source.includes("Inspect current activity"), false);
  assertStringIncludes(
    source,
    "A static D3 hierarchical edge-bundling view of recorded",
  );

  assertStringIncludes(overview, "activities={projectPath.activities}");
  assertStringIncludes(overview, "onOpenActivity={openOverviewActivity}");
  assertStringIncludes(overview, "onOpenEvidence={openOverviewEvidence}");
});

Deno.test("Overview destinations keep Evidence and Activity without a Product tab", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertEquals(source.includes('onNavigate("product")'), false);
  assertEquals(source.includes("ProductWorkspaceFacet"), false);
  assertEquals(source.includes("onOpenProductFacet"), false);
  assertEquals(source.includes("openProductFacet"), false);
  assertStringIncludes(source, 'onClick={() => onNavigate("verification")}');
  assertStringIncludes(source, 'onClick={() => onNavigate("work")}');
  assertStringIncludes(source, 'data-surface="digital-thread-whiteboard"');
  assertStringIncludes(source, "<OverviewThreadHero");
});

Deno.test("visible hull adapters target displayed graph identities, not the full record", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const adapterContexts = hero.slice(
    hero.indexOf("const hullEngineeringCases = useMemo("),
    hero.indexOf("const hullContents = useMemo("),
  );
  const hullContents = hero.slice(
    hero.indexOf("const hullContents = useMemo("),
    hero.indexOf("const candidateStructuredRowCounts = useMemo("),
  );
  const recordHullContents = hero.slice(
    hero.indexOf("const recordHullContents = useMemo("),
    hero.indexOf("const groupRowAnchors = useMemo("),
  );
  const visibleContext = adapterContexts.slice(
    adapterContexts.indexOf("const hullAdapterContext = useMemo("),
    adapterContexts.indexOf("const recordHullAdapterContext = useMemo("),
  );
  const recordContext = adapterContexts.slice(
    adapterContexts.indexOf("const recordHullAdapterContext = useMemo("),
  );

  assertEquals(adapterContexts.includes("const hullEngineeringCases"), true);
  assertStringIncludes(visibleContext, "nodes: view.nodes");
  assertEquals(visibleContext.includes("recordView.nodes"), false);
  assertStringIncludes(
    visibleContext,
    "engineeringCases: hullEngineeringCases",
  );
  assertStringIncludes(recordContext, "nodes: recordView.nodes");
  assertEquals(recordContext.includes("nodes: view.nodes"), false);
  assertStringIncludes(recordContext, "engineeringCases: hullEngineeringCases");

  assertStringIncludes(hullContents, "buildOverviewHullContents(");
  assertStringIncludes(hullContents, "view.nodes,");
  assertStringIncludes(
    hullContents,
    "{ ...hullAdapterContext, currentBrief }",
  );
  assertEquals(hullContents.includes("recordHullAdapterContext"), false);
  assertEquals(hullContents.includes("recordView.nodes"), false);

  assertStringIncludes(recordHullContents, "buildOverviewHullContents(");
  assertStringIncludes(recordHullContents, "recordView.nodes,");
  assertStringIncludes(recordHullContents, "recordHullAdapterContext");
  assertEquals(
    recordHullContents.includes("{ ...hullAdapterContext, currentBrief }"),
    false,
  );
});

Deno.test("Overview keeps current revisions and existing record access without extra hull controls", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const helper = await Deno.readTextFile(
    new URL("./src/project/overview/hulls/version-history.ts", import.meta.url),
  );

  assertStringIncludes(hero, "buildOverviewVersionHistory");
  assertStringIncludes(hero, "recordView");
  assertStringIncludes(hero, "thread.graph.edges");
  assertStringIncludes(hero, "versionHistory.displayedGraph");
  assertStringIncludes(hero, "recordHullContents");
  assertStringIncludes(hero, "recordNodesByKey");
  assertEquals(hero.includes("graphWithoutAnalysisOverlay"), false);
  assertEquals(flow.includes("onToggleGroupHistory"), false);
  assertEquals(flow.includes('data-history="true"'), false);
  assertEquals(flow.includes("onToggleCaseHistory"), false);
  assertEquals(flow.includes('data-case-history="true"'), false);
  assertEquals(flow.includes("onToggleHullHistory"), false);
  assertEquals(hero.includes("onToggleHullHistory"), false);
  assertEquals(flow.includes('data-hull-history="true"'), false);
  assertEquals(flow.includes("overviewHullHistoryControl"), false);
  assertEquals(hero.includes("historyExpandedHullKeys"), false);
  assertEquals(hero.includes("setHistoryExpandedHullKeys"), false);
  assertEquals(
    flow.includes("whiteboardHullControl({ labeled: true })"),
    false,
  );
  assertStringIncludes(flow, "data-native-action={row.nativeAction}");
  assertStringIncludes(flow, "!group.collapsed");
  assertStringIncludes(hero, "applyOverviewHullAdapters");
  assertEquals(hero.includes("withOverviewCurrentEngineeringCases"), false);
  assertEquals(hero.includes("projectEngineeringCaseSeries("), false);
  assertEquals(flow.includes("Preuves de"), false);
  assertStringIncludes(flow, "onMouseEnter");
  assertStringIncludes(flow, "inspection.graphKeys");
  assertStringIncludes(flow, "data-relation-kind={link.relationKind}");
  assertEquals(flow.includes("navigation-parent"), false);
  const rowLayout = await Deno.readTextFile(
    new URL("./src/project/overview/hulls/row-layout.ts", import.meta.url),
  );
  assertStringIncludes(
    rowLayout,
    'OVERVIEW_HULL_ROW_PARENT_RELATION = "row-parent"',
  );
  assertStringIncludes(flow, "selectedRowKey");
  assertEquals(flow.includes("onActivateHullRow?.(row, group.key)"), true);
  assertStringIncludes(hero, "activateOverviewHullRow(row, {");
  assertStringIncludes(hero, "openCurrentBrief: () =>");
  assertEquals(
    hero.slice(
      hero.indexOf("onActivateHullRow={(row, groupKey) => {"),
      hero.indexOf("nodesByKey={nodesByKey}"),
    ).includes("nativeAction"),
    false,
  );
  assertEquals(hero.includes("row.nodeKey ?? row.key"), false);
  assertStringIncludes(hero, "overviewHullRowActions(row)");
  assertStringIncludes(hero, "overviewHullRowPrimaryGraphRef(row)");
  assertEquals(hero.includes('content?.mode === "tree" ? content.rows'), false);
  assertStringIncludes(flow, "overviewHullPresentationRowKey(");
  assertStringIncludes(flow, "overviewEffectiveInspection(");
  assertStringIncludes(flow, "overviewHullHierarchyLinkState(");
  assertStringIncludes(hero, "hoveredKey ?? selectedKey");
  assertStringIncludes(hero, "openCurrentBriefViewer");
  assertStringIncludes(hero, 'kind: "current-brief"');
  assertStringIncludes(hero, 'type: "row-activated"');
  assertStringIncludes(hero, "overviewHullMappedGraphKey(");
  assertStringIncludes(hero, "overviewHullPresentationRowLookup(");
  assertStringIncludes(hero, "setSelectedRowKey(undefined)");
  const background = hero.slice(
    hero.indexOf("onPointerDownCapture={(event) => {"),
    hero.indexOf('"overview-thread-layout-switch"'),
  );
  assertEquals(background.includes("setSelectedRowKey(undefined)"), false);
  const selectionNoteClose = hero.slice(
    hero.indexOf("<OverviewThreadSelectionNote"),
    hero.indexOf("<OverviewThreadBriefSourceNote"),
  );
  assertStringIncludes(selectionNoteClose, "closeSelection()");
  const briefClose = hero.slice(
    hero.indexOf("<OverviewThreadBriefSourceNote"),
    hero.indexOf('className="overview-thread-viewport"'),
  );
  assertStringIncludes(briefClose, "closeSelection()");
  const toggle = hero.slice(
    hero.indexOf("const toggleSelection ="),
    hero.indexOf("const bringViewerFront ="),
  );
  assertStringIncludes(toggle, 'type: "selection-toggled"');
  assertEquals(toggle.includes("openViewer("), false);
  assertStringIncludes(helper, "buildVersionedProvenanceProjection");
  assertEquals(helper.includes("graphWithoutAnalysisOverlay"), false);
  assertEquals(helper.includes("producer"), false);
  assertEquals(helper.includes("recordedAt"), false);
});

function assertIdentityClass(source: string, identity: string): void {
  assertEquals(
    source.includes(`"${identity}"`) || source.includes(`'${identity}'`),
    true,
    `Missing identity class ${identity}`,
  );
}

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
