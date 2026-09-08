import { overviewInspectionRelatedGraphKeys } from "../../overview-thread-inspection.ts";
import {
  flowSegmentPaintRank,
  flowSegmentState,
} from "../../overview-thread-d3-flow-highlight.ts";
import type {
  OverviewThreadD3FlowLayout,
  OverviewThreadD3FlowPoint,
  OverviewThreadD3FlowSegmentLayout,
} from "../../overview-thread-d3-flow-layout.ts";
import { nonNegativeFinite } from "./geometry.ts";

export type OverviewFlowSegmentState =
  import("../../overview-thread-d3-flow-highlight.ts").OverviewFlowSegmentHighlightState;

export interface OverviewFlowSegmentPresentation {
  readonly segment: OverviewThreadD3FlowSegmentLayout;
  readonly state: OverviewFlowSegmentState;
  readonly connectedToDrag: boolean;
}

export interface OverviewFlowSegmentElement {
  readonly path: SVGPathElement;
  presentation?: OverviewFlowSegmentPresentation;
  renderedD?: string;
  renderedWidth?: string;
  renderedPresence?: string;
}

export function overviewFlowVisualSegments(
  layout: OverviewThreadD3FlowLayout,
): readonly OverviewThreadD3FlowSegmentLayout[] {
  const extended = layout as OverviewThreadD3FlowLayout & {
    readonly corridors?: readonly OverviewThreadD3FlowSegmentLayout[];
  };
  if (!extended.corridors || extended.corridors.length === 0) {
    return layout.segments;
  }
  const byKey = new Map(
    [...extended.corridors, ...layout.segments].map((segment) => [
      segment.key,
      segment,
    ]),
  );
  return [...byKey.values()];
}

export function canonicalOverviewFlowMotionPoints(
  segment: OverviewThreadD3FlowSegmentLayout,
  layout: OverviewThreadD3FlowLayout,
): readonly OverviewThreadD3FlowPoint[] {
  if (segment.kind !== "same-lane-trunk" || segment.points.length < 2) {
    return segment.points;
  }
  const first = segment.points[0]!;
  const last = segment.points.at(-1)!;
  const firstGroup = layout.groups.find((group) =>
    sameOverviewFlowPoint(group.outHub, first) ||
    sameOverviewFlowPoint(group.inHub, first)
  );
  const lastGroup = layout.groups.find((group) =>
    sameOverviewFlowPoint(group.outHub, last) ||
    sameOverviewFlowPoint(group.inHub, last)
  );
  return firstGroup && lastGroup &&
      firstGroup.key.localeCompare(lastGroup.key) > 0
    ? segment.points.toReversed()
    : segment.points;
}

function sameOverviewFlowPoint(
  left: OverviewThreadD3FlowPoint,
  right: OverviewThreadD3FlowPoint,
): boolean {
  return left.x === right.x && left.y === right.y;
}

export function applyOverviewFlowSegmentPresentation(
  path: SVGPathElement,
  presentation: OverviewFlowSegmentPresentation,
): void {
  path.dataset.kind = presentation.segment.kind;
  path.dataset.role = presentation.segment.role;
  path.dataset.direction = presentation.segment.direction;
  path.dataset.state = presentation.state;
  path.dataset.dragRoute = presentation.connectedToDrag ? "connected" : "idle";
  if (presentation.segment.dock) {
    path.dataset.dock = presentation.segment.dock;
  } else {
    delete path.dataset.dock;
  }
}

export function formatOverviewFlowMotionNumber(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

export function segmentTouchesKeys(
  segment: OverviewThreadD3FlowSegmentLayout,
  keys: ReadonlySet<string>,
): boolean {
  if (keys.size === 0) return false;
  return segment.fromKeys.some((key) => keys.has(key)) ||
    segment.toKeys.some((key) => keys.has(key));
}

export function overviewFlowSegmentPresentations(
  layout: OverviewThreadD3FlowLayout,
  activeKey: string | undefined,
  movingNodeKeys: ReadonlySet<string>,
  dragging: boolean,
  activeKeys: readonly string[] = [],
  muteUnmatched = false,
): readonly OverviewFlowSegmentPresentation[] {
  return overviewFlowVisualSegments(layout).map((segment) => ({
    segment,
    state: flowSegmentState(
      segment,
      activeKey,
      activeKeys,
      layout.routes,
      muteUnmatched,
    ),
    connectedToDrag: dragging && segmentTouchesKeys(segment, movingNodeKeys),
  })).toSorted((left, right) =>
    flowSegmentPaintRank(left.state) - flowSegmentPaintRank(right.state) ||
    left.segment.key.localeCompare(right.segment.key)
  );
}

export function flowSegmentWidth(
  segment: OverviewThreadD3FlowSegmentLayout,
): number {
  return nonNegativeFinite(segment.width);
}

export function flowRelatedNodeKeys(
  layout: OverviewThreadD3FlowLayout,
  activeKeys: readonly string[],
): ReadonlySet<string> {
  return overviewInspectionRelatedGraphKeys(layout.routes, activeKeys);
}
