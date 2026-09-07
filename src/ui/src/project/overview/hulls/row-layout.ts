import {
  OVERVIEW_THREAD_D3_HULL_HUB_MARGIN as HULL_HIERARCHY_HUB_MARGIN,
  OverviewThreadD3CableFanInFields,
  type OverviewThreadD3CableHull,
  overviewThreadD3CableTerminal,
} from "../../overview-thread-d3-cable-board.ts";
import type { OverviewThreadD3CableObstacle } from "../../overview-thread-d3-cable-field.ts";
import type { OverviewHullContentRow, OverviewHullRowBox } from "./types.ts";

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

/**
 * Presentation parentage for any visible row that already names a present
 * parentKey. Never a Thread edge, evidence join, or inferred relation.
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
    const involved = new Set([
      parentKey,
      ...children.map((child) => child.row.key),
    ]);
    const side = hierarchyFanSide(parent, group);
    const hull: OverviewThreadD3CableHull = {
      key: parentKey,
      x: group.x,
      y: parent.y,
      width: group.width,
      height: parent.height,
      hubMargin: HULL_HIERARCHY_HUB_MARGIN,
    };
    const fields = new OverviewThreadD3CableFanInFields();
    const parentTerminal = overviewThreadD3CableTerminal(
      hull,
      rowLeaf(parent, group.view, pointSize),
      side,
      "source",
    );
    fields.demand(parentTerminal, 1);
    const childTerminals = children.map((child) => {
      const terminal = overviewThreadD3CableTerminal(
        hull,
        rowLeaf(child, group.view, pointSize),
        side,
        "target",
      );
      fields.demand(terminal, 1);
      return { child, terminal };
    });
    const obstacles: readonly OverviewThreadD3CableObstacle[] =
      group.view === "list" && group.columns > 1
        ? [...positions.values()]
          .filter((position) => !involved.has(position.row.key))
          .map((position) => ({
            key: position.row.key,
            minimumX: position.x,
            maximumX: position.x + position.width,
            minimumY: position.y,
            maximumY: position.y + position.height,
          }))
          .toSorted((left, right) => left.key.localeCompare(right.key))
        : [];
    fields.solve(() => obstacles);
    const parentBranch = fields.branchFor(parentTerminal);
    if (!parentBranch) continue;
    for (const { child, terminal } of childTerminals) {
      const childBranch = fields.branchFor(terminal);
      if (!childBranch) continue;
      links.push({
        fromKey: parentKey,
        toKey: child.row.key,
        relationKind: OVERVIEW_HULL_ROW_PARENT_RELATION,
        points: [
          ...parentBranch.points,
          ...childBranch.points.slice(1),
        ],
        d: `${parentBranch.d}${childBranch.d}`,
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

function rowLeaf(
  position: OverviewHullRowLayout,
  view: OverviewHullRowBox["view"],
  pointSize: number,
): {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} {
  return {
    key: position.row.key,
    ...overviewHullRowCableSurface(position, view, pointSize),
  };
}
