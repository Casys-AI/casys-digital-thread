import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("CSS17 no longer paints flow items, flow segments or cable state", async () => {
  const shell = await Deno.readTextFile(
    new URL("./src/styles/17-saas-shell.css", import.meta.url),
  );
  assertEquals(shell.includes(".overview-thread-flow-node"), false);
  assertEquals(shell.includes(".overview-thread-flow-segment"), false);
  assertEquals(shell.includes(".overview-thread-flow-node-card"), false);
  assertEquals(shell.includes(".overview-thread-flow-node-dot"), false);
  assertEquals(shell.includes(".overview-thread-cable["), false);
  assertEquals(shell.includes(".overview-thread-cable {"), false);
  assertEquals(shell.includes('data-state="incoming"'), false);
  assertEquals(shell.includes('data-state="outgoing"'), false);
  assertStringIncludes(shell, ".overview-thread-node-leader");
  assertStringIncludes(shell, ".overview-thread-node-label");
  assertStringIncludes(shell, "paint-order: stroke");
});

Deno.test("migrated CSS18 item/state paint lives on whiteboard recipes", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const migrated = [
    ".overview-thread-flow-activity-label {",
    ".overview-thread-flow-activity-status {",
    ".overview-thread-flow-activity-status-mark",
    ".overview-thread-flow-activity-key {",
    '.overview-thread-flow-node[data-kind="activity"] .overview-thread-flow-node-dot',
    '.overview-thread-flow-node[data-emphasis="true"] .overview-thread-flow-node-dot',
    ".overview-thread-flow-node-tooltip {\n  position: absolute",
    ".overview-thread-flow-structure-row:hover .overview-thread-flow-node-tooltip",
    ".overview-thread-flow-row-name {",
    ".overview-thread-flow-row-meta[data-live",
    '[data-listed="true"][data-emphasis="true"] .overview-thread-flow-node-dot',
  ];
  for (const selector of migrated) {
    assertEquals(
      styles.includes(selector),
      false,
      `CSS18 still paints ${selector}`,
    );
  }
  assertStringIncludes(recipes, "pendingMarker");
  assertStringIncludes(recipes, "activityLabel");
  assertStringIncludes(recipes, "bg-[var(--flow-color)]");
  assertStringIncludes(recipes, "stroke-[#6d28d9]");
  assertStringIncludes(recipes, "stroke-[#0f766e]");
  assertStringIncludes(styles, ".overview-thread-flow-segment");
  assertStringIncludes(styles, ".overview-thread-flow-hierarchy-links path");
  assertStringIncludes(
    styles,
    "padding: 0 0.45rem 0 calc(0.45rem + var(--structure-depth) * 0.9rem)",
  );
});

Deno.test("FlowSegmentLayer owns Thread graph edges; hierarchy stays a CSS18 guide", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const hierarchy = sourceSection(
    flow,
    '<g className="overview-thread-flow-hierarchy-links">',
    "<FlowSegmentLayer",
  );
  const segmentLayer = sourceSection(
    flow,
    "function FlowSegmentLayer({",
    "function structureRowTooltip(",
  );
  assertStringIncludes(hierarchy, "layoutOverviewHullHierarchyLinks(");
  assertStringIncludes(hierarchy, "data-relation-kind={link.relationKind}");
  assertEquals(hierarchy.includes("overview-thread-flow-segment"), false);
  assertStringIncludes(
    segmentLayer,
    'path.setAttribute("class", "overview-thread-flow-segment");',
  );
  assertStringIncludes(
    segmentLayer,
    'path.setAttribute("stroke-linecap", "round");',
  );
  assertStringIncludes(
    segmentLayer,
    'path.setAttribute("stroke-linejoin", "round");',
  );
  assertEquals(
    segmentLayer.includes("layoutOverviewHullHierarchyLinks"),
    false,
  );
  assertEquals(segmentLayer.includes("row-parent"), false);
  assertEquals(
    styles.includes(".overview-thread-flow-hierarchy-links path"),
    true,
  );
  assertEquals(
    recipes.includes("Hierarchy cables stay on FlowSegmentLayer"),
    false,
  );
});

Deno.test("pending structured rows stay inert under unlayered CSS18", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-overview-thread-flow.css", import.meta.url),
  );
  const recipes = await Deno.readTextFile(
    new URL("./src/ui/whiteboard.ts", import.meta.url),
  );
  const flowItem = sourceSection(
    recipes,
    "export const whiteboardFlowItem = recipe(cva(",
    "export type WhiteboardFlowItemProps",
  );
  const listed = sourceSection(flowItem, "listed: cn(", "pending: {");
  const pending = sourceSection(flowItem, "pending: {", "compoundVariants:");
  const compounds = sourceSection(
    flowItem,
    "compoundVariants:",
    "defaultVariants:",
  );
  const rowRule = cssRule(styles, ".overview-thread-flow-structure-row");
  const pendingSelector =
    ".overview-thread-flow-structure-row.overview-thread-flow-structure-row-pending";
  const pendingRule = cssRule(styles, pendingSelector);
  const pendingBlocks = [
    ...styles.matchAll(
      /\.overview-thread-flow-structure-row-pending[^{]*\{[^}]*\}/g,
    ),
  ].map((match) => match[0]);

  assertStringIncludes(rowRule, "pointer-events: auto;");
  assertStringIncludes(pendingRule, "pointer-events: none;");
  assertEquals(
    pendingSelector.startsWith(".overview-thread-flow-structure-row."),
    true,
    "pending lock must outrank the unlayered structure-row pointer-events",
  );
  assertEquals(pendingBlocks.length >= 1, true);
  for (const block of pendingBlocks) {
    assertEquals(
      block.includes("pointer-events: auto"),
      false,
      `pending CSS18 rule regained pointer events:\n${block}`,
    );
    assertEquals(
      /\b(?:background(?:-color)?|color|fill|stroke)\s*:/.test(block),
      false,
      `CSS18 pending rule paints item chrome:\n${block}`,
    );
  }
  assertEquals(
    listed.includes(
      "hover:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
    ),
    false,
    "listed density must not carry lane hover into the pending variant",
  );
  assertEquals(
    pending.includes(
      "hover:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
    ),
    false,
  );
  assertEquals(pending.includes("var(--flow-color)"), false);
  assertStringIncludes(pending, "pointer-events-none");
  assertStringIncludes(compounds, 'density: "listed"');
  assertStringIncludes(compounds, "pending: false");
  assertStringIncludes(
    compounds,
    "hover:bg-[color-mix(in_srgb,var(--flow-color)_8%,transparent)]",
  );
});

function cssRule(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  assertEquals(start >= 0, true, `Missing CSS selector ${selector}`);
  const end = source.indexOf("\n}", start);
  assertEquals(end > start, true, `Unclosed ${selector}`);
  return source.slice(start, end + 2);
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
