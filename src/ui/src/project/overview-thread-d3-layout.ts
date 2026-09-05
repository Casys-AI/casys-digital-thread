import {
  cluster,
  hierarchy,
  type HierarchyNode,
  type HierarchyPointNode,
} from "d3-hierarchy";
import { curveBundle, lineRadial } from "d3-shape";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import { OVERVIEW_LANES } from "./overview-lanes.ts";

const TAU = Math.PI * 2;
const DEFAULT_INNER_RADIUS = 328;
const DEFAULT_LABEL_COLUMN_X = 372;
const DEFAULT_HEIGHT = 900;
const DEFAULT_LABEL_GAP = 16;
const DEFAULT_BUNDLE_BETA = 0.82;
const MIN_LABEL_HORIZONTAL_SPACE = 190;
const MAX_LABEL_HORIZONTAL_SPACE = 360;
const LABEL_VERTICAL_PADDING = 32;

export interface OverviewThreadD3NodeInput {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey: string;
  readonly label: string;
}

export interface OverviewThreadD3EdgeInput {
  readonly key: string;
  readonly fromKey: string;
  readonly toKey: string;
  readonly pathCount: number;
  readonly pathKeys: readonly string[];
  readonly emphasis: boolean;
}

export interface OverviewThreadD3LayoutOptions {
  readonly innerRadius?: number;
  readonly labelColumnX?: number;
  readonly height?: number;
  readonly labelGap?: number;
  readonly bundleBeta?: number;
}

export interface OverviewThreadD3NodeLayout {
  readonly key: string;
  readonly lane: EngineeringPathLaneId;
  readonly groupKey: string;
  readonly label: string;
  readonly angle: number;
  readonly radius: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly textAnchor: "start" | "end";
  readonly leaderD: string;
}

export type OverviewThreadD3RoutePointKind =
  | "root"
  | "lane"
  | "group"
  | "leaf"
  | "placeholder";

export interface OverviewThreadD3RoutePoint {
  readonly key: string;
  readonly kind: OverviewThreadD3RoutePointKind;
  readonly angle: number;
  readonly radius: number;
  readonly x: number;
  readonly y: number;
}

export interface OverviewThreadD3EdgeLayout extends OverviewThreadD3EdgeInput {
  readonly d: string;
  readonly route: readonly OverviewThreadD3RoutePoint[];
}

export interface OverviewThreadD3LaneLayout {
  readonly lane: EngineeringPathLaneId;
  readonly title: string;
  readonly color: string;
  readonly startAngle: number;
  readonly endAngle: number;
  readonly labelAngle: number;
  readonly arcD: string;
}

export interface OverviewThreadD3Layout {
  readonly viewBox: readonly [number, number, number, number];
  readonly nodes: readonly OverviewThreadD3NodeLayout[];
  readonly edges: readonly OverviewThreadD3EdgeLayout[];
  readonly lanes: readonly OverviewThreadD3LaneLayout[];
  readonly unroutedEdgeKeys: readonly string[];
}

type BundleDatumKind = OverviewThreadD3RoutePointKind;

interface BundleDatum {
  readonly kind: BundleDatumKind;
  readonly key: string;
  readonly lane?: EngineeringPathLaneId;
  readonly groupKey?: string;
  readonly node?: OverviewThreadD3NodeInput;
  readonly children?: readonly BundleDatum[];
}

interface PendingLabel {
  readonly point: HierarchyPointNode<BundleDatum>;
  readonly node: OverviewThreadD3NodeInput;
  readonly side: -1 | 1;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly desiredY: number;
}

/**
 * Builds a deterministic radial hierarchy and routes every edge through its
 * shared lane and group ancestors with D3's bundle curve.
 */
