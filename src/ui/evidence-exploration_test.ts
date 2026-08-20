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
    "Double-click for the local neighbourhood.",
  );
  assertEquals(workbench.includes("full/local"), false);
});

Deno.test("Verification keeps its inspector and depth control in the three-column graph workspace", async () => {
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
  assertStringIncludes(source, 'aria-label="Neighbor depth"');
  assertStringIncludes(source, 'type="range"');
  assertStringIncludes(source, "Radius for the next local view");
  assertStringIncludes(
    workbench,
    'activeView === "verification" ? "is-verification"',
  );
  assertStringIncludes(workbench, 'activeView === "verification" && inspector');
  assertStringIncludes(workbench, "inspectorOpen ? selection : undefined");
  assertStringIncludes(workbench, "onNeighborDepthChange={setLocalDepth}");
  assertEquals(workbench.includes("Close details"), false);
  assertStringIncludes(
    styles,
    "grid-template-columns: minmax(0, 1fr) 312px",
  );
  assertStringIncludes(
    styles,
    ".thread-graph-workspace.is-verification > .thread-tool-drawer",
  );
  assertStringIncludes(styles, "@media (max-width: 1120px)");
});
