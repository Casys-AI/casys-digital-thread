import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("hero pan start never clears selection; a background click may dismiss unpinned", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const pan = hero.slice(
    hero.indexOf("const beginCanvasPan = ("),
    hero.indexOf("const moveFocus = ("),
  );
  assertStringIncludes(pan, "overviewCanvasPointerBecamePan(");
  assertStringIncludes(pan, "moved: false");
  assertStringIncludes(pan, "const wasPan = pan.moved");
  assertStringIncludes(
    pan,
    'if (!wasPan && event.type === "pointerup") clearCanvasSelection()',
  );
  assertEquals(pan.includes("setSelectedKey(undefined)"), false);
  assertEquals(pan.includes("setSelectedRowKey(undefined)"), false);

  const capture = hero.slice(
    hero.indexOf("onPointerDownCapture={(event) => {"),
    hero.indexOf('"overview-thread-layout-switch"'),
  );
  assertEquals(capture.includes("setSelectedKey(undefined)"), false);
  assertEquals(capture.includes("clearCanvasSelection("), false);
  assertEquals(capture.includes("closeSelection("), false);
});

Deno.test("selection note pins independently of opening an exact viewer", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const note = await Deno.readTextFile(
    new URL(
      "./src/project/overview-thread-selection-note.tsx",
      import.meta.url,
    ),
  );
  const toggle = hero.slice(
    hero.indexOf("const toggleSelection ="),
    hero.indexOf("const bringViewerFront ="),
  );
  assertStringIncludes(
    toggle,
    'apply({ type: "selection-toggled", key: item.key })',
  );
  assertEquals(toggle.includes("openViewer("), false);
  assertStringIncludes(hero, "placeOverviewSelectionNote(");
  assertStringIncludes(hero, "overviewSelectionNoteAnchorFromRects(");
  assertStringIncludes(hero, "setSelectionPinned(selectionPinned !== true)");
  assertStringIncludes(hero, "pinned={selectionPinned === true}");
  assertStringIncludes(
    note,
    'aria-label={pinned ? "Unpin selection" : "Pin selection"}',
  );
  assertStringIncludes(note, "whiteboardNotePin({ pressed: pinned })");
  assertStringIncludes(note, 'data-pinned={pinned ? "true" : "false"}');
  assertEquals(note.includes("openViewer("), false);
});

Deno.test("hull row activation goes through the shared selection reducer", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const activate = hero.slice(
    hero.indexOf("onActivateHullRow={(row, groupKey) => {"),
    hero.indexOf("nodesByKey={nodesByKey}"),
  );
  assertStringIncludes(activate, "activateOverviewHullRow(row, {");
  assertStringIncludes(activate, 'type: "row-activated"');
  assertStringIncludes(activate, "selectNode: (nodeKey) =>");
  assertStringIncludes(activate, "openSession: (_sessionId, nodeKey) =>");
  assertStringIncludes(activate, "openCurrentBrief: () =>");
  assertEquals(activate.includes("nativeAction"), false);
  assertEquals(activate.includes("setSelectedKey("), false);
  assertEquals(activate.includes("setSelectedRowKey("), false);
});

Deno.test("hero does not force-select hull rows without an exact single action", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const activate = hero.slice(
    hero.indexOf("onActivateHullRow={(row, groupKey) => {"),
    hero.indexOf("nodesByKey={nodesByKey}"),
  );
  assertStringIncludes(activate, "activateOverviewHullRow(row, {");
  assertStringIncludes(activate, 'type: "row-activated"');
  assertEquals(activate.includes("overviewHullRowActions(row)"), false);
  assertEquals(activate.includes("length !== 1"), false);
  const afterActivate = activate.slice(
    activate.indexOf("activateOverviewHullRow(row, {"),
  );
  const afterActivateCall = afterActivate.slice(
    afterActivate.indexOf("});") + 3,
  );
  assertEquals(afterActivateCall.includes("apply("), false);
  assertEquals(afterActivateCall.includes("row-activated"), false);
});

Deno.test("selection note placement reserves the live layout toolbar", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const from = 'from "./overview/whiteboard/index.ts"';
  const importBlock = hero.slice(
    hero.lastIndexOf("import {", hero.indexOf(from)),
    hero.indexOf(from) + from.length + 1,
  );
  assertStringIncludes(importBlock, "OVERVIEW_SELECTION_NOTE_TOP_MARGIN");
  assertStringIncludes(importBlock, "OVERVIEW_SELECTION_NOTE_GAP");
  assertStringIncludes(importBlock, "placeOverviewSelectionNote");
  assertEquals(importBlock.includes("113"), false);

  const placement = hero.slice(
    hero.indexOf("function readOverviewSelectionNotePlacement("),
    hero.indexOf("function overviewSelectionNoteStyle("),
  );
  assertStringIncludes(
    placement,
    'host.querySelector(".overview-thread-layout-switch")',
  );
  assertStringIncludes(placement, "OVERVIEW_SELECTION_NOTE_TOP_MARGIN");
  assertStringIncludes(placement, "OVERVIEW_SELECTION_NOTE_GAP");
  assertStringIncludes(
    placement,
    "toolbarBox.bottom - viewportBox.top + OVERVIEW_SELECTION_NOTE_GAP",
  );
  assertStringIncludes(placement, "topMargin");
  assertStringIncludes(placement, "placeOverviewSelectionNote({");
  assertEquals(placement.includes("113"), false);
});

Deno.test("structured hull row click and keyboard activate; context menu does not", async () => {
  const flow = await Deno.readTextFile(
    new URL("./src/project/overview-thread-d3-flow.tsx", import.meta.url),
  );
  const start = flow.indexOf("function FlowStructureRow(");
  const end = flow.indexOf("function FlowNode(", start);
  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  const structure = flow.slice(start, end);
  assertStringIncludes(
    structure,
    "onClick={() => onActivateHullRow?.(row, group.key)}",
  );
  assertStringIncludes(
    structure,
    "onActivate: () => onActivateHullRow?.(row, group.key)",
  );
  assertStringIncludes(structure, "data-native-action={row.nativeAction}");
  assertEquals(structure.includes("onContextMenu"), false);
  assertEquals(structure.includes("DropdownMenuContextTrigger"), true);
});
