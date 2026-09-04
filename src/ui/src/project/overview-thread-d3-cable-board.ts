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
  overviewThreadD3CableSidesForBoxes,
  type OverviewThreadD3CableVector,
} from "./overview-thread-d3-cable-anchorage.ts";
import {
  buildOverviewThreadD3NodeFanIn,
  type OverviewThreadD3NodeFanInRoute,
  reverseOverviewThreadD3NodeFanInRoute,
} from "./overview-thread-d3-node-fan-in.ts";
import type { OverviewThreadD3CableObstacle } from "./overview-thread-d3-cable-field.ts";

export type OverviewThreadD3CableRole = "source" | "target";

/** A hull a cable can leave or enter: one group's immutable rectangle. */
export interface OverviewThreadD3CableHull extends OverviewThreadD3CableBox {
  readonly key: string;
  /** Clearance between the hull edge and its cable hubs. */
  readonly hubMargin: number;
}

/** A leaf inside a hull: one node's rectangle. */
export interface OverviewThreadD3CableLeaf extends OverviewThreadD3CableBox {
  readonly key: string;
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
  /** Identity of the fan-in field this terminal belongs to. */
  readonly fieldKey: string;
  /** Identity of this terminal's own branch inside that field. */
  readonly branchKey: string;
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
  const fieldKey = `${hull.key}|${role}|${side}`;
  return {
    hull,
    leaf,
    side,
    role,
    port: overviewThreadD3CableAnchor(leaf, side),
    hub: overviewThreadD3CableAnchor(hull, side, hull.hubMargin),
    departureTangent: overviewThreadD3CableDepartureTangent(side),
    arrivalTangent: overviewThreadD3CableArrivalTangent(side),
    fieldKey,
    branchKey: `${fieldKey}|${leaf.key}`,
  };
}

/** Sides two hulls exchange over, from where they actually sit on the board. */
export function overviewThreadD3CableHullSides(
  source: OverviewThreadD3CableHull,
  target: OverviewThreadD3CableHull,
  preferred: "left-to-right" | "right-to-left" = "left-to-right",
): {
  readonly source: OverviewThreadD3CableSide;
  readonly target: OverviewThreadD3CableSide;
} {
  return overviewThreadD3CableSidesForBoxes(source, target, preferred);
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
 * A field must see every leaf that shares a junction before it is solved: one
 * cable solved at a time reproduces the rigid one-strand-per-relation geometry
 * this whole module exists to avoid. So demand is collected first, solved
 * once, then read back per branch.
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
    const leaf = field.leaves.get(terminal.leaf.key);
    if (leaf) leaf.weight += weight;
    else field.leaves.set(terminal.leaf.key, { terminal, weight });
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
        left.terminal.leaf.key.localeCompare(right.terminal.leaf.key)
      );
      try {
        const solved = buildOverviewThreadD3NodeFanIn({
          junction: field.terminal.hub,
          trunkTangent: field.terminal.departureTangent,
          leaves: leaves.map(({ terminal, weight }) => ({
            key: terminal.leaf.key,
            anchor: terminal.port,
            anchorTangent: terminal.departureTangent,
            weight,
          })),
          obstacles: obstaclesFor(field.terminal.hull),
        });
        for (const { terminal } of leaves) {
          const route = solved.get(terminal.leaf.key);
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
