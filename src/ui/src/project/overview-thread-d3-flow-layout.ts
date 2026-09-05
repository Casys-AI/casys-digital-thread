import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import { curveBumpX, line } from "d3-shape";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import type { OverviewThreadD3CableObstacle } from "./overview-thread-d3-cable-field.ts";
import {
  OverviewThreadD3CableFanInFields,
  overviewThreadD3CableHullSides,
  type OverviewThreadD3CableTerminal,
  overviewThreadD3CableTerminal,
} from "./overview-thread-d3-cable-board.ts";
import type { OverviewThreadD3NodeFanInRoute } from "./overview-thread-d3-node-fan-in.ts";
import {
  overviewThreadD3CableAnchor,
  overviewThreadD3CableArrivalTangent,
  overviewThreadD3CableDepartureTangent,
  type OverviewThreadD3CableSide,
} from "./overview-thread-d3-cable-anchorage.ts";
import {
  buildOverviewThreadD3JointCorridor,
} from "./overview-thread-d3-joint-corridor.ts";
import { OVERVIEW_LANES } from "./overview-lanes.ts";

const DEFAULT_WIDTH = 1000;
const DEFAULT_VIEWPORT_HEIGHT = 520;
const DEFAULT_NODE_SIZE = 10;
const DEFAULT_NODE_GAP = 11;
const DENSE_NODE_SIZE = 8;
const DENSE_NODE_GAP = 7;
const DENSE_GROUP_THRESHOLD = 60;
const DEFAULT_MAX_GRID_COLUMNS = 10;
const DEFAULT_GROUP_GAP = 26;
const DENSE_GROUP_GAP = 20;
const DEFAULT_MIN_LAYOUT_HEIGHT = 380;
const LANE_HEADER_Y = 26;
const DEFAULT_TOP_INSET = 64;
const DEFAULT_BOTTOM_INSET = 40;
const LANE_SIDE_GAP = 16;
const DEFAULT_CORRIDOR_CAPTURE_MIN = 30;
const DEFAULT_CORRIDOR_CAPTURE_MAX = 44;
const DEFAULT_CORRIDOR_RELEASE_RATIO = 1.5;
const MINIMUM_OBSTACLE_MARGIN = 12;
/**
 * Cable hubs hang off the moved hull itself, not off the lane column. On a
 * freely placed whiteboard a lane-width offset leaves stubs in empty space and
 * inverts hub order between neighbouring groups, which reads as a hairpin.
 */
const GROUP_HUB_MARGIN = 20;
/** Lateral bow of a cable between two leaves stacked in the same column. */
const INTRA_GROUP_BOW = 9;
/** One listed row, in viewBox units. */
const HULL_LIST_ROW_HEIGHT = 17;
/** Foot of a listed hull, where "shown / total" is stated. */
const HULL_LIST_FOOTER_HEIGHT = 13;
/** A listed hull is at least this wide: a row must be able to say a name. */
const HULL_LIST_MINIMUM_WIDTH = 190;
/**
 * Width at which the list flows into a second and a third column. Widening a
 * hull first gives the titles more room; only past these does a column appear.
 */
const HULL_LIST_TWO_COLUMN_WIDTH = 216;
const HULL_LIST_THREE_COLUMN_WIDTH = 331;
/** Rows a listed hull shows before the operator resizes it. */
const HULL_LIST_DEFAULT_ROWS = 4;
/** Below this the hull refuses to shrink: fewer rows is not a folder. */
const HULL_LIST_MINIMUM_ROWS = 3;
/**
 * Gutter between listed columns. Without it the right port of one column and
 * the left port of the next share a coordinate, and two leaves anchored at the
 * same point collapse their fan-in field.
 */
const HULL_LIST_COLUMN_GAP = 7;
/**
 * Projected hull geometry for its caption and folder controls.
 *
 * The caption/control band is projected hull geometry rather than a pill
 * outside it. List and collapsed views reserve its height; the compact matrix
 * keeps its exact coordinates and placements without an automatic offset.
 */
const HULL_HEADER_HEIGHT = 20;
const DEFAULT_OBSTACLE_MARGIN = MINIMUM_OBSTACLE_MARGIN;
const NODE_FAN_IN_OBSTACLE_MARGIN = 2;
const ROUTE_CLEARANCE = 1;
/**
 * Minimum bend a trunk is drawn with. Cable in a tray turns on a radius near
 * its own bundle diameter; a tighter corner reads as a kink, not routing.
 */
const ROUTED_FILLET_MAX_RADIUS = 16;
const ROUTED_FILLET_TURN_EPSILON = 0.08;

export interface OverviewThreadD3FlowNodeInput {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey: string;
  readonly label: string;
  /** When the record changed, for the hull's optional recency order. */
  readonly recordedAt?: string;
  /**
   * The leaf that contains this one, when the hull declares containment and
   * exactly one parent claims it. This is what makes a hull a folder tree.
   */
  readonly parentKey?: string;
}

export interface OverviewThreadD3FlowEdgeInput {
  readonly key: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly pathCount: number;
  readonly pathKeys: readonly string[];
  readonly emphasis: boolean;
}

export interface OverviewThreadD3FlowLayoutOptions {
  readonly width?: number;
  readonly viewportHeight?: number;
  readonly minHeight?: number;
  readonly topInset?: number;
  readonly bottomInset?: number;
  readonly nodeSize?: number;
  readonly nodeGap?: number;
  readonly maxGridColumns?: number;
  readonly groupGap?: number;
  readonly bundleBeta?: number;
  /**
   * Pair trunks enter the same presentation corridor at this complete-link
   * distance. Coordinates are in viewBox units and never affect relation
   * identity.
   */
  readonly corridorCaptureDistance?: number;
  /**
   * Pairs that shared a corridor in `previousRoutingState` remain together up
   * to this larger distance. The state is ephemeral interaction state only.
   */
  readonly corridorReleaseDistance?: number;
  /** Clearance added around immutable group hulls for edge-only routing. */
  readonly obstacleMargin?: number;
  /**
   * Optional prior magnetic grouping. Callers may keep it between drag frames,
   * but it must never be persisted as project or Thread truth.
   */
  readonly previousRoutingState?: OverviewThreadD3FlowRoutingState;
  /**
   * Group placements are keyed by `overviewThreadD3FlowGroupIdentity(...)`.
   * `x` and `y` are absolute whiteboard coordinates. Finite offsets are added
   * without constraining the hull to the initial graph frame.
   */
  readonly groupPlacements?: Readonly<
    Record<string, OverviewThreadD3FlowGroupPlacement>
  >;
  /** Node placements are keyed by the exact input node key. */
  readonly nodePlacements?: Readonly<
    Record<string, OverviewThreadD3FlowNodePlacement>
  >;
}

export interface OverviewThreadD3FlowGroupPlacement {
  readonly x?: number;
  readonly y?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
  /**
   * Operator-chosen hull size, in viewBox units. The matrix re-flows inside
   * it; leaves are never dropped to make the hull fit, and a size below what
   * one leaf needs is raised to that floor.
   */
  readonly width?: number;
  readonly height?: number;
  /**
   * Folded hull: the band alone. Its leaves keep their identity and their
   * relations — they collapse onto the band, so cables land on the bar rather
   * than vanishing. A hull is folded, never closed.
   */
  readonly collapsed?: boolean;
  /**
   * How the hull presents its contents. Both views hold every leaf; only the
   * reading changes. Remembered per hull.
   */
  readonly view?: OverviewThreadD3FlowHullView;
  /** First listed row shown when the hull holds more rows than it shows. */
  readonly scrollRow?: number;
  readonly sort?: OverviewThreadD3FlowHullSort;
}

/**
 * How a hull presents its own contents. `list` names every row and flows them
 * into columns as the hull widens; `matrix` is the dense field of points.
 */
export type OverviewThreadD3FlowHullView = "list" | "matrix";

/**
 * Reading order inside a hull. The graph's own order is not an authority here:
 * this is a comfort for whoever reads the folder, and it never changes which
 * relations exist or how they are routed.
 */
export type OverviewThreadD3FlowHullSort = "recorded" | "recent" | "name";

