import { assertEquals } from "@std/assert";
import {
  OVERVIEW_CANVAS_PAN_CLICK_SLOP_PX,
  OVERVIEW_SELECTION_NOTE_GAP,
  OVERVIEW_SELECTION_NOTE_TOP_MARGIN,
  overviewCanvasPointerBecamePan,
  overviewSelectionNoteAnchorFromRects,
  placeOverviewSelectionNote,
} from "./src/project/overview/whiteboard/selection-interaction.ts";
import {
  createOverviewWhiteboardControllerState,
  nextOverviewHeroSelection,
  reduceOverviewWhiteboard,
} from "./src/project/overview/whiteboard/state.ts";
import { overviewWhiteboardPersistedState } from "./src/project/overview/whiteboard/viewers.ts";

const NODE_A = "artifact:a";
const NODE_B = "artifact:b";
const ROW_A = 'hull-row:["group:build","root"]';
const ROW_B = 'hull-row:["group:build","child"]';

Deno.test("selection note opens to the right of the clicked row when it fits", () => {
  const placement = placeOverviewSelectionNote({
    host: { width: 1000, height: 800 },
    anchor: { x: 120, y: 180, width: 48, height: 22 },
    note: { height: 240 },
  });
  assertEquals(placement.left, 180);
  assertEquals(placement.top, 180);
  assertEquals(placement.width, 300);
  assertEquals(placement.maxHeight, 608);
});

Deno.test("selection note flips left of the clicked row when the right side overflows", () => {
  const placement = placeOverviewSelectionNote({
    host: { width: 1000, height: 800 },
    anchor: { x: 720, y: 200, width: 40, height: 20 },
    note: { height: 240 },
  });
  assertEquals(placement.left, 408);
  assertEquals(placement.top, 200);
});

Deno.test("selection note stays fully inside the host when the row is near an edge", () => {
  const placement = placeOverviewSelectionNote({
    host: { width: 420, height: 320 },
    anchor: { x: 8, y: 280, width: 36, height: 18 },
    note: { width: 300, height: 260 },
  });
  assertEquals(placement.left >= 12, true);
  assertEquals(placement.left + placement.width <= 408, true);
  assertEquals(placement.top >= 48, true);
  assertEquals(placement.top + 260 <= 320, true);
  assertEquals(placement.maxHeight, 320 - 12 - placement.top);
});

Deno.test("selection note topMargin reserves the measured toolbar, not a magic offset", () => {
  const viewport = { top: 8, width: 1000, height: 720 };
  const toolbar = { bottom: 96 };
  const topMargin = Math.max(
    OVERVIEW_SELECTION_NOTE_TOP_MARGIN,
    toolbar.bottom - viewport.top + OVERVIEW_SELECTION_NOTE_GAP,
  );
  assertEquals(
    topMargin,
    toolbar.bottom - viewport.top + OVERVIEW_SELECTION_NOTE_GAP,
  );
  assertEquals(topMargin >= OVERVIEW_SELECTION_NOTE_TOP_MARGIN, true);

  const shallowMargin = Math.max(
    OVERVIEW_SELECTION_NOTE_TOP_MARGIN,
    viewport.top + 10 - viewport.top + OVERVIEW_SELECTION_NOTE_GAP,
  );
  assertEquals(shallowMargin, OVERVIEW_SELECTION_NOTE_TOP_MARGIN);

  const placement = placeOverviewSelectionNote({
    host: { width: viewport.width, height: viewport.height },
    anchor: { x: 140, y: 16, width: 40, height: 20 },
    note: { height: 220 },
    topMargin,
  });
  assertEquals(placement.top >= topMargin, true);

  const unreserved = placeOverviewSelectionNote({
    host: { width: viewport.width, height: viewport.height },
    anchor: { x: 140, y: 16, width: 40, height: 20 },
    note: { height: 220 },
  });
  assertEquals(unreserved.top < topMargin, true);
  assertEquals(unreserved.top, OVERVIEW_SELECTION_NOTE_TOP_MARGIN);
});

Deno.test("selection note anchor is measured from the actual host and row boxes", () => {
  assertEquals(
    overviewSelectionNoteAnchorFromRects(
      { left: 40, top: 80 },
      { left: 160, top: 140, width: 50, height: 24 },
    ),
    { x: 120, y: 60, width: 50, height: 24 },
  );
});

Deno.test("pointer travel below the slop stays a click; travel at the slop is a pan", () => {
  assertEquals(
    overviewCanvasPointerBecamePan({ x: 10, y: 10 }, { x: 14, y: 12 }),
    false,
  );
  assertEquals(
    overviewCanvasPointerBecamePan(
      { x: 10, y: 10 },
      { x: 10 + OVERVIEW_CANVAS_PAN_CLICK_SLOP_PX, y: 10 },
    ),
    true,
  );
});