export function buildOverviewThreadD3Layout(
  nodes: readonly OverviewThreadD3NodeInput[],
  edges: readonly OverviewThreadD3EdgeInput[],
  options: OverviewThreadD3LayoutOptions = {},
): OverviewThreadD3Layout {
  assertUniqueNodeKeys(nodes);

  const innerRadius = positiveOrDefault(
    options.innerRadius,
    DEFAULT_INNER_RADIUS,
  );
  const labelColumnX = Math.max(
    innerRadius + 28,
    positiveOrDefault(options.labelColumnX, DEFAULT_LABEL_COLUMN_X),
  );
  const height = Math.max(
    innerRadius * 2 + LABEL_VERTICAL_PADDING * 2,
    positiveOrDefault(options.height, DEFAULT_HEIGHT),
  );
  const requestedLabelGap = positiveOrDefault(
    options.labelGap,
    DEFAULT_LABEL_GAP,
  );
  const bundleBeta = clamp(
    options.bundleBeta ?? DEFAULT_BUNDLE_BETA,
    0,
    1,
  );

  const tree = buildBundleTree(nodes);
  const root = hierarchy<BundleDatum>(
    tree,
    (datum: BundleDatum) => datum.children,
  );
  const positionedRoot = cluster<BundleDatum>()
    .size([TAU, innerRadius])
    .separation(bundleSeparation)(root);
  const leafByKey = new Map<string, HierarchyPointNode<BundleDatum>>();
  const pendingLabels: PendingLabel[] = [];

  for (const point of positionedRoot.leaves()) {
    if (point.data.kind !== "leaf" || point.data.node === undefined) continue;
    const node = point.data.node;
    leafByKey.set(node.key, point);
    const anchor = radialPoint(point.x, point.y);
    const side: -1 | 1 = anchor.x < 0 ? -1 : 1;
    pendingLabels.push({
      point,
      node,
      side,
      anchorX: anchor.x,
      anchorY: anchor.y,
      desiredY: anchor.y,
    });
  }

  const labelYByKey = distributeBilateralLabels(
    pendingLabels,
    height,
    requestedLabelGap,
  );
  const nodeLayouts = pendingLabels
    .toSorted((left, right) =>
      left.point.x - right.point.x ||
      left.node.key.localeCompare(right.node.key)
    )
    .map((pending): OverviewThreadD3NodeLayout => {
      const labelY = labelYByKey.get(pending.node.key) ?? pending.desiredY;
      const labelX = pending.side * labelColumnX;
      const outer = radialPoint(pending.point.x, innerRadius + 8);
      const elbowX = pending.side * (innerRadius + 22);
      const leaderEndX = labelX - pending.side * 8;
      return {
        key: pending.node.key,
        lane: pending.node.lane,
        groupKey: pending.node.groupKey,
        label: pending.node.label,
        angle: pending.point.x,
        radius: pending.point.y,
        anchorX: pending.anchorX,
        anchorY: pending.anchorY,
        labelX,
        labelY,
        textAnchor: pending.side === 1 ? "start" : "end",
        leaderD: `M ${number(pending.anchorX)} ${number(pending.anchorY)} L ${
          number(outer.x)
        } ${number(outer.y)} L ${number(elbowX)} ${number(labelY)} L ${
          number(leaderEndX)
        } ${number(labelY)}`,
      };
    });

  const radialLine = lineRadial<HierarchyPointNode<BundleDatum>>()
    .angle((point: HierarchyPointNode<BundleDatum>) => point.x)
    .radius((point: HierarchyPointNode<BundleDatum>) => point.y)
    .curve(curveBundle.beta(bundleBeta));
  const edgeLayouts: OverviewThreadD3EdgeLayout[] = [];
  const unroutedEdgeKeys: string[] = [];

  for (const edge of edges) {
    const source = leafByKey.get(edge.fromKey);
    const target = leafByKey.get(edge.toKey);
    if (!source || !target) {
      unroutedEdgeKeys.push(edge.key);
      continue;
    }
    const hierarchyRoute = source.path(target) as Array<
      HierarchyPointNode<BundleDatum>
    >;
    const d = radialLine(hierarchyRoute);
    if (!d) {
      unroutedEdgeKeys.push(edge.key);
      continue;
    }
    edgeLayouts.push({
      ...edge,
      d,
      route: hierarchyRoute.map(routePoint),
    });
  }

  const lanes = buildLaneLayouts(positionedRoot, innerRadius);
  const labelHorizontalSpace = clamp(
    Math.max(0, ...nodes.map((node) => node.label.length)) * 6.4 + 20,
    MIN_LABEL_HORIZONTAL_SPACE,
    MAX_LABEL_HORIZONTAL_SPACE,
  );
  const halfWidth = Math.max(
    innerRadius + 36,
    labelColumnX + labelHorizontalSpace,
  );

  return {
    viewBox: [-halfWidth, -height / 2, halfWidth * 2, height],
    nodes: nodeLayouts,
    edges: edgeLayouts,
    lanes,
    unroutedEdgeKeys,
  };
}

function buildBundleTree(
  nodes: readonly OverviewThreadD3NodeInput[],
): BundleDatum {
  const laneOrder = new Map(
    OVERVIEW_LANES.map((lane, index) => [lane.id, index]),
  );
  const orderedNodes = nodes.toSorted((left, right) =>
    (laneOrder.get(left.lane) ?? Number.MAX_SAFE_INTEGER) -
      (laneOrder.get(right.lane) ?? Number.MAX_SAFE_INTEGER) ||
    normalizedGroupKey(left.groupKey).localeCompare(
      normalizedGroupKey(right.groupKey),
    ) ||
    left.label.localeCompare(right.label) ||
    left.key.localeCompare(right.key)
  );

  return {
    kind: "root",
    key: "bundle:root",
    children: OVERVIEW_LANES.map((lane): BundleDatum => {
      const laneNodes = orderedNodes.filter((node) => node.lane === lane.id);
      const byGroup = new Map<string, OverviewThreadD3NodeInput[]>();
      for (const node of laneNodes) {
        const groupKey = normalizedGroupKey(node.groupKey);
        const group = byGroup.get(groupKey) ?? [];
        group.push(node);
        byGroup.set(groupKey, group);
      }
      const groups: BundleDatum[] = [...byGroup.entries()].map(
        ([groupKey, groupNodes]): BundleDatum => ({
          kind: "group",
          key: `bundle:group:${lane.id}:${groupKey}`,
          lane: lane.id,
          groupKey,
          children: groupNodes.map((node): BundleDatum => ({
            kind: "leaf",
            key: `bundle:leaf:${node.key}`,
            lane: lane.id,
            groupKey,
            node,
          })),
        }),
      );
      return {
        kind: "lane",
        key: `bundle:lane:${lane.id}`,
        lane: lane.id,
        children: groups.length > 0 ? groups : [{
          kind: "placeholder",
          key: `bundle:placeholder:${lane.id}`,
          lane: lane.id,
        }],
      };
    }),
  };
}

