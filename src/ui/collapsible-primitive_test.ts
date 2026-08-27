import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Collapsible wraps Ark UI", async () => {
  const primitive = await Deno.readTextFile(
    new URL("./src/ui/collapsible.tsx", import.meta.url),
  );

  assertStringIncludes(primitive, 'from "@ark-ui/react/collapsible"');
  assertStringIncludes(primitive, "export function Collapsible");
  assertStringIncludes(primitive, "export function CollapsibleTrigger");
  assertStringIncludes(primitive, "export function CollapsibleContent");
});

Deno.test("Overview path band uses the five stage labels and not the old gate spine", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const lanes = await Deno.readTextFile(
    new URL("./src/project/overview-lanes.ts", import.meta.url),
  );
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  assertStringIncludes(lanes, 'requirements: "FRAME"');
  assertStringIncludes(lanes, '"system-model": "SYSTEM MODEL"');
  assertStringIncludes(lanes, 'geometry: "GEOMETRY"');
  assertStringIncludes(lanes, 'physics: "PHYSICS"');
  assertStringIncludes(lanes, 'verdicts: "VERIFICATION"');
  assertEquals(lanes.includes("CAD"), false);

  assertStringIncludes(overview, "PROJECT_PATH_STAGE_LABELS");
  assertStringIncludes(overview, "groupProjectPathGatesByLane");
  assertStringIncludes(overview, "projectPathLaneStageStatus");
  assertStringIncludes(overview, "function ProjectPathStageBand");
  assertStringIncludes(overview, 'role="list"');
  assertStringIncludes(overview, "aria-label={`${label} ${count} ${status}`}");
  assertEquals(overview.includes("<Collapsible"), false);
  assertEquals(overview.includes('from "../ui/collapsible.tsx"'), false);
  assertEquals(overview.includes("earlier gates"), false);
  assertEquals(overview.includes("Earlier project gates"), false);
  assertEquals(overview.includes("function EarlierGatesPanel"), false);
  assertEquals(overview.includes("function SpinePhase"), false);
  assertEquals(
    overview.includes("function ActivityRevisionAttemptList"),
    false,
  );
  assertEquals(overview.includes("function Chevron"), false);
  assertEquals(overview.includes("1 revision · 1 attempt"), false);
  assertEquals(overview.includes("activityLifecycleSummary"), false);
  assertEquals(overview.includes("splitLeadingSatisfiedGates"), false);

  const bandStart = overview.indexOf("function ProjectPathStageBand");
  const bandEnd = overview.indexOf("function OverviewReviewBanner", bandStart);
  const band = overview.slice(bandStart, bandEnd);
  assertEquals(bandStart >= 0, true);
  assertEquals(bandEnd > bandStart, true);
  assertEquals(band.includes("<button"), false);
  assertEquals(band.includes("CAD"), false);
  assertEquals(band.includes("group.color"), false);
  assertEquals(band.includes("style={{ color:"), false);

  assertStringIncludes(hero, "OVERVIEW_LANES");
  assertStringIncludes(hero, "column.lane.color");
  assertEquals(hero.includes("PROJECT_PATH_STAGE_LABELS"), false);
  assertEquals(hero.includes("FRAME"), false);
});

Deno.test("the Work ribbon stays visible instead of a collapsed Project pulse", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const start = workbench.indexOf('activeView === "work" &&');
  const end = workbench.indexOf('activeView === "verification" &&', start);
  const pulse = workbench.slice(start, end);

  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  assertStringIncludes(pulse, "<ProjectWorkRibbon");
  assertEquals(
    workbench.includes("Project pulse"),
    false,
    "the validated Work feed (7a) has no collapsed Project pulse disclosure",
  );
});