export interface OverviewThreadD3FlowNodePlacement {
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export interface OverviewThreadD3FlowRoutingCorridorState {
  readonly id: string;
  readonly partitionKey: string;
  readonly pairKeys: readonly string[];
}

/** Ephemeral presentation-only state for capture/release hysteresis. */
export interface OverviewThreadD3FlowRoutingState {
  readonly corridors: readonly OverviewThreadD3FlowRoutingCorridorState[];
}

export interface OverviewThreadD3FlowPoint {
  readonly x: number;
  readonly y: number;
}

export interface OverviewThreadD3FlowPort extends OverviewThreadD3FlowPoint {}

/**
 * Physical side a cable leaves or enters. Hulls placed in the same column
 * exchange over the vertical axis; a lane-only left/right vocabulary forces
 * that exchange into a lateral hook around both hulls.
 */
export type OverviewThreadD3FlowCableSide = OverviewThreadD3CableSide;

/** A group hull with the clearance its cable hubs stand off by. */
type FlowCableHull = OverviewThreadD3FlowGroupLayout & {
  readonly hubMargin: number;
};

type FlowCableTerminal = OverviewThreadD3CableTerminal<
  FlowCableHull,
  OverviewThreadD3FlowNodeLayout
>;

export interface OverviewThreadD3FlowNodeLayout
  extends OverviewThreadD3FlowNodeInput {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly leftPort: OverviewThreadD3FlowPort;
  readonly rightPort: OverviewThreadD3FlowPort;
  readonly topPort: OverviewThreadD3FlowPort;
  readonly bottomPort: OverviewThreadD3FlowPort;
  /**
   * Not drawn: the hull is folded, or the row is outside the list window. The
   * leaf keeps its identity and its relations either way.
   */
  readonly folded: boolean;
  /** Drawn as a named row rather than a point. */
  readonly listed: boolean;
}

export interface OverviewThreadD3FlowGroupLayout {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey: string;
  readonly nodeKeys: readonly string[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly centerY: number;
  /**
   * Name the hull states, when a single container holds everything it lists.
   * The caption falls back to the group's own identity otherwise.
   */
  readonly title?: string;
  /** The leaf that name came from, so the band can select it. */
  readonly promotedKey?: string;
  /** Caption/control geometry: list/collapsed reserve it; matrix stays exact. */
  readonly headerHeight: number;
  readonly collapsed: boolean;
  readonly view: OverviewThreadD3FlowHullView;
  /** Window on the list: first row shown, rows shown, rows held in total. */
  readonly scrollRow: number;
  readonly visibleRows: number;
  readonly rowCount: number;
  /** Height of the foot that states "shown / total". */
  readonly footerHeight: number;
  readonly inHub: OverviewThreadD3FlowPort;
  readonly outHub: OverviewThreadD3FlowPort;
  readonly topHub: OverviewThreadD3FlowPort;
  readonly bottomHub: OverviewThreadD3FlowPort;
}

export interface OverviewThreadD3FlowLaneLayout {
  readonly lane: EngineeringPathLaneId;
  readonly title: string;
  readonly color: string;
  readonly x: number;
  readonly headerY: number;
  readonly entryX: number;
  readonly exitX: number;
  readonly nodeCount: number;
}

export type OverviewThreadD3FlowSegmentKind =
  | "node-branch"
  | "pair-feeder"
  | "bundle-trunk"
  | "same-lane-trunk";

export type OverviewThreadD3FlowSegmentRole =
  | "source"
  | "target"
  | "shared";

export type OverviewThreadD3FlowDirection =
  | "forward"
  | "reverse"
  | "same-lane"
  | "mixed";

/** Direction of one exact relation; only shared segments can be "mixed". */
export type OverviewThreadD3FlowRouteDirection = Exclude<
  OverviewThreadD3FlowDirection,
  "mixed"
>;

export type OverviewThreadD3FlowCurve =
  | "bump"
  | "rounded"
  | "catmull-rom";

export interface OverviewThreadD3FlowSegmentLayout {
  readonly key: string;
  readonly kind: OverviewThreadD3FlowSegmentKind;
  readonly role: OverviewThreadD3FlowSegmentRole;
  readonly direction: OverviewThreadD3FlowDirection;
  readonly curve: OverviewThreadD3FlowCurve;
  readonly d: string;
  /** Geometry-topology token for safe renderer morph/cross-fade decisions. */
  readonly topologySignature: string;
  readonly points: readonly OverviewThreadD3FlowPoint[];
  readonly pathCount: number;
  /** Presentation width derived only from this segment's current pathCount. */
  readonly width: number;
  readonly pathKeys: readonly string[];
  readonly edgeKeys: readonly string[];
  readonly fromKeys: readonly string[];
  readonly toKeys: readonly string[];
  /** Exact directed group-pair presentation identities carried here. */
  readonly pairKeys: readonly string[];
  /** Magnetic corridor identities; never relation or persistence identities. */
  readonly corridorKeys: readonly string[];
  readonly emphasis: boolean;
}

export interface OverviewThreadD3FlowRoute {
  readonly edgeKey: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly segmentKeys: readonly string[];
  readonly pathCount: number;
  readonly pathKeys: readonly string[];
}

export interface OverviewThreadD3FlowLayout {
  readonly viewBox: readonly [number, number, number, number];
  readonly viewportHeight: number;
  readonly nodes: readonly OverviewThreadD3FlowNodeLayout[];
  readonly groups: readonly OverviewThreadD3FlowGroupLayout[];
  readonly lanes: readonly OverviewThreadD3FlowLaneLayout[];
  readonly segments: readonly OverviewThreadD3FlowSegmentLayout[];
  readonly routes: readonly OverviewThreadD3FlowRoute[];
  readonly unroutedEdgeKeys: readonly string[];
  /** The next optional drag-frame state; presentation-only and non-authority. */
  readonly nextRoutingState: OverviewThreadD3FlowRoutingState;
}

/**
 * Returns the collision-safe identity used to place one exact lane/group
 * pair. Group labels are never matched fuzzily or across lanes.
 */
export function overviewThreadD3FlowGroupIdentity(
  lane: EngineeringPathLaneId,
  groupKey: string,
): string {
  return flowGroupKey(lane, normalizedGroupKey(groupKey));
}

type LaneTreeDatumKind = "lane" | "group" | "leaf";

interface LaneTreeDatum {
  readonly kind: LaneTreeDatumKind;
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey?: string;
  readonly node?: OverviewThreadD3FlowNodeInput;
  readonly children?: readonly LaneTreeDatum[];
}

interface MutableSegment {
  readonly key: string;
  readonly kind: OverviewThreadD3FlowSegmentKind;
  readonly d: string;
  readonly curve: OverviewThreadD3FlowCurve;
  readonly topologySignature: string;
  readonly points: readonly OverviewThreadD3FlowPoint[];
  readonly roles: Set<"source" | "target" | "shared">;
  readonly directions: Set<"forward" | "reverse" | "same-lane">;
  readonly pathKeys: Set<string>;
  readonly edgeKeys: Set<string>;
  readonly fromKeys: Set<string>;
  readonly toKeys: Set<string>;
  readonly pairKeys: Set<string>;
  readonly corridorKeys: Set<string>;
  pathCount: number;
  emphasis: boolean;
}

interface SegmentSpec {
  readonly key: string;
  readonly kind: OverviewThreadD3FlowSegmentKind;
  readonly role: "source" | "target" | "shared";
  readonly direction: "forward" | "reverse" | "same-lane";
  readonly points: readonly OverviewThreadD3FlowPoint[];
  readonly curve: OverviewThreadD3FlowCurve;
  readonly d?: string;
  readonly pairKey?: string;
  readonly corridorKey?: string;
  readonly topologySignature?: string;
}

interface GroupMatrixPlan {
  readonly groupKey: string;
  readonly nodes: readonly OverviewThreadD3FlowNodeInput[];
  readonly columns: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
}

interface LaneMatrixPlan {
  readonly lane: EngineeringPathLaneId;
  readonly groups: readonly GroupMatrixPlan[];
  readonly contentHeight: number;
}

/** One recorded relation resolved onto the physical board. */
interface ResolvedCableEdge {
  readonly edge: OverviewThreadD3FlowEdgeInput;
  readonly source: FlowCableTerminal;
  readonly target: FlowCableTerminal;
  readonly direction: OverviewThreadD3FlowRouteDirection;
}

/** Every relation between the same two hulls, sharing one physical trunk. */
interface CablePair {
  readonly key: string;
  readonly partitionKey: string;
  readonly physicalDirection: "left-to-right" | "right-to-left";
  readonly sourceSide: OverviewThreadD3FlowCableSide;
  readonly targetSide: OverviewThreadD3FlowCableSide;
  readonly sourceGroup: OverviewThreadD3FlowGroupLayout;
  readonly targetGroup: OverviewThreadD3FlowGroupLayout;
  readonly sourceHub: OverviewThreadD3FlowPoint;
  readonly targetHub: OverviewThreadD3FlowPoint;
  readonly leftY: number;
  readonly rightY: number;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly edges: readonly ResolvedCableEdge[];
  readonly pathCount: number;
}

interface CorridorCluster {
  readonly id: string;
  readonly partitionKey: string;
  readonly pairs: readonly CablePair[];
}

interface RoutingObstacle extends OverviewThreadD3CableObstacle {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

/**
 * Builds a fixed five-lane flow layout. Edges contribute metadata to shared
 * node branches, exact directed pair feeders, and spatial presentation
 * corridors instead of drawing duplicate paths. Corridors aggregate only
 * metadata from their current member pairs; routes and exact edge identities
 * remain authoritative and are never inferred from spatial proximity.
 */
export function buildOverviewThreadD3FlowLayout(
  nodes: readonly OverviewThreadD3FlowNodeInput[],
  edges: readonly OverviewThreadD3FlowEdgeInput[],
  options: OverviewThreadD3FlowLayoutOptions = {},
): OverviewThreadD3FlowLayout {
  assertUniqueNodeKeys(nodes);

  const width = positiveOrDefault(options.width, DEFAULT_WIDTH);
  const viewportHeight = positiveOrDefault(
    options.viewportHeight,
    DEFAULT_VIEWPORT_HEIGHT,
  );
  const minHeight = positiveOrDefault(
    options.minHeight,
    DEFAULT_MIN_LAYOUT_HEIGHT,
  );
  const topInset = nonNegativeOrDefault(
    options.topInset,
    DEFAULT_TOP_INSET,
  );
  const bottomInset = nonNegativeOrDefault(
    options.bottomInset,
    DEFAULT_BOTTOM_INSET,
  );
  const denseLayout = largestOverviewGroupSize(nodes) >= DENSE_GROUP_THRESHOLD;
  const nodeSize = positiveOrDefault(
    options.nodeSize,
    denseLayout ? DENSE_NODE_SIZE : DEFAULT_NODE_SIZE,
  );
  const nodeGap = positiveOrDefault(
    options.nodeGap,
    denseLayout ? DENSE_NODE_GAP : DEFAULT_NODE_GAP,
  );
  const requestedMaxGridColumns = Math.max(
    1,
    Math.floor(
      positiveOrDefault(options.maxGridColumns, DEFAULT_MAX_GRID_COLUMNS),
    ),
  );
  const groupGap = positiveOrDefault(
    options.groupGap,
    denseLayout ? DENSE_GROUP_GAP : DEFAULT_GROUP_GAP,
  );
  const corridorCaptureDistance = positiveOrDefault(
    options.corridorCaptureDistance,
    clamp(
      (nodeSize + nodeGap) * 1.7,
      DEFAULT_CORRIDOR_CAPTURE_MIN,
      DEFAULT_CORRIDOR_CAPTURE_MAX,
    ),
  );
  const corridorReleaseDistance = Math.max(
    corridorCaptureDistance,
    positiveOrDefault(
      options.corridorReleaseDistance,
      corridorCaptureDistance * DEFAULT_CORRIDOR_RELEASE_RATIO,
    ),
  );
  const obstacleMargin = nonNegativeOrDefault(
    Math.max(
      MINIMUM_OBSTACLE_MARGIN,
      options.obstacleMargin ?? DEFAULT_OBSTACLE_MARGIN,
    ),
    DEFAULT_OBSTACLE_MARGIN,
  );
  const laneStep = width / OVERVIEW_LANES.length;
  const laneX = new Map(
    OVERVIEW_LANES.map((lane, index) => [
      lane.id,
      laneStep * (index + 0.5),
    ]),
  );
  const laneHubOffset = laneStep / 2 - LANE_SIDE_GAP;
  const availableMatrixWidth = Math.max(
    nodeSize,
    laneHubOffset * 2 - LANE_SIDE_GAP * 2,
  );
  const maximumColumnsByWidth = Math.max(
    1,
    Math.floor((availableMatrixWidth + nodeGap) / (nodeSize + nodeGap)),
  );
  const maximumColumns = Math.min(
    requestedMaxGridColumns,
    maximumColumnsByWidth,
  );
  const lanePlans = OVERVIEW_LANES.map((lane) =>
    buildLaneMatrixPlan(
      lane.id,
      nodes.filter((node) => node.lane === lane.id),
      nodeSize,
      nodeGap,
      maximumColumns,
      groupGap,
    )
  );
  const maximumLaneContentHeight = Math.max(
    0,
    ...lanePlans.map((plan) => plan.contentHeight),
  );
  const layoutHeight = Math.max(
    minHeight,
    topInset + maximumLaneContentHeight + bottomInset,
  );
  const contentAreaHeight = layoutHeight - topInset - bottomInset;
  const nodeLayouts: OverviewThreadD3FlowNodeLayout[] = [];
  const groupLayouts: OverviewThreadD3FlowGroupLayout[] = [];

  for (const plan of lanePlans) {
    if (plan.groups.length === 0) continue;
    const centerX = laneX.get(plan.lane)!;
    let groupTop = topInset + (contentAreaHeight - plan.contentHeight) / 2;
    for (const group of plan.groups) {
      const baseGroupLeft = centerX - group.width / 2;
      const baseGroupTop = groupTop;
      const groupIdentity = overviewThreadD3FlowGroupIdentity(
        plan.lane,
        group.groupKey,
      );
      const groupPlacement = ownPlacement(
        options.groupPlacements,
        groupIdentity,
      );
      const { x: groupLeft, y: placedGroupTop } = resolveGroupOrigin(
        baseGroupLeft,
        baseGroupTop,
        groupPlacement,
      );
      const hull = resolveHullBox(group, groupPlacement, nodeSize, nodeGap);
      const outline = hullOutlineRows(group.nodes, groupPlacement?.sort);
      const centerY = placedGroupTop + hull.height / 2;
      const listed = hull.view === "list" && !hull.collapsed;
      const listColumnWidth = listed
        ? (hull.width - HULL_LIST_COLUMN_GAP * (hull.columns - 1)) /
          hull.columns
        : 0;
      const listCapacity = listed
        ? Math.max(1, Math.ceil(group.nodes.length / hull.columns))
        : 0;
      for (const [index, outlineRow] of outline.rows.entries()) {
        const node = outlineRow.node;
        // The list reads down a column then across, like a Finder column view.
        const listColumn = listed ? Math.floor(index / listCapacity) : 0;
        const listRow = listed
          ? index - listColumn * listCapacity - hull.scrollRow
          : 0;
        // A row scrolled out of the window keeps its identity and its cables;
        // it is not drawn, and its cable lands on the hull edge instead.
        const offWindow = listed &&
          (listRow < 0 || listRow >= hull.visibleRows);
        const column = index % hull.columns;
        const row = Math.floor(index / hull.columns);
        const matrixNodeX = groupLeft + column * (nodeSize + nodeGap);
        const matrixNodeY = placedGroupTop + row * (nodeSize + nodeGap);
        const nodePlacement = ownPlacement(options.nodePlacements, node.key);
        const nodeWidth = listed ? listColumnWidth : nodeSize;
        const nodeHeight = listed ? HULL_LIST_ROW_HEIGHT : nodeSize;
        const nodeX = hull.collapsed
          ? groupLeft + hull.width / 2 - nodeSize / 2
          : listed
          ? groupLeft + listColumn * (listColumnWidth + HULL_LIST_COLUMN_GAP)
          : clamp(
            matrixNodeX + finiteOrZero(nodePlacement?.offsetX),
            groupLeft,
            groupLeft + hull.width - nodeSize,
          );
        const nodeY = hull.collapsed
          ? placedGroupTop + HULL_HEADER_HEIGHT / 2 - nodeSize / 2
          : listed
          ? placedGroupTop + HULL_HEADER_HEIGHT +
            clamp(listRow, 0, Math.max(0, hull.visibleRows - 1)) *
              HULL_LIST_ROW_HEIGHT
          : clamp(
            matrixNodeY + finiteOrZero(nodePlacement?.offsetY),
            placedGroupTop,
            placedGroupTop + hull.height - nodeSize,
          );
        const nodeCenterX = nodeX + nodeWidth / 2;
        const nodeCenterY = nodeY + nodeHeight / 2;
        nodeLayouts.push({
          ...node,
          x: nodeX,
          y: nodeY,
          width: nodeWidth,
          height: nodeHeight,
          centerX: nodeCenterX,
          centerY: nodeCenterY,
          leftPort: { x: nodeX, y: nodeCenterY },
          rightPort: { x: nodeX + nodeWidth, y: nodeCenterY },
          topPort: { x: nodeCenterX, y: nodeY },
          bottomPort: { x: nodeCenterX, y: nodeY + nodeHeight },
          folded: hull.collapsed || offWindow,
          listed,
        });
      }
      if (outline.promoted) {
        const bandCenterX = groupLeft + hull.width / 2;
        const bandCenterY = placedGroupTop + HULL_HEADER_HEIGHT / 2;
        nodeLayouts.push({
          ...outline.promoted,
          x: bandCenterX - nodeSize / 2,
          y: bandCenterY - nodeSize / 2,
          width: nodeSize,
          height: nodeSize,
          centerX: bandCenterX,
          centerY: bandCenterY,
          leftPort: { x: bandCenterX - nodeSize / 2, y: bandCenterY },
          rightPort: { x: bandCenterX + nodeSize / 2, y: bandCenterY },
          topPort: { x: bandCenterX, y: bandCenterY - nodeSize / 2 },
          bottomPort: { x: bandCenterX, y: bandCenterY + nodeSize / 2 },
          folded: true,
          listed: false,
        });
      }
      groupLayouts.push({
        key: groupIdentity,
        lane: plan.lane,
        groupKey: group.groupKey,
        nodeKeys: group.nodes.map((node) => node.key),
        x: groupLeft,
        y: placedGroupTop,
        width: hull.width,
        height: hull.height,
        columns: hull.columns,
        rows: hull.rows,
        centerY,
        ...(outline.promoted
          ? { title: outline.promoted.label, promotedKey: outline.promoted.key }
          : {}),
        headerHeight: HULL_HEADER_HEIGHT,
        collapsed: hull.collapsed,
        view: hull.view,
        scrollRow: hull.scrollRow,
        visibleRows: hull.visibleRows,
        rowCount: group.nodes.length,
        footerHeight: hull.view === "list" && !hull.collapsed
          ? HULL_LIST_FOOTER_HEIGHT
          : 0,
        inHub: {
          x: groupLeft - GROUP_HUB_MARGIN,
          y: centerY,
        },
        outHub: {
          x: groupLeft + group.width + GROUP_HUB_MARGIN,
          y: centerY,
        },
        topHub: {
          x: groupLeft + group.width / 2,
          y: placedGroupTop - GROUP_HUB_MARGIN,
        },
        bottomHub: {
          x: groupLeft + group.width / 2,
          y: placedGroupTop + group.height + GROUP_HUB_MARGIN,
        },
      });
      groupTop += hull.height + groupGap;
    }
  }

  const orderedNodes = nodeLayouts.toSorted(compareNodeLayout);
  const orderedGroups = groupLayouts.toSorted(compareGroupLayout);
  const routingObstacles = buildRoutingObstacles(
    orderedGroups,
    obstacleMargin,
  );
  const nodeByKey = new Map(orderedNodes.map((node) => [node.key, node]));
  const laneIndex = new Map(
    OVERVIEW_LANES.map((lane, index) => [lane.id, index]),
  );
  const lanes: OverviewThreadD3FlowLaneLayout[] = OVERVIEW_LANES.map((lane) => {
    const x = laneX.get(lane.id)!;
    return {
      lane: lane.id,
      title: lane.title,
      color: lane.color,
      x,
      headerY: LANE_HEADER_Y,
      entryX: x - laneHubOffset,
      exitX: x + laneHubOffset,
      nodeCount: orderedNodes.filter((node) => node.lane === lane.id).length,
    };
  });
  const bumpLine = line<OverviewThreadD3FlowPoint>()
    .x((point: OverviewThreadD3FlowPoint) => point.x)
    .y((point: OverviewThreadD3FlowPoint) => point.y)
    .curve(curveBumpX);
  const segmentByKey = new Map<string, MutableSegment>();
  const routes: OverviewThreadD3FlowRoute[] = [];
  const unroutedEdgeKeys = new Set<string>();
  const markEdgesUnrouted = (edgeKeys: readonly string[]): void => {
    for (const edgeKey of edgeKeys) unroutedEdgeKeys.add(edgeKey);
  };
  const edgesByPair = new Map<string, ResolvedCableEdge[]>();
  // Pass 1 — resolve every recorded relation onto the board, and collect the
  // complete fan-in demand before any field is solved.
  const fanInFields = new OverviewThreadD3CableFanInFields();
  const hullByKey = new Map<string, FlowCableHull>(
    orderedGroups.map((group) => [
      group.key,
      { ...group, hubMargin: GROUP_HUB_MARGIN },
    ]),
  );
  const resolvedEdges: ResolvedCableEdge[] = [];
  const localEdges: {
    readonly edge: OverviewThreadD3FlowEdgeInput;
    readonly sourceNode: OverviewThreadD3FlowNodeLayout;
    readonly targetNode: OverviewThreadD3FlowNodeLayout;
  }[] = [];
  for (
    const edge of edges.toSorted((left, right) =>
      left.key.localeCompare(right.key)
    )
  ) {
    const sourceNode = nodeByKey.get(edge.fromKey);
    const targetNode = nodeByKey.get(edge.toKey);
    if (!sourceNode || !targetNode || sourceNode.key === targetNode.key) {
      unroutedEdgeKeys.add(edge.key);
      continue;
    }
    const sourceHull = hullByKey.get(
      overviewThreadD3FlowGroupIdentity(sourceNode.lane, sourceNode.groupKey),
    );
    const targetHull = hullByKey.get(
      overviewThreadD3FlowGroupIdentity(targetNode.lane, targetNode.groupKey),
    );
    if (!sourceHull || !targetHull) {
      unroutedEdgeKeys.add(edge.key);
      continue;
    }
    // Leaves of one hull are wired inside it: no hub, no trunk, no corridor.
    if (sourceHull.key === targetHull.key) {
      localEdges.push({ edge, sourceNode, targetNode });
      continue;
    }
    const direction = cableDirection(sourceNode, targetNode, laneIndex);
    const sides = direction === "same-lane"
      ? overviewThreadD3CableHullSides(sourceHull, targetHull)
      : crossLaneCableSides(sourceHull, targetHull, direction);
    const source = overviewThreadD3CableTerminal(
      sourceHull,
      sourceNode,
      sides.source,
      "source",
    );
    const target = overviewThreadD3CableTerminal(
      targetHull,
      targetNode,
      sides.target,
      "target",
    );
    if (!sourceHull.collapsed && !sourceNode.folded) {
      fanInFields.demand(source, edge.pathCount);
    }
    if (!targetHull.collapsed && !targetNode.folded) {
      fanInFields.demand(target, edge.pathCount);
    }
    resolvedEdges.push({ edge, source, target, direction });
  }
  fanInFields.solve((hull) => buildNodeFanInObstacles(orderedGroups, hull.key));

  const addSegment = (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ): string => {
    let segment = segmentByKey.get(spec.key);
    if (!segment) {
      // Shared segments are deduplicated before SVG path generation. This is
      // material at 500+ exact routes, where most calls only merge metadata.
      const generated = spec.d ??
        (spec.curve === "bump"
          ? bumpLine(spec.points)
          : spec.curve === "rounded"
          ? overviewThreadD3FlowRoundedPath(spec.points)
          : undefined);
      if (!generated) return "";
      segment = {
        key: spec.key,
        kind: spec.kind,
        d: generated,
        curve: spec.curve,
        topologySignature: spec.topologySignature ??
          segmentTopologySignature(spec),
        points: spec.points,
        roles: new Set(),
        directions: new Set(),
        pathKeys: new Set(),
        edgeKeys: new Set(),
        fromKeys: new Set(),
        toKeys: new Set(),
        pairKeys: new Set(),
        corridorKeys: new Set(),
        pathCount: 0,
        emphasis: false,
      };
      segmentByKey.set(spec.key, segment);
    }
    segment.roles.add(spec.role);
    segment.directions.add(spec.direction);
    segment.fromKeys.add(edge.fromKey);
    segment.toKeys.add(edge.toKey);
    if (spec.pairKey) segment.pairKeys.add(spec.pairKey);
    if (spec.corridorKey) segment.corridorKeys.add(spec.corridorKey);
    segment.emphasis ||= edge.emphasis;
    for (const pathKey of edge.pathKeys) segment.pathKeys.add(pathKey);
    if (!segment.edgeKeys.has(edge.key)) {
      segment.edgeKeys.add(edge.key);
      segment.pathCount += edge.pathCount;
    }
    return spec.key;
  };

  // Pass 2 — local cables, entirely inside one hull.
  for (const { edge, sourceNode, targetNode } of localEdges) {
    const routeSegmentKeys: string[] = [];
    const hull = hullByKey.get(
      overviewThreadD3FlowGroupIdentity(sourceNode.lane, sourceNode.groupKey),
    );
    if (!hull) {
      unroutedEdgeKeys.add(edge.key);
      continue;
    }
    const routed = addIntraGroupRoute(
      edge,
      sourceNode,
      targetNode,
      hull.x + hull.width,
      addSegment,
      routeSegmentKeys,
    );
    if (routed) routes.push(exactRoute(edge, routeSegmentKeys));
    else unroutedEdgeKeys.add(edge.key);
  }

  // Pass 3 — relations between two hulls share the trunk of their pair.
  for (const resolved of resolvedEdges) {
    const pairKey = directedPairKey(resolved.source.hull, resolved.target.hull);
    edgesByPair.set(pairKey, [...(edgesByPair.get(pairKey) ?? []), resolved]);
  }

  const cablePairs = [...edgesByPair.entries()]
    .map(([pairKey, pairEdges]) =>
      buildCablePair(pairKey, pairEdges, laneIndex)
    )
    .toSorted((left, right) => left.key.localeCompare(right.key));
  const corridors = clusterCablePairs(
    cablePairs,
    options.previousRoutingState,
    corridorCaptureDistance,
    corridorReleaseDistance,
  );

  for (const corridor of corridors) {
    let jointCorridor: ReturnType<typeof buildOverviewThreadD3JointCorridor>;
    try {
      // Trunks are solved per pair, not per edge: every relation between the
      // same two hulls shares one physical cable, which is what makes the
      // corridor read as a bundle instead of parallel lookalike strands.
      jointCorridor = buildOverviewThreadD3JointCorridor({
        trajectories: corridor.pairs.map((pair) => ({
          key: pair.key,
          bundleKey: corridor.id,
          sourceAnchor: pair.sourceHub,
          sourceTangent: overviewThreadD3CableDepartureTangent(pair.sourceSide),
          targetAnchor: pair.targetHub,
          targetTangent: overviewThreadD3CableArrivalTangent(pair.targetSide),
          weight: pair.pathCount,
          // A hull the operator resized can end up covering its neighbours.
          // Treating those neighbours as walls would strand every relation
          // crossing them, so a hull that overlaps an endpoint hull stops
          // being an obstacle for that trunk: the cable is drawn, and the
          // overlap stays the operator's to resolve.
          excludedObstacleKeys: [
            pair.sourceGroup.key,
            pair.targetGroup.key,
            ...overlappingObstacleKeys(pair.sourceGroup, routingObstacles),
            ...overlappingObstacleKeys(pair.targetGroup, routingObstacles),
          ],
        })),
        obstacles: routingObstacles,
      });
    } catch {
      markEdgesUnrouted(
        corridor.pairs.flatMap((pair) =>
          pair.edges.map((resolved) => resolved.edge.key)
        ),
      );
      continue;
    }
    for (const pair of corridor.pairs) {
      const trunk = jointCorridor.routes.get(pair.key);
      if (!trunk) {
        markEdgesUnrouted(pair.edges.map((resolved) => resolved.edge.key));
        continue;
      }
      for (const resolved of pair.edges) {
        const sourceAtEdge = resolved.source.hull.collapsed ||
          resolved.source.leaf.folded;
        const targetAtEdge = resolved.target.hull.collapsed ||
          resolved.target.leaf.folded;
        const sourceBranch = sourceAtEdge
          ? undefined
          : fanInFields.branchFor(resolved.source);
        const targetBranch = targetAtEdge
          ? undefined
          : fanInFields.branchFor(resolved.target);
        if (
          (!sourceAtEdge && !sourceBranch) || (!targetAtEdge && !targetBranch)
        ) {
          unroutedEdgeKeys.add(resolved.edge.key);
          continue;
        }
        const routeSegmentKeys: string[] = [];
        if (sourceBranch) {
          appendNodeBranch(
            resolved.edge,
            resolved.source,
            resolved.direction,
            pair.key,
            corridor.id,
            sourceBranch,
            addSegment,
            routeSegmentKeys,
          );
        } else {
          appendHullEdgeStub(
            resolved.edge,
            resolved.source,
            resolved.direction,
            pair.key,
            corridor.id,
            addSegment,
            routeSegmentKeys,
          );
        }
        pushKey(
          routeSegmentKeys,
          addSegment({
            key: structuredKey("pair-trunk", [pair.key]),
            kind: "bundle-trunk",
            role: "shared",
            direction: resolved.direction,
            points: trunk.points,
            curve: trunk.curve,
            d: trunk.d,
            pairKey: pair.key,
            corridorKey: corridor.id,
            topologySignature: trunk.topologySignature,
          }, resolved.edge),
        );
        if (targetBranch) {
          appendNodeBranch(
            resolved.edge,
            resolved.target,
            resolved.direction,
            pair.key,
            corridor.id,
            targetBranch,
            addSegment,
            routeSegmentKeys,
          );
        } else {
          appendHullEdgeStub(
            resolved.edge,
            resolved.target,
            resolved.direction,
            pair.key,
            corridor.id,
            addSegment,
            routeSegmentKeys,
          );
        }
        routes.push(exactRoute(resolved.edge, routeSegmentKeys));
      }
    }
  }

  const segments = [...segmentByKey.values()]
    .map(finalizeSegment)
    .toSorted(compareSegment);

  return {
    viewBox: [0, 0, width, layoutHeight],
    viewportHeight: Math.min(viewportHeight, layoutHeight),
    nodes: orderedNodes,
    groups: orderedGroups,
    lanes,
    segments,
    routes: routes.toSorted((left, right) =>
      left.edgeKey.localeCompare(right.edgeKey)
    ),
    unroutedEdgeKeys: [...unroutedEdgeKeys].toSorted(),
    nextRoutingState: {
      corridors: corridors.map((corridor) => ({
        id: corridor.id,
        partitionKey: corridor.partitionKey,
        pairKeys: corridor.pairs.map((pair) => pair.key).toSorted(),
      })),
    },
  };
}

function buildLaneTree(
  lane: EngineeringPathLaneId,
  nodes: readonly OverviewThreadD3FlowNodeInput[],
): LaneTreeDatum {
  const grouped = new Map<string, OverviewThreadD3FlowNodeInput[]>();
  for (const node of nodes) {
    const groupKey = normalizedGroupKey(node.groupKey);
    const group = grouped.get(groupKey) ?? [];
    group.push(node);
    grouped.set(groupKey, group);
  }
  return {
    kind: "lane",
    key: structuredKey("lane", [lane]),
    lane,
    children: [...grouped.entries()].map(([groupKey, groupNodes]) => ({
      kind: "group",
      key: flowGroupKey(lane, groupKey),
      lane,
      groupKey,
      children: groupNodes.map((node) => ({
        kind: "leaf",
        key: structuredKey("leaf", [node.key]),
        lane,
        groupKey,
        node,
      })),
    })),
  };
}

function buildLaneMatrixPlan(
  lane: EngineeringPathLaneId,
  nodes: readonly OverviewThreadD3FlowNodeInput[],
  nodeSize: number,
  nodeGap: number,
  maximumColumns: number,
  groupGap: number,
): LaneMatrixPlan {
  const laneRoot = hierarchy<LaneTreeDatum>(
    buildLaneTree(lane, nodes.toSorted(compareNodeInput)),
    (datum: LaneTreeDatum) => datum.children,
  );
  const groups: GroupMatrixPlan[] = [];
  for (const groupPoint of laneRoot.children ?? []) {
    if (groupPoint.data.kind !== "group") continue;
    const groupNodes = groupPoint.leaves().flatMap(
      (leaf: HierarchyNode<LaneTreeDatum>) =>
        leaf.data.node ? [leaf.data.node] : [],
    ).toSorted(compareNodeInput);
    if (groupNodes.length === 0) continue;
    const columns = Math.min(
      maximumColumns,
      Math.max(1, Math.ceil(Math.sqrt(groupNodes.length))),
    );
    const rows = Math.ceil(groupNodes.length / columns);
    groups.push({
      groupKey: groupPoint.data.groupKey!,
      nodes: groupNodes,
      columns,
      rows,
      width: columns * nodeSize + Math.max(0, columns - 1) * nodeGap,
      height: rows * nodeSize + Math.max(0, rows - 1) * nodeGap,
    });
  }
  const laneWidth = Math.max(
    ...groups.map((group) => group.width),
  );
  const uniform = groups.map((group) => ({ ...group, width: laneWidth }));
  return {
    lane,
    groups: uniform,
    contentHeight: uniform.reduce((height, group) => height + group.height, 0) +
      Math.max(0, uniform.length - 1) * groupGap,
  };
}

/**
 * Lead from the hull's own edge out to its hub.
 *
 * Used when the leaf itself is not on screen — the hull is folded, or the row
 * is scrolled out of the list window. There is nothing to fan into, so every
 * relation crossing that side shares one stub, and the cable lands on the hull
 * rather than starting in mid-air twenty units away from it.
 */
function appendHullEdgeStub(
  edge: OverviewThreadD3FlowEdgeInput,
  terminal: FlowCableTerminal,
  direction: OverviewThreadD3FlowRouteDirection,
  pairKey: string,
  corridorKey: string | undefined,
  addSegment: (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ) => string,
  route: string[],
): void {
  const band = overviewThreadD3CableAnchor(terminal.hull, terminal.side);
  const points = terminal.role === "source"
    ? [band, terminal.hub]
    : [terminal.hub, band];
  pushKey(
    route,
    addSegment({
      key: structuredKey("folded-hull-stub", [
        terminal.role,
        terminal.side,
        terminal.hull.key,
      ]),
      kind: "node-branch",
      role: terminal.role,
      direction,
      points,
      curve: "rounded",
      pairKey,
      corridorKey,
    }, edge),
  );
}

function appendNodeBranch(
  edge: OverviewThreadD3FlowEdgeInput,
  terminal: FlowCableTerminal,
  direction: OverviewThreadD3FlowRouteDirection,
  pairKey: string,
  corridorKey: string | undefined,
  branch: OverviewThreadD3NodeFanInRoute,
  addSegment: (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ) => string,
  route: string[],
): void {
  pushKey(
    route,
    addSegment({
      // Role is part of the identity because the same physical branch is
      // traversed in opposite orientations by A→B and B→A.
      key: structuredKey("node-branch", [
        terminal.role,
        terminal.side,
        terminal.leaf.key,
      ]),
      kind: "node-branch",
      role: terminal.role,
      direction,
      points: branch.points,
      curve: "catmull-rom",
      d: branch.d,
      topologySignature: branch.topologySignature,
      pairKey,
      corridorKey,
    }, edge),
  );
}

/**
 * Lane order owns the relation's recorded direction. Placement never rewrites
 * it: moving a hull changes which sides a cable uses, never what it records.
 */
function cableDirection(
  sourceNode: OverviewThreadD3FlowNodeLayout,
  targetNode: OverviewThreadD3FlowNodeLayout,
  laneIndex: ReadonlyMap<EngineeringPathLaneId, number>,
): OverviewThreadD3FlowRouteDirection {
  const sourceLaneIndex = laneIndex.get(sourceNode.lane)!;
  const targetLaneIndex = laneIndex.get(targetNode.lane)!;
  if (sourceLaneIndex === targetLaneIndex) return "same-lane";
  return sourceLaneIndex < targetLaneIndex ? "forward" : "reverse";
}

/**
 * Relations between engineering lanes keep a horizontal, hierarchical flow.
 *
 * Selecting top/bottom only because two freely moved hulls are far apart on
 * Y can place a hub inside a neighbouring hull in the same lane stack. It
 * also makes the recorded left-to-right process read as a vertical cable.
 * The actual X order still owns the physical side, so moving a hull through
 * another one flips its anchors without rewriting relation direction.
 */
/**
 * Sides for a relation whose hulls sit too close for facing hubs.
 *
 * When two freely moved hulls leave no corridor for facing hubs, both ends
 * take the top port for that frame rather than dropping the relation or
 * occupying the coinciding hub. A clear horizontal corridor still uses the
 * shared anchorage vocabulary.
 */
function crossLaneCableSides(
  source: FlowCableHull,
  target: FlowCableHull,
  direction: Exclude<OverviewThreadD3FlowRouteDirection, "same-lane">,
): {
  readonly source: OverviewThreadD3FlowCableSide;
  readonly target: OverviewThreadD3FlowCableSide;
} {
  const deltaX = (target.x + target.width / 2) -
    (source.x + source.width / 2);
  const horizontalGap = deltaX >= 0
    ? target.x - (source.x + source.width)
    : source.x - (target.x + target.width);
  const facingHubSpan = horizontalGap - source.hubMargin - target.hubMargin;
  const branchClearance = Math.min(source.hubMargin, target.hubMargin) +
    NODE_FAN_IN_OBSTACLE_MARGIN;

  if (
    horizontalGap <= branchClearance ||
    Math.abs(facingHubSpan) <= ROUTE_CLEARANCE
  ) {
    return { source: "top", target: "top" };
  }
  return overviewThreadD3CableHullSides(
    source,
    target,
    direction === "reverse" ? "right-to-left" : "left-to-right",
  );
}

function directedPairKey(
  source: OverviewThreadD3FlowGroupLayout,
  target: OverviewThreadD3FlowGroupLayout,
): string {
  return structuredKey("directed-pair", [source.key, target.key]);
}

/** Hulls whose inflated box intersects `hull`, and so cannot bound it. */
function overlappingObstacleKeys(
  hull: OverviewThreadD3FlowGroupLayout,
  obstacles: readonly RoutingObstacle[],
): readonly string[] {
  return obstacles.filter((obstacle) =>
    obstacle.key !== hull.key &&
    obstacle.minimumX < hull.x + hull.width &&
    obstacle.maximumX > hull.x &&
    obstacle.minimumY < hull.y + hull.height &&
    obstacle.maximumY > hull.y
  ).map((obstacle) => obstacle.key);
}

function buildRoutingObstacles(
  groups: readonly OverviewThreadD3FlowGroupLayout[],
  margin: number,
): readonly RoutingObstacle[] {
  return groups.map((group) => ({
    key: group.key,
    lane: group.lane,
    minimumX: group.x - margin,
    maximumX: group.x + group.width + margin,
    minimumY: group.y - margin,
    maximumY: group.y + group.height + margin,
  })).toSorted((left, right) => left.key.localeCompare(right.key));
}

/**
 * Hulls a fan-in field must avoid.
 *
 * Its own hull is excluded, and so is any hull overlapping it: an operator who
 * resizes a hull over its neighbour must not thereby wall in every branch
 * inside it. The overlap stays visible and stays theirs to resolve; the
 * relations keep their cables meanwhile.
 */
function buildNodeFanInObstacles(
  groups: readonly OverviewThreadD3FlowGroupLayout[],
  owningGroupKey: string,
): readonly OverviewThreadD3CableObstacle[] {
  const owner = groups.find((group) => group.key === owningGroupKey);
  return groups.filter((group) =>
    group.key !== owningGroupKey &&
    !(owner !== undefined &&
      group.x < owner.x + owner.width && group.x + group.width > owner.x &&
      group.y < owner.y + owner.height && group.y + group.height > owner.y)
  ).map((
    group,
  ) => ({
    key: group.key,
    minimumX: group.x - NODE_FAN_IN_OBSTACLE_MARGIN,
    maximumX: group.x + group.width + NODE_FAN_IN_OBSTACLE_MARGIN,
    minimumY: group.y - NODE_FAN_IN_OBSTACLE_MARGIN,
    maximumY: group.y + group.height + NODE_FAN_IN_OBSTACLE_MARGIN,
  })).toSorted((left, right) => left.key.localeCompare(right.key));
}

/**
 * Conservative SVG path for a routed waypoint polyline. Interior corners
 * become quadratic fillets (`Q`) whose radius is capped and shortened by the
 * adjacent segments. Two-point routes stay a single `L`. If a corner is too
 * short or already collinear, that vertex stays linear instead of inventing a
 * curve that could cut a hull.
 */
export function overviewThreadD3FlowRoundedPath(
  points: readonly OverviewThreadD3FlowPoint[],
): string {
  const simplified = compactRoutePoints(points);
  if (simplified.length === 0) return "";
  const first = simplified[0]!;
  if (simplified.length === 1) {
    return `M ${formatRoutedPathNumber(first.x)} ${
      formatRoutedPathNumber(first.y)
    }`;
  }
  if (simplified.length === 2) {
    const last = simplified[1]!;
    return `M ${formatRoutedPathNumber(first.x)} ${
      formatRoutedPathNumber(first.y)
    } L ${formatRoutedPathNumber(last.x)} ${formatRoutedPathNumber(last.y)}`;
  }

  const parts: string[] = [
    `M ${formatRoutedPathNumber(first.x)} ${formatRoutedPathNumber(first.y)}`,
  ];
  let cursor = first;
  const lastIndex = simplified.length - 1;
  for (let index = 1; index < lastIndex; index++) {
    const previous = simplified[index - 1]!;
    const current = simplified[index]!;
    const next = simplified[index + 1]!;
    const fillet = conservativeQuadraticFillet(previous, current, next);
    if (!fillet) {
      appendRoutedLinear(parts, cursor, current);
      cursor = current;
      continue;
    }
    appendRoutedLinear(parts, cursor, fillet.start);
    parts.push(
      `Q ${formatRoutedPathNumber(current.x)} ${
        formatRoutedPathNumber(current.y)
      } ${formatRoutedPathNumber(fillet.end.x)} ${
        formatRoutedPathNumber(fillet.end.y)
      }`,
    );
    cursor = fillet.end;
  }
  appendRoutedLinear(parts, cursor, simplified[lastIndex]!);
  return parts.join(" ");
}

function conservativeQuadraticFillet(
  previous: OverviewThreadD3FlowPoint,
  current: OverviewThreadD3FlowPoint,
  next: OverviewThreadD3FlowPoint,
): {
  readonly start: OverviewThreadD3FlowPoint;
  readonly end: OverviewThreadD3FlowPoint;
} | undefined {
  const incomingX = current.x - previous.x;
  const incomingY = current.y - previous.y;
  const outgoingX = next.x - current.x;
  const outgoingY = next.y - current.y;
  const incomingLength = Math.hypot(incomingX, incomingY);
  const outgoingLength = Math.hypot(outgoingX, outgoingY);
  if (incomingLength <= ROUTE_CLEARANCE || outgoingLength <= ROUTE_CLEARANCE) {
    return undefined;
  }
  const cross = incomingX * outgoingY - incomingY * outgoingX;
  if (
    Math.abs(cross) <=
      incomingLength * outgoingLength * ROUTED_FILLET_TURN_EPSILON
  ) {
    return undefined;
  }
  const radius = Math.min(
    ROUTED_FILLET_MAX_RADIUS,
    incomingLength * 0.5,
    outgoingLength * 0.5,
  );
  if (radius <= ROUTE_CLEARANCE) return undefined;
  return {
    start: {
      x: current.x - (incomingX / incomingLength) * radius,
      y: current.y - (incomingY / incomingLength) * radius,
    },
    end: {
      x: current.x + (outgoingX / outgoingLength) * radius,
      y: current.y + (outgoingY / outgoingLength) * radius,
    },
  };
}

function appendRoutedLinear(
  parts: string[],
  from: OverviewThreadD3FlowPoint,
  to: OverviewThreadD3FlowPoint,
): void {
  if (from.x === to.x && from.y === to.y) return;
  parts.push(
    `L ${formatRoutedPathNumber(to.x)} ${formatRoutedPathNumber(to.y)}`,
  );
}

function formatRoutedPathNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function compactRoutePoints(
  points: readonly OverviewThreadD3FlowPoint[],
): readonly OverviewThreadD3FlowPoint[] {
  const unique: OverviewThreadD3FlowPoint[] = [];
  for (const point of points) {
    const previous = unique.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    unique.push(point);
  }
  return unique.filter((point, index) => {
    if (index === 0 || index === unique.length - 1) return true;
    const previous = unique[index - 1]!;
    const next = unique[index + 1]!;
    return (point.x - previous.x) * (next.y - point.y) !==
      (point.y - previous.y) * (next.x - point.x);
  });
}

function buildCablePair(
  pairKey: string,
  edges: readonly ResolvedCableEdge[],
  laneIndex: ReadonlyMap<EngineeringPathLaneId, number>,
): CablePair {
  const orderedEdges = edges.toSorted((left, right) =>
    left.edge.key.localeCompare(right.edge.key)
  );
  const first = orderedEdges[0]!;
  const sourceLaneIndex = laneIndex.get(first.source.leaf.lane)!;
  const targetLaneIndex = laneIndex.get(first.target.leaf.lane)!;
  const physicalDirection = first.target.hub.x === first.source.hub.x
    ? first.direction === "forward" ? "left-to-right" : "right-to-left"
    : first.target.hub.x > first.source.hub.x
    ? "left-to-right"
    : "right-to-left";
  const minimumLaneIndex = Math.min(sourceLaneIndex, targetLaneIndex);
  const maximumLaneIndex = Math.max(sourceLaneIndex, targetLaneIndex);
  const minimumX = Math.min(first.source.hub.x, first.target.hub.x);
  const maximumX = Math.max(first.source.hub.x, first.target.hub.x);
  return {
    key: pairKey,
    // The axis belongs to the partition: a vertical exchange never shares a
    // corridor with a lateral one, however close their hubs happen to sit.
    partitionKey: structuredKey("corridor-partition", [
      OVERVIEW_LANES[minimumLaneIndex]!.id,
      OVERVIEW_LANES[maximumLaneIndex]!.id,
      first.source.side,
      first.target.side,
      physicalDirection,
    ]),
    physicalDirection,
    sourceSide: first.source.side,
    targetSide: first.target.side,
    sourceGroup: first.source.hull,
    targetGroup: first.target.hull,
    sourceHub: first.source.hub,
    targetHub: first.target.hub,
    leftY: physicalDirection === "left-to-right"
      ? first.source.hub.y
      : first.target.hub.y,
    rightY: physicalDirection === "left-to-right"
      ? first.target.hub.y
      : first.source.hub.y,
    minimumX,
    maximumX,
    edges: orderedEdges,
    pathCount: orderedEdges.reduce(
      (count, resolved) => count + resolved.edge.pathCount,
      0,
    ),
  };
}

function clusterCablePairs(
  pairs: readonly CablePair[],
  previousState: OverviewThreadD3FlowRoutingState | undefined,
  captureDistance: number,
  releaseDistance: number,
): readonly CorridorCluster[] {
  const previousTogether = previousCorridorPairKeys(previousState);
  const previousTokenByPair = previousCorridorTokens(previousState, pairs);
  const pairsByPartition = new Map<string, CablePair[]>();
  for (const pair of pairs) {
    const partition = pairsByPartition.get(pair.partitionKey) ?? [];
    partition.push(pair);
    pairsByPartition.set(pair.partitionKey, partition);
  }

  const result: CorridorCluster[] = [];
  for (
    const [partitionKey, partitionPairs] of [...pairsByPartition.entries()]
      .toSorted(([left], [right]) => left.localeCompare(right))
  ) {
    const mutableClusters: CablePair[][] = [];
    const orderedPairs = partitionPairs.toSorted((left, right) => {
      const leftToken = previousTokenByPair.get(left.key);
      const rightToken = previousTokenByPair.get(right.key);
      if (leftToken || rightToken) {
        if (!leftToken) return 1;
        if (!rightToken) return -1;
        const tokenOrder = leftToken.localeCompare(rightToken);
        if (tokenOrder !== 0) return tokenOrder;
      }
      return left.leftY - right.leftY || left.rightY - right.rightY ||
        left.key.localeCompare(right.key);
    });

    for (const pair of orderedPairs) {
      const candidates = mutableClusters.flatMap((cluster, index) => {
        if (!clusterSharesHorizontalSpan([...cluster, pair])) return [];
        let maximumDistance = 0;
        for (const member of cluster) {
          const distance = cablePairDistance(member, pair);
          const pairStateKey = previousPairStateKey(
            partitionKey,
            member.key,
            pair.key,
          );
          const threshold = previousTogether.has(pairStateKey)
            ? releaseDistance
            : captureDistance;
          if (distance > threshold) return [];
          maximumDistance = Math.max(maximumDistance, distance);
        }
        return [{
          index,
          maximumDistance,
          anchor: cluster.map((member) => member.key).toSorted()[0]!,
        }];
      }).toSorted((left, right) =>
        left.maximumDistance - right.maximumDistance ||
        left.anchor.localeCompare(right.anchor)
      );
      const selected = candidates[0];
      if (selected) mutableClusters[selected.index]!.push(pair);
      else mutableClusters.push([pair]);
    }

    for (const cluster of mutableClusters) {
      // Bundle rank must follow the trunks' own vertical order: ranked
      // lexically, two trunks whose hubs are stacked get inverted offsets and
      // cross in mid-run. The corridor's identity stays lexical so it survives
      // a drag frame unchanged.
      const orderedCluster = cluster.toSorted((left, right) =>
        left.leftY - right.leftY || left.rightY - right.rightY ||
        left.key.localeCompare(right.key)
      );
      const lexicalFirst = cluster.toSorted((left, right) =>
        left.key.localeCompare(right.key)
      )[0]!;
      // The ID is derived from live lexical identities. Caller state may
      // influence only the release threshold, never choose an identifier.
      const id = structuredKey("corridor", [partitionKey, lexicalFirst.key]);
      result.push({ id, partitionKey, pairs: orderedCluster });
    }
  }
  return result.toSorted((left, right) => left.id.localeCompare(right.id));
}

function previousCorridorPairKeys(
  state: OverviewThreadD3FlowRoutingState | undefined,
): ReadonlySet<string> {
  const together = new Set<string>();
  for (const corridor of state?.corridors ?? []) {
    const pairKeys = [...new Set(corridor.pairKeys)].toSorted();
    for (let leftIndex = 0; leftIndex < pairKeys.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < pairKeys.length;
        rightIndex++
      ) {
        together.add(
          previousPairStateKey(
            corridor.partitionKey,
            pairKeys[leftIndex]!,
            pairKeys[rightIndex]!,
          ),
        );
      }
    }
  }
  return together;
}

function previousCorridorTokens(
  state: OverviewThreadD3FlowRoutingState | undefined,
  pairs: readonly CablePair[],
): ReadonlyMap<string, string> {
  const currentByKey = new Map(pairs.map((pair) => [pair.key, pair]));
  const tokenByPair = new Map<string, string>();
  for (const corridor of state?.corridors ?? []) {
    const currentPairKeys = [...new Set(corridor.pairKeys)]
      .filter((pairKey) =>
        currentByKey.get(pairKey)?.partitionKey === corridor.partitionKey
      )
      .toSorted();
    if (currentPairKeys.length === 0) continue;
    const token = structuredKey("previous-corridor", [
      corridor.partitionKey,
      ...currentPairKeys,
    ]);
    for (const pairKey of currentPairKeys) {
      const current = tokenByPair.get(pairKey);
      if (!current || token.localeCompare(current) < 0) {
        tokenByPair.set(pairKey, token);
      }
    }
  }
  return tokenByPair;
}

function previousPairStateKey(
  partitionKey: string,
  leftPairKey: string,
  rightPairKey: string,
): string {
  const pairKeys = [leftPairKey, rightPairKey].toSorted();
  return structuredKey("previous-pair", [
    partitionKey,
    pairKeys[0]!,
    pairKeys[1]!,
  ]);
}

function cablePairDistance(
  left: CablePair,
  right: CablePair,
): number {
  return Math.max(
    Math.abs(left.leftY - right.leftY),
    Math.abs(left.rightY - right.rightY),
  );
}

function clusterSharesHorizontalSpan(
  pairs: readonly CablePair[],
): boolean {
  const sharedMinimum = Math.max(...pairs.map((pair) => pair.minimumX));
  const sharedMaximum = Math.min(...pairs.map((pair) => pair.maximumX));
  return sharedMinimum <= sharedMaximum;
}

function exactRoute(
  edge: OverviewThreadD3FlowEdgeInput,
  segmentKeys: readonly string[],
): OverviewThreadD3FlowRoute {
  return {
    edgeKey: edge.key,
    fromKey: edge.fromKey,
    toKey: edge.toKey,
    segmentKeys,
    pathCount: edge.pathCount,
    pathKeys: edge.pathKeys,
  };
}

/**
 * Two leaves of one immutable hull are already neighbours. Their cable stays
 * local instead of leaving the hull for a shared junction and returning, which
 * reads as a spur pointing into empty board.
 */
function addIntraGroupRoute(
  edge: OverviewThreadD3FlowEdgeInput,
  sourceNode: OverviewThreadD3FlowNodeLayout,
  targetNode: OverviewThreadD3FlowNodeLayout,
  hullRight: number,
  addSegment: (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ) => string,
  route: string[],
): boolean {
  const key = structuredKey("intra-group-cable", [
    sourceNode.key,
    targetNode.key,
  ]);
  const columnGap = targetNode.centerX - sourceNode.centerX;
  const stacked = Math.abs(columnGap) < sourceNode.width;
  // Two leaves in one column are wired out to a run alongside the hull and
  // back, the way a cable follows the edge of a rack instead of cutting across
  // the next column of ports.
  const runX = hullRight + INTRA_GROUP_BOW;
  const points = stacked
    ? [
      sourceNode.rightPort,
      { x: runX, y: sourceNode.centerY },
      { x: runX, y: targetNode.centerY },
      targetNode.rightPort,
    ]
    : columnGap > 0
    ? [sourceNode.rightPort, targetNode.leftPort]
    : [sourceNode.leftPort, targetNode.rightPort];
  const segmentKey = addSegment({
    key,
    kind: "same-lane-trunk",
    role: "shared",
    direction: "same-lane",
    points,
    curve: stacked ? "rounded" : "bump",
  }, edge);
  if (!segmentKey) return false;
  pushKey(route, segmentKey);
  return true;
}

function finalizeSegment(
  segment: MutableSegment,
): OverviewThreadD3FlowSegmentLayout {
  const roles = [...segment.roles];
  const directions = [...segment.directions];
  return {
    key: segment.key,
    kind: segment.kind,
    role: roles.length === 1 ? roles[0]! : "shared",
    direction: directions.length === 1 ? directions[0]! : "mixed",
    curve: segment.curve,
    d: segment.d,
    topologySignature: segment.topologySignature,
    points: segment.points,
    pathCount: segment.pathCount,
    width: segmentWidth(segment.kind, segment.pathCount),
    pathKeys: [...segment.pathKeys].toSorted(),
    edgeKeys: [...segment.edgeKeys].toSorted(),
    fromKeys: [...segment.fromKeys].toSorted(),
    toKeys: [...segment.toKeys].toSorted(),
    pairKeys: [...segment.pairKeys].toSorted(),
    corridorKeys: [...segment.corridorKeys].toSorted(),
    emphasis: segment.emphasis,
  };
}

function segmentWidth(
  kind: OverviewThreadD3FlowSegmentKind,
  pathCount: number,
): number {
  const minimum = kind === "node-branch"
    ? 0.72
    : kind === "pair-feeder"
    ? 0.84
    : 0.95;
  return minimum + Math.min(
    2.5,
    Math.log2(Math.max(0, pathCount) + 1) * 0.34,
  );
}

function segmentTopologySignature(spec: SegmentSpec): string {
  return structuredKey("segment-topology", [
    spec.kind,
    spec.curve,
    ...routeStepSigns(spec.points),
  ]);
}

function routeStepSigns(
  points: readonly OverviewThreadD3FlowPoint[],
): readonly string[] {
  return points.slice(1).map((point, index) => {
    const previous = points[index]!;
    return `${Math.sign(point.x - previous.x)},${
      Math.sign(point.y - previous.y)
    }`;
  });
}

function compareNodeInput(
  left: OverviewThreadD3FlowNodeInput,
  right: OverviewThreadD3FlowNodeInput,
): number {
  return normalizedGroupKey(left.groupKey).localeCompare(
    normalizedGroupKey(right.groupKey),
  ) || left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key);
}

function compareNodeLayout(
  left: OverviewThreadD3FlowNodeLayout,
  right: OverviewThreadD3FlowNodeLayout,
): number {
  return laneOrder(left.lane) - laneOrder(right.lane) ||
    left.y - right.y || left.x - right.x || left.key.localeCompare(right.key);
}

function compareGroupLayout(
  left: OverviewThreadD3FlowGroupLayout,
  right: OverviewThreadD3FlowGroupLayout,
): number {
  return laneOrder(left.lane) - laneOrder(right.lane) ||
    left.centerY - right.centerY || left.key.localeCompare(right.key);
}

function compareSegment(
  left: OverviewThreadD3FlowSegmentLayout,
  right: OverviewThreadD3FlowSegmentLayout,
): number {
  return segmentOrder(left.kind) - segmentOrder(right.kind) ||
    left.key.localeCompare(right.key);
}

function segmentOrder(kind: OverviewThreadD3FlowSegmentKind): number {
  if (kind === "bundle-trunk") return 0;
  if (kind === "pair-feeder") return 1;
  if (kind === "same-lane-trunk") return 2;
  return 3;
}

function laneOrder(lane: EngineeringPathLaneId): number {
  return OVERVIEW_LANES.findIndex((candidate) => candidate.id === lane);
}

function flowGroupKey(lane: EngineeringPathLaneId, groupKey: string): string {
  return structuredKey("group", [lane, groupKey]);
}

function normalizedGroupKey(value: string): string {
  return value.trim() || "__ungrouped__";
}

function largestOverviewGroupSize(
  nodes: readonly OverviewThreadD3FlowNodeInput[],
): number {
  const counts = new Map<string, number>();
  let largest = 0;
  for (const node of nodes) {
    const key = flowGroupKey(node.lane, normalizedGroupKey(node.groupKey));
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    largest = Math.max(largest, count);
  }
  return largest;
}

function structuredKey(prefix: string, values: readonly string[]): string {
  return `${prefix}:${
    values.map((value) => `${value.length}:${value}`).join("|")
  }`;
}

function pushKey(target: string[], key: string): void {
  if (key && target.at(-1) !== key) target.push(key);
}

function assertUniqueNodeKeys(
  nodes: readonly OverviewThreadD3FlowNodeInput[],
): void {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (keys.has(node.key)) {
      throw new Error(`Duplicate Overview D3 flow node key: ${node.key}`);
    }
    keys.add(node.key);
  }
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

interface ResolvedHullBox {
  readonly width: number;
  readonly height: number;
  readonly columns: number;
  readonly rows: number;
  readonly collapsed: boolean;
  readonly view: OverviewThreadD3FlowHullView;
  readonly scrollRow: number;
  /** Rows the window shows at once, all columns together. */
  readonly visibleRows: number;
}

interface HullOutlineRow {
  readonly node: OverviewThreadD3FlowNodeInput;
}

interface HullOutline {
  readonly rows: readonly HullOutlineRow[];
  /**
   * The single container every other leaf sits under, when the hull has one.
   * It names the hull instead of taking a row inside it — a folder does not
   * list itself. Absent when the hull has several roots: promoting one of them
   * would state a primacy the record never declared.
   */
  readonly promoted?: OverviewThreadD3FlowNodeInput;
}

/**
 * Lay one hull's leaves out, and find the container that names it.
 *
 * Rows are flat, in the hull's own reading order. When a single leaf holds
 * every other one — and only then — it names the hull instead of taking a row
 * inside it: a folder does not list itself. A hull with several roots keeps
 * them all, since promoting one would state a primacy the record never
 * declared.
 */
function hullOutlineRows(
  nodes: readonly OverviewThreadD3FlowNodeInput[],
  sort: OverviewThreadD3FlowHullSort | undefined,
): HullOutline {
  const ordered = sortHullLeaves(nodes, sort);
  const own = new Set(ordered.map((node) => node.key));
  const children = new Map<string, OverviewThreadD3FlowNodeInput[]>();
  let contained = 0;
  for (const node of ordered) {
    const parent = node.parentKey;
    if (parent === undefined || parent === node.key || !own.has(parent)) {
      continue;
    }
    contained += 1;
    children.set(parent, [...(children.get(parent) ?? []), node]);
  }
  const flat = ordered.map((node) => ({ node }));
  if (contained === 0) return { rows: flat };

  const roots = ordered.filter((node) => {
    const parent = node.parentKey;
    return parent === undefined || !own.has(parent);
  });
  const promoted = roots.length === 1 &&
      (children.get(roots[0]!.key) ?? []).length > 0
    ? roots[0]
    : undefined;
  if (!promoted) return { rows: flat };
  return {
    rows: flat.filter((row) => row.node.key !== promoted.key),
    promoted,
  };
}

/**
 * Reading order of one hull's leaves.
 *
 * Ties always fall back to the exact key, so a hull reads the same way twice.
 * Recency uses the record's own timestamp; a leaf without one sorts last
 * rather than being given a date it does not have.
 */
function sortHullLeaves(
  nodes: readonly OverviewThreadD3FlowNodeInput[],
  sort: OverviewThreadD3FlowHullSort | undefined,
): readonly OverviewThreadD3FlowNodeInput[] {
  if (sort === "name") {
    return nodes.toSorted((left, right) =>
      left.label.localeCompare(right.label) ||
      left.key.localeCompare(right.key)
    );
  }
  if (sort === "recent") {
    return nodes.toSorted((left, right) =>
      (right.recordedAt ?? "").localeCompare(left.recordedAt ?? "") ||
      left.key.localeCompare(right.key)
    );
  }
  return nodes;
}

/** Columns a listed hull flows into at this width. */
function hullListColumns(width: number): number {
  if (width >= HULL_LIST_THREE_COLUMN_WIDTH) return 3;
  return width >= HULL_LIST_TWO_COLUMN_WIDTH ? 2 : 1;
}

/**
 * Hull box after an operator resize.
 *
 * A resized hull keeps every leaf: the matrix re-flows to the new width, and
 * the height follows the rows that result unless the operator asked for more.
 * Shrinking below one leaf is refused rather than clipping the contents.
 */
function resolveHullBox(
  group: GroupMatrixPlan,
  placement: OverviewThreadD3FlowGroupPlacement | undefined,
  nodeSize: number,
  nodeGap: number,
): ResolvedHullBox {
  const requestedWidth = finiteOrUndefined(placement?.width);
  const requestedHeight = finiteOrUndefined(placement?.height);
  const collapsed = placement?.collapsed === true;
  // Resizing is what changes the reading: a hull narrower than a name is a
  // field of points, a wider one is a named list that flows into columns. An
  // explicit choice from the band's control overrides the size.
  const sizedWidth = Math.max(nodeSize, requestedWidth ?? group.width);
  const view: OverviewThreadD3FlowHullView = placement?.view ??
    (sizedWidth >= HULL_LIST_MINIMUM_WIDTH ? "list" : "matrix");
  if (collapsed) {
    return {
      width: Math.max(nodeSize, requestedWidth ?? group.width),
      height: HULL_HEADER_HEIGHT,
      columns: group.columns,
      rows: 0,
      collapsed,
      view,
      scrollRow: 0,
      visibleRows: 0,
    };
  }
  if (view === "list") {
    const width = Math.max(HULL_LIST_MINIMUM_WIDTH, sizedWidth);
    const columns = hullListColumns(width);
    // Height is a window on the list, not a scale: the operator chooses how
    // many rows to see, never how big a row is.
    const requestedRows = requestedHeight === undefined
      ? HULL_LIST_DEFAULT_ROWS
      : Math.round(
        (requestedHeight - HULL_HEADER_HEIGHT - HULL_LIST_FOOTER_HEIGHT) /
          HULL_LIST_ROW_HEIGHT,
      );
    const capacity = Math.max(1, Math.ceil(group.nodes.length / columns));
    const visibleRows = clamp(
      requestedRows,
      Math.min(HULL_LIST_MINIMUM_ROWS, capacity),
      Math.max(capacity, requestedRows),
    );
    const scrollRow = clamp(
      Math.round(finiteOrZero(placement?.scrollRow)),
      0,
      Math.max(0, capacity - visibleRows),
    );
    return {
      width,
      height: HULL_HEADER_HEIGHT + visibleRows * HULL_LIST_ROW_HEIGHT +
        HULL_LIST_FOOTER_HEIGHT,
      columns,
      rows: visibleRows,
      collapsed,
      view,
      scrollRow,
      visibleRows,
    };
  }
  if (requestedWidth === undefined && requestedHeight === undefined) {
    return {
      width: group.width,
      height: group.height,
      columns: group.columns,
      rows: group.rows,
      collapsed,
      view,
      scrollRow: 0,
      visibleRows: group.rows,
    };
  }
  const width = Math.max(nodeSize, requestedWidth ?? group.width);
  const columns = Math.max(
    1,
    Math.floor((width + nodeGap) / (nodeSize + nodeGap)),
  );
  const rows = Math.ceil(group.nodes.length / columns);
  const contentHeight = HULL_HEADER_HEIGHT + rows * nodeSize +
    Math.max(0, rows - 1) * nodeGap;
  return {
    width,
    height: Math.max(contentHeight, requestedHeight ?? contentHeight),
    columns,
    rows,
    collapsed,
    view,
    scrollRow: 0,
    visibleRows: rows,
  };
}

function resolveGroupOrigin(
  baseX: number,
  baseY: number,
  placement: OverviewThreadD3FlowGroupPlacement | undefined,
): OverviewThreadD3FlowPoint {
  const requestedX = finiteOrUndefined(placement?.x) ?? baseX;
  const requestedY = finiteOrUndefined(placement?.y) ?? baseY;
  return {
    x: requestedX + finiteOrZero(placement?.offsetX),
    y: requestedY + finiteOrZero(placement?.offsetY),
  };
}

function ownPlacement<T>(
  placements: Readonly<Record<string, T>> | undefined,
  key: string,
): T | undefined {
  return placements && Object.hasOwn(placements, key)
    ? placements[key]
    : undefined;
}

function finiteOrUndefined(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? value : undefined;
}

function finiteOrZero(value: number | undefined): number {
  return finiteOrUndefined(value) ?? 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
