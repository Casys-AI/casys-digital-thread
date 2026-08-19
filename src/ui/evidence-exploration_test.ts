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
