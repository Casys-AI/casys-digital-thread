/**
 * The whiteboard seen as cable hardware: hulls, leaves, terminals and the
 * fan-in fields that join them.
 *
 * `buildOverviewThreadD3FlowLayout` owns lanes, matrices and placement. This
 * module owns the question "where does a cable attach, and how does it reach
 * the hull it belongs to" — once, for every cable, whatever lanes its ends sit
 * in. Keeping that answer in one place is what stops the three lookalike
 * routing paths (inside a hull, within a lane, across lanes) from drifting
 * apart again.
 */
import {
  overviewThreadD3CableAnchor,
  overviewThreadD3CableArrivalTangent,
  type OverviewThreadD3CableBox,
  overviewThreadD3CableDepartureTangent,
  type OverviewThreadD3CableSide,
  type OverviewThreadD3CableSidePair,
  type OverviewThreadD3CableVector,
} from "./overview-thread-d3-cable-anchorage.ts";
import {
  buildOverviewThreadD3NodeFanIn,
  type OverviewThreadD3NodeFanInRoute,
  reverseOverviewThreadD3NodeFanInRoute,
} from "./overview-thread-d3-node-fan-in.ts";
import type { OverviewThreadD3CableObstacle } from "./overview-thread-d3-cable-field.ts";

export type OverviewThreadD3CableRole = "source" | "target";

/** Shared stand-off for recorded cables and navigation fans on a hull. */
export const OVERVIEW_THREAD_D3_HULL_HUB_MARGIN = 20;

/** A hull a cable can leave or enter: one group's immutable rectangle. */
export interface OverviewThreadD3CableHull extends OverviewThreadD3CableBox {
  readonly key: string;
  /** Clearance between the hull edge and its cable hubs. */
  readonly hubMargin: number;
  /**
   * Caption band reserved above the leaves. Left/right hubs sit on the
   * content, not on this band; top/bottom hubs stay on the outer hull.
   */
  readonly headerHeight?: number;
  readonly footerHeight?: number;
  /** Folded hulls have no body; their rail is the remaining bar. */
  readonly collapsed?: boolean;
}

/**
 * Side rail for left/right cables: the content body, never the caption band.
 * A collapsed hull has no body, so the remaining bar is the dock.
 */
export function overviewThreadD3CableBodyBox(
  hull: OverviewThreadD3CableHull,
): OverviewThreadD3CableBox {
  if (hull.collapsed) {
    return { x: hull.x, y: hull.y, width: hull.width, height: hull.height };
  }
  const header = nonNegative(hull.headerHeight);
  const footer = nonNegative(hull.footerHeight);
  return {
    x: hull.x,
    y: hull.y + header,
    width: hull.width,
    height: Math.max(0, hull.height - header - footer),
  };
}

/** A leaf inside a hull: one node's rectangle. */
export interface OverviewThreadD3CableLeaf extends OverviewThreadD3CableBox {
  readonly key: string;
  /**
   * Visual cable dock this leaf shares. Graph identity stays on `key`;
   * omitted when the leaf has its own take.
   */
  readonly dockKey?: string;
}

/**
 * One end of a cable, fully resolved: which leaf, on which hull, through which
 * side — and every point and tangent that follows from it.
 */
export interface OverviewThreadD3CableTerminal<
  Hull extends OverviewThreadD3CableHull = OverviewThreadD3CableHull,
  Leaf extends OverviewThreadD3CableLeaf = OverviewThreadD3CableLeaf,
> {
  readonly hull: Hull;
  readonly leaf: Leaf;
  readonly side: OverviewThreadD3CableSide;
  readonly role: OverviewThreadD3CableRole;
  /** Attachment point on the leaf boundary. */
  readonly port: OverviewThreadD3CableVector;
  /** Shared junction just clear of the hull, where this side's cables meet. */
  readonly hub: OverviewThreadD3CableVector;
  readonly departureTangent: OverviewThreadD3CableVector;
  readonly arrivalTangent: OverviewThreadD3CableVector;
  /** Visual dock this terminal shares; graph identity stays on `leaf.key`. */
  readonly dockKey: string;
  /** Identity of the fan-in field this terminal belongs to. */
  readonly fieldKey: string;
  /** Identity of this terminal's visual branch inside that field. */
  readonly branchKey: string;
}

