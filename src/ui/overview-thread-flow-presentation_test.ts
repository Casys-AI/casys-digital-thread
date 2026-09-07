import { assertEquals, assertStringIncludes } from "@std/assert";
import { flowSegmentState } from "./src/project/overview-thread-d3-flow-highlight.ts";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  type OverviewThreadD3FlowNodeInput,
} from "./src/project/overview-thread-d3-flow-layout.ts";

Deno.test("fresh idle presentation tokens stay muted and never paint purple or teal inspection hues", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const shell = await Deno.readTextFile(
    new URL("./src/styles/17-saas-shell.css", import.meta.url),
  );
  assertStringIncludes(styles, "--overview-cable-idle-color");
  assertStringIncludes(styles, "--overview-cable-idle-opacity");
  assertStringIncludes(styles, "--overview-inspection-color");
  assertEquals(styles.includes("#6d28d9"), false);
  assertEquals(styles.includes("#0f766e"), false);
  assertEquals(shell.includes("#6d28d9"), false);
  assertEquals(shell.includes("#0f766e"), false);
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
    styles.indexOf("opacity: 0.9;", incomingIndex) + 20,
  );
  assertStringIncludes(incomingBlock, "var(--overview-inspection-color)");
  assertStringIncludes(
    incomingBlock,
    '[data-state="outgoing"]',
  );
  assertStringIncludes(
    styles,
    ".overview-thread-flow-hierarchy-links path {\n  fill: none;\n  stroke: var(--overview-cable-idle-color);",
  );
});

Deno.test("incoming and outgoing exact chains share one inspection color and still raise the far branch", () => {
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
  const layout = buildOverviewThreadD3FlowLayout(nodes, edges);
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

Deno.test("record FlowNode dots and matrix points share subdued idle and active ring tokens", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const heroIndex = styles.indexOf(".overview-thread-hero {");
  const heroBlock = styles.slice(
    heroIndex,
    styles.indexOf("\n}", heroIndex) + 2,
  );
  assertStringIncludes(heroBlock, "--overview-point-idle-fill: 38%;");
  assertStringIncludes(heroBlock, "--overview-point-idle-stroke: 64%;");
  assertEquals(styles.split("--overview-point-idle-fill:").length - 1, 1);
  assertEquals(styles.split("--overview-point-idle-stroke:").length - 1, 1);

  const idleFill =
    "color-mix(in srgb, var(--flow-color) var(--overview-point-idle-fill), #fff)";
  const idleStroke =
    "color-mix(in srgb, var(--flow-color) var(--overview-point-idle-stroke), #fff)";
  const matrixIdleIndex = styles.indexOf(
    '.overview-thread-flow-structure-row[data-hull-row-view="matrix"]::before {',
  );
  const matrixIdle = styles.slice(
    matrixIdleIndex,
    styles.indexOf("\n}", matrixIdleIndex) + 2,
  );
  const nodeDotIndex = styles.indexOf(".overview-thread-flow-node-dot {");
  const nodeDotIdle = styles.slice(
    nodeDotIndex,
    styles.indexOf("\n}", nodeDotIndex) + 2,
  );
  assertStringIncludes(matrixIdle, `background: ${idleFill}`);
  assertStringIncludes(matrixIdle, `border: 1px solid ${idleStroke}`);
  assertStringIncludes(nodeDotIdle, `background: ${idleFill}`);
  assertStringIncludes(nodeDotIdle, `border: 1px solid ${idleStroke}`);
  assertEquals(matrixIdle.includes("var(--flow-color) 28%"), false);
  assertEquals(nodeDotIdle.includes("var(--flow-color) 28%"), false);
  assertEquals(matrixIdle.includes("background: var(--flow-color)"), false);
  assertEquals(nodeDotIdle.includes("background: var(--flow-color)"), false);

  const matrixActiveIndex = styles.indexOf(
    '.overview-thread-flow-structure-row[data-hull-row-view="matrix"]:hover::before',
  );
  const matrixActive = styles.slice(
    matrixActiveIndex,
    styles.indexOf("\n}", matrixActiveIndex) + 2,
  );
  const nodeActiveIndex = styles.indexOf(
    '.overview-thread-hero .overview-thread-flow-node:not([data-kind="activity"]):hover .overview-thread-flow-node-dot',
  );
  const nodeActive = styles.slice(
    nodeActiveIndex,
    styles.indexOf("\n}", nodeActiveIndex) + 2,
  );
  assertStringIncludes(
    matrixActive,
    '[data-inspection-active="true"]::before',
  );
  assertEquals(
    matrixActive.includes('[data-selected="true"]::before'),
    false,
  );
  assertStringIncludes(matrixActive, "background: var(--flow-color);");
  assertStringIncludes(matrixActive, "border-color: var(--flow-color);");
  assertStringIncludes(nodeActive, "background: var(--flow-color);");
  assertStringIncludes(nodeActive, "border-color: var(--flow-color);");
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
  assertStringIncludes(nodeDotIdle, idleStroke);
});

Deno.test("retained data-selected does not paint the active structure atom", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  assertStringIncludes(
    styles,
    '.overview-thread-flow-structure-row[data-inspection-active="true"] {\n  background: #e7eef0;',
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"][data-inspection-active="true"]::before',
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
});

Deno.test("matrix row hover keeps a transparent cell and a compact tooltip contract", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"]:hover',
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"][data-inspection-active="true"] {\n  background: transparent;',
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"]::before',
  );
  assertEquals(
    styles.includes(
      '[data-hull-row-view="matrix"]::before {\n  content: "";\n  width: 0.5rem;\n  height: 0.5rem;\n  border: 1px solid var(--flow-color);\n  border-radius: 50%;\n  background: var(--flow-color);',
    ),
    false,
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"]:hover::before',
  );
  assertStringIncludes(
    styles,
    '[data-hull-row-view="matrix"] .overview-thread-flow-node-tooltip {\n  max-width: min(8.5rem, 22cqi);',
  );
});
