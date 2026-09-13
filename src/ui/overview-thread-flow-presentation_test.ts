/// <reference lib="dom" />
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  flowSegmentPaintRank,
  flowSegmentState,
} from "./src/project/overview-thread-d3-flow-highlight.ts";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  type OverviewThreadD3FlowNodeInput,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import { overviewFlowSegmentPresentations } from "./src/project/overview/flow/segments.ts";

Deno.test("idle cables stay grey and inspection paints distinct incoming and outgoing hues", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const shell = await Deno.readTextFile(
    new URL("./src/styles/17-saas-shell.css", import.meta.url),
  );
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  assertStringIncludes(styles, "--overview-cable-idle-color");
  assertStringIncludes(styles, "--overview-cable-idle-opacity: 0.16");
  assertEquals(styles.includes("--overview-inspection-color"), false);
  assertEquals(flow.includes("--overview-inspection-color"), false);
  assertStringIncludes(styles, "stroke: #6d28d9");
  assertStringIncludes(styles, "stroke: #0f766e");
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  assertStringIncludes(recipes, "stroke-[#6d28d9]");
  assertStringIncludes(recipes, "stroke-[#0f766e]");
  assertEquals(shell.includes(".overview-thread-flow-segment"), false);
  assertEquals(shell.includes(".overview-thread-flow-node"), false);
  assertEquals(shell.includes(".overview-thread-cable["), false);
  assertEquals(shell.includes("stroke: #6d28d9"), false);
  assertEquals(shell.includes("stroke: #0f766e"), false);
  assertStringIncludes(
    shell,
    "stroke: var(--overview-cable-idle-color, #6e7f86);",
  );
  assertStringIncludes(shell, ".overview-thread-node-leader");
  assertStringIncludes(
    styles,
    '.overview-thread-flow-segment[data-state="incoming"]',
  );
  assertStringIncludes(
    styles,
    '.overview-thread-flow-segment[data-state="outgoing"]',
  );
  const incomingIndex = styles.indexOf(
    '.overview-thread-hero .overview-thread-flow-segment[data-state="incoming"]',
  );
  const incomingBlock = styles.slice(
    incomingIndex,
    styles.indexOf("opacity: 0.7;", incomingIndex) + 20,
  );
  assertStringIncludes(incomingBlock, "stroke: #6d28d9");
  assertEquals(incomingBlock.includes('[data-state="outgoing"]'), false);
  assertStringIncludes(
    styles,
    "opacity: 0.16",
  );
  assertStringIncludes(styles, "opacity: 0.3;");
  assertStringIncludes(styles, "opacity: 0.22;");
  assertStringIncludes(styles, "opacity: 0.14;");
  assertStringIncludes(styles, "opacity: 0.055;");
  const hierarchyStart = styles.indexOf(
    ".overview-thread-flow-hierarchy-links path {",
  );
  const hierarchyEnd = styles.indexOf(
    ".overview-thread-hero .overview-thread-flow-node {",
    hierarchyStart,
  );
  assertEquals(hierarchyStart >= 0, true);
  assertEquals(hierarchyEnd > hierarchyStart, true);
  const hierarchy = styles.slice(hierarchyStart, hierarchyEnd);
  assertStringIncludes(hierarchy, "stroke: var(--overview-cable-idle-color);");
  assertStringIncludes(hierarchy, "opacity: 0.2;");
  assertEquals(hierarchy.includes("var(--flow-color)"), false);
  assertEquals(hierarchy.includes("#6d28d9"), false);
  assertEquals(hierarchy.includes("#0f766e"), false);
  assertStringIncludes(recipes, "stroke-[#6e7f86]");
  assertStringIncludes(recipes, "opacity-[0.16]");
  assertStringIncludes(recipes, "[stroke-linejoin:round]");
  assertStringIncludes(recipes, "opacity-[0.68]");
});