/** Visual dock a leaf occupies; falls back to the exact graph key. */
export function overviewThreadD3CableDockKey(
  leaf: Pick<OverviewThreadD3CableLeaf, "key" | "dockKey">,
): string {
  return leaf.dockKey ?? leaf.key;
}

export function overviewThreadD3CableTerminal<
  Hull extends OverviewThreadD3CableHull,
  Leaf extends OverviewThreadD3CableLeaf,
>(
  hull: Hull,
  leaf: Leaf,
  side: OverviewThreadD3CableSide,
  role: OverviewThreadD3CableRole,
): OverviewThreadD3CableTerminal<Hull, Leaf> {
  const dockKey = overviewThreadD3CableDockKey(leaf);
  const fieldKey = `${hull.key}|${role}|${side}`;
  return {
    hull,
    leaf,
    side,
    role,
    port: overviewThreadD3CableAnchor(leaf, side),
    hub: overviewThreadD3CableHub(hull, side),
    departureTangent: overviewThreadD3CableDepartureTangent(side),
    arrivalTangent: overviewThreadD3CableArrivalTangent(side),
    dockKey,
    fieldKey,
    branchKey: `${fieldKey}|${dockKey}`,
  };
}

/** Shared junction just clear of `hull`, on the side the cables actually use. */
export function overviewThreadD3CableHub(
  hull: OverviewThreadD3CableHull,
  side: OverviewThreadD3CableSide,
): OverviewThreadD3CableVector {
  if (side === "top" || side === "bottom") {
    return overviewThreadD3CableAnchor(hull, side, hull.hubMargin);
  }
  return overviewThreadD3CableAnchor(
    overviewThreadD3CableBodyBox(hull),
    side,
    hull.hubMargin,
  );
}

function nonNegative(value: number | undefined): number {
  return Number.isFinite(value) && value! > 0 ? value! : 0;
}

/**
 * Sides two hulls exchange over. Hull cables stay on left/right for every
 * placement — stacked, overlapped, close, or dragged. Facing flanks are used
 * only when both hubs fit in the horizontal gap; otherwise both ends share
 * one external lateral face so the hubs cannot coincide. When that face
 * would plant a hub inside the neighbour, the cable returns on the outer
 * lateral faces. Never top/bottom.
 */
export function overviewThreadD3CableHullSides(
  source: OverviewThreadD3CableHull,
  target: OverviewThreadD3CableHull,
  preferred: "left-to-right" | "right-to-left" = "left-to-right",
): OverviewThreadD3CableSidePair {
  const rightGap = target.x - (source.x + source.width);
  const leftGap = source.x - (target.x + target.width);
  const facingRoom = source.hubMargin + target.hubMargin + HUB_SEPARATION;
  if (rightGap > facingRoom) {
    return { source: "right", target: "left" };
  }
  if (leftGap > facingRoom) {
    return { source: "left", target: "right" };
  }

  const centerDelta = (target.x + target.width / 2) -
    (source.x + source.width / 2);
  const preferredSame: OverviewThreadD3CableSide = centerDelta > 0
    ? "left"
    : centerDelta < 0
    ? "right"
    : preferred === "left-to-right"
    ? "right"
    : "left";
  const otherSame: OverviewThreadD3CableSide = preferredSame === "right"
    ? "left"
    : "right";
  for (const side of [preferredSame, otherSame]) {
    if (lateralSameSideViable(source, target, side)) {
      return { source: side, target: side };
    }
  }

  if (centerDelta > 0) return { source: "left", target: "right" };
  if (centerDelta < 0) return { source: "right", target: "left" };
  return preferred === "left-to-right"
    ? { source: "right", target: "left" }
    : { source: "left", target: "right" };
}

const HUB_SEPARATION = 1;

