import { overviewThreadD3CableAnchor } from "../../overview-thread-d3-cable-anchorage.ts";
import type { OverviewHullContentRow } from "./types.ts";

/** Geometry a hull needs to place the same rows in tree, list, and points. */
export interface OverviewHullRowBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly headerHeight: number;
  readonly footerHeight: number;
  readonly view: "tree" | "list" | "matrix";
  readonly columns: number;
  readonly visibleRows: number;
  readonly scrollRow: number;
  readonly collapsed: boolean;
}

export interface OverviewHullRowLayout {
  readonly row: OverviewHullContentRow;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface OverviewHullRowCell {
  readonly index: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Gutter between listed columns. Without it the right port of one column and
 * the left port of the next share a coordinate, and cables cut labels.
 */
export const OVERVIEW_HULL_LIST_COLUMN_GAP = 7;

/** One visible cable surface shared by record docks and navigation fans. */
export function overviewHullRowCableSurface(
  cell: Pick<OverviewHullRowCell, "x" | "y" | "width" | "height">,
  view: OverviewHullRowBox["view"],
  pointSize = 10,
): Pick<OverviewHullRowCell, "x" | "y" | "width" | "height"> {
  const compact = view === "matrix";
  const inset = Math.min(4, cell.width / 8);
  const width = compact
    ? Math.min(pointSize, cell.width)
    : cell.width - inset * 2;
  const height = compact ? Math.min(pointSize, cell.height) : cell.height;
  return {
    x: cell.x + (cell.width - width) / 2,
    y: cell.y + (cell.height - height) / 2,
    width,
    height,
  };
}

/** Arrange the same content rows; changing a view never selects other objects. */
export function layoutOverviewHullRows(
  rows: readonly OverviewHullContentRow[],
  group: OverviewHullRowBox,
): readonly OverviewHullRowLayout[] {
  return layoutOverviewHullRowCells(rows.length, group).map((
    { index, ...cell },
  ) => ({
    ...cell,
    row: rows[index]!,
    depth: group.view === "tree" ? rows[index]!.depth : 0,
  }));
}

/** Shared cell geometry for rendering and exact recorded cable docks. */
export function layoutOverviewHullRowCells(
  rowCount: number,
  group: OverviewHullRowBox,
): readonly OverviewHullRowCell[] {
  if (group.collapsed || rowCount === 0) return [];
  const matrix = group.view === "matrix";
  const columns = group.view === "tree" ? 1 : Math.max(1, group.columns);
  const gap = group.view === "list" && columns > 1
    ? OVERVIEW_HULL_LIST_COLUMN_GAP
    : 0;
  const capacity = Math.ceil(rowCount / columns);
  const visibleRows = matrix ? capacity : Math.max(1, group.visibleRows);
  const cellWidth = (group.width - gap * (columns - 1)) / columns;
  const cellHeight = (group.height - group.headerHeight - group.footerHeight) /
    visibleRows;
  return Array.from({ length: rowCount }, (_, index) => index).flatMap(
    (index) => {
      const column = matrix ? index % columns : Math.floor(index / capacity);
      const rowIndex = matrix
        ? Math.floor(index / columns)
        : index % capacity - group.scrollRow;
      if (rowIndex < 0 || rowIndex >= visibleRows) return [];
      return [{
        index,
        x: group.x + column * (cellWidth + gap),
        y: group.y + group.headerHeight + rowIndex * cellHeight,
        width: cellWidth,
        height: cellHeight,
      }];
    },
  );
}

export const OVERVIEW_HULL_ROW_PARENT_RELATION = "row-parent" as const;

export interface OverviewHullHierarchyLink {
  readonly fromKey: string;
  readonly toKey: string;
  readonly relationKind: typeof OVERVIEW_HULL_ROW_PARENT_RELATION;
  readonly points: readonly { readonly x: number; readonly y: number }[];
  readonly d: string;
}

const HIERARCHY_SPINE_OFFSET = 8;
const HIERARCHY_SAME_LINE = 0.75;
const HIERARCHY_ROW_OFFSET = 12;

interface HierarchyPoint {
  readonly x: number;
  readonly y: number;
}

interface HierarchyObstacle {
  readonly key: string;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

/**
 * Presentation parentage for any visible row that already names a present
 * parentKey. Never a Thread edge, evidence join, or inferred relation.
 * Orthogonal elbows stay a containment guide; Thread graph cables keep
 * their own fan-in routing.
 */
export function layoutOverviewHullHierarchyLinks(
  rows: readonly OverviewHullContentRow[],
  group: OverviewHullRowBox,
  pointSize = 10,
): readonly OverviewHullHierarchyLink[] {
  const positions = new Map(
    layoutOverviewHullRows(rows, group).map((position) => [
      position.row.key,
      position,
    ]),
  );
  const childrenByParent = new Map<string, OverviewHullRowLayout[]>();
  for (const row of rows) {
    if (!row.parentKey) continue;
    const source = positions.get(row.parentKey);
    const target = positions.get(row.key);
    if (!source || !target) continue;
    const siblings = childrenByParent.get(row.parentKey) ?? [];
    siblings.push(target);
    childrenByParent.set(row.parentKey, siblings);
  }
  const links: OverviewHullHierarchyLink[] = [];
  for (const [parentKey, children] of childrenByParent) {
    const parent = positions.get(parentKey);
    if (!parent) continue;
    const side = hierarchyFanSide(parent, group);
    const parentDock = hierarchyRowDock(parent, group.view, pointSize, side);
    for (const child of children) {
      const childDock = hierarchyRowDock(child, group.view, pointSize, side);
      const obstacles = [...positions.values()]
        .filter((position) =>
          position.row.key !== parentKey && position.row.key !== child.row.key
        )
        .map((position) => hierarchyObstacle(position, group.view, pointSize))
        .toSorted((left, right) => left.key.localeCompare(right.key));
      const points = orthogonalHierarchyPoints(
        parentDock,
        childDock,
        side,
        group,
        parent,
        child,
        obstacles,
      );
      links.push({
        fromKey: parentKey,
        toKey: child.row.key,
        relationKind: OVERVIEW_HULL_ROW_PARENT_RELATION,
        points,
        d: orthogonalHierarchyPath(points),
      });
    }
  }
  return links;
}

function hierarchyFanSide(
  parent: OverviewHullRowLayout,
  group: OverviewHullRowBox,
): "left" | "right" {
  if (group.view !== "list" || group.columns <= 1) return "right";
  const mid = group.x + group.width / 2;
  return parent.x + parent.width / 2 <= mid ? "left" : "right";
}

function hierarchyRowDock(
  position: OverviewHullRowLayout,
  view: OverviewHullRowBox["view"],
  pointSize: number,
  side: "left" | "right",
): HierarchyPoint {
  return overviewThreadD3CableAnchor(
    overviewHullRowCableSurface(position, view, pointSize),
    side,
  );
}

function hierarchyObstacle(
  position: OverviewHullRowLayout,
  view: OverviewHullRowBox["view"],
  pointSize: number,
): HierarchyObstacle {
  const box = view === "matrix"
    ? overviewHullRowCableSurface(position, view, pointSize)
    : position;
  return {
    key: position.row.key,
    minimumX: box.x,
    maximumX: box.x + box.width,
    minimumY: box.y,
    maximumY: box.y + box.height,
  };
}

function orthogonalHierarchyPoints(
  parentDock: HierarchyPoint,
  childDock: HierarchyPoint,
  side: "left" | "right",
  group: OverviewHullRowBox,
  parent: OverviewHullRowLayout,
  child: OverviewHullRowLayout,
  obstacles: readonly HierarchyObstacle[],
): readonly HierarchyPoint[] {
  const candidates: HierarchyPoint[][] = [];
  const sameY = Math.abs(parentDock.y - childDock.y) <= HIERARCHY_SAME_LINE;
  const room = Math.min(
    HIERARCHY_ROW_OFFSET,
    Math.max(6, parent.height * 0.35, child.height * 0.35),
  );
  if (sameY) {
    candidates.push(
      hierarchyURoute(parentDock, childDock, parentDock.y + room),
    );
    candidates.push(
      hierarchyURoute(parentDock, childDock, parentDock.y - room),
    );
  }
  const sign = side === "right" ? 1 : -1;
  const base = side === "right"
    ? Math.max(parentDock.x, childDock.x)
    : Math.min(parentDock.x, childDock.x);
  const columnEdge = side === "right"
    ? Math.max(parent.x + parent.width, child.x + child.width)
    : Math.min(parent.x, child.x);
  const outer = side === "right" ? group.x + group.width + 6 : group.x - 6;
  const spines = group.view === "matrix"
    ? [
      base + sign * HIERARCHY_SPINE_OFFSET,
      columnEdge,
      outer,
    ]
    : [
      columnEdge,
      base + sign * HIERARCHY_SPINE_OFFSET,
      base + sign * 16,
      outer,
    ];
  const seen = new Set<number>();
  for (const spineX of spines) {
    if (seen.has(spineX)) continue;
    seen.add(spineX);
    candidates.push([
      parentDock,
      { x: spineX, y: parentDock.y },
      { x: spineX, y: childDock.y },
      childDock,
    ]);
  }
  if (!sameY) {
    candidates.push(
      hierarchyURoute(parentDock, childDock, parentDock.y + room),
    );
    candidates.push(
      hierarchyURoute(parentDock, childDock, parentDock.y - room),
    );
    candidates.push(
      hierarchyURoute(parentDock, childDock, childDock.y + room),
    );
    candidates.push(
      hierarchyURoute(parentDock, childDock, childDock.y - room),
    );
  }
  for (const candidate of candidates) {
    const compact = compactOrthogonalPoints(candidate);
    if (!orthogonalPathHitsObstacles(compact, obstacles)) return compact;
  }
  return compactOrthogonalPoints(candidates[0] ?? [parentDock, childDock]);
}

function hierarchyURoute(
  parentDock: HierarchyPoint,
  childDock: HierarchyPoint,
  elbowY: number,
): HierarchyPoint[] {
  return [
    parentDock,
    { x: parentDock.x, y: elbowY },
    { x: childDock.x, y: elbowY },
    childDock,
  ];
}

function compactOrthogonalPoints(
  points: readonly HierarchyPoint[],
): HierarchyPoint[] {
  const unique: HierarchyPoint[] = [];
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

function orthogonalPathHitsObstacles(
  points: readonly HierarchyPoint[],
  obstacles: readonly HierarchyObstacle[],
): boolean {
  if (obstacles.length === 0 || points.length < 2) return false;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    for (const obstacle of obstacles) {
      if (axisSegmentHitsBox(from, to, obstacle)) return true;
    }
  }
  return false;
}

function axisSegmentHitsBox(
  from: HierarchyPoint,
  to: HierarchyPoint,
  box: HierarchyObstacle,
): boolean {
  const inset = 0.5;
  const minX = box.minimumX + inset;
  const maxX = box.maximumX - inset;
  const minY = box.minimumY + inset;
  const maxY = box.maximumY - inset;
  if (maxX <= minX || maxY <= minY) return false;
  if (from.y === to.y) {
    if (from.y <= minY || from.y >= maxY) return false;
    const left = Math.min(from.x, to.x);
    const right = Math.max(from.x, to.x);
    return right > minX && left < maxX;
  }
  if (from.x === to.x) {
    if (from.x <= minX || from.x >= maxX) return false;
    const top = Math.min(from.y, to.y);
    const bottom = Math.max(from.y, to.y);
    return bottom > minY && top < maxY;
  }
  return true;
}

function orthogonalHierarchyPath(points: readonly HierarchyPoint[]): string {
  if (points.length === 0) return "";
  return points.map((point, index) =>
    `${index === 0 ? "M" : "L"}${formatHierarchyNumber(point.x)} ${
      formatHierarchyNumber(point.y)
    }`
  ).join("");
}

function formatHierarchyNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}
