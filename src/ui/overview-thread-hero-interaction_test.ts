import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Overview thread selection opens locally and a second click closes it", async () => {
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
  assertStringIncludes(source, "tabIndex={0}");
  assertStringIncludes(source, "aria-expanded={selected}");
  assertStringIncludes(source, 'event.key !== "Enter"');
  assertStringIncludes(source, 'event.key !== " "');
  assertStringIncludes(source, "Open in Verification →");
  assertStringIncludes(source, "onOpenEvidence(selected.node.ref)");
});

Deno.test("Overview activity markers stay distinct from recorded Verification navigation", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  const activityPanelStart = source.indexOf(
    "function OverviewActivityNodePanel(",
  );
  const activityPanelEnd = source.indexOf(
    "function activityStatusCaption(",
    activityPanelStart,
  );
  const activityPanel = source.slice(activityPanelStart, activityPanelEnd);
  assertEquals(activityPanelStart >= 0, true);
  assertEquals(activityPanelEnd > activityPanelStart, true);
  assertStringIncludes(activityPanel, "Project activity");
  assertStringIncludes(activityPanel, "Open in Activity");
  assertStringIncludes(activityPanel, "activityStatusCaption(activity.status)");
  assertEquals(activityPanel.includes("Open in Verification"), false);
  assertEquals(activityPanel.includes("freshness"), false);
  assertEquals(activityPanel.includes("onOpenEvidence"), false);
  assertEquals(activityPanel.includes("activity.id"), false);

  const recordedPanelStart = source.indexOf(
    "function OverviewRecordedNodePanel(",
  );
  const recordedPanel = source.slice(recordedPanelStart, activityPanelStart);
  assertStringIncludes(recordedPanel, "Open in Verification →");
  assertEquals(recordedPanel.includes("Open in Activity"), false);

  const markerStart = source.indexOf("function ActivityMarker(");
  const markerEnd = source.indexOf(
    "function OverviewRecordedNodePanel(",
    markerStart,
  );
  const marker = source.slice(markerStart, markerEnd);
  assertEquals(markerStart >= 0, true);
  assertEquals(markerEnd > markerStart, true);
  assertEquals(marker.includes("selected"), false);
  assertStringIncludes(marker, 'status === "active"');
  assertStringIncludes(marker, 'r="11"');
  assertStringIncludes(marker, "stroke-success/30");
  assertStringIncludes(marker, 'strokeDasharray={planned ? "3 2" : undefined}');
  assertStringIncludes(marker, "stroke-muted-foreground");
  assertStringIncludes(marker, "stroke-destructive");
  assertStringIncludes(source, "PENDING");
  assertStringIncludes(source, "IN PROGRESS");
  assertStringIncludes(source, "BLOCKED");
  assertStringIncludes(
    source,
    "Recorded thread and project progress across requirements, model, geometry, physics and verdicts",
  );

  assertStringIncludes(overview, "activities={projectPath.activities}");
  assertStringIncludes(overview, "onOpenActivity={openOverviewActivity}");
  assertStringIncludes(overview, "onOpenEvidence={openOverviewEvidence}");
});

Deno.test("Overview product facet callbacks do not also run their fallback", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(source, "const openProductFacet");
  assertEquals(source.includes('?.("requirements") ??'), false);
  assertEquals(source.includes('?.("structure") ??'), false);
});