function lateralSameSideViable(
  source: OverviewThreadD3CableHull,
  target: OverviewThreadD3CableHull,
  side: "left" | "right",
): boolean {
  const sourceHub = overviewThreadD3CableHub(source, side);
  const targetHub = overviewThreadD3CableHub(target, side);
  if (
    Math.hypot(sourceHub.x - targetHub.x, sourceHub.y - targetHub.y) <=
      HUB_SEPARATION
  ) {
    return false;
  }
  return !pointInsideBox(sourceHub, target) &&
    !pointInsideBox(targetHub, source);
}

function pointInsideBox(
  point: OverviewThreadD3CableVector,
  box: OverviewThreadD3CableBox,
): boolean {
  return point.x > box.x && point.x < box.x + box.width &&
    point.y > box.y && point.y < box.y + box.height;
}

interface FanInFieldDemand {
  readonly terminal: OverviewThreadD3CableTerminal;
  readonly leaves: Map<
    string,
    { readonly terminal: OverviewThreadD3CableTerminal; weight: number }
  >;
}

/**
 * The fan-in fields of one layout pass.
 *
 * A field must see every visual dock that shares a junction before it is
 * solved: one cable solved at a time reproduces the rigid
 * one-strand-per-relation geometry this whole module exists to avoid. Exact
 * terminals that share a dock are merged first — identical anchors are
 * refused — then demand is solved once and read back per branch.
 */
export class OverviewThreadD3CableFanInFields {
  readonly #demands = new Map<string, FanInFieldDemand>();
  readonly #branches = new Map<string, OverviewThreadD3NodeFanInRoute>();
  #solved = false;

  /** Registers `terminal` as a leaf of its field, weighted by path count. */
  demand(terminal: OverviewThreadD3CableTerminal, weight: number): void {
    if (this.#solved) {
      throw new Error(
        "Cable fan-in demand is closed once the fields are solved.",
      );
    }
    let field = this.#demands.get(terminal.fieldKey);
    if (!field) {
      field = { terminal, leaves: new Map() };
      this.#demands.set(terminal.fieldKey, field);
    }
    const leaf = field.leaves.get(terminal.dockKey);
    if (leaf) leaf.weight += weight;
    else field.leaves.set(terminal.dockKey, { terminal, weight });
  }

  /**
   * Solves every field. A field that cannot be solved emits no branch at all:
   * a degraded half-cable would read as a spur into empty board.
   */
  solve(
    obstaclesFor: (
      hull: OverviewThreadD3CableHull,
    ) => readonly OverviewThreadD3CableObstacle[],
  ): void {
    this.#solved = true;
    const fields = [...this.#demands.values()].toSorted((left, right) =>
      left.terminal.fieldKey.localeCompare(right.terminal.fieldKey)
    );
    for (const field of fields) {
      const leaves = [...field.leaves.values()].toSorted((left, right) =>
        left.terminal.dockKey.localeCompare(right.terminal.dockKey) ||
        left.terminal.leaf.key.localeCompare(right.terminal.leaf.key)
      );
      try {
        const solved = buildOverviewThreadD3NodeFanIn({
          junction: field.terminal.hub,
          trunkTangent: field.terminal.departureTangent,
          leaves: leaves.map(({ terminal, weight }) => ({
            key: terminal.dockKey,
            anchor: terminal.port,
            anchorTangent: terminal.departureTangent,
            weight,
          })),
          obstacles: obstaclesFor(field.terminal.hull),
        });
        for (const { terminal } of leaves) {
          const route = solved.get(terminal.dockKey);
          if (route) this.#branches.set(terminal.branchKey, route);
        }
      } catch {
        // Strict by design: dependent relations are reported unrouted.
      }
    }
  }

  /**
   * The branch of `terminal`, oriented leaf-to-hub for a source and
   * hub-to-leaf for a target, or `undefined` when its field failed.
   */
  branchFor(
    terminal: OverviewThreadD3CableTerminal,
  ): OverviewThreadD3NodeFanInRoute | undefined {
    const branch = this.#branches.get(terminal.branchKey);
    if (!branch) return undefined;
    return terminal.role === "source"
      ? branch
      : reverseOverviewThreadD3NodeFanInRoute(branch);
  }
}
