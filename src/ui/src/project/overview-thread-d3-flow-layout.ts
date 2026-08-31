import { hierarchy, type HierarchyNode } from "d3-hierarchy";
import { curveBumpX, line } from "d3-shape";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import {
  buildOverviewThreadD3CableFieldRoute,
  type OverviewThreadD3CableFieldRoute,
  type OverviewThreadD3CableObstacle,
  type OverviewThreadD3CablePoint,
} from "./overview-thread-d3-cable-field.ts";
import {
  buildOverviewThreadD3NodeFanIn,
  type OverviewThreadD3NodeFanInRoute,
  reverseOverviewThreadD3NodeFanInRoute,
} from "./overview-thread-d3-node-fan-in.ts";
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
const DEFAULT_OBSTACLE_MARGIN = MINIMUM_OBSTACLE_MARGIN;
const NODE_FAN_IN_OBSTACLE_MARGIN = 2;
const CABLE_ENDPOINT_GUARD_COUNT = 3;
const CABLE_ENDPOINT_GUARD_LENGTH = 22;
const ROUTE_CLEARANCE = 1;
const ROUTED_FILLET_MAX_RADIUS = 8;
const ROUTED_FILLET_TURN_EPSILON = 0.08;

export interface OverviewThreadD3FlowNodeInput {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey: string;
  readonly label: string;
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
}

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
  readonly inHub: OverviewThreadD3FlowPort;
  readonly outHub: OverviewThreadD3FlowPort;
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

interface ResolvedInterLaneEdge {
  readonly edge: OverviewThreadD3FlowEdgeInput;
  readonly sourceNode: OverviewThreadD3FlowNodeLayout;
  readonly targetNode: OverviewThreadD3FlowNodeLayout;
  readonly sourceGroup: OverviewThreadD3FlowGroupLayout;
  readonly targetGroup: OverviewThreadD3FlowGroupLayout;
  readonly sourceHub: OverviewThreadD3FlowPoint;
  readonly targetHub: OverviewThreadD3FlowPoint;
  readonly sourceSide: "left" | "right";
  readonly targetSide: "left" | "right";
  readonly direction: "forward" | "reverse";
}

interface InterLanePair {
  readonly key: string;
  readonly partitionKey: string;
  readonly physicalDirection: "left-to-right" | "right-to-left";
  readonly sourceGroup: OverviewThreadD3FlowGroupLayout;
  readonly targetGroup: OverviewThreadD3FlowGroupLayout;
  readonly sourceHub: OverviewThreadD3FlowPoint;
  readonly targetHub: OverviewThreadD3FlowPoint;
  readonly leftY: number;
  readonly rightY: number;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly edges: readonly ResolvedInterLaneEdge[];
  readonly pathCount: number;
}

interface CorridorCluster {
  readonly id: string;
  readonly partitionKey: string;
  readonly pairs: readonly InterLanePair[];
}

