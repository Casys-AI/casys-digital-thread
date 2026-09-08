/**
 * Transient selection-note geometry and pointer click-vs-pan.
 *
 * Presentation only. These numbers never become Thread identities or
 * persisted whiteboard state.
 */

export interface OverviewSelectionNoteRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverviewSelectionNotePlacement {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly maxHeight: number;
}

export const OVERVIEW_SELECTION_NOTE_WIDTH = 300;
export const OVERVIEW_SELECTION_NOTE_GAP = 12;
export const OVERVIEW_SELECTION_NOTE_MARGIN = 12;
export const OVERVIEW_SELECTION_NOTE_TOP_MARGIN = 48;
export const OVERVIEW_CANVAS_PAN_CLICK_SLOP_PX = 6;

export function overviewCanvasPointerBecamePan(
  start: { readonly x: number; readonly y: number },
  current: { readonly x: number; readonly y: number },
  slop = OVERVIEW_CANVAS_PAN_CLICK_SLOP_PX,
): boolean {
  return Math.hypot(current.x - start.x, current.y - start.y) >= slop;
}

export function overviewSelectionNoteAnchorFromRects(
  host: { readonly left: number; readonly top: number },
  anchor: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  },
): OverviewSelectionNoteRect {
  return {
    x: anchor.left - host.left,
    y: anchor.top - host.top,
    width: anchor.width,
    height: anchor.height,
  };
}

export function placeOverviewSelectionNote(input: {
  readonly host: { readonly width: number; readonly height: number };
  readonly anchor: OverviewSelectionNoteRect;
  readonly note: { readonly width?: number; readonly height: number };
  readonly gap?: number;
  readonly margin?: number;
  readonly topMargin?: number;
}): OverviewSelectionNotePlacement {
  const margin = input.margin ?? OVERVIEW_SELECTION_NOTE_MARGIN;
  const topMargin = input.topMargin ?? OVERVIEW_SELECTION_NOTE_TOP_MARGIN;
  const gap = input.gap ?? OVERVIEW_SELECTION_NOTE_GAP;
  const width = Math.min(
    input.note.width ?? OVERVIEW_SELECTION_NOTE_WIDTH,
    Math.max(0, input.host.width - margin * 2),
  );
  const maxHeight = Math.max(0, input.host.height - topMargin - margin);
  const height = Math.min(input.note.height, maxHeight);
  const minLeft = margin;
  const maxLeft = Math.max(minLeft, input.host.width - margin - width);
  const minTop = topMargin;
  const maxTop = Math.max(minTop, input.host.height - margin - height);

  const rightLeft = input.anchor.x + input.anchor.width + gap;
  const leftLeft = input.anchor.x - gap - width;
  const belowTop = input.anchor.y + input.anchor.height + gap;
  const aboveTop = input.anchor.y - gap - height;
  const alignedTop = clamp(input.anchor.y, minTop, maxTop);
  const alignedLeft = clamp(input.anchor.x, minLeft, maxLeft);

  const fitsRight = rightLeft <= maxLeft;
  const fitsLeft = leftLeft >= minLeft;
  if (fitsRight || fitsLeft) {
    return {
      top: alignedTop,
      left: fitsRight ? rightLeft : leftLeft,
      width,
      maxHeight: remainingMaxHeight(input.host.height, alignedTop, margin),
    };
  }

  const fitsBelow = belowTop <= maxTop;
  const fitsAbove = aboveTop >= minTop;
  if (fitsBelow || fitsAbove) {
    const top = fitsBelow ? belowTop : aboveTop;
    return {
      top,
      left: alignedLeft,
      width,
      maxHeight: remainingMaxHeight(input.host.height, top, margin),
    };
  }

  const roomRight = input.host.width - margin - rightLeft - width;
  const roomLeft = leftLeft - margin;
  const left = roomRight >= roomLeft
    ? clamp(rightLeft, minLeft, maxLeft)
    : clamp(leftLeft, minLeft, maxLeft);
  return {
    top: alignedTop,
    left,
    width,
    maxHeight: remainingMaxHeight(input.host.height, alignedTop, margin),
  };
}

function remainingMaxHeight(
  hostHeight: number,
  top: number,
  margin: number,
): number {
  return Math.max(0, hostHeight - margin - top);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
