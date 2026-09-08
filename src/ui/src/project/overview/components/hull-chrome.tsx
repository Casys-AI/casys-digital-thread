import {
  whiteboardHullFold,
  whiteboardHullMonitorChip,
} from "../../../ui/whiteboard.ts";
import { cn } from "../../../lib/utils.ts";
import type {
  CSSProperties,
  JSX,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { overviewGroupCaption } from "../../overview-thread-hero-model.ts";
import type { OverviewThreadD3FlowGroupLayout } from "../../overview-thread-d3-flow-layout.ts";
import {
  FLOW_HULL_MARGIN,
  flowHeightPercent,
  flowWidthPercent,
  flowXPercent,
  flowYPercent,
} from "../flow/geometry.ts";

export function flowGroupCaption(
  group: OverviewThreadD3FlowGroupLayout,
): string {
  return overviewGroupCaption(group.groupKey, group.lane);
}

export function OverviewFlowGroupBand(
  {
    group,
    viewBox,
    color,
    hierarchyPending = false,
    status,
    onScrollRows,
    children,
  }: {
    readonly group: OverviewThreadD3FlowGroupLayout;
    readonly viewBox: readonly [number, number, number, number];
    readonly color: string;
    readonly hierarchyPending?: boolean;
    readonly status?: "active" | "blocked";
    readonly onScrollRows?: (rows: number) => void;
    readonly children: ReactNode;
  },
): JSX.Element {
  return (
    <div
      className={cn("overview-thread-flow-group-band", "group")}
      data-lane={group.lane}
      data-view={group.view}
      data-status={status}
      aria-busy={hierarchyPending || undefined}
      onWheel={onScrollRows && group.view !== "matrix" &&
          !group.collapsed
        ? (event) => {
          if (group.rowCount <= group.visibleRows * group.columns) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          onScrollRows(event.deltaY > 0 ? 1 : -1);
        }
        : undefined}
      data-collapsed={group.collapsed ? "true" : "false"}
      style={{
        "--flow-x": flowXPercent(
          group.x + group.width / 2,
          viewBox,
        ),
        "--flow-y": flowYPercent(
          group.y - FLOW_HULL_MARGIN +
            (group.headerHeight + FLOW_HULL_MARGIN) / 2,
          viewBox,
        ),
        "--hull-width": flowWidthPercent(
          group.width + FLOW_HULL_MARGIN * 2,
          viewBox,
        ),
        "--hull-header": flowHeightPercent(
          group.headerHeight + FLOW_HULL_MARGIN,
          viewBox,
        ),
        "--flow-color": color,
      } as CSSProperties}
    >
      {children}
    </div>
  );
}

export function OverviewFlowGroupFold(
  {
    group,
    caption,
    onToggle,
  }: {
    readonly group: OverviewThreadD3FlowGroupLayout;
    readonly caption: string;
    readonly onToggle: () => void;
  },
): JSX.Element {
  return (
    <button
      type="button"
      className={cn("overview-thread-flow-group-fold", whiteboardHullFold)}
      aria-label={`${group.collapsed ? "Unfold" : "Fold"} ${caption} hull`}
      aria-expanded={!group.collapsed}
      title={group.collapsed ? "Déplier" : "Plier"}
      onClick={onToggle}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {group.collapsed ? "▸" : "▾"}
    </button>
  );
}

export function OverviewFlowGroupFoot(
  {
    group,
    viewBox,
    color,
  }: {
    readonly group: OverviewThreadD3FlowGroupLayout;
    readonly viewBox: readonly [number, number, number, number];
    readonly color: string;
  },
): JSX.Element {
  return (
    <div
      className="overview-thread-flow-group-foot"
      data-lane={group.lane}
      style={{
        "--flow-x": flowXPercent(
          group.x + group.width / 2,
          viewBox,
        ),
        "--flow-y": flowYPercent(
          group.y + group.height - group.footerHeight / 2,
          viewBox,
        ),
        "--hull-width": flowWidthPercent(
          group.width + FLOW_HULL_MARGIN * 2,
          viewBox,
        ),
        "--flow-color": color,
      } as CSSProperties}
    >
      {Math.min(group.visibleRows * group.columns, group.rowCount)}
      {" / "}
      {group.rowCount}
      {group.structureRowCount && " éléments"}
      {group.rowCount > group.visibleRows * group.columns &&
        " — molette dans le hull"}
    </div>
  );
}

export function OverviewFlowGroupMonitor(
  {
    group,
    viewBox,
    color,
    liveCount,
    failed,
    countLabel,
    counts,
  }: {
    readonly group: OverviewThreadD3FlowGroupLayout;
    readonly viewBox: readonly [number, number, number, number];
    readonly color: string;
    readonly liveCount: number;
    readonly failed: boolean;
    readonly countLabel?: string;
    readonly counts?: readonly {
      readonly key: string;
      readonly value: number;
    }[];
  },
): JSX.Element {
  return (
    <span
      className={cn(
        "overview-thread-flow-group-monitor",
        whiteboardHullMonitorChip,
      )}
      data-alert={failed ? "true" : "false"}
      {...Object.fromEntries(
        (counts ?? []).map((item) => [
          `data-hull-count-${item.key}`,
          String(item.value),
        ]),
      )}
      style={{
        "--flow-x": flowXPercent(
          group.x + group.width,
          viewBox,
        ),
        "--flow-y": flowYPercent(group.y, viewBox),
        "--flow-color": color,
      } as CSSProperties}
    >
      <i aria-hidden="true" />
      {countLabel ?? group.rowCount}
      {liveCount > 0 && ` · ${liveCount} live`}
      {failed && " · ⚠"}
    </span>
  );
}

export function OverviewFlowGroupResize(
  {
    group,
    viewBox,
    caption,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  }: {
    readonly group: OverviewThreadD3FlowGroupLayout;
    readonly viewBox: readonly [number, number, number, number];
    readonly caption: string;
    readonly onPointerDown: (event: ReactPointerEvent<Element>) => void;
    readonly onPointerMove: (event: ReactPointerEvent<Element>) => void;
    readonly onPointerUp: (event: ReactPointerEvent<Element>) => void;
    readonly onPointerCancel: (event: ReactPointerEvent<Element>) => void;
    readonly onLostPointerCapture: (event: ReactPointerEvent<Element>) => void;
  },
): JSX.Element {
  return (
    <button
      type="button"
      className="overview-thread-flow-group-resize"
      aria-label={`Resize ${caption} hull`}
      tabIndex={-1}
      style={{
        "--flow-x": flowXPercent(
          group.x + group.width,
          viewBox,
        ),
        "--flow-y": flowYPercent(
          group.y + group.height,
          viewBox,
        ),
      } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
    />
  );
}
