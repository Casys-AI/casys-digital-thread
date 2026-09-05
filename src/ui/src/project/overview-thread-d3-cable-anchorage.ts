/**
 * Where a cable leaves or enters a rectangle, and along which axis.
 *
 * Nodes and group hulls are the same shape to a cable: a box with four sides.
 * A node port is an anchor at offset zero; a group hub is the same anchor
 * pushed a fixed margin clear of the hull. Keeping one vocabulary here is what
 * lets every cable — inside a hull, between hulls of one lane, or across lanes
 * — be routed by the same code instead of three lookalike branches.
 */

export type OverviewThreadD3CableSide = "left" | "right" | "top" | "bottom";

export interface OverviewThreadD3CableVector {
  readonly x: number;
  readonly y: number;
}

/** Any rectangle a cable can attach to: a node, or an immutable group hull. */
export interface OverviewThreadD3CableBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const SIDE_VECTORS: {
  readonly [K in OverviewThreadD3CableSide]: OverviewThreadD3CableVector;
} = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/** Unit vector pointing away from the box through `side`. */
export function overviewThreadD3CableSideVector(
  side: OverviewThreadD3CableSide,
): OverviewThreadD3CableVector {
  return SIDE_VECTORS[side];
}

/** Direction a cable follows while leaving `side`. */
export function overviewThreadD3CableDepartureTangent(
  side: OverviewThreadD3CableSide,
): OverviewThreadD3CableVector {
  return SIDE_VECTORS[side];
}

/** Direction a cable follows while arriving into `side`, i.e. inwards. */
export function overviewThreadD3CableArrivalTangent(
  side: OverviewThreadD3CableSide,
): OverviewThreadD3CableVector {
  const vector = SIDE_VECTORS[side];
  return { x: -vector.x, y: -vector.y };
}

/**
 * Anchor on `side` of `box`, pushed `offset` units clear of the edge. Offset
 * zero is the port on the boundary itself.
 */
export function overviewThreadD3CableAnchor(
  box: OverviewThreadD3CableBox,
  side: OverviewThreadD3CableSide,
  offset = 0,
): OverviewThreadD3CableVector {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  switch (side) {
    case "left":
      return { x: box.x - offset, y: centerY };
    case "right":
      return { x: box.x + box.width + offset, y: centerY };
    case "top":
      return { x: centerX, y: box.y - offset };
    case "bottom":
      return { x: centerX, y: box.y + box.height + offset };
  }
}

export interface OverviewThreadD3CableSidePair {
  readonly source: OverviewThreadD3CableSide;
  readonly target: OverviewThreadD3CableSide;
}

/**
 * Chooses the sides two boxes exchange over.
 *
 * A clear horizontal corridor keeps the exchange on the facing flanks. A
 * clear vertical corridor — two hulls stacked in one column — uses the
 * facing top and bottom ports. Overlap on both axes falls back to the
 * recorded horizontal preference; geometry never moves a hull to resolve it.
 */
export function overviewThreadD3CableSidesForBoxes(
  source: OverviewThreadD3CableBox,
  target: OverviewThreadD3CableBox,
  preferred: "left-to-right" | "right-to-left" = "left-to-right",
): OverviewThreadD3CableSidePair {
  const rightGap = target.x - (source.x + source.width);
  const leftGap = source.x - (target.x + target.width);
  const bottomGap = target.y - (source.y + source.height);
  const topGap = source.y - (target.y + target.height);
  if (rightGap >= 0 || leftGap >= 0) {
    return rightGap >= leftGap
      ? { source: "right", target: "left" }
      : { source: "left", target: "right" };
  }
  if (bottomGap >= 0 || topGap >= 0) {
    return bottomGap >= topGap
      ? { source: "bottom", target: "top" }
      : { source: "top", target: "bottom" };
  }

  const centerDelta = (target.x + target.width / 2) -
    (source.x + source.width / 2);
  if (centerDelta > 0) return { source: "right", target: "left" };
  if (centerDelta < 0) return { source: "left", target: "right" };
  return preferred === "left-to-right"
    ? { source: "right", target: "left" }
    : { source: "left", target: "right" };
}
