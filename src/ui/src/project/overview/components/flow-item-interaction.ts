import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  isFlowMoveDirection,
  type OverviewThreadD3FlowMoveDirection,
} from "../flow/geometry.ts";

/** Shared canvas shortcuts for raw FlowNodes and structured rows. */
export const FLOW_ITEM_KEYSHORTCUTS =
  "ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10";

export type FlowItemVisualState =
  | "selected"
  | "related"
  | "muted"
  | "default";

export function flowItemVisualState(
  inspectionActive: boolean,
  related: boolean,
  inspecting = false,
): FlowItemVisualState {
  if (inspectionActive) return "selected";
  if (!inspecting) return "default";
  return related ? "related" : "muted";
}

export function flowItemTabIndex(focused: boolean): 0 | -1 {
  return focused ? 0 : -1;
}

export function handleFlowItemKeyDown(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  handlers: {
    readonly onActivate: () => void;
    readonly onMove?: (direction: OverviewThreadD3FlowMoveDirection) => void;
  },
): void {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    handlers.onActivate();
    return;
  }
  if (handlers.onMove && isFlowMoveDirection(event.key)) {
    event.preventDefault();
    handlers.onMove(event.key);
  }
}
