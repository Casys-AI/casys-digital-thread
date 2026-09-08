import {
  whiteboardFlowItem,
  whiteboardFlowItemPart,
  whiteboardHullControl,
  whiteboardHullViewSelect,
} from "../ui/whiteboard.ts";
import { cn } from "../lib/utils.ts";
import type {
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { EngineeringPhaseStatus } from "../../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import type { OverviewHeroNode } from "./overview-thread-hero-model.ts";
import type { OverviewThreadD3FlowHullView } from "./overview-thread-d3-flow-layout.ts";
import {
  type OverviewThreadD3FlowGroupLayout,
  type OverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowNodeLayout,
  type OverviewThreadD3FlowSegmentLayout,
} from "./overview-thread-d3-flow-layout.ts";
import {
  overviewThreadHullControlsVisible,
  overviewThreadHullLabel,
  overviewThreadHullLabelBudget,
} from "./overview-thread-hull-model.ts";
import {
  overviewThreadGroupContextValue,
  overviewThreadNodeContextValue,
} from "./overview-thread-context-target.ts";
import { DropdownMenuContextTrigger } from "../ui/dropdown-menu.tsx";
import {
  layoutOverviewHullHierarchyLinks,
  layoutOverviewHullRowCells,
  layoutOverviewHullRows,
  type OverviewHullRowLayout,
} from "./overview/hulls/row-layout.ts";
import {
  type OverviewHullContent,
  type OverviewHullContentRow,
  overviewHullGraphKeysByPresentationRow,
  overviewHullHierarchyLinkState,
  overviewHullPresentationRowKey,
  overviewHullRowGraphRefs,
  overviewHullRowPresentation,
  overviewHullRowPrimaryGraphRef,
  overviewHullRowTooltip,
} from "./overview/hulls/index.ts";
import { overviewActivityStatusCaption } from "./overview/activity-status-caption.ts";
import { overviewDomainGroupColor } from "./overview/hulls/domain-groups.ts";
import { flowSegmentPaintRank } from "./overview-thread-d3-flow-highlight.ts";
import {
  overviewEffectiveInspection,
  overviewInspectionIsRelatedRow,
  overviewInspectionIsVisualTarget,
  overviewInspectionPresentationRowKey,
  type OverviewInspectionTarget,
} from "./overview-thread-inspection.ts";
import {
  clampNumber,
  FLOW_HULL_MARGIN,
  FLOW_HULL_MINIMUM_HEIGHT,
  FLOW_HULL_MINIMUM_WIDTH,
  FLOW_PRACTICAL_WORLD_LIMIT,
  flowHeightPercent,
  flowKeyboardMoveDelta,
  flowWidthPercent,
  flowXPercent,
  flowYPercent,
  isFlowMoveDirection,
  type OverviewThreadD3FlowMoveDirection,
} from "./overview/flow/geometry.ts";
import {
  overviewFlowMotionGeometrySettled,
  overviewFlowMotionPath,
  OverviewFlowMotionScene,
  overviewFlowMotionTopologySignature,
} from "./overview/flow/motion.ts";
import {
  applyOverviewFlowSegmentPresentation,
  canonicalOverviewFlowMotionPoints,
  flowRelatedNodeKeys,
  flowSegmentWidth,
  formatOverviewFlowMotionNumber,
  type OverviewFlowSegmentElement,
  type OverviewFlowSegmentPresentation,
  overviewFlowSegmentPresentations,
} from "./overview/flow/segments.ts";
import { FlowItemSurface } from "./overview/components/flow-item-surface.tsx";
import { FlowRowBody } from "./overview/components/flow-row-body.tsx";
import {
  FLOW_ITEM_KEYSHORTCUTS,
  flowItemTabIndex,
  flowItemVisualState,
  handleFlowItemKeyDown,
} from "./overview/components/flow-item-interaction.ts";
import {
  flowGroupCaption,
  OverviewFlowGroupBand,
  OverviewFlowGroupFold,
  OverviewFlowGroupFoot,
  OverviewFlowGroupMonitor,
  OverviewFlowGroupResize,
} from "./overview/components/hull-chrome.tsx";

export type { OverviewThreadD3FlowMoveDirection };

export interface OverviewThreadStageSummary {
  readonly lane: EngineeringPathLaneId;
  readonly label: string;
  readonly status: EngineeringPhaseStatus;
  readonly count: string;
}

export interface OverviewThreadD3FlowProps {
  readonly layout: OverviewThreadD3FlowLayout;
  readonly nodesByKey: ReadonlyMap<string, OverviewHeroNode>;
  readonly viewerNodeKeys?: ReadonlySet<string>;
  readonly hullContents?: ReadonlyMap<string, OverviewHullContent>;
  readonly pendingHierarchyGroupKeys?: ReadonlySet<string>;
  readonly rowAnchors?: Readonly<
    Record<string, Readonly<Record<string, number>>>
  >;
  readonly onActivateHullRow?: (
    row: OverviewHullContentRow,
    groupKey: string,
  ) => void;
  readonly selectedRowKey?: string;
  readonly stages?: readonly OverviewThreadStageSummary[];
  readonly showLaneStrip?: boolean;
  readonly activeKey?: string;
  readonly selectedKey?: string;
  readonly hoveredKey?: string;
  readonly focusedKey?: string;
  readonly onHover: (key: string | undefined) => void;
  readonly onFocus: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onMoveGroup?: (
    key: string,
    position: { readonly x: number; readonly y: number },
  ) => void;
  readonly onMoveNode?: (
    key: string,
    delta: { readonly x: number; readonly y: number },
  ) => void;
  /** Resize one hull. The matrix re-flows; no leaf is ever dropped. */
  readonly onResizeGroup?: (
    key: string,
    size: { readonly width: number; readonly height: number },
  ) => void;
  /** Fold or unfold one hull down to its band. */
  readonly onToggleGroupFold?: (key: string) => void;
  /** Choose how one hull presents its contents. */
  readonly onSetGroupView?: (
    key: string,
    view: OverviewThreadD3FlowHullView,
  ) => void;
  /** Cycle the hull's reading order. */
  readonly onCycleGroupSort?: (key: string) => void;
  /** Scroll a listed hull's window, in rows. */
  readonly onScrollGroup?: (key: string, rows: number) => void;
  readonly onMove: (
    key: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly refNode: (key: string, node: HTMLButtonElement | null) => void;
  /** Live board scale: hull controls retract when zoomed out. */
  readonly boardScale?: number;
}

interface OverviewFlowDragState {
  readonly kind: "group" | "node";
  readonly key: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly unitsPerPixelX: number;
  readonly unitsPerPixelY: number;
  appliedX: number;
  appliedY: number;
  pendingX?: number;
  pendingY?: number;
  moved: boolean;
}

interface OverviewFlowResizeState {
  readonly key: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originWidth: number;
  readonly originHeight: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  readonly unitsPerPixelX: number;
  readonly unitsPerPixelY: number;
}

interface OverviewFlowDragTarget {
  readonly kind: OverviewFlowDragState["kind"];
  readonly key: string;
}

const FLOW_DRAG_THRESHOLD_PX = 4;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPrefersReducedMotion);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function readPrefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export type {
  OverviewFlowMotionPointSnapshot,
  OverviewFlowMotionTarget,
  OverviewFlowMotionVisualSnapshot,
} from "./overview/flow/motion.ts";
export {
  advanceOverviewFlowMotionScalar,
  overviewFlowMotionPath,
  OverviewFlowMotionScene,
  overviewFlowMotionTopologySignature,
} from "./overview/flow/motion.ts";
export { flowGroupCaption } from "./overview/components/hull-chrome.tsx";

/**
 * Read-only, left-to-right projection. D3 owns the shared cable geometry and
 * the compact group matrices; the HTML node layer keeps tooltips and focus
 * targets legible when the SVG contracts to a narrow workbench.
 */
export function OverviewThreadD3Flow({
  layout,
  nodesByKey,
  viewerNodeKeys,
  hullContents,
  pendingHierarchyGroupKeys,
  rowAnchors,
  onActivateHullRow,
  selectedRowKey,
  stages = [],
  showLaneStrip = true,
  selectedKey,
  hoveredKey,
  focusedKey,
  onHover,
  onFocus,
  onToggle,
  onMoveGroup,
  onMoveNode,
  onResizeGroup,
  onToggleGroupFold,
  onSetGroupView,
  onCycleGroupSort,
  onScrollGroup,
  onMove,
  refNode,
  boardScale = 1,
}: OverviewThreadD3FlowProps): JSX.Element {
  const titleId = useId();
  const [hoveredRowKey, setHoveredRowKey] = useState<string>();
  const graphKeysByPresentationRow = useMemo(
    () => overviewHullGraphKeysByPresentationRow(hullContents, rowAnchors),
    [rowAnchors, hullContents],
  );
  const inspection = overviewEffectiveInspection({
    hoveredPresentationRowKey: hoveredRowKey,
    selectedPresentationRowKey: selectedRowKey,
    hoveredGraphKey: hoveredKey,
    selectedGraphKey: selectedKey,
    graphKeysByPresentationRow,
  });
  const litRowKey = overviewInspectionPresentationRowKey(
    inspection,
    graphKeysByPresentationRow,
  );
  const descriptionId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<OverviewFlowDragState>();
  const resizeRef = useRef<OverviewFlowResizeState>();
  const dragFrameRef = useRef<number>();
  const suppressedClicksRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState<OverviewFlowDragTarget>();
  const reducedMotion = usePrefersReducedMotion();
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = layout.viewBox;
  // Folder controls are noise at a distance: past this scale they retract and
  // the hull is read by its band alone.
  const controlsVisible = overviewThreadHullControlsVisible(boardScale);
  /** A band narrower than this has room for its name or its controls, not both. */
  const bandFitsControls = (width: number) => width >= 240;
  const relatedKeys = useMemo(
    () => flowRelatedNodeKeys(layout, inspection.graphKeys),
    [inspection.graphKeys, layout],
  );
  const laneColorById = useMemo(
    () => new Map(layout.lanes.map((lane) => [lane.lane, lane.color])),
    [layout.lanes],
  );
  const groupColor = (group: OverviewThreadD3FlowGroupLayout) =>
    overviewDomainGroupColor(
      group.groupKey,
      laneColorById.get(group.lane) ?? "currentColor",
    );
  const stageByLane = useMemo(
    () => new Map(stages.map((stage) => [stage.lane, stage])),
    [stages],
  );
  const activityStatuses = useMemo(
    () => overviewFlowActivityStatuses(hullContents),
    [hullContents],
  );
  // A planned activity already carries its own dashed marker and title. A
  // legend containing only Planned is detached from that work item, while
  // active and blocked entries remain useful board-wide status affordances.
  const notableActivityStatuses = activityStatuses.filter((status) =>
    status !== "planned"
  );
  const movingNodeKeys = useMemo(() => {
    if (!dragging) return new Set<string>();
    if (dragging.kind === "node") return new Set([dragging.key]);
    return new Set(
      layout.groups.find((group) => group.key === dragging.key)?.nodeKeys ?? [],
    );
  }, [dragging, layout.groups]);
  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== undefined) {
        globalThis.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);
  const commitPendingDrag = () => {
    dragFrameRef.current = undefined;
    const drag = dragRef.current;
    if (drag?.pendingX === undefined || drag.pendingY === undefined) return;
    const nextX = drag.pendingX;
    const nextY = drag.pendingY;
    drag.pendingX = undefined;
    drag.pendingY = undefined;
    if (drag.kind === "group") {
      onMoveGroup?.(drag.key, { x: nextX, y: nextY });
    } else {
      onMoveNode?.(drag.key, {
        x: nextX - drag.appliedX,
        y: nextY - drag.appliedY,
      });
    }
    drag.appliedX = nextX;
    drag.appliedY = nextY;
  };
  const beginResize = (
    key: string,
    event: ReactPointerEvent<Element>,
  ) => {
    if (event.button !== 0 || !event.isPrimary || !onResizeGroup) return;
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (!canvasBounds || canvasBounds.width <= 0) return;
    const group = layout.groups.find((candidate) => candidate.key === key);
    if (!group) return;
    event.stopPropagation();
    resizeRef.current = {
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originWidth: group.width,
      originHeight: group.height,
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      unitsPerPixelX: viewBoxWidth / canvasBounds.width,
      unitsPerPixelY: viewBoxHeight / canvasBounds.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<Element>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !onResizeGroup) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onResizeGroup(resize.key, {
      width: Math.max(
        FLOW_HULL_MINIMUM_WIDTH,
        resize.originWidth +
          (event.clientX - resize.startClientX) * resize.unitsPerPixelX,
      ),
      height: Math.max(
        FLOW_HULL_MINIMUM_HEIGHT,
        resize.originHeight +
          (event.clientY - resize.startClientY) * resize.unitsPerPixelY,
      ),
    });
  };

  const endResize = (event: ReactPointerEvent<Element>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    event.stopPropagation();
  };

  const beginDrag = (
    kind: OverviewFlowDragState["kind"],
    key: string,
    event: ReactPointerEvent<Element>,
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (kind === "group" && !onMoveGroup) return;
    if (kind === "node" && !onMoveNode) return;
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (
      !canvasBounds || canvasBounds.width <= 0 || canvasBounds.height <= 0
    ) return;
    const group = layout.groups.find((candidate) =>
      kind === "group"
        ? candidate.key === key
        : candidate.nodeKeys.includes(key)
    );
    if (!group) return;
    const node = kind === "node"
      ? layout.nodes.find((candidate) => candidate.key === key)
      : undefined;
    let originX: number;
    let originY: number;
    let minimumX: number;
    let minimumY: number;
    let maximumX: number;
    let maximumY: number;
    if (kind === "group") {
      originX = group.x;
      originY = group.y;
      minimumX = -FLOW_PRACTICAL_WORLD_LIMIT;
      minimumY = -FLOW_PRACTICAL_WORLD_LIMIT;
      maximumX = FLOW_PRACTICAL_WORLD_LIMIT;
      maximumY = FLOW_PRACTICAL_WORLD_LIMIT;
    } else {
      if (!node) return;
      originX = node.x;
      originY = node.y;
      minimumX = group.x;
      minimumY = group.y + group.headerHeight;
      maximumX = group.x + group.width - node.width;
      maximumY = group.y + group.height - node.height;
    }
    event.stopPropagation();
    dragRef.current = {
      kind,
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX,
      originY,
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      unitsPerPixelX: viewBoxWidth / canvasBounds.width,
      unitsPerPixelY: viewBoxHeight / canvasBounds.height,
      appliedX: originX,
      appliedY: originY,
      moved: false,
    };
    setDragging({ kind, key });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientDeltaX = event.clientX - drag.startClientX;
    const clientDeltaY = event.clientY - drag.startClientY;
    if (
      !drag.moved &&
      Math.hypot(clientDeltaX, clientDeltaY) < FLOW_DRAG_THRESHOLD_PX
    ) return;
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    const nextX = clampNumber(
      drag.originX + clientDeltaX * drag.unitsPerPixelX,
      drag.minimumX,
      drag.maximumX,
    );
    const nextY = clampNumber(
      drag.originY + clientDeltaY * drag.unitsPerPixelY,
      drag.minimumY,
      drag.maximumY,
    );
    if (
      nextX === (drag.pendingX ?? drag.appliedX) &&
      nextY === (drag.pendingY ?? drag.appliedY)
    ) return;
    drag.pendingX = nextX;
    drag.pendingY = nextY;
    if (dragFrameRef.current === undefined) {
      dragFrameRef.current = globalThis.requestAnimationFrame(
        commitPendingDrag,
      );
    }
  };
  const endDrag = (
    event: ReactPointerEvent<Element>,
    suppressClick = true,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (dragFrameRef.current !== undefined) {
      globalThis.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = undefined;
    }
    commitPendingDrag();
    if (suppressClick && drag.moved && drag.kind === "node") {
      suppressedClicksRef.current.add(drag.key);
      globalThis.setTimeout(() => {
        suppressedClicksRef.current.delete(drag.key);
      }, 0);
    }
    dragRef.current = undefined;
    setDragging(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const toggleUnlessDragged = (
    key: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (suppressedClicksRef.current.delete(key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onToggle(key);
  };

  return (
    <section
      className="overview-thread-flow"
      role="group"
      aria-labelledby={`${titleId} ${descriptionId}`}
      data-inspection={inspection.mode}
      data-dragging={dragging ? "true" : "false"}
    >
      <h3 id={titleId} className="overview-thread-flow-sr-only">
        Project digital thread
      </h3>
      <p id={descriptionId} className="overview-thread-flow-sr-only">
        A left-to-right hierarchy from requirements to verdicts. Shared D3 cable
        segments merge related records and reroute while groups or records move.
        Group labels are drag handles and can be moved with the arrow keys.
        Records can be dragged within their group. Use the arrow keys on a
        record to navigate, then Enter or Space to inspect it.
      </p>

      <div
        className={showLaneStrip
          ? "overview-thread-flow-lane-strip"
          : "overview-thread-flow-sr-only"}
        role="list"
        aria-label="Engineering thread stages"
      >
        {layout.lanes.map((lane, index) => {
          const stage = stageByLane.get(lane.lane);
          return (
            <div
              key={lane.lane}
              role="listitem"
              className="overview-thread-flow-lane"
              data-lane={lane.lane}
              data-stage-status={stage?.status}
              style={{
                "--flow-x": flowXPercent(lane.x, layout.viewBox),
                "--flow-color": lane.color,
              } as CSSProperties}
            >
              <span
                className="overview-thread-flow-lane-index"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              {stage
                ? (
                  <span className="overview-thread-flow-lane-copy">
                    <span className="overview-thread-flow-stage-title">
                      {stage.label}
                    </span>
                    <span className="overview-thread-flow-lane-meta">
                      <span className="overview-thread-flow-lane-title">
                        {lane.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="overview-thread-flow-stage-count">
                        {stage.count}
                      </span>
                      <span
                        className="overview-thread-flow-stage-status"
                        data-status={stage.status}
                      >
                        <span
                          className="overview-thread-flow-status-dot"
                          aria-hidden="true"
                        />
                        <span className="overview-thread-flow-status-label">
                          {flowStatusCaption(stage.status)}
                        </span>
                      </span>
                    </span>
                  </span>
                )
                : (
                  <span className="overview-thread-flow-lane-title">
                    {lane.title}
                  </span>
                )}
            </div>
          );
        })}
      </div>

      <div
        ref={canvasRef}
        className="overview-thread-flow-canvas"
        style={{
          aspectRatio: `${viewBoxWidth} / ${viewBoxHeight}`,
        }}
      >
        {notableActivityStatuses.length > 0 && (
          <div
            className="overview-thread-flow-activity-legend"
            role="list"
            aria-label="Project activity status"
          >
            {notableActivityStatuses.map((status) => (
              <span key={status} role="listitem">
                <span
                  className={cn(
                    "overview-thread-flow-activity-key",
                    whiteboardFlowItemPart({
                      part: "legendKey",
                      status: status === "active" || status === "blocked"
                        ? status
                        : undefined,
                    }),
                  )}
                  data-status={status}
                  aria-hidden="true"
                />
                {flowStatusCaption(status)}
              </span>
            ))}
          </div>
        )}
        <svg
          viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          className="overview-thread-flow-svg"
          aria-hidden="true"
          focusable="false"
        >
          <g className="overview-thread-flow-guides">
            {layout.lanes.map((lane) => (
              <line
                key={lane.lane}
                x1={lane.x}
                x2={lane.x}
                y1={viewBoxY}
                y2={viewBoxY + viewBoxHeight}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="overview-thread-flow-groups">
            {layout.groups.map((group) => (
              <DropdownMenuContextTrigger
                key={group.key}
                value={overviewThreadGroupContextValue(group.key)}
                asChild
              >
                <rect
                  x={group.x - FLOW_HULL_MARGIN}
                  y={group.y - FLOW_HULL_MARGIN}
                  width={group.width + FLOW_HULL_MARGIN * 2}
                  height={group.height + FLOW_HULL_MARGIN * 2}
                  rx="12"
                  data-lane={group.lane}
                  data-group-key={group.groupKey}
                  data-view={group.view}
                  data-hierarchy-pending={pendingHierarchyGroupKeys?.has(
                      group.key,
                    )
                    ? "true"
                    : undefined}
                  aria-busy={pendingHierarchyGroupKeys?.has(group.key) ||
                    undefined}
                  data-draggable={onMoveGroup ? "true" : "false"}
                  data-overview-context-target={overviewThreadGroupContextValue(
                    group.key,
                  )}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) =>
                    beginDrag("group", group.key, event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={(event) => endDrag(event, false)}
                  onLostPointerCapture={(event) => endDrag(event, false)}
                />
              </DropdownMenuContextTrigger>
            ))}
          </g>
          <g className="overview-thread-flow-hierarchy-links">
            {layout.groups.flatMap((group) => {
              if (
                !group.structureRowCount || group.collapsed ||
                pendingHierarchyGroupKeys?.has(group.key)
              ) return [];
              const rows = hullContents?.get(group.key)?.rows ?? [];
              const pointSize = group.view === "matrix"
                ? layout.nodes.find((node) => node.key === group.nodeKeys[0])
                  ?.width
                : undefined;
              return (
                <g key={group.key}>
                  {layoutOverviewHullHierarchyLinks(rows, group, pointSize)
                    .map((link) => (
                      <path
                        key={`${group.key}:${link.fromKey}>${link.toKey}`}
                        data-from-row={link.fromKey}
                        data-to-row={link.toKey}
                        data-relation-kind={link.relationKind}
                        data-state={overviewHullHierarchyLinkState(
                          group.key,
                          link.fromKey,
                          link.toKey,
                          litRowKey,
                        )}
                        d={link.d}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                </g>
              );
            })}
          </g>
          <FlowSegmentLayer
            layout={layout}
            activeKey={inspection.graphKeys[0]}
            activeKeys={inspection.graphKeys.slice(1)}
            muteUnmatched={inspection.mode !== "idle"}
            movingNodeKeys={movingNodeKeys}
            dragging={Boolean(dragging)}
            reducedMotion={reducedMotion}
          />
        </svg>

        <div className="overview-thread-flow-group-labels">
          {layout.groups.map((group) => (
            <OverviewFlowGroupBand
              key={group.key}
              group={group}
              viewBox={layout.viewBox}
              color={groupColor(group)}
              hierarchyPending={pendingHierarchyGroupKeys?.has(group.key) ===
                true}
              status={hullContents?.get(group.key)?.status}
              onScrollRows={onScrollGroup
                ? (rows) => onScrollGroup(group.key, rows)
                : undefined}
            >
              <DropdownMenuContextTrigger
                value={overviewThreadGroupContextValue(group.key)}
                asChild
              >
                <button
                  type="button"
                  className="overview-thread-flow-group-label"
                  data-lane={group.lane}
                  data-draggable={onMoveGroup ? "true" : "false"}
                  data-overview-context-target={overviewThreadGroupContextValue(
                    group.key,
                  )}
                  disabled={!onMoveGroup}
                  aria-label={`Move ${
                    flowGroupCaption(group)
                  } group. Drag, use the arrow keys, or open its context menu.`}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"
                  title={group.title ?? flowGroupCaption(group)}
                  onPointerDown={(event) =>
                    beginDrag("group", group.key, event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={(event) => endDrag(event, false)}
                  onLostPointerCapture={(event) => endDrag(event, false)}
                  onKeyDown={(event) => {
                    if (!onMoveGroup || !isFlowMoveDirection(event.key)) return;
                    event.preventDefault();
                    const delta = flowKeyboardMoveDelta(event.key);
                    onMoveGroup(group.key, {
                      x: clampNumber(
                        group.x + delta.x,
                        -FLOW_PRACTICAL_WORLD_LIMIT,
                        FLOW_PRACTICAL_WORLD_LIMIT,
                      ),
                      y: clampNumber(
                        group.y + delta.y,
                        -FLOW_PRACTICAL_WORLD_LIMIT,
                        FLOW_PRACTICAL_WORLD_LIMIT,
                      ),
                    });
                  }}
                >
                  <span className="overview-thread-flow-group-name">
                    {overviewThreadHullLabel(
                      group.title ?? flowGroupCaption(group),
                      overviewThreadHullLabelBudget(group.width),
                    )}
                  </span>
                  {bandFitsControls(group.width) && (
                    <span
                      className="overview-thread-flow-group-scope"
                      aria-hidden="true"
                    >
                      {group.lane}
                    </span>
                  )}
                </button>
              </DropdownMenuContextTrigger>
              {controlsVisible && !bandFitsControls(group.width) &&
                !group.collapsed && onSetGroupView && (
                <select
                  className={cn(
                    "overview-thread-flow-group-view",
                    whiteboardHullViewSelect,
                  )}
                  aria-label={`Vue de ${flowGroupCaption(group)}`}
                  title="Vue du hull : arborescence, liste ou points"
                  value={group.view}
                  onChange={(event) =>
                    onSetGroupView(
                      group.key,
                      event.currentTarget.value as OverviewThreadD3FlowHullView,
                    )}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <option value="tree">Arbre</option>
                  <option value="list">Liste</option>
                  <option value="matrix">Points</option>
                </select>
              )}
              {controlsVisible && bandFitsControls(group.width) &&
                !group.collapsed && onSetGroupView && (
                <>
                  <button
                    type="button"
                    className={cn(
                      "overview-thread-flow-group-control",
                      whiteboardHullControl(),
                    )}
                    data-view="tree"
                    data-active={group.view === "tree" ? "true" : "false"}
                    aria-pressed={group.view === "tree"}
                    aria-label={`Tree ${flowGroupCaption(group)}`}
                    title="Arborescence — largeur libre"
                    onClick={() => onSetGroupView(group.key, "tree")}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    Arbre
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "overview-thread-flow-group-control",
                      whiteboardHullControl(),
                    )}
                    data-active={group.view === "list" ? "true" : "false"}
                    aria-pressed={group.view === "list"}
                    aria-label={`List ${flowGroupCaption(group)}`}
                    title="Liste — colonnes selon la largeur"
                    onClick={() => onSetGroupView(group.key, "list")}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    ≣
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "overview-thread-flow-group-control",
                      whiteboardHullControl(),
                    )}
                    data-active={group.view === "matrix" ? "true" : "false"}
                    aria-pressed={group.view === "matrix"}
                    aria-label={`Compact ${flowGroupCaption(group)}`}
                    title="Matrice de points"
                    onClick={() => onSetGroupView(group.key, "matrix")}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    ⠿
                  </button>
                </>
              )}
              {controlsVisible && bandFitsControls(group.width) &&
                !group.collapsed && !group.structureRowCount &&
                onCycleGroupSort && (
                <button
                  type="button"
                  className={cn(
                    "overview-thread-flow-group-control",
                    whiteboardHullControl(),
                  )}
                  aria-label={`Reading order of ${flowGroupCaption(group)}`}
                  title="Ordre de lecture — enregistré / récent / nom"
                  onClick={() => onCycleGroupSort(group.key)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  ↓t
                </button>
              )}
              {onToggleGroupFold && (controlsVisible || group.collapsed) && (
                <OverviewFlowGroupFold
                  group={group}
                  caption={flowGroupCaption(group)}
                  onToggle={() => onToggleGroupFold(group.key)}
                />
              )}
            </OverviewFlowGroupBand>
          ))}
          {layout.groups.filter((group) =>
            group.view !== "matrix" && !group.collapsed
          )
            .map((group) => (
              <OverviewFlowGroupFoot
                key={`foot:${group.key}`}
                group={group}
                viewBox={layout.viewBox}
                color={groupColor(group)}
              />
            ))}
          {layout.groups.filter((group) => !group.collapsed).map((group) => {
            const live = group.nodeKeys.filter((key) => {
              const item = nodesByKey.get(key);
              return item?.kind === "recorded" &&
                item.node.freshness === "running";
            }).length;
            const failed = group.nodeKeys.some((key) => {
              const item = nodesByKey.get(key);
              return item?.kind === "recorded" &&
                item.node.freshness === "failed";
            });
            const hullCounts = hullContents?.get(group.key)?.counts;
            return (
              <OverviewFlowGroupMonitor
                key={`monitor:${group.key}`}
                group={group}
                viewBox={layout.viewBox}
                color={groupColor(group)}
                liveCount={live}
                failed={failed}
                countLabel={hullCounts?.label}
                counts={hullCounts?.items}
              />
            );
          })}
          {onResizeGroup && controlsVisible &&
            layout.groups.filter((group) => !group.collapsed).map((group) => (
              <OverviewFlowGroupResize
                key={`resize:${group.key}`}
                group={group}
                viewBox={layout.viewBox}
                caption={flowGroupCaption(group)}
                onPointerDown={(event) => beginResize(group.key, event)}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onLostPointerCapture={endResize}
              />
            ))}
        </div>

        <div className="overview-thread-flow-nodes">
          {layout.groups.filter((group) =>
            group.structureRowCount && !group.collapsed &&
            pendingHierarchyGroupKeys?.has(group.key)
          ).map((group) => (
            <FlowHullPendingRows
              key={`pending:${group.key}`}
              group={group}
              viewBox={layout.viewBox}
              color={groupColor(group)}
              count={group.structureRowCount!}
            />
          ))}
          {layout.groups.filter((group) =>
            group.structureRowCount && !group.collapsed &&
            !pendingHierarchyGroupKeys?.has(group.key)
          )
            .map((group) => {
              const content = hullContents?.get(group.key);
              if (!content || content.rows.length === 0) return null;
              return layoutOverviewHullRows(content.rows, group).map(
                (position) => (
                  <FlowStructureRow
                    key={`${group.key}:${position.row.key}`}
                    group={group}
                    position={position}
                    viewBox={layout.viewBox}
                    color={groupColor(group)}
                    graphKeysByPresentationRow={graphKeysByPresentationRow}
                    nodesByKey={nodesByKey}
                    inspection={inspection}
                    relatedKeys={relatedKeys}
                    selectedRowKey={selectedRowKey}
                    focusedKey={focusedKey}
                    refNode={refNode}
                    onActivateHullRow={onActivateHullRow}
                    onHoverGraphKey={onHover}
                    onFocusGraphKey={onFocus}
                    onHoverPresentationRow={setHoveredRowKey}
                    onScrollGroup={onScrollGroup}
                    onMove={onMove}
                  />
                ),
              );
            })}
          {layout.nodes.map((position) => {
            const item = nodesByKey.get(position.key);
            if (!item || position.folded || position.rowAnchored) return null;
            const pendingGroup = layout.groups.find((group) =>
              group.nodeKeys.includes(position.key)
            );
            if (
              pendingGroup &&
              (pendingHierarchyGroupKeys?.has(pendingGroup.key) ||
                pendingGroup.structureRowCount)
            ) return null;
            return (
              <FlowNode
                key={position.key}
                item={item}
                hasViewer={viewerNodeKeys?.has(item.key) ?? false}
                position={position}
                viewBox={layout.viewBox}
                color={overviewDomainGroupColor(
                  item.groupKey,
                  laneColorById.get(position.lane) ?? "currentColor",
                )}
                selected={position.key === selectedKey}
                inspectionActive={overviewInspectionIsVisualTarget(inspection, {
                  graphKey: position.key,
                })}
                focused={position.key === focusedKey}
                related={relatedKeys.has(position.key)}
                inspecting={inspection.mode !== "idle"}
                draggable={Boolean(onMoveNode)}
                refNode={(node) => refNode(position.key, node)}
                onHover={(hovered) =>
                  onHover(hovered ? position.key : undefined)}
                onFocus={() => onFocus(position.key)}
                onToggle={(event) =>
                  event
                    ? toggleUnlessDragged(position.key, event)
                    : onToggle(position.key)}
                onDragStart={(event) => beginDrag("node", position.key, event)}
                onDrag={moveDrag}
                onDragEnd={endDrag}
                onDragCancel={(event) => endDrag(event, false)}
                onMove={(direction) => onMove(position.key, direction)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

function FlowHullPendingRows({
  group,
  viewBox,
  color,
  count,
}: {
  readonly group: OverviewThreadD3FlowGroupLayout;
  readonly viewBox: readonly [number, number, number, number];
  readonly color: string;
  readonly count: number;
}): JSX.Element {
  const density = group.view === "matrix" ? "point" : "listed";
  return (
    <div
      className="overview-thread-flow-hull-pending"
      data-group-key={group.key}
      data-whiteboard-flow-pending="true"
      role="status"
      aria-busy="true"
      aria-label="Loading hull hierarchy"
    >
      {layoutOverviewHullRowCells(count, group).map((cell) => (
        <div
          key={cell.index}
          className={cn(
            "overview-thread-flow-structure-row",
            "overview-thread-flow-structure-row-pending",
            whiteboardFlowItem({ density, pending: true }),
          )}
          data-hull-row-view={group.view}
          data-pending="true"
          aria-hidden="true"
          style={{
            left: flowXPercent(cell.x, viewBox),
            top: flowYPercent(cell.y, viewBox),
            width: flowWidthPercent(cell.width, viewBox),
            height: flowHeightPercent(cell.height, viewBox),
            "--flow-color": color,
          } as CSSProperties}
        >
          <FlowItemSurface density={density} hasViewer={false} pending>
            {density === "listed"
              ? (
                <span
                  className={whiteboardFlowItemPart({ part: "pendingBar" })}
                />
              )
              : undefined}
          </FlowItemSurface>
        </div>
      ))}
    </div>
  );
}

function FlowStructureRow({
  group,
  position,
  viewBox,
  color,
  graphKeysByPresentationRow,
  nodesByKey,
  inspection,
  relatedKeys,
  selectedRowKey,
  focusedKey,
  refNode,
  onActivateHullRow,
  onHoverGraphKey,
  onFocusGraphKey,
  onHoverPresentationRow,
  onScrollGroup,
  onMove,
}: {
  readonly group: OverviewThreadD3FlowGroupLayout;
  readonly position: OverviewHullRowLayout;
  readonly viewBox: readonly [number, number, number, number];
  readonly color: string;
  readonly graphKeysByPresentationRow: ReadonlyMap<string, readonly string[]>;
  readonly nodesByKey: ReadonlyMap<string, OverviewHeroNode>;
  readonly inspection: OverviewInspectionTarget;
  readonly relatedKeys: ReadonlySet<string>;
  readonly selectedRowKey?: string;
  readonly focusedKey?: string;
  readonly refNode: (key: string, node: HTMLButtonElement | null) => void;
  readonly onActivateHullRow?: (
    row: OverviewHullContentRow,
    groupKey: string,
  ) => void;
  readonly onHoverGraphKey: (key: string | undefined) => void;
  readonly onFocusGraphKey: (key: string) => void;
  readonly onHoverPresentationRow: (key: string | undefined) => void;
  readonly onScrollGroup?: (key: string, rows: number) => void;
  readonly onMove: (
    key: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
}): JSX.Element {
  const { row } = position;
  const presentation = overviewHullRowPresentation(row);
  const presentationKey = overviewHullPresentationRowKey(group.key, row.key);
  const rowGraphKeys = useMemo(() => {
    const mapped = graphKeysByPresentationRow.get(presentationKey);
    if (mapped) return mapped;
    return overviewHullRowGraphRefs(row);
  }, [graphKeysByPresentationRow, presentationKey, row]);
  const graphKey = overviewHullRowPrimaryGraphRef(row) ?? rowGraphKeys[0];
  const contextKey = row.viewerNodeKey ??
    overviewHullRowPrimaryGraphRef(row);
  const boundItem = graphKey ? nodesByKey.get(graphKey) : undefined;
  const tooltip = structureRowTooltip(row, boundItem, group.view);
  const selected = presentationKey === selectedRowKey;
  const inspectionRelated = overviewInspectionIsRelatedRow(
    inspection,
    presentationKey,
    rowGraphKeys,
    relatedKeys,
  );
  const inspectionActive = overviewInspectionIsVisualTarget(inspection, {
    presentationRowKey: presentationKey,
    graphKeys: rowGraphKeys,
  });
  const focused = focusedKey === presentationKey ||
    (focusedKey ? rowGraphKeys.includes(focusedKey) : false);
  const nodeRef = useRef<HTMLButtonElement | null>(null);
  const density = group.view === "matrix" ? "point" : "listed";
  const activityStatus = boundItem?.kind === "activity"
    ? boundItem.activity.status
    : undefined;
  useLayoutEffect(() => {
    const element = nodeRef.current;
    for (const key of rowGraphKeys) {
      refNode(key, element);
    }
    return () => {
      for (const key of rowGraphKeys) {
        refNode(key, null);
      }
    };
  }, [refNode, rowGraphKeys]);
  return (
    <DropdownMenuContextTrigger
      value={contextKey
        ? overviewThreadNodeContextValue(contextKey)
        : overviewThreadGroupContextValue(group.key)}
      asChild
    >
      <button
        type="button"
        className={cn(
          "overview-thread-flow-structure-row",
          "cursor-context-menu data-[has-viewer=true]:cursor-pointer",
          "data-[hull-row-kind=source]:cursor-pointer",
          whiteboardFlowItem({ density }),
        )}
        data-whiteboard-flow-item="true"
        data-overview-context-target={contextKey
          ? overviewThreadNodeContextValue(contextKey)
          : overviewThreadGroupContextValue(group.key)}
        data-hull-row-key={row.key}
        data-hull-row-kind={row.kind}
        data-native-action={row.nativeAction}
        data-kind={boundItem?.kind}
        data-status={activityStatus}
        data-lane={group.lane}
        data-hull-group-key={group.key}
        data-overview-presentation-row={presentationKey}
        data-hull-row-view={group.view}
        data-has-viewer={presentation.hasViewer ? "true" : "false"}
        data-selected={selected ? "true" : "false"}
        data-state={flowItemVisualState(
          inspectionActive,
          inspectionRelated,
          inspection.mode !== "idle",
        )}
        data-focused={focused ? "true" : "false"}
        tabIndex={flowItemTabIndex(focused)}
        aria-label={presentation.ariaLabel}
        aria-pressed={selected}
        aria-keyshortcuts={FLOW_ITEM_KEYSHORTCUTS}
        style={{
          left: flowXPercent(position.x, viewBox),
          top: flowYPercent(position.y, viewBox),
          width: flowWidthPercent(position.width, viewBox),
          height: flowHeightPercent(position.height, viewBox),
          "--structure-depth": position.depth,
          "--flow-color": color,
        } as CSSProperties}
        onClick={() => onActivateHullRow?.(row, group.key)}
        onKeyDown={(event) =>
          handleFlowItemKeyDown(event, {
            onActivate: () => onActivateHullRow?.(row, group.key),
            onMove: graphKey
              ? (direction) => onMove(graphKey, direction)
              : undefined,
          })}
        onMouseEnter={() => {
          onHoverPresentationRow(presentationKey);
          onHoverGraphKey(graphKey);
        }}
        onMouseLeave={() => {
          onHoverPresentationRow(undefined);
          onHoverGraphKey(undefined);
        }}
        onFocus={() => {
          onHoverPresentationRow(presentationKey);
          if (graphKey) onFocusGraphKey(graphKey);
          onHoverGraphKey(graphKey);
        }}
        onBlur={() => {
          onHoverPresentationRow(undefined);
          onHoverGraphKey(undefined);
        }}
        ref={(element) => {
          nodeRef.current = element;
          refNode(presentationKey, element);
        }}
        onWheel={group.view !== "matrix" &&
            group.rowCount > group.visibleRows * group.columns &&
            onScrollGroup
          ? (event) => {
            event.preventDefault();
            event.stopPropagation();
            onScrollGroup(group.key, event.deltaY > 0 ? 1 : -1);
          }
          : undefined}
      >
        <FlowItemSurface
          density={density}
          hasViewer={presentation.hasViewer}
          label={presentation.label}
          detail={presentation.detail}
          status={activityStatus}
        />
        <span
          className={cn(
            "overview-thread-flow-node-tooltip",
            whiteboardFlowItemPart({ part: "tooltip" }),
          )}
          aria-hidden="true"
        >
          <strong>{tooltip.title}</strong>
          <span>{tooltip.body}</span>
        </span>
      </button>
    </DropdownMenuContextTrigger>
  );
}

function FlowNode({
  item,
  hasViewer,
  position,
  viewBox,
  color,
  selected,
  inspectionActive,
  focused,
  related,
  inspecting,
  draggable,
  refNode,
  onHover,
  onFocus,
  onToggle,
  onDragStart,
  onDrag,
  onDragEnd,
  onDragCancel,
  onMove,
}: {
  readonly item: OverviewHeroNode;
  readonly hasViewer: boolean;
  readonly position: OverviewThreadD3FlowNodeLayout;
  readonly viewBox: readonly [number, number, number, number];
  readonly color: string;
  readonly selected: boolean;
  readonly inspectionActive: boolean;
  readonly focused: boolean;
  readonly related: boolean;
  readonly inspecting: boolean;
  readonly draggable: boolean;
  readonly refNode: (node: HTMLButtonElement | null) => void;
  readonly onHover: (hovered: boolean) => void;
  readonly onFocus: () => void;
  readonly onToggle: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDragCancel: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onMove: (direction: OverviewThreadD3FlowMoveDirection) => void;
}): JSX.Element {
  const density = position.listed ? "listed" : "point";
  const activityStatus = item.kind === "activity"
    ? item.activity.status
    : undefined;
  return (
    <DropdownMenuContextTrigger
      value={overviewThreadNodeContextValue(item.key)}
      asChild
    >
      <button
        ref={refNode}
        type="button"
        tabIndex={flowItemTabIndex(focused)}
        aria-label={`${flowNodeAriaLabel(item)}${
          hasViewer ? " · Open viewer" : ""
        }`}
        aria-pressed={selected}
        className={cn(
          "overview-thread-flow-node",
          whiteboardFlowItem({ density }),
        )}
        data-whiteboard-flow-item="true"
        data-kind={item.kind}
        data-has-viewer={hasViewer ? "true" : "false"}
        data-status={activityStatus}
        data-lane={position.lane}
        data-state={flowItemVisualState(
          inspectionActive,
          related,
          inspecting,
        )}
        data-focused={focused ? "true" : "false"}
        data-draggable={draggable ? "true" : "false"}
        data-emphasis={item.kind !== "activity" && item.emphasis
          ? "true"
          : "false"}
        data-overview-context-target={overviewThreadNodeContextValue(item.key)}
        data-listed={position.listed ? "true" : "false"}
        data-tree-depth={position.listed ? position.depth : undefined}
        aria-keyshortcuts={FLOW_ITEM_KEYSHORTCUTS}
        style={{
          "--flow-x": position.listed
            ? flowXPercent(position.x, viewBox)
            : flowXPercent(position.centerX, viewBox),
          "--flow-y": flowYPercent(position.centerY, viewBox),
          "--row-width": flowWidthPercent(position.width, viewBox),
          "--row-height": flowHeightPercent(position.height, viewBox),
          "--flow-color": color,
        } as CSSProperties}
        onClick={onToggle}
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragCancel}
        onLostPointerCapture={onDragCancel}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={onFocus}
        onBlur={() => onHover(false)}
        onKeyDown={(event) =>
          handleFlowItemKeyDown(event, {
            onActivate: () => onToggle(),
            onMove,
          })}
      >
        <FlowItemSurface
          density={density}
          hasViewer={hasViewer}
          status={activityStatus}
          emphasis={item.kind !== "activity" && item.emphasis}
        >
          {density === "listed" ? <FlowRowBody item={item} /> : undefined}
        </FlowItemSurface>
        {item.kind === "activity" && density === "point"
          ? (
            <span
              className={cn(
                "overview-thread-flow-activity-label",
                whiteboardFlowItemPart({ part: "activityLabel" }),
              )}
              data-status={item.activity.status}
              aria-hidden="true"
            >
              <strong>{item.activity.title}</strong>
              <span
                className={cn(
                  "overview-thread-flow-activity-status",
                  whiteboardFlowItemPart({ part: "activityStatus" }),
                )}
              >
                <span
                  className={cn(
                    "overview-thread-flow-activity-status-mark",
                    whiteboardFlowItemPart({ part: "activityMark" }),
                  )}
                  aria-hidden="true"
                />
                {flowStatusCaption(item.activity.status)}
              </span>
            </span>
          )
          : (
            <span
              className={cn(
                "overview-thread-flow-node-tooltip",
                whiteboardFlowItemPart({ part: "tooltip" }),
              )}
              aria-hidden="true"
            >
              <strong>{item.label}</strong>
              <span>{flowNodeDescription(item)}</span>
            </span>
          )}
      </button>
    </DropdownMenuContextTrigger>
  );
}

function FlowSegmentLayer({
  layout,
  activeKey,
  activeKeys,
  muteUnmatched = false,
  movingNodeKeys,
  dragging,
  reducedMotion,
}: {
  readonly layout: OverviewThreadD3FlowLayout;
  readonly activeKey: string | undefined;
  readonly activeKeys: readonly string[];
  readonly muteUnmatched?: boolean;
  readonly movingNodeKeys: ReadonlySet<string>;
  readonly dragging: boolean;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const layerRef = useRef<SVGGElement>(null);
  const sceneRef = useRef(new OverviewFlowMotionScene());
  const elementsRef = useRef(new Map<string, OverviewFlowSegmentElement>());
  const presentationByKeyRef = useRef(
    new Map<string, OverviewFlowSegmentPresentation>(),
  );
  const animationFrameRef = useRef<number>();
  const previousFrameAtRef = useRef<number>();
  const frameCallbackRef = useRef<(now: number) => void>();

  const syncScene = () => {
    const layer = layerRef.current;
    if (!layer) return;
    const liveIds = new Set<string>();
    sceneRef.current.visit((visual) => {
      liveIds.add(visual.id);
      let element = elementsRef.current.get(visual.id);
      if (!element) {
        const path = globalThis.document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("fill", "none");
        path.setAttribute("class", "overview-thread-flow-segment");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        layer.appendChild(path);
        element = { path };
        elementsRef.current.set(visual.id, element);
      }
      const presentation = visual.phase === "active"
        ? presentationByKeyRef.current.get(visual.key)
        : element.presentation;
      if (presentation) {
        element.presentation = presentation;
        applyOverviewFlowSegmentPresentation(element.path, presentation);
      }
      element.path.dataset.motionPhase = visual.phase;
      const renderedD = overviewFlowMotionGeometrySettled(visual) &&
          visual.phase === "active"
        ? visual.targetD
        : overviewFlowMotionPath(visual.points, visual.kind, visual.curve);
      const renderedWidth = formatOverviewFlowMotionNumber(visual.width);
      const renderedPresence = formatOverviewFlowMotionNumber(visual.presence);
      if (element.renderedD !== renderedD) {
        element.path.setAttribute("d", renderedD);
        element.renderedD = renderedD;
      }
      if (element.renderedWidth !== renderedWidth) {
        element.path.setAttribute("stroke-width", renderedWidth);
        element.renderedWidth = renderedWidth;
      }
      if (element.renderedPresence !== renderedPresence) {
        element.path.setAttribute("stroke-opacity", renderedPresence);
        element.renderedPresence = renderedPresence;
      }
    });
    for (const [id, element] of elementsRef.current) {
      if (liveIds.has(id)) continue;
      element.path.remove();
      elementsRef.current.delete(id);
    }
    const painted = [...elementsRef.current.values()].toSorted((left, right) =>
      flowSegmentPaintRank(left.presentation?.state ?? "default") -
        flowSegmentPaintRank(right.presentation?.state ?? "default") ||
      left.path.dataset.kind?.localeCompare(right.path.dataset.kind ?? "") ||
      0
    );
    for (const element of painted) layer.appendChild(element.path);
  };

  const requestMotionFrame = () => {
    if (
      animationFrameRef.current !== undefined ||
      !sceneRef.current.needsAnimation()
    ) return;
    animationFrameRef.current = globalThis.requestAnimationFrame((now) =>
      frameCallbackRef.current?.(now)
    );
  };

  frameCallbackRef.current = (now: number) => {
    animationFrameRef.current = undefined;
    const previous = previousFrameAtRef.current;
    previousFrameAtRef.current = now;
    sceneRef.current.advance(
      previous === undefined ? 1_000 / 60 : now - previous,
    );
    syncScene();
    if (sceneRef.current.needsAnimation()) {
      requestMotionFrame();
    } else {
      previousFrameAtRef.current = undefined;
    }
  };

  useLayoutEffect(() => {
    const presentations = overviewFlowSegmentPresentations(
      layout,
      activeKey,
      movingNodeKeys,
      dragging,
      activeKeys,
      muteUnmatched,
    );
    presentationByKeyRef.current = new Map(
      presentations.map((presentation) => [
        presentation.segment.key,
        presentation,
      ]),
    );
    sceneRef.current.reconcile(
      presentations.map(({ segment, connectedToDrag }) => {
        const points = canonicalOverviewFlowMotionPoints(segment, layout);
        const declaredTopology =
          (segment as OverviewThreadD3FlowSegmentLayout & {
            readonly topologySignature?: string;
          }).topologySignature;
        return {
          key: segment.key,
          kind: segment.kind,
          curve: segment.curve,
          points,
          topologySignature: declaredTopology?.trim() ||
            overviewFlowMotionTopologySignature(segment.kind, points),
          targetD: segment.d,
          width: flowSegmentWidth(segment),
          edgeKeys: segment.edgeKeys,
          pathKeys: segment.pathKeys,
          pinEndpoints: connectedToDrag,
        };
      }),
      reducedMotion,
    );
    syncScene();
    if (reducedMotion && animationFrameRef.current !== undefined) {
      globalThis.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      previousFrameAtRef.current = undefined;
    } else {
      requestMotionFrame();
    }
  }, [
    activeKey,
    activeKeys,
    dragging,
    layout,
    movingNodeKeys,
    muteUnmatched,
    reducedMotion,
  ]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== undefined) {
        globalThis.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = undefined;
      previousFrameAtRef.current = undefined;
    };
  }, []);

  return <g ref={layerRef} className="overview-thread-flow-segments" />;
}

function structureRowTooltip(
  row: OverviewHullContentRow,
  item: OverviewHeroNode | undefined,
  view: "tree" | "list" | "matrix",
): { readonly title: string; readonly body: string } {
  if (view === "matrix") return overviewHullRowTooltip(row, view);
  if (item && item.kind !== "activity") {
    return { title: item.label, body: flowNodeDescription(item) };
  }
  return overviewHullRowTooltip(row, view);
}

function flowNodeDescription(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `Activity \u00b7 ${flowStatusCaption(item.activity.status)}`;
  }
  if (item.kind === "brief-source") {
    return `Brief r${item.brief.revision} · ${item.sourceItem.kind}`;
  }
  return item.node.summary;
}

function flowNodeAriaLabel(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `Inspect activity ${item.activity.title}, ${
      flowStatusCaption(item.activity.status)
    }`;
  }
  if (item.kind === "brief-source") {
    return `Read brief source ${item.sourceItem.id}, brief r${item.brief.revision}`;
  }
  return `Inspect ${item.node.label}, ${item.node.freshness}, ${item.node.ref.id}`;
}

const FLOW_ACTIVITY_STATUS_ORDER = [
  "planned",
  "active",
  "blocked",
] as const satisfies readonly EngineeringPhaseStatus[];

function overviewFlowActivityStatuses(
  hullContents:
    | ReadonlyMap<string, OverviewHullContent>
    | undefined,
): readonly EngineeringPhaseStatus[] {
  const present = new Set<EngineeringPhaseStatus>();
  for (const content of hullContents?.values() ?? []) {
    if (content.status) present.add(content.status);
  }
  return FLOW_ACTIVITY_STATUS_ORDER.filter((status) => present.has(status));
}

function flowStatusCaption(status: EngineeringPhaseStatus): string {
  return overviewActivityStatusCaption(status);
}
