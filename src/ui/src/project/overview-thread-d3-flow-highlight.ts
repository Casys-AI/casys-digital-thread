import type { OverviewThreadD3FlowSegmentLayout } from "./overview-thread-d3-flow-layout.ts";

export type OverviewFlowSegmentHighlightState =
  | "default"
  | "emphasis"
  | "incoming"
  | "outgoing"
  | "muted";

/**
 * Lights the complete branch → shared trunk → far branch chain of every
 * exact route that names the hovered or selected endpoint. Unrelated
 * bundle members stay muted.
 */
export function flowSegmentState(
  segment: OverviewThreadD3FlowSegmentLayout,
  activeKey: string | undefined,
  activeKeys: readonly string[] = [],
  routes: readonly {
    readonly fromKey: string;
    readonly toKey: string;
    readonly segmentKeys: readonly string[];
  }[] = [],
  muteUnmatched = false,
): OverviewFlowSegmentHighlightState {
  const keys = activeKey ? [activeKey, ...activeKeys] : activeKeys;
  if (keys.length === 0) {
    if (muteUnmatched) return "muted";
    return segment.emphasis ? "emphasis" : "default";
  }
  const keySet = new Set(keys);
  let outgoing = segment.fromKeys.some((key) => keySet.has(key));
  let incoming = segment.toKeys.some((key) => keySet.has(key));
  for (const route of routes) {
    if (!route.segmentKeys.includes(segment.key)) continue;
    if (keySet.has(route.fromKey)) outgoing = true;
    if (keySet.has(route.toKey)) incoming = true;
  }
  if (outgoing) return "outgoing";
  if (incoming) return "incoming";
  return "muted";
}

export function flowSegmentPaintRank(
  state: OverviewFlowSegmentHighlightState,
): number {
  if (state === "muted") return 0;
  if (state === "incoming" || state === "outgoing") return 2;
  return 1;
}