Deno.test("incoming and outgoing exact chains share one inspection color and still raise the far branch", () => {
  const layout = twoCadFeaLayout();
  const routeA = layout.routes.find((route) => route.edgeKey === "trace:a>fea")!;
  const idle = layout.segments.map((segment) =>
    flowSegmentState(segment, undefined, [], layout.routes)
  );
  assertEquals(idle.every((state) => state === "default"), true);
  assertEquals(
    routeA.segmentKeys.map((key) =>
      flowSegmentState(
        layout.segments.find((segment) => segment.key === key)!,
        "artifact:cad-a",
        [],
        layout.routes,
      )
    ),
    ["outgoing", "outgoing", "outgoing"],
  );
  assertEquals(
    routeA.segmentKeys.map((key) =>
      flowSegmentState(
        layout.segments.find((segment) => segment.key === key)!,
        "observation:fea",
        [],
        layout.routes,
      )
    ),
    ["incoming", "incoming", "incoming"],
  );
});

Deno.test("overviewFlowSegmentPresentations orders paint then key and flags drag only on touching cables", () => {
  const layout = twoCadFeaLayout();
  const moving = new Set(["artifact:cad-a"]);
  const idle = overviewFlowSegmentPresentations(
    layout,
    "artifact:cad-a",
    moving,
    false,
  );
  const dragging = overviewFlowSegmentPresentations(
    layout,
    "artifact:cad-a",
    moving,
    true,
  );

  assertEquals(idle.length > 0, true);
  assertEquals(
    idle.every((presentation) => presentation.connectedToDrag === false),
    true,
  );
  assertEquals(
    idle.map((presentation) => presentation.state),
    idle.map((presentation) =>
      flowSegmentState(
        presentation.segment,
        "artifact:cad-a",
        [],
        layout.routes,
      )
    ),
  );
  assertEquals(
    idle.map((presentation) => flowSegmentPaintRank(presentation.state)),
    idle.map((presentation) => flowSegmentPaintRank(presentation.state))
      .toSorted((left, right) => left - right),
  );
  for (let index = 1; index < idle.length; index++) {
    const previous = idle[index - 1]!;
    const current = idle[index]!;
    if (
      flowSegmentPaintRank(previous.state) !==
        flowSegmentPaintRank(current.state)
    ) continue;
    assertEquals(
      previous.segment.key.localeCompare(current.segment.key) <= 0,
      true,
    );
  }

  const expectedConnectedToDrag = dragging.map((presentation) =>
    presentation.segment.fromKeys.includes("artifact:cad-a") ||
    presentation.segment.toKeys.includes("artifact:cad-a")
  );
  assertEquals(
    dragging.some((presentation) => presentation.connectedToDrag),
    true,
  );
  assertEquals(expectedConnectedToDrag.includes(false), true);
  assertEquals(
    dragging.map((presentation) => presentation.connectedToDrag),
    expectedConnectedToDrag,
  );
});

Deno.test("record FlowNode dots and matrix points share a saturated idle fill and selected halo", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const heroIndex = styles.indexOf(".overview-thread-hero {");
  const heroBlock = styles.slice(
    heroIndex,
    styles.indexOf("\n}", heroIndex) + 2,
  );
  assertEquals(heroBlock.includes("--overview-point-idle-fill"), false);
  assertEquals(heroBlock.includes("--overview-point-idle-stroke"), false);
  assertEquals(styles.includes("--overview-point-idle-fill"), false);
  assertEquals(styles.includes("--overview-point-idle-stroke"), false);

  assertStringIncludes(recipes, "size-[0.4375rem]");
  assertStringIncludes(recipes, "bg-[var(--flow-color)]");
  assertStringIncludes(
    recipes,
    "border-[color-mix(in_srgb,var(--flow-color)_76%,#fff)]",
  );
  assertStringIncludes(recipes, "shadow-[0_0_0_2px_#fff]");
  assertStringIncludes(
    recipes,
    "group-data-[state=selected]:shadow-[0_0_0_2px_#fff,0_0_0_4px_color-mix(in_srgb,var(--flow-color)_48%,transparent)]",
  );
  assertEquals(recipes.includes("var(--flow-color)_28%"), false);
  assertEquals(recipes.includes("ring-primary/50"), false);
  assertEquals(styles.includes("background: #e7eef0"), false);
  assertEquals(
    styles.includes(
      ".overview-thread-flow-node-dot {\n  display: block;\n  width: 0.4375rem;\n  height: 0.4375rem;\n  border: 1px solid color-mix(in srgb, var(--flow-color) 76%, #fff);\n  border-radius: 999px;\n  background: var(--flow-color);",
    ),
    false,
  );

  const containerIndex = styles.indexOf(
    "@container overview-thread-flow (max-width: 44rem)",
  );
  const nextContainer = styles.indexOf(
    "@container overview-thread-flow (max-width: 30rem)",
    containerIndex + 1,
  );
  const container = styles.slice(containerIndex, nextContainer);
  const overrideIndex = container.indexOf(".overview-thread-flow-node-dot {");
  const override = container.slice(
    overrideIndex,
    container.indexOf("\n  }", overrideIndex) + 4,
  );
  assertStringIncludes(override, "width: 0.375rem;");
  assertStringIncludes(override, "height: 0.375rem;");
  assertEquals(override.includes("border: 0"), false);
  assertEquals(override.includes("box-shadow: 0 0 0 1px #fff"), false);
  assertEquals(override.includes("var(--overview-point-idle-stroke)"), false);
});

