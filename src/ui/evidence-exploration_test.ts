import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Evidence exploration uses 4b navigation without a full/local toggle", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/evidence-exploration.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "onEnterLocalView");
  assertStringIncludes(source, "doubleClickNode");
  assertStringIncludes(source, "clientHeight");
  assertStringIncludes(source, "ResizeObserver");
  assertStringIncludes(source, "EvidenceMinimap");
  assertStringIncludes(source, "buildEvidenceMinimapView");
  assertStringIncludes(source, "Full map");
  assertStringIncludes(source, "view.nodeCount");
  assertStringIncludes(source, "view.edgeCount");
  assertStringIncludes(source, "Cases");
  assertStringIncludes(source, "Recorded systems");
  assertStringIncludes(source, "Types · semantic filter");
  assertStringIncludes(source, "Selected case unavailable");
  assertStringIncludes(source, "All records");
  assertStringIncludes(source, "verificationCaseFilter");
  assertStringIncludes(workbench, "filterGraphByVerificationCase");
  assertStringIncludes(workbench, "verificationCaseNodes=");
  assertEquals(source.includes(">Components<"), false);
  assertEquals(source.includes("REQ-S-002"), false);
  assertEquals(source.includes("+23.3%"), false);
  assertEquals(source.includes("AV-114"), false);
  assertEquals(source.includes("RUNNING"), false);
  assertEquals(source.includes("full/local"), false);

  assertStringIncludes(workbench, "fullMapProjection=");
  assertStringIncludes(workbench, "onEnterLocalView=");
  assertStringIncludes(workbench, "focusLineage: false");
  assertStringIncludes(
    workbench,
    "Double-click a node to focus its neighbourhood.",
  );
  assertEquals(workbench.includes("full/local"), false);
});

Deno.test("Verification opens a closable inspector without shrinking the default graph", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/evidence-exploration.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/04-feed-and-graph.css", import.meta.url),
  );

  assertStringIncludes(source, "neighborDepth");
  assertStringIncludes(
    source,
    'projection.isFiltered ? "Depth" : "Next local depth"',
  );
  assertStringIncludes(source, '? "Neighbor depth"');
  assertStringIncludes(source, ': "Next local depth"');
  assertStringIncludes(source, 'type="range"');
  assertStringIncludes(source, "Applied to the next local view");
  assertStringIncludes(source, "labelSize: 11");
  assertStringIncludes(source, "labelGridCellSize: compact ? 10 : 108");
  assertStringIncludes(source, "labelDensity: compact ? 1 : 0.06");
  assertStringIncludes(source, "stagePadding: compact ? 30 : 40");
  assertStringIncludes(source, "Accessible evidence table");
  assertStringIncludes(
    workbench,
    'activeView === "verification"',
  );
  assertStringIncludes(workbench, "`is-verification ${");
  assertStringIncludes(
    workbench,
    'activeView === "verification" && inspectorOpen && inspector',
  );
  assertStringIncludes(workbench, "inspectorOpen ? selection : undefined");
  assertStringIncludes(workbench, "onNeighborDepthChange={setLocalDepth}");
  assertStringIncludes(workbench, "Close details");
  assertStringIncludes(workbench, 'inspectorOpen ? "has-inspector" : ""');
  assertStringIncludes(
    styles,
    "grid-template-columns: minmax(0, 1fr) 312px",
  );
  assertStringIncludes(
    styles,
    ".thread-graph-workspace.is-verification > .thread-tool-drawer",
  );
  assertStringIncludes(styles, "@container workspace (max-width: 70rem)");
});