interface RoutingObstacle extends OverviewThreadD3CableObstacle {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

interface NodeFanInFieldDemand {
  readonly key: string;
  readonly group: OverviewThreadD3FlowGroupLayout;
  readonly role: "source" | "target";
  readonly side: "left" | "right";
  readonly leaves: Map<string, NodeFanInFieldLeafDemand>;
}

interface NodeFanInFieldLeafDemand {
  readonly node: OverviewThreadD3FlowNodeLayout;
  weight: number;
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
      const groupDeltaX = groupLeft - baseGroupLeft;
      const centerY = placedGroupTop + group.height / 2;
      for (const [index, node] of group.nodes.entries()) {
        const column = index % group.columns;
        const row = Math.floor(index / group.columns);
        const matrixNodeX = groupLeft + column * (nodeSize + nodeGap);
        const matrixNodeY = placedGroupTop + row * (nodeSize + nodeGap);
        const nodePlacement = ownPlacement(options.nodePlacements, node.key);
        const nodeX = clamp(
          matrixNodeX + finiteOrZero(nodePlacement?.offsetX),
          groupLeft,
          groupLeft + group.width - nodeSize,
        );
        const nodeY = clamp(
          matrixNodeY + finiteOrZero(nodePlacement?.offsetY),
          placedGroupTop,
          placedGroupTop + group.height - nodeSize,
        );
        const nodeCenterX = nodeX + nodeSize / 2;
        const nodeCenterY = nodeY + nodeSize / 2;
        nodeLayouts.push({
          ...node,
          x: nodeX,
          y: nodeY,
          width: nodeSize,
          height: nodeSize,
          centerX: nodeCenterX,
          centerY: nodeCenterY,
          leftPort: { x: nodeCenterX - nodeSize / 2, y: nodeCenterY },
          rightPort: { x: nodeCenterX + nodeSize / 2, y: nodeCenterY },
        });
      }
      groupLayouts.push({
        key: groupIdentity,
        lane: plan.lane,
        groupKey: group.groupKey,
        nodeKeys: group.nodes.map((node) => node.key),
        x: groupLeft,
        y: placedGroupTop,
        width: group.width,
        height: group.height,
        columns: group.columns,
        rows: group.rows,
        centerY,
        inHub: {
          x: centerX - laneHubOffset + groupDeltaX,
          y: centerY,
        },
        outHub: {
          x: centerX + laneHubOffset + groupDeltaX,
          y: centerY,
        },
      });
      groupTop += group.height + groupGap;
    }
  }

  const orderedNodes = nodeLayouts.toSorted(compareNodeLayout);
  const orderedGroups = groupLayouts.toSorted(compareGroupLayout);
  const routingObstacles = buildRoutingObstacles(
    orderedGroups,
    obstacleMargin,
  );
  const nodeByKey = new Map(orderedNodes.map((node) => [node.key, node]));
  const groupByKey = new Map(orderedGroups.map((group) => [group.key, group]));
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
  const interLaneEdgesByPair = new Map<string, ResolvedInterLaneEdge[]>();
  const nodeFanInDemands = new Map<string, NodeFanInFieldDemand>();
  const recordNodeFanInDemand = (
    group: OverviewThreadD3FlowGroupLayout,
    role: "source" | "target",
    side: "left" | "right",
    node: OverviewThreadD3FlowNodeLayout,
    weight: number,
  ): void => {
    const key = nodeFanInFieldKey(group, role, side);
    let demand = nodeFanInDemands.get(key);
    if (!demand) {
      demand = { key, group, role, side, leaves: new Map() };
      nodeFanInDemands.set(key, demand);
    }
    const leaf = demand.leaves.get(node.key);
    if (leaf) leaf.weight += weight;
    else demand.leaves.set(node.key, { node, weight });
  };

  // Collect the complete visual field before materialising any route. A D3
  // fan-in must see every compatible leaf at once; solving lazily per exact
  // edge would recreate the rigid one-cable-at-a-time geometry.
  for (
    const edge of edges.toSorted((left, right) =>
      left.key.localeCompare(right.key)
    )
  ) {
    const sourceNode = nodeByKey.get(edge.fromKey);
    const targetNode = nodeByKey.get(edge.toKey);
    if (!sourceNode || !targetNode || sourceNode.key === targetNode.key) {
      continue;
    }
    const sourceGroup = groupByKey.get(
      overviewThreadD3FlowGroupIdentity(
        sourceNode.lane,
        sourceNode.groupKey,
      ),
    );
    const targetGroup = groupByKey.get(
      overviewThreadD3FlowGroupIdentity(
        targetNode.lane,
        targetNode.groupKey,
      ),
    );
    if (!sourceGroup || !targetGroup) continue;
    const sourceLaneIndex = laneIndex.get(sourceNode.lane)!;
    const targetLaneIndex = laneIndex.get(targetNode.lane)!;
    let sourceSide: "left" | "right";
    let targetSide: "left" | "right";
    if (sourceLaneIndex === targetLaneIndex) {
      const sides = sameLaneCableSides(sourceGroup, targetGroup);
      sourceSide = sides.source;
      targetSide = sides.target;
    } else {
      const direction: "forward" | "reverse" = sourceLaneIndex <
          targetLaneIndex
        ? "forward"
        : "reverse";
      const physicalDirection = interLanePhysicalDirection(
        sourceGroup,
        targetGroup,
        direction,
      );
      sourceSide = physicalDirection === "left-to-right" ? "right" : "left";
      targetSide = physicalDirection === "left-to-right" ? "left" : "right";
    }
    recordNodeFanInDemand(
      sourceGroup,
      "source",
      sourceSide,
      sourceNode,
      edge.pathCount,
    );
    recordNodeFanInDemand(
      targetGroup,
      "target",
      targetSide,
      targetNode,
      edge.pathCount,
    );
  }

  const nodeFanInRouteByIdentity = new Map<
    string,
    OverviewThreadD3NodeFanInRoute
  >();
  for (
    const demand of [...nodeFanInDemands.values()].toSorted((left, right) =>
      left.key.localeCompare(right.key)
    )
  ) {
    const junction = demand.side === "left"
      ? demand.group.inHub
      : demand.group.outHub;
    const direction = demand.side === "left" ? -1 : 1;
    const leaves = [...demand.leaves.values()].toSorted((left, right) =>
      left.node.key.localeCompare(right.node.key)
    );
    try {
      const field = buildOverviewThreadD3NodeFanIn({
        junction,
        trunkTangent: { x: direction, y: 0 },
        leaves: leaves.map(({ node, weight }) => ({
          key: node.key,
          anchor: demand.side === "left" ? node.leftPort : node.rightPort,
          anchorTangent: { x: direction, y: 0 },
          weight,
        })),
        obstacles: buildNodeFanInObstacles(
          orderedGroups,
          demand.group.key,
        ),
      });
      for (const { node } of leaves) {
        const route = field.get(node.key);
        if (!route) continue;
        nodeFanInRouteByIdentity.set(
          nodeFanInRouteIdentity(
            demand.group,
            demand.role,
            demand.side,
            node.key,
          ),
          route,
        );
      }
    } catch {
      // Strict by design: a failed physical field emits no degraded branch.
      // Exact dependent edges are marked unrouted in the materialisation pass.
    }
  }

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
    const sourceGroup = groupByKey.get(
      overviewThreadD3FlowGroupIdentity(
        sourceNode.lane,
        sourceNode.groupKey,
      ),
    );
    const targetGroup = groupByKey.get(
      overviewThreadD3FlowGroupIdentity(
        targetNode.lane,
        targetNode.groupKey,
      ),
    );
    if (!sourceGroup || !targetGroup) {
      unroutedEdgeKeys.add(edge.key);
      continue;
    }
    const sourceLaneIndex = laneIndex.get(sourceNode.lane)!;
    const targetLaneIndex = laneIndex.get(targetNode.lane)!;

    if (sourceLaneIndex === targetLaneIndex) {
      const routeSegmentKeys: string[] = [];
      const routed = addSameLaneRoute(
        edge,
        sourceNode,
        targetNode,
        sourceGroup,
        targetGroup,
        routingObstacles,
        nodeFanInRouteByIdentity,
        addSegment,
        routeSegmentKeys,
      );
      if (routed) routes.push(exactRoute(edge, routeSegmentKeys));
      else unroutedEdgeKeys.add(edge.key);
    } else {
      const direction: "forward" | "reverse" = sourceLaneIndex <
          targetLaneIndex
        ? "forward"
        : "reverse";
      const physicalDirection = interLanePhysicalDirection(
        sourceGroup,
        targetGroup,
        direction,
      );
      const sourceSide = physicalDirection === "left-to-right"
        ? "right"
        : "left";
      const targetSide = physicalDirection === "left-to-right"
        ? "left"
        : "right";
      const sourceHub = sourceSide === "right"
        ? sourceGroup.outHub
        : sourceGroup.inHub;
      const targetHub = targetSide === "left"
        ? targetGroup.inHub
        : targetGroup.outHub;
      const pairKey = directedPairKey(sourceGroup, targetGroup);
      const pairEdges = interLaneEdgesByPair.get(pairKey) ?? [];
      pairEdges.push({
        edge,
        sourceNode,
        targetNode,
        sourceGroup,
        targetGroup,
        sourceHub,
        targetHub,
        sourceSide,
        targetSide,
        direction,
      });
      interLaneEdgesByPair.set(pairKey, pairEdges);
    }
  }

  const interLanePairs = [...interLaneEdgesByPair.entries()]
    .map(([pairKey, pairEdges]) =>
      buildInterLanePair(pairKey, pairEdges, laneIndex)
    )
    .toSorted((left, right) => left.key.localeCompare(right.key));
  const corridors = clusterInterLanePairs(
    interLanePairs,
    options.previousRoutingState,
    corridorCaptureDistance,
    corridorReleaseDistance,
  );

  for (const corridor of corridors) {
    const exactEdges = corridor.pairs.flatMap((pair) =>
      pair.edges.map((resolved) => ({ pair, resolved }))
    );
    let jointCorridor: ReturnType<typeof buildOverviewThreadD3JointCorridor>;
    try {
      jointCorridor = buildOverviewThreadD3JointCorridor({
        trajectories: exactEdges.map(({ resolved }) => ({
          key: resolved.edge.key,
          bundleKey: corridor.id,
          sourceAnchor: resolved.sourceSide === "left"
            ? resolved.sourceNode.leftPort
            : resolved.sourceNode.rightPort,
          sourceTangent: horizontalFlowTangent(resolved.sourceSide),
          targetAnchor: resolved.targetSide === "left"
            ? resolved.targetNode.leftPort
            : resolved.targetNode.rightPort,
          targetTangent: horizontalArrivalTangent(resolved.targetSide),
          weight: resolved.edge.pathCount,
          excludedObstacleKeys: [
            resolved.sourceGroup.key,
            resolved.targetGroup.key,
          ],
        })),
        obstacles: routingObstacles,
      });
    } catch {
      markEdgesUnrouted(
        exactEdges.map(({ resolved }) => resolved.edge.key),
      );
      continue;
    }
    for (const { pair, resolved } of exactEdges) {
      const bundledRoute = jointCorridor.routes.get(resolved.edge.key);
      if (!bundledRoute) {
        unroutedEdgeKeys.add(resolved.edge.key);
        continue;
      }
      const segmentKey = structuredKey("bundled-edge", [resolved.edge.key]);
      const routeSegmentKeys: string[] = [];
      pushKey(
        routeSegmentKeys,
        addSegment({
          key: segmentKey,
          kind: "bundle-trunk",
          role: "shared",
          direction: resolved.direction,
          points: bundledRoute.points,
          curve: bundledRoute.curve,
          d: bundledRoute.d,
          pairKey: pair.key,
          corridorKey: corridor.id,
          topologySignature: bundledRoute.topologySignature,
        }, resolved.edge),
      );
      routes.push(exactRoute(resolved.edge, routeSegmentKeys));
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
  return {
    lane,
    groups,
    contentHeight: groups.reduce((height, group) => height + group.height, 0) +
      Math.max(0, groups.length - 1) * groupGap,
  };
}

function nodeFanInFieldKey(
  group: OverviewThreadD3FlowGroupLayout,
  role: "source" | "target",
  side: "left" | "right",
): string {
  return structuredKey("node-fan-in-field", [group.key, role, side]);
}

function nodeFanInRouteIdentity(
  group: OverviewThreadD3FlowGroupLayout,
  role: "source" | "target",
  side: "left" | "right",
  nodeKey: string,
): string {
  return structuredKey("node-fan-in-route", [
    nodeFanInFieldKey(group, role, side),
    nodeKey,
  ]);
}

function appendNodeBranch(
  edge: OverviewThreadD3FlowEdgeInput,
  node: OverviewThreadD3FlowNodeLayout,
  side: "left" | "right",
  role: "source" | "target",
  direction: "forward" | "reverse" | "same-lane",
  pairKey: string,
  corridorKey: string | undefined,
  fanInRoute: OverviewThreadD3NodeFanInRoute,
  addSegment: (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ) => string,
  route: string[],
): void {
  const oriented = role === "source"
    ? fanInRoute
    : reverseOverviewThreadD3NodeFanInRoute(fanInRoute);
  pushKey(
    route,
    addSegment({
      // Role is part of the identity because the same physical branch is
      // traversed in opposite orientations by A→B and B→A.
      key: structuredKey("node-branch", [role, side, node.key]),
      kind: "node-branch",
      role,
      direction,
      points: oriented.points,
      curve: "catmull-rom",
      d: oriented.d,
      topologySignature: oriented.topologySignature,
      pairKey,
      corridorKey,
    }, edge),
  );
}

function directedPairKey(
  source: OverviewThreadD3FlowGroupLayout,
  target: OverviewThreadD3FlowGroupLayout,
): string {
  return structuredKey("directed-pair", [source.key, target.key]);
}

function flowCurveForCableField(
  _route: OverviewThreadD3CableFieldRoute,
): OverviewThreadD3FlowCurve {
  return "catmull-rom";
}

function outwardTangentPoint(
  endpoint: OverviewThreadD3FlowPoint,
  side: "left" | "right",
): OverviewThreadD3CablePoint {
  return {
    x: endpoint.x + (side === "right" ? 1 : -1),
    y: endpoint.y,
  };
}

function horizontalFlowTangent(
  side: "left" | "right",
): OverviewThreadD3CablePoint {
  return { x: side === "right" ? 1 : -1, y: 0 };
}

function horizontalArrivalTangent(
  side: "left" | "right",
): OverviewThreadD3CablePoint {
  return { x: side === "left" ? 1 : -1, y: 0 };
}

/**
 * Chooses presentation ports from the groups' current physical placement.
 * Lane order still owns the relation's forward/reverse metadata; it is only a
 * deterministic final tie-break when two manually placed hulls have the same
 * horizontal centre. Routing must never move either hull to resolve that tie.
 */
function interLanePhysicalDirection(
  source: OverviewThreadD3FlowGroupLayout,
  target: OverviewThreadD3FlowGroupLayout,
  businessDirection: "forward" | "reverse",
): "left-to-right" | "right-to-left" {
  const sourceLeft = source.x;
  const sourceRight = source.x + source.width;
  const targetLeft = target.x;
  const targetRight = target.x + target.width;

  if (sourceRight <= targetLeft) return "left-to-right";
  if (targetRight <= sourceLeft) return "right-to-left";

  const sourceCenter = (sourceLeft + sourceRight) / 2;
  const targetCenter = (targetLeft + targetRight) / 2;
  if (targetCenter > sourceCenter) return "left-to-right";
  if (targetCenter < sourceCenter) return "right-to-left";
  return businessDirection === "forward" ? "left-to-right" : "right-to-left";
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

function buildNodeFanInObstacles(
  groups: readonly OverviewThreadD3FlowGroupLayout[],
  owningGroupKey: string,
): readonly OverviewThreadD3CableObstacle[] {
  return groups.filter((group) => group.key !== owningGroupKey).map((
    group,
  ) => ({
    key: group.key,
    minimumX: group.x - NODE_FAN_IN_OBSTACLE_MARGIN,
    maximumX: group.x + group.width + NODE_FAN_IN_OBSTACLE_MARGIN,
    minimumY: group.y - NODE_FAN_IN_OBSTACLE_MARGIN,
    maximumY: group.y + group.height + NODE_FAN_IN_OBSTACLE_MARGIN,
  })).toSorted((left, right) => left.key.localeCompare(right.key));
}

function pointInsideRoutingObstacle(
  point: OverviewThreadD3FlowPoint,
  obstacle: RoutingObstacle,
): boolean {
  return point.x >= obstacle.minimumX && point.x <= obstacle.maximumX &&
    point.y >= obstacle.minimumY && point.y <= obstacle.maximumY;
}

function tryBuildCableFieldRoute(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacles: readonly RoutingObstacle[],
  options?: Parameters<typeof buildOverviewThreadD3CableFieldRoute>[3],
): OverviewThreadD3CableFieldRoute | undefined {
  try {
    return buildOverviewThreadD3CableFieldRoute(
      source,
      target,
      obstacles,
      options,
    );
  } catch {
    return undefined;
  }
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

function buildInterLanePair(
  pairKey: string,
  edges: readonly ResolvedInterLaneEdge[],
  laneIndex: ReadonlyMap<EngineeringPathLaneId, number>,
): InterLanePair {
  const orderedEdges = edges.toSorted((left, right) =>
    left.edge.key.localeCompare(right.edge.key)
  );
  const first = orderedEdges[0]!;
  const sourceLaneIndex = laneIndex.get(first.sourceNode.lane)!;
  const targetLaneIndex = laneIndex.get(first.targetNode.lane)!;
  const physicalDirection = first.targetHub.x === first.sourceHub.x
    ? first.direction === "forward" ? "left-to-right" : "right-to-left"
    : first.targetHub.x > first.sourceHub.x
    ? "left-to-right"
    : "right-to-left";
  const minimumLaneIndex = Math.min(sourceLaneIndex, targetLaneIndex);
  const maximumLaneIndex = Math.max(sourceLaneIndex, targetLaneIndex);
  const minimumX = Math.min(first.sourceHub.x, first.targetHub.x);
  const maximumX = Math.max(first.sourceHub.x, first.targetHub.x);
  return {
    key: pairKey,
    partitionKey: structuredKey("corridor-partition", [
      OVERVIEW_LANES[minimumLaneIndex]!.id,
      OVERVIEW_LANES[maximumLaneIndex]!.id,
      physicalDirection,
    ]),
    physicalDirection,
    sourceGroup: first.sourceGroup,
    targetGroup: first.targetGroup,
    sourceHub: first.sourceHub,
    targetHub: first.targetHub,
    leftY: physicalDirection === "left-to-right"
      ? first.sourceHub.y
      : first.targetHub.y,
    rightY: physicalDirection === "left-to-right"
      ? first.targetHub.y
      : first.sourceHub.y,
    minimumX,
    maximumX,
    edges: orderedEdges,
    pathCount: orderedEdges.reduce(
      (count, resolved) => count + resolved.edge.pathCount,
      0,
    ),
  };
}

function clusterInterLanePairs(
  pairs: readonly InterLanePair[],
  previousState: OverviewThreadD3FlowRoutingState | undefined,
  captureDistance: number,
  releaseDistance: number,
): readonly CorridorCluster[] {
  const previousTogether = previousCorridorPairKeys(previousState);
  const previousTokenByPair = previousCorridorTokens(previousState, pairs);
  const pairsByPartition = new Map<string, InterLanePair[]>();
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
    const mutableClusters: InterLanePair[][] = [];
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
          const distance = interLanePairDistance(member, pair);
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
      const orderedCluster = cluster.toSorted((left, right) =>
        left.key.localeCompare(right.key)
      );
      // The ID is derived from live lexical identities. Caller state may
      // influence only the release threshold, never choose an identifier.
      const id = structuredKey("corridor", [
        partitionKey,
        orderedCluster[0]!.key,
      ]);
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
  pairs: readonly InterLanePair[],
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

function interLanePairDistance(
  left: InterLanePair,
  right: InterLanePair,
): number {
  return Math.max(
    Math.abs(left.leftY - right.leftY),
    Math.abs(left.rightY - right.rightY),
  );
}

function clusterSharesHorizontalSpan(
  pairs: readonly InterLanePair[],
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

function addSameLaneRoute(
  edge: OverviewThreadD3FlowEdgeInput,
  sourceNode: OverviewThreadD3FlowNodeLayout,
  targetNode: OverviewThreadD3FlowNodeLayout,
  sourceGroup: OverviewThreadD3FlowGroupLayout,
  targetGroup: OverviewThreadD3FlowGroupLayout,
  routingObstacles: readonly RoutingObstacle[],
  nodeFanInRouteByIdentity: ReadonlyMap<
    string,
    OverviewThreadD3NodeFanInRoute
  >,
  addSegment: (
    spec: SegmentSpec,
    edge: OverviewThreadD3FlowEdgeInput,
  ) => string,
  route: string[],
): boolean {
  const direction = "same-lane" as const;
  const pairKey = directedPairKey(sourceGroup, targetGroup);
  const sides = sameLaneCableSides(sourceGroup, targetGroup);
  const sourceHub = sides.source === "left"
    ? sourceGroup.inHub
    : sourceGroup.outHub;
  const targetHub = sides.target === "left"
    ? targetGroup.inHub
    : targetGroup.outHub;
  const sourceBranchRoute = nodeFanInRouteByIdentity.get(
    nodeFanInRouteIdentity(
      sourceGroup,
      "source",
      sides.source,
      sourceNode.key,
    ),
  );
  const targetBranchRoute = nodeFanInRouteByIdentity.get(
    nodeFanInRouteIdentity(
      targetGroup,
      "target",
      sides.target,
      targetNode.key,
    ),
  );
  if (!sourceBranchRoute || !targetBranchRoute) return false;
  // A same-lane return is local presentation geometry. Hulls in unrelated
  // lanes must not pull it into a page-wide detour; collision authority for
  // this route is limited to immutable hulls in its own lane.
  const sameLaneObstacles = routingObstacles.filter((obstacle) =>
    obstacle.lane === sourceNode.lane
  );
  const endpointGroupKeys = new Set([sourceGroup.key, targetGroup.key]);
  if (
    sameLaneObstacles.some((obstacle) =>
      !endpointGroupKeys.has(obstacle.key) &&
      (pointInsideRoutingObstacle(sourceHub, obstacle) ||
        pointInsideRoutingObstacle(targetHub, obstacle))
    )
  ) return false;

  let cableRoute: OverviewThreadD3CableFieldRoute | undefined;
  if (sourceGroup.key !== targetGroup.key) {
    cableRoute = tryBuildCableFieldRoute(
      sourceHub,
      targetHub,
      sameLaneObstacles.filter((obstacle) =>
        !endpointGroupKeys.has(obstacle.key)
      ),
      {
        sourceTangentTarget: outwardTangentPoint(sourceHub, sides.source),
        targetTangentSource: outwardTangentPoint(targetHub, sides.target),
        endpointGuardCount: CABLE_ENDPOINT_GUARD_COUNT,
        endpointGuardLength: CABLE_ENDPOINT_GUARD_LENGTH,
      },
    );
    if (!cableRoute) return false;
  }
  appendNodeBranch(
    edge,
    sourceNode,
    sides.source,
    "source",
    direction,
    pairKey,
    undefined,
    sourceBranchRoute,
    addSegment,
    route,
  );

  if (cableRoute) {
    pushKey(
      route,
      addSegment({
        key: structuredKey("same-lane-trunk", [
          sourceNode.lane,
          sourceGroup.key,
          targetGroup.key,
        ]),
        kind: "same-lane-trunk",
        role: "shared",
        direction,
        points: cableRoute.points,
        curve: flowCurveForCableField(cableRoute),
        d: cableRoute.d,
        topologySignature: cableRoute.topologySignature,
        pairKey,
      }, edge),
    );
  }

  appendNodeBranch(
    edge,
    targetNode,
    sides.target,
    "target",
    direction,
    pairKey,
    undefined,
    targetBranchRoute,
    addSegment,
    route,
  );
  return true;
}

function sameLaneCableSides(
  source: OverviewThreadD3FlowGroupLayout,
  target: OverviewThreadD3FlowGroupLayout,
): { readonly source: "left" | "right"; readonly target: "left" | "right" } {
  if (source.x + source.width <= target.x) {
    return { source: "right", target: "left" };
  }
  if (target.x + target.width <= source.x) {
    return { source: "left", target: "right" };
  }
  // Vertically stacked or horizontally overlapping hulls share the right
  // exterior side. Tangent guards form a compact curved return instead of a
  // page-wide rectangular bus.
  return { source: "right", target: "right" };
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