function bundleSeparation(
  left: HierarchyNode<BundleDatum>,
  right: HierarchyNode<BundleDatum>,
): number {
  if (left.data.lane !== right.data.lane) return 7;
  if (left.data.groupKey !== right.data.groupKey) return 2.5;
  return 1;
}

function distributeBilateralLabels(
  pending: readonly PendingLabel[],
  height: number,
  requestedGap: number,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const minY = -height / 2 + LABEL_VERTICAL_PADDING;
  const maxY = height / 2 - LABEL_VERTICAL_PADDING;
  for (const side of [-1, 1] as const) {
    const labels = pending
      .filter((item) => item.side === side)
      .toSorted((left, right) =>
        left.desiredY - right.desiredY ||
        left.node.key.localeCompare(right.node.key)
      );
    if (labels.length === 0) continue;
    const gap = labels.length === 1
      ? 0
      : Math.min(requestedGap, (maxY - minY) / (labels.length - 1));
    const positions = labels.map((label) => clamp(label.desiredY, minY, maxY));
    for (let index = 1; index < positions.length; index++) {
      positions[index] = Math.max(
        positions[index]!,
        positions[index - 1]! + gap,
      );
    }
    if (positions.at(-1)! > maxY) {
      positions[positions.length - 1] = maxY;
      for (let index = positions.length - 2; index >= 0; index--) {
        positions[index] = Math.min(
          positions[index]!,
          positions[index + 1]! - gap,
        );
      }
    }
    if (positions[0]! < minY) {
      positions[0] = minY;
      for (let index = 1; index < positions.length; index++) {
        positions[index] = Math.max(
          positions[index]!,
          positions[index - 1]! + gap,
        );
      }
    }
    labels.forEach((label, index) =>
      result.set(label.node.key, positions[index]!)
    );
  }
  return result;
}

function buildLaneLayouts(
  root: HierarchyPointNode<BundleDatum>,
  innerRadius: number,
): readonly OverviewThreadD3LaneLayout[] {
  const pointByLane = new Map<
    EngineeringPathLaneId,
    HierarchyPointNode<BundleDatum>
  >(
    (root.children ?? []).flatMap((child: HierarchyPointNode<BundleDatum>) =>
      child.data.lane ? [[child.data.lane, child] as const] : []
    ),
  );
  return OVERVIEW_LANES.flatMap((lane) => {
    const lanePoint = pointByLane.get(lane.id);
    if (!lanePoint) return [];
    const angles = lanePoint.leaves()
      .map((leaf: HierarchyPointNode<BundleDatum>) => leaf.x)
      .toSorted((a: number, b: number) => a - b);
    if (angles.length === 0) return [];
    const halfPadding = angles.length === 1
      ? 0.035
      : Math.min(0.035, (angles.at(-1)! - angles[0]!) * 0.08);
    const startAngle = Math.max(0, angles[0]! - halfPadding);
    const endAngle = Math.min(TAU, angles.at(-1)! + halfPadding);
    const arcRadius = innerRadius + 13;
    return [{
      lane: lane.id,
      title: lane.title,
      color: lane.color,
      startAngle,
      endAngle,
      labelAngle: (startAngle + endAngle) / 2,
      arcD: ringArcPath(startAngle, endAngle, arcRadius),
    }];
  });
}

function routePoint(
  point: HierarchyPointNode<BundleDatum>,
): OverviewThreadD3RoutePoint {
  const cartesian = radialPoint(point.x, point.y);
  return {
    key: point.data.key,
    kind: point.data.kind,
    angle: point.x,
    radius: point.y,
    x: cartesian.x,
    y: cartesian.y,
  };
}

function ringArcPath(
  startAngle: number,
  endAngle: number,
  radius: number,
): string {
  const start = radialPoint(startAngle, radius);
  const end = radialPoint(endAngle, radius);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${number(start.x)} ${number(start.y)} A ${number(radius)} ${
    number(radius)
  } 0 ${largeArc} 1 ${number(end.x)} ${number(end.y)}`;
}

function radialPoint(angle: number, radius: number): { x: number; y: number } {
  return {
    x: Math.sin(angle) * radius,
    y: -Math.cos(angle) * radius,
  };
}

function assertUniqueNodeKeys(
  nodes: readonly OverviewThreadD3NodeInput[],
): void {
  const keys = new Set<string>();
  for (const node of nodes) {
    if (keys.has(node.key)) {
      throw new Error(`Duplicate Overview D3 node key: ${node.key}`);
    }
    keys.add(node.key);
  }
}

function normalizedGroupKey(value: string): string {
  return value.trim() || "__ungrouped__";
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function number(value: number): string {
  return Number(value.toFixed(3)).toString();
}
