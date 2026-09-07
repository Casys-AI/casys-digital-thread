/**
 * Collision resolution for movable whiteboard hulls, not graph authority.
 *
 * The manipulated hull stays under the pointer. Other hulls retain their
 * position whenever possible, then take the nearest free horizontal or
 * vertical position. Each hull is placed once against the already placed
 * rectangles, so crowded chains settle without oscillation or an iteration
 * ceiling that could leave overlapping boxes behind.
 */
export interface OverviewThreadHullBox {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface OverviewThreadHullSeparationOptions {
  readonly fixedKey?: string;
  /** Includes the drawn border and space for the exterior cable trays. */
  readonly gap?: number;
}

// 20-unit cable hub + 12-unit router inflation + room for a tangent stub.
export const OVERVIEW_THREAD_HULL_SEPARATION_GAP = 48;

/** Return the same exact hull identities in input order, without mutation. */
export function separateOverviewThreadHulls<T extends OverviewThreadHullBox>(
  hulls: readonly T[],
  options: OverviewThreadHullSeparationOptions = {},
): readonly T[] {
  const gap = options.gap ?? OVERVIEW_THREAD_HULL_SEPARATION_GAP;
  if (!Number.isFinite(gap) || gap < 0) {
    throw new RangeError("Hull clearance must be a finite non-negative value.");
  }
  const keys = new Set<string>();
  for (const hull of hulls) {
    if (!hull.key || keys.has(hull.key)) {
      throw new TypeError("Hull identities must be non-empty and unique.");
    }
    keys.add(hull.key);
    if (
      ![hull.x, hull.y, hull.width, hull.height].every(Number.isFinite) ||
      hull.width <= 0 || hull.height <= 0
    ) {
      throw new RangeError("Hull geometry must be finite with positive size.");
    }
  }
  const fixed = hulls.find((hull) => hull.key === options.fixedKey);
  const ordered = hulls.toSorted((left, right) => {
    if (left.key === fixed?.key) return -1;
    if (right.key === fixed?.key) return 1;
    if (fixed) {
      const distance = squaredDistance(left, fixed) -
        squaredDistance(right, fixed);
      if (distance !== 0) return distance;
    }
    return left.x - right.x || left.y - right.y ||
      left.key.localeCompare(right.key);
  });
  const placed: T[] = [];
  for (const hull of ordered) {
    if (!placed.some((obstacle) => hullsOverlap(hull, obstacle, gap))) {
      placed.push(hull);
      continue;
    }
    const candidates = [
      ...freeAxisPositions(hull, placed, "x", gap).map((x) => ({ ...hull, x })),
      ...freeAxisPositions(hull, placed, "y", gap).map((y) => ({ ...hull, y })),
    ].filter((candidate) =>
      Number.isFinite(candidate.x) && Number.isFinite(candidate.y) &&
      !placed.some((obstacle) => hullsOverlap(candidate, obstacle, gap))
    );
    candidates.sort((left, right) =>
      squaredDistance(left, hull) - squaredDistance(right, hull) ||
      // Equal distances favor moving with the existing left-to-right flow,
      // then downwards, instead of reversing the reader's established order.
      (left.x < hull.x ? 1 : 0) - (right.x < hull.x ? 1 : 0) ||
      (left.y < hull.y ? 1 : 0) - (right.y < hull.y ? 1 : 0) ||
      Math.abs(left.y - hull.y) - Math.abs(right.y - hull.y) ||
      left.x - right.x || left.y - right.y
    );
    const next = candidates[0];
    if (!next) {
      throw new RangeError(
        "Hull separation exceeds finite whiteboard geometry.",
      );
    }
    placed.push(next);
  }
  const byKey = new Map(placed.map((hull) => [hull.key, hull]));
  return hulls.map((hull) => byKey.get(hull.key)!);
}

function squaredDistance(
  left: OverviewThreadHullBox,
  right: OverviewThreadHullBox,
): number {
  const x = left.x + left.width / 2 - right.x - right.width / 2;
  const y = left.y + left.height / 2 - right.y - right.height / 2;
  return x * x + y * y;
}

function hullsOverlap(
  left: OverviewThreadHullBox,
  right: OverviewThreadHullBox,
  gap: number,
): boolean {
  return left.x < right.x + right.width + gap &&
    right.x < left.x + left.width + gap &&
    left.y < right.y + right.height + gap &&
    right.y < left.y + left.height + gap;
}

/**
 * The occupied intervals on one axis, with the other coordinate held still.
 * Their union yields the two nearest free positions directly. No iterative
 * pairwise shove can bounce between two neighbors or miss a later obstacle.
 */
function freeAxisPositions(
  hull: OverviewThreadHullBox,
  obstacles: readonly OverviewThreadHullBox[],
  axis: "x" | "y",
  gap: number,
): readonly number[] {
  const other = axis === "x" ? "y" : "x";
  const size = axis === "x" ? "width" : "height";
  const otherSize = axis === "x" ? "height" : "width";
  const intervals = obstacles.filter((obstacle) =>
    hull[other] < obstacle[other] + obstacle[otherSize] + gap &&
    obstacle[other] < hull[other] + hull[otherSize] + gap
  ).map((obstacle) => ({
    start: obstacle[axis] - hull[size] - gap,
    end: obstacle[axis] + obstacle[size] + gap,
  })).toSorted((left, right) =>
    left.start - right.start || left.end - right.end
  );
  const merged: { start: number; end: number }[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start < previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
  }
  const occupied = merged.find((interval) =>
    interval.start < hull[axis] && hull[axis] < interval.end
  );
  return occupied ? [occupied.start, occupied.end] : [hull[axis]];
}
