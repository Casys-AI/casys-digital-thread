/** Canvas-percent helpers and hull-size constants for the whiteboard flow. */

export type OverviewThreadD3FlowMoveDirection =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export const FLOW_HULL_MINIMUM_WIDTH = 24;
/** Drawn hull bleeds this far past the layout box on every side. */
export const FLOW_HULL_MARGIN = 7;
export const FLOW_HULL_MINIMUM_HEIGHT = 28;
export const FLOW_KEYBOARD_MOVE_STEP = 12;
export const FLOW_PRACTICAL_WORLD_LIMIT = 10_000_000;

export function flowXPercent(
  x: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${((x - viewBox[0]) / viewBox[2]) * 100}%`;
}

export function flowWidthPercent(
  width: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${(width / viewBox[2]) * 100}%`;
}

export function flowHeightPercent(
  height: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${(height / viewBox[3]) * 100}%`;
}

export function flowYPercent(
  y: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${((y - viewBox[1]) / viewBox[3]) * 100}%`;
}

export function isFlowMoveDirection(
  key: string,
): key is OverviewThreadD3FlowMoveDirection {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" ||
    key === "ArrowRight";
}

export function flowKeyboardMoveDelta(
  direction: OverviewThreadD3FlowMoveDirection,
): { readonly x: number; readonly y: number } {
  if (direction === "ArrowUp") {
    return { x: 0, y: -FLOW_KEYBOARD_MOVE_STEP };
  }
  if (direction === "ArrowDown") {
    return { x: 0, y: FLOW_KEYBOARD_MOVE_STEP };
  }
  if (direction === "ArrowLeft") {
    return { x: -FLOW_KEYBOARD_MOVE_STEP, y: 0 };
  }
  return { x: FLOW_KEYBOARD_MOVE_STEP, y: 0 };
}

export function clampNumber(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