Deno.test("canvas-cleared drops an unpinned selection and keeps a pinned one", () => {
  const selected = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "selection-toggled", key: NODE_A },
  );
  const cleared = reduceOverviewWhiteboard(selected, {
    type: "canvas-cleared",
  });
  assertEquals(cleared.presentation.selectedKey, undefined);
  assertEquals(cleared.presentation.selectedRowKey, undefined);
  assertEquals(cleared.presentation.selectionPinned, undefined);

  const pinned = reduceOverviewWhiteboard(selected, {
    type: "selection-pin-changed",
    pinned: true,
  });
  assertEquals(pinned.presentation.selectionPinned, true);
  const afterBackground = reduceOverviewWhiteboard(pinned, {
    type: "canvas-cleared",
  });
  assertEquals(afterBackground.presentation.selectedKey, NODE_A);
  assertEquals(afterBackground.presentation.selectionPinned, true);
  assertEquals(afterBackground.presentation.hoveredKey, undefined);
});

Deno.test("transform-changed never clears selection as a pan side effect", () => {
  let state = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "selection-toggled", key: NODE_A },
  );
  state = reduceOverviewWhiteboard(state, {
    type: "selection-pin-changed",
    pinned: true,
  });
  const panned = reduceOverviewWhiteboard(state, {
    type: "transform-changed",
    transform: { x: -80, y: 24, k: 1.2 },
    touched: true,
  });
  assertEquals(panned.presentation.selectedKey, NODE_A);
  assertEquals(panned.presentation.selectionPinned, true);
});

Deno.test("pin lifecycle keeps the same record until close, new selection, or unpin", () => {
  const selected = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "selection-toggled", key: NODE_A },
  );
  const pinned = reduceOverviewWhiteboard(selected, {
    type: "selection-pin-changed",
    pinned: true,
  });
  const sameClick = reduceOverviewWhiteboard(pinned, {
    type: "selection-toggled",
    key: NODE_A,
  });
  assertEquals(sameClick.presentation.selectedKey, NODE_A);
  assertEquals(sameClick.presentation.selectionPinned, true);

  const nextRecord = reduceOverviewWhiteboard(pinned, {
    type: "selection-toggled",
    key: NODE_B,
  });
  assertEquals(nextRecord.presentation.selectedKey, NODE_B);
  assertEquals(nextRecord.presentation.selectionPinned, undefined);

  const closed = reduceOverviewWhiteboard(pinned, {
    type: "selection-closed",
  });
  assertEquals(closed.presentation.selectedKey, undefined);
  assertEquals(closed.presentation.selectionPinned, undefined);

  const unpinned = reduceOverviewWhiteboard(pinned, {
    type: "selection-pin-changed",
    pinned: false,
  });
  assertEquals(unpinned.presentation.selectionPinned, undefined);
  const toggledOff = reduceOverviewWhiteboard(unpinned, {
    type: "selection-toggled",
    key: NODE_A,
  });
  assertEquals(toggledOff.presentation.selectedKey, undefined);
});

Deno.test("pinned row selection does not toggle off; a new row unpins", () => {
  const selected = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "row-activated", rowKey: ROW_A, mappedKey: NODE_A },
  );
  assertEquals(selected.presentation.selectedRowKey, ROW_A);
  assertEquals(selected.presentation.selectedKey, NODE_A);
  const pinned = reduceOverviewWhiteboard(selected, {
    type: "selection-pin-changed",
    pinned: true,
  });
  const sameRow = reduceOverviewWhiteboard(pinned, {
    type: "row-activated",
    rowKey: ROW_A,
    mappedKey: NODE_A,
  });
  assertEquals(sameRow.presentation.selectedRowKey, ROW_A);
  assertEquals(sameRow.presentation.selectionPinned, true);

  const nextRow = reduceOverviewWhiteboard(pinned, {
    type: "row-activated",
    rowKey: ROW_B,
    mappedKey: NODE_B,
  });
  assertEquals(nextRow.presentation.selectedRowKey, ROW_B);
  assertEquals(nextRow.presentation.selectedKey, NODE_B);
  assertEquals(nextRow.presentation.selectionPinned, undefined);
});

Deno.test("pin cannot attach to an empty selection and is not persisted", () => {
  const empty = reduceOverviewWhiteboard(
    createOverviewWhiteboardControllerState(),
    { type: "selection-pin-changed", pinned: true },
  );
  assertEquals(empty.presentation.selectionPinned, undefined);
  const selected = reduceOverviewWhiteboard(empty, {
    type: "selection-toggled",
    key: NODE_A,
  });
  const pinned = reduceOverviewWhiteboard(selected, {
    type: "selection-pin-changed",
    pinned: true,
  });
  const persisted = overviewWhiteboardPersistedState(pinned.presentation);
  assertEquals("selectionPinned" in persisted, false);
  assertEquals(nextOverviewHeroSelection(NODE_A, NODE_A), undefined);
  assertEquals(nextOverviewHeroSelection(NODE_A, NODE_A, true), NODE_A);
});
