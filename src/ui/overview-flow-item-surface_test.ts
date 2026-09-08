import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("FlowNode and structured rows instantiate one visual surface", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const surface = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-item-surface.tsx",
      import.meta.url,
    ),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const rowBody = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-row-body.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(
    flow,
    'from "./overview/components/flow-item-surface.tsx"',
  );
  assertEquals(flow.split("<FlowItemSurface").length - 1, 3);
  assertStringIncludes(flow, "whiteboardFlowItem({ density })");
  assertStringIncludes(
    flow,
    'const density = position.listed ? "listed" : "point"',
  );
  assertEquals(flow.split('data-whiteboard-flow-item="true"').length - 1, 2);
  assertStringIncludes(
    surface,
    'part: pending ? "pendingMarker" : "marker"',
  );
  assertEquals(surface.includes("treeMark"), false);
  assertEquals(surface.includes("overview-thread-flow-structure-mark"), false);
  assertStringIncludes(surface, 'whiteboardFlowItemPart({ part: "label" })');
  assertStringIncludes(surface, 'whiteboardFlowItemPart({ part: "detail" })');
  assertStringIncludes(surface, 'whiteboardFlowItemPart({ part: "viewer" })');
  assertStringIncludes(surface, "overview-thread-flow-node-dot");
  assertEquals(surface.includes("ring-primary"), false);
  assertEquals(rowBody.includes("overview-thread-flow-row-dot"), false);
  assertStringIncludes(
    rowBody,
    'whiteboardFlowItemPart({ part: "name" })',
  );
  assertStringIncludes(
    rowBody,
    'whiteboardFlowItemPart({ part: "detail", live })',
  );
  assertStringIncludes(recipes, "export const whiteboardFlowItem");
  assertEquals(recipes.includes('part: "treeMark"'), false);
  assertEquals(recipes.includes("whiteboardRelatedRow"), false);
  assertEquals(recipes.includes("ring-primary/50"), false);
  assertStringIncludes(
    recipes,
    "bg-[var(--flow-color)]",
  );
  assertStringIncludes(
    recipes,
    "data-[state=related]:bg-[color-mix(in_srgb,var(--flow-color)_4%,transparent)]",
  );
  assertStringIncludes(
    recipes,
    "data-[state=selected]:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
  );
  assertStringIncludes(
    recipes,
    "group-data-[state=related]:shadow-[0_0_0_2px_#fff,0_0_0_3px_color-mix(in_srgb,var(--flow-color)_26%,transparent)]",
  );
  assertStringIncludes(recipes, "pendingMarker");
  assertStringIncludes(recipes, "bg-muted-foreground/20");
  assertStringIncludes(recipes, 'status: "planned"');
  assertStringIncludes(recipes, "activityLabel");
  assertEquals(recipes.includes("bg-[var(--ui-success)]"), false);
});

Deno.test("point tree list and matrix share one marker grammar and pending pulse", async () => {
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const surface = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-item-surface.tsx",
      import.meta.url,
    ),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertStringIncludes(
    recipes,
    'point: "grid size-[0.875rem] place-items-center rounded-full"',
  );
  assertStringIncludes(recipes, "listed:");
  assertStringIncludes(flow, 'group.view === "matrix" ? "point" : "listed"');
  assertStringIncludes(flow, "whiteboardFlowItem({ density, pending: true })");
  assertStringIncludes(surface, 'part: pending ? "pendingMarker" : "marker"');
  assertStringIncludes(surface, "overview-thread-flow-node-dot");
  assertEquals(surface.includes("overview-thread-flow-structure-mark"), false);
  assertEquals(flow.includes("overview-thread-flow-structure-mark"), false);
  assertStringIncludes(
    recipes,
    "group-data-[kind=activity]:rounded-[0.125rem]",
  );
  assertStringIncludes(
    recipes,
    "border-[color-mix(in_srgb,var(--flow-color)_76%,#fff)]",
  );
});

Deno.test("structured rows share FlowNode keyboard and visual state contract", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const interaction = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-item-interaction.ts",
      import.meta.url,
    ),
  );
  assertStringIncludes(interaction, "export const FLOW_ITEM_KEYSHORTCUTS");
  assertStringIncludes(
    interaction,
    '"ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"',
  );
  assertStringIncludes(interaction, "export function flowItemTabIndex");
  assertStringIncludes(interaction, "export function handleFlowItemKeyDown");
  assertStringIncludes(interaction, 'event.key === "Enter"');
  assertStringIncludes(interaction, "isFlowMoveDirection(event.key)");
  assertEquals(flow.split("FLOW_ITEM_KEYSHORTCUTS").length - 1 >= 2, true);
  assertEquals(flow.split("flowItemTabIndex(focused)").length - 1, 2);
  assertEquals(flow.split("handleFlowItemKeyDown(").length - 1, 2);
  assertEquals(flow.split("flowItemVisualState(").length - 1, 2);
  assertStringIncludes(
    flow,
    "onMove: graphKey\n              ? (direction) => onMove(graphKey, direction)",
  );
  assertStringIncludes(
    flow,
    'item.kind === "activity" && density === "point"',
  );
});

Deno.test("structured rows expose the same data-lane as FlowNode", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const structure = sourceSection(
    flow,
    "function FlowStructureRow(",
    "function FlowNode(",
  );
  const node = sourceSection(
    flow,
    "function FlowNode(",
    "function FlowSegmentLayer(",
  );
  assertStringIncludes(node, "data-lane={position.lane}");
  assertStringIncludes(structure, "data-lane={group.lane}");
  assertStringIncludes(recipes, "group-data-[lane=requirements]:left-0");
  assertStringIncludes(recipes, "group-data-[lane=verdicts]:right-0");
});

Deno.test("listed viewer affordance stays right-aligned without a detail", async () => {
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const surface = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-item-surface.tsx",
      import.meta.url,
    ),
  );
  const rowBody = await Deno.readTextFile(
    new URL(
      "./src/project/overview/components/flow-row-body.tsx",
      import.meta.url,
    ),
  );
  const detail = sourceSection(recipes, "detail: cn(", "viewer: cn(");
  const viewer = sourceSection(recipes, "viewer: cn(", "tooltip: cn(");
  assertStringIncludes(detail, "ml-auto");
  assertStringIncludes(viewer, "ml-auto");
  assertStringIncludes(
    rowBody,
    'whiteboardFlowItemPart({ part: "detail", live })',
  );
  assertStringIncludes(
    surface,
    '{density === "listed" && hasViewer && !pending && (',
  );
  assertEquals(surface.includes("detail && hasViewer"), false);
});

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