Deno.test("retained data-selected does not paint the active structure atom", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  assertEquals(styles.includes("background: #e7eef0"), false);
  assertEquals(
    styles.includes('[data-inspection-active="true"]'),
    false,
  );
  assertEquals(
    styles.includes(
      '.overview-thread-flow-structure-row[data-selected="true"]',
    ),
    false,
  );
  assertEquals(
    styles.includes('[data-selected="true"]::before'),
    false,
  );
  assertStringIncludes(
    recipes,
    "data-[state=selected]:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
  );
});

Deno.test("matrix row hover keeps a transparent cell and a compact tooltip contract", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  assertStringIncludes(
    recipes,
    "hover:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
  );
  assertStringIncludes(
    recipes,
    'point: "grid size-[0.875rem] place-items-center rounded-full"',
  );
  assertEquals(
    recipes.includes(
      'point: "grid size-[0.875rem] place-items-center rounded-full"',
    ) && recipes.includes("8%,transparent"),
    true,
  );
  const pointRecipe = recipes.slice(
    recipes.indexOf("density: {"),
    recipes.indexOf("listed:"),
  );
  assertEquals(pointRecipe.includes("8%,transparent"), false);
  assertEquals(styles.includes('[data-hull-row-view="matrix"]::before'), false);
  assertEquals(
    styles.includes(
      '[data-hull-row-view="matrix"] > :not(.overview-thread-flow-node-tooltip)',
    ),
    false,
  );
  assertEquals(
    styles.includes(
      '[data-hull-row-view="matrix"] .overview-thread-flow-node-tooltip {',
    ),
    false,
  );
  assertStringIncludes(
    recipes,
    "group-data-[hull-row-view=matrix]:max-w-[min(8.5rem,22cqi)]",
  );
});

function twoCadFeaLayout() {
  const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
    {
      key: "artifact:cad-a",
      lane: "geometry",
      groupKey: "domain:geometry",
      label: "CAD A",
    },
    {
      key: "artifact:cad-b",
      lane: "geometry",
      groupKey: "domain:geometry",
      label: "CAD B",
    },
    {
      key: "observation:fea",
      lane: "physics",
      groupKey: "domain:fea",
      label: "FEA",
    },
  ];
  const edges: readonly OverviewThreadD3FlowEdgeInput[] = [
    {
      key: "trace:a>fea",
      fromKey: "artifact:cad-a",
      toKey: "observation:fea",
      pathCount: 1,
      pathKeys: ["trace:a>fea"],
      emphasis: false,
    },
    {
      key: "trace:b>fea",
      fromKey: "artifact:cad-b",
      toKey: "observation:fea",
      pathCount: 1,
      pathKeys: ["trace:b>fea"],
      emphasis: false,
    },
  ];
  return buildOverviewThreadD3FlowLayout(nodes, edges);
}
