// @deno-types="npm:@types/d3-force@^3.0.10"
import {
  type Force,
  forceLink,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { curveCatmullRom, line } from "d3-shape";

const DEFAULT_CORNER_CLEARANCE = 12;
const DEFAULT_MAX_PARTICLES = 10;
const MIN_PARTICLES = 4;
const MAX_PARTICLES = 12;
const DEFAULT_TICK_COUNT = 24;
const DEFAULT_CURVE_TOLERANCE = 0.18;
const VISIBILITY_EPSILON = 1e-7;
const COST_EPSILON = 1e-8;
const BEND_COST = 1.35;
const BACKTRACK_COST = 0.12;
const PARTICLE_SPACING = 42;
const REPULSION_REACH = 18;
const HARD_PROJECTION_CLEARANCE = 0.35;

export interface OverviewThreadD3CablePoint {
  readonly x: number;
  readonly y: number;
}

/**
 * Immutable, already-inflated obstacle. Source and target hulls must be
 * excluded by the caller so their ports can remain exact.
 */
export interface OverviewThreadD3CableObstacle {
  readonly key: string;
  readonly minimumX: number;
  readonly maximumX: number;
  readonly minimumY: number;
  readonly maximumY: number;
}

export interface OverviewThreadD3CableFieldOptions {
  /** Extra clearance around the already-inflated obstacle corners. */
  readonly cornerClearance?: number;
  /** Number of moving-chain particles, clamped to the inclusive range 4..12. */
  readonly maxParticles?: number;
  /** Fixed manual D3 tick count. No timer or animation is started. */
  readonly tickCount?: number;
  /** Adaptive tolerance used to flatten and validate the rendered cubic. */
  readonly curveTolerance?: number;
  /**
   * Absolute point indicating the desired departure tangent. When supplied,
   * two or three free guard particles turn a feeder into its shared trunk
   * progressively instead of introducing a rigid elbow at the fan-in.
   */
  readonly sourceTangentTarget?: OverviewThreadD3CablePoint;
  /** Absolute point on the desired incoming tangent before `target`. */
  readonly targetTangentSource?: OverviewThreadD3CablePoint;
  /** Free guards per configured endpoint, clamped to 2..3. */
  readonly endpointGuardCount?: number;
  /** Maximum world-space length occupied by one endpoint's guard chain. */
  readonly endpointGuardLength?: number;
}

export interface OverviewThreadD3CableFieldRoute {
  /** Final fixed-endpoint control points used by `d`. */
  readonly points: readonly OverviewThreadD3CablePoint[];
  /** Deterministic collision-free guide selected before relaxation. */
  readonly guidePoints: readonly OverviewThreadD3CablePoint[];
  /** D3-produced SVG path. */
  readonly d: string;
  readonly curve: "catmull-rom";
  readonly topologySignature: string;
  readonly usedRelaxation: boolean;
}

interface VisibilityVertex extends OverviewThreadD3CablePoint {
  readonly key: string;
}

interface SearchEntry {
  readonly previous: number | undefined;
  readonly current: number;
  readonly cost: number;
  readonly priority: number;
  readonly lexicalPath: string;
  readonly path: readonly number[];
}

interface SearchBest {
  readonly cost: number;
  readonly lexicalPath: string;
}

interface CableParticle extends SimulationNodeDatum {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
  readonly guideX: number;
  readonly guideY: number;
  readonly ordinal: number;
}

interface CableLink extends SimulationLinkDatum<CableParticle> {
  source: number | CableParticle;
  target: number | CableParticle;
}

interface SvgLineSegment {
  readonly kind: "line";
  readonly source: OverviewThreadD3CablePoint;
  readonly target: OverviewThreadD3CablePoint;
}

interface SvgCubicSegment {
  readonly kind: "cubic";
  readonly source: OverviewThreadD3CablePoint;
  readonly control1: OverviewThreadD3CablePoint;
  readonly control2: OverviewThreadD3CablePoint;
  readonly target: OverviewThreadD3CablePoint;
}

type SvgSegment = SvgLineSegment | SvgCubicSegment;

const cableCatmullRomLine = line<OverviewThreadD3CablePoint>()
  .x((point: OverviewThreadD3CablePoint) => point.x)
  .y((point: OverviewThreadD3CablePoint) => point.y)
  .curve(curveCatmullRom.alpha(0.5))
  .digits(null);

/**
 * Builds one deterministic, edge-only cable chain. D3 relaxes copied
 * particles; it never owns or moves a graph node, a hull, or caller data.
 */
export function buildOverviewThreadD3CableFieldRoute(
  sourceInput: OverviewThreadD3CablePoint,
  targetInput: OverviewThreadD3CablePoint,
  obstacleInputs: readonly OverviewThreadD3CableObstacle[],
  options: OverviewThreadD3CableFieldOptions = {},
): OverviewThreadD3CableFieldRoute {
  const source = finitePoint(sourceInput, "source");
  const target = finitePoint(targetInput, "target");
  const obstacles = normalizeObstacles(obstacleInputs);
  const cornerClearance = positiveOrDefault(
    options.cornerClearance,
    DEFAULT_CORNER_CLEARANCE,
  );
  const maximumParticles = integerInRange(
    options.maxParticles,
    DEFAULT_MAX_PARTICLES,
    MIN_PARTICLES,
    MAX_PARTICLES,
  );
  const tickCount = integerInRange(
    options.tickCount,
    DEFAULT_TICK_COUNT,
    1,
    400,
  );
  const curveTolerance = positiveOrDefault(
    options.curveTolerance,
    DEFAULT_CURVE_TOLERANCE,
  );

  assertEndpointOutsideObstacles(source, "source", obstacles);
  assertEndpointOutsideObstacles(target, "target", obstacles);

  const guarded = buildEndpointGuardChains(source, target, obstacles, options);
  if (
    guarded.source.length === 1 && guarded.target.length === 1 &&
    overviewThreadD3CableSegmentVisible(source, target, obstacles)
  ) {
    const points = Object.freeze([source, target]);
    return Object.freeze({
      points,
      guidePoints: points,
      d: overviewThreadD3CableCatmullRomPath(points),
      curve: "catmull-rom",
      topologySignature: "cable-field/v1|direct|fan:0:0|curve:catmull-rom:1",
      usedRelaxation: false,
    });
  }

  const routingSource = guarded.source.at(-1)!;
  const routingTarget = guarded.target[0]!;
  const clearanceAttempts = uniqueSortedCoordinates([
    cornerClearance,
    Math.max(cornerClearance, 18),
    Math.max(cornerClearance, 26),
  ]);
  let lastFailure: unknown;
  for (const attemptClearance of clearanceAttempts) {
    try {
      const visibilityPath = overviewThreadD3CableSegmentVisible(
          routingSource,
          routingTarget,
          obstacles,
        )
        ? [routingSource, routingTarget]
        : shortestVisibilityPath(
          routingSource,
          routingTarget,
          obstacles,
          attemptClearance,
        );
      const guidePoints = Object.freeze(
        deduplicateConsecutivePoints([
          ...guarded.source.slice(0, -1),
          ...stringPullVisibilityPath(visibilityPath, obstacles),
          ...guarded.target.slice(1),
        ]),
      );
      const obstacleTopology = overviewThreadD3CableTopologySignature(
        guidePoints,
        obstacles,
      );
      const topologyBase = `${obstacleTopology}|fan:${
        guarded.source.length - 1
      }:${guarded.target.length - 1}`;
      const safeParticleGuide = guidePoints.length <= maximumParticles
        ? guidePoints
        : boundedSafeGuide(guidePoints, obstacles, maximumParticles);
      if (safeParticleGuide.length > maximumParticles) {
        lastFailure = new RangeError(
          `Obstacle-safe route needs ${safeParticleGuide.length} control points; maximum is ${maximumParticles}`,
        );
        continue;
      }
      const particleGuide = resampleGuide(
        safeParticleGuide,
        Math.min(
          maximumParticles,
          Math.max(
            MIN_PARTICLES,
            Math.ceil(polylineLength(guidePoints) / PARTICLE_SPACING) + 1,
            safeParticleGuide.length,
          ),
        ),
      );
      const relaxationTicks = uniqueSortedCoordinates([
        tickCount,
        Math.min(tickCount, 12),
        1,
      ]).toReversed();
      const candidates: {
        readonly points: readonly OverviewThreadD3CablePoint[];
        readonly usedRelaxation: boolean;
      }[] = relaxationTicks.map((attemptTicks) => ({
        points: relaxCableParticles(
          particleGuide,
          obstacles,
          attemptTicks,
        ),
        usedRelaxation: true,
      }));
      candidates.push({
        points: particleGuide.map(copyPoint),
        usedRelaxation: false,
      });
      for (const candidate of candidates) {
        const d = overviewThreadD3CableCatmullRomPath(candidate.points);
        if (
          !d.includes("C") ||
          overviewThreadD3CableTopologySignature(
              candidate.points,
              obstacles,
            ) !== obstacleTopology ||
          !overviewThreadD3CablePolylineClear(candidate.points, obstacles) ||
          !overviewThreadD3CableSvgPathClear(d, obstacles, curveTolerance)
        ) continue;
        return Object.freeze({
          points: Object.freeze(candidate.points.map(copyPoint)),
          guidePoints,
          d,
          curve: "catmull-rom",
          topologySignature: `${topologyBase}|curve:catmull-rom:${
            Math.max(1, candidate.points.length - 1)
          }`,
          usedRelaxation: candidate.usedRelaxation,
        });
      }
      lastFailure = new Error(
        `Catmull-Rom curve clips an obstacle at clearance ${attemptClearance}`,
      );
    } catch (error) {
      lastFailure = error;
    }
  }
  const detail = lastFailure instanceof Error ? `: ${lastFailure.message}` : "";
  throw new Error(`No obstacle-safe Catmull-Rom route exists${detail}`);
}

/** Closed-rectangle visibility; touching an inflated hull is not clear. */
export function overviewThreadD3CableSegmentVisible(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacles: readonly OverviewThreadD3CableObstacle[],
): boolean {
  return obstacles.every((obstacle) =>
    !segmentIntersectsClosedRectangle(source, target, obstacle)
  );
}

export function overviewThreadD3CablePolylineClear(
  points: readonly OverviewThreadD3CablePoint[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): boolean {
  if (points.length === 0 || points.some((point) => !isFinitePoint(point))) {
    return false;
  }
  for (let index = 1; index < points.length; index++) {
    if (
      !overviewThreadD3CableSegmentVisible(
        points[index - 1]!,
        points[index]!,
        obstacles,
      )
    ) return false;
  }
  return true;
}

/**
 * Samples the actual M/L/C commands emitted by D3. Cubics are adaptively
 * flattened, so the collision check follows rendered geometry rather than
 * assuming that safe control points imply a safe curve.
 */
export function sampleOverviewThreadD3CableSvgPath(
  d: string,
  tolerance = DEFAULT_CURVE_TOLERANCE,
): readonly OverviewThreadD3CablePoint[] {
  const segments = parseSvgPath(d);
  if (segments.length === 0) return [];
  const samples: OverviewThreadD3CablePoint[] = [
    copyPoint(segments[0]!.source),
  ];
  for (const segment of segments) {
    if (segment.kind === "line") {
      samples.push(copyPoint(segment.target));
      continue;
    }
    flattenCubic(
      segment.source,
      segment.control1,
      segment.control2,
      segment.target,
      positiveOrDefault(tolerance, DEFAULT_CURVE_TOLERANCE),
      0,
      samples,
    );
  }
  return Object.freeze(samples);
}

export function overviewThreadD3CableSvgPathClear(
  d: string,
  obstacles: readonly OverviewThreadD3CableObstacle[],
  tolerance = DEFAULT_CURVE_TOLERANCE,
): boolean {
  try {
    return overviewThreadD3CablePolylineClear(
      sampleOverviewThreadD3CableSvgPath(d, tolerance),
      obstacles,
    );
  } catch {
    return false;
  }
}

/** Stable presentation topology; it records no relation or project truth. */
export function overviewThreadD3CableTopologySignature(
  points: readonly OverviewThreadD3CablePoint[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): string {
  if (points.length < 2 || obstacles.length === 0) {
    return "cable-field/v1|direct";
  }
  const sides = [...obstacles].sort(compareObstacle).map((obstacle) => {
    const side = closestPolylineSide(points, obstacle);
    return `${encodeURIComponent(obstacle.key)}:${side}`;
  });
  return `cable-field/v1|${sides.join(",")}`;
}

function buildEndpointGuardChains(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacles: readonly OverviewThreadD3CableObstacle[],
  options: OverviewThreadD3CableFieldOptions,
): {
  readonly source: readonly OverviewThreadD3CablePoint[];
  readonly target: readonly OverviewThreadD3CablePoint[];
} {
  const count = integerInRange(options.endpointGuardCount, 2, 2, 3);
  const maximumLength = positiveOrDefault(options.endpointGuardLength, 28);
  const chordLimit = distance(source, target) * 0.28;
  const guardLength = Math.min(maximumLength, chordLimit);
  const sourceTarget = options.sourceTangentTarget &&
      isFinitePoint(options.sourceTangentTarget)
    ? copyPoint(options.sourceTangentTarget)
    : undefined;
  const targetSource = options.targetTangentSource &&
      isFinitePoint(options.targetTangentSource)
    ? copyPoint(options.targetTangentSource)
    : undefined;
  const sourceChain = sourceTarget
    ? outwardGuardChain(source, sourceTarget, count, guardLength, false)
    : [copyPoint(source)];
  const targetChain = targetSource
    ? outwardGuardChain(target, targetSource, count, guardLength, true)
    : [copyPoint(target)];
  return {
    source: overviewThreadD3CablePolylineClear(sourceChain, obstacles)
      ? Object.freeze(sourceChain)
      : Object.freeze([copyPoint(source)]),
    target: overviewThreadD3CablePolylineClear(targetChain, obstacles)
      ? Object.freeze(targetChain)
      : Object.freeze([copyPoint(target)]),
  };
}

function outwardGuardChain(
  endpoint: OverviewThreadD3CablePoint,
  tangentPoint: OverviewThreadD3CablePoint,
  count: number,
  length: number,
  reverse: boolean,
): OverviewThreadD3CablePoint[] {
  const direction = normalizedVector(endpoint, tangentPoint);
  if (
    length <= VISIBILITY_EPSILON ||
    Math.hypot(direction.x, direction.y) <= VISIBILITY_EPSILON
  ) return [copyPoint(endpoint)];
  const chain = [copyPoint(endpoint)];
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const offset = length * ordinal / count;
    chain.push({
      x: endpoint.x + direction.x * offset,
      y: endpoint.y + direction.y * offset,
    });
  }
  return reverse ? chain.toReversed() : chain;
}

function deduplicateConsecutivePoints(
  points: readonly OverviewThreadD3CablePoint[],
): OverviewThreadD3CablePoint[] {
  const result: OverviewThreadD3CablePoint[] = [];
  for (const point of points) {
    if (
      result.length === 0 ||
      distance(result.at(-1)!, point) > VISIBILITY_EPSILON
    ) result.push(copyPoint(point));
  }
  return result;
}

function normalizeObstacles(
  inputs: readonly OverviewThreadD3CableObstacle[],
): readonly OverviewThreadD3CableObstacle[] {
  const keys = new Set<string>();
  const obstacles = inputs.map((input, index) => {
    const key = input.key.trim();
    if (!key) throw new TypeError(`obstacle[${index}] needs a key`);
    if (keys.has(key)) throw new TypeError(`Duplicate obstacle key: ${key}`);
    keys.add(key);
    const values = [
      input.minimumX,
      input.maximumX,
      input.minimumY,
      input.maximumY,
    ];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new TypeError(`Obstacle ${key} has a non-finite bound`);
    }
    if (
      input.minimumX > input.maximumX || input.minimumY > input.maximumY
    ) {
      throw new RangeError(`Obstacle ${key} has inverted bounds`);
    }
    return Object.freeze({
      key,
      minimumX: input.minimumX,
      maximumX: input.maximumX,
      minimumY: input.minimumY,
      maximumY: input.maximumY,
    });
  });
  return Object.freeze(obstacles.toSorted(compareObstacle));
}

function compareObstacle(
  left: OverviewThreadD3CableObstacle,
  right: OverviewThreadD3CableObstacle,
): number {
  return left.key.localeCompare(right.key) ||
    left.minimumX - right.minimumX || left.minimumY - right.minimumY ||
    left.maximumX - right.maximumX || left.maximumY - right.maximumY;
}

function finitePoint(
  input: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  if (!isFinitePoint(input)) {
    throw new TypeError(`${label} must contain finite x/y coordinates`);
  }
  return Object.freeze(copyPoint(input));
}

function isFinitePoint(point: OverviewThreadD3CablePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function copyPoint(
  point: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  return { x: point.x, y: point.y };
}

function assertEndpointOutsideObstacles(
  point: OverviewThreadD3CablePoint,
  label: string,
  obstacles: readonly OverviewThreadD3CableObstacle[],
): void {
  const containing = obstacles.find((obstacle) =>
    pointInsideClosedRectangle(point, obstacle)
  );
  if (containing) {
    throw new RangeError(
      `${label} lies inside inflated obstacle ${containing.key}`,
    );
  }
}

function shortestVisibilityPath(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacles: readonly OverviewThreadD3CableObstacle[],
  clearance: number,
): readonly OverviewThreadD3CablePoint[] {
  const vertices = buildVisibilityVertices(
    source,
    target,
    obstacles,
    clearance,
  );
  const sourceIndex = vertices.findIndex((vertex) => vertex.key === "source");
  const targetIndex = vertices.findIndex((vertex) => vertex.key === "target");
  const adjacency = vertices.map(() => [] as number[]);
  for (let left = 0; left < vertices.length; left++) {
    for (let right = left + 1; right < vertices.length; right++) {
      if (
        overviewThreadD3CableSegmentVisible(
          vertices[left]!,
          vertices[right]!,
          obstacles,
        )
      ) {
        adjacency[left]!.push(right);
        adjacency[right]!.push(left);
      }
    }
  }
  for (const neighbours of adjacency) {
    neighbours.sort((left, right) =>
      vertices[left]!.key.localeCompare(vertices[right]!.key)
    );
  }

  const heap = new SearchHeap();
  const first: SearchEntry = {
    previous: undefined,
    current: sourceIndex,
    cost: 0,
    priority: distance(source, target),
    lexicalPath: "source",
    path: [sourceIndex],
  };
  heap.push(first);
  const best = new Map<string, SearchBest>();
  best.set(searchStateKey(undefined, sourceIndex), {
    cost: 0,
    lexicalPath: "source",
  });
  const globalDirection = normalizedVector(source, target);

  while (heap.size > 0) {
    const entry = heap.pop()!;
    const stateKey = searchStateKey(entry.previous, entry.current);
    const known = best.get(stateKey);
    if (!known || searchEntryWorse(entry, known)) continue;
    if (entry.current === targetIndex) {
      return Object.freeze(
        entry.path.map((index) => copyPoint(vertices[index]!)),
      );
    }
    for (const next of adjacency[entry.current]!) {
      if (next === entry.previous) continue;
      const currentPoint = vertices[entry.current]!;
      const nextPoint = vertices[next]!;
      const edgeLength = distance(currentPoint, nextPoint);
      if (edgeLength <= VISIBILITY_EPSILON) continue;
      const bendPenalty = entry.previous === undefined
        ? 0
        : BEND_COST * turnAngle(
          vertices[entry.previous]!,
          currentPoint,
          nextPoint,
        );
      const direction = normalizedVector(currentPoint, nextPoint);
      const backwardProjection = Math.min(
        0,
        direction.x * globalDirection.x + direction.y * globalDirection.y,
      );
      const backtrackPenalty = -backwardProjection * edgeLength *
        BACKTRACK_COST;
      const cost = entry.cost + edgeLength + bendPenalty + backtrackPenalty;
      const lexicalPath = `${entry.lexicalPath}>${vertices[next]!.key}`;
      const nextStateKey = searchStateKey(entry.current, next);
      const previousBest = best.get(nextStateKey);
      if (
        previousBest && !candidateBetter(cost, lexicalPath, previousBest)
      ) continue;
      best.set(nextStateKey, { cost, lexicalPath });
      heap.push({
        previous: entry.current,
        current: next,
        cost,
        priority: cost + distance(nextPoint, target),
        lexicalPath,
        path: [...entry.path, next],
      });
    }
  }
  throw new Error("No obstacle-safe visibility route exists");
}

function uniqueSortedCoordinates(values: readonly number[]): readonly number[] {
  const coordinates = new Map<string, number>();
  for (const value of values) {
    coordinates.set(canonicalCoordinate(value), value);
  }
  return Object.freeze(
    [...coordinates.values()].toSorted((left, right) => left - right),
  );
}

function buildVisibilityVertices(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacles: readonly OverviewThreadD3CableObstacle[],
  clearance: number,
): readonly VisibilityVertex[] {
  const candidates: VisibilityVertex[] = [
    { key: "source", ...copyPoint(source) },
    { key: "target", ...copyPoint(target) },
  ];
  for (const obstacle of obstacles) {
    candidates.push(
      {
        key: `corner/${encodeURIComponent(obstacle.key)}/top-left`,
        x: obstacle.minimumX - clearance,
        y: obstacle.minimumY - clearance,
      },
      {
        key: `corner/${encodeURIComponent(obstacle.key)}/top-right`,
        x: obstacle.maximumX + clearance,
        y: obstacle.minimumY - clearance,
      },
      {
        key: `corner/${encodeURIComponent(obstacle.key)}/bottom-left`,
        x: obstacle.minimumX - clearance,
        y: obstacle.maximumY + clearance,
      },
      {
        key: `corner/${encodeURIComponent(obstacle.key)}/bottom-right`,
        x: obstacle.maximumX + clearance,
        y: obstacle.maximumY + clearance,
      },
    );
  }
  const exposed = candidates.filter((candidate) =>
    candidate.key === "source" || candidate.key === "target" ||
    obstacles.every((obstacle) =>
      !pointInsideClosedRectangle(candidate, obstacle)
    )
  );
  const byCoordinate = new Map<string, VisibilityVertex>();
  for (
    const candidate of exposed.toSorted((left, right) =>
      left.key.localeCompare(right.key)
    )
  ) {
    const coordinateKey = `${canonicalCoordinate(candidate.x)}:${
      canonicalCoordinate(candidate.y)
    }`;
    const existing = byCoordinate.get(coordinateKey);
    if (!existing || candidate.key === "source" || candidate.key === "target") {
      byCoordinate.set(coordinateKey, candidate);
    }
  }
  return Object.freeze([...byCoordinate.values()].toSorted((left, right) => {
    const leftRank = left.key === "source" ? 0 : left.key === "target" ? 2 : 1;
    const rightRank = right.key === "source"
      ? 0
      : right.key === "target"
      ? 2
      : 1;
    return leftRank - rightRank || left.key.localeCompare(right.key);
  }));
}

function stringPullVisibilityPath(
  path: readonly OverviewThreadD3CablePoint[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): OverviewThreadD3CablePoint[] {
  if (path.length <= 2) return path.map(copyPoint);
  const result = [copyPoint(path[0]!)];
  let anchor = 0;
  while (anchor < path.length - 1) {
    let visible = anchor + 1;
    for (let candidate = path.length - 1; candidate > anchor; candidate--) {
      if (
        overviewThreadD3CableSegmentVisible(
          path[anchor]!,
          path[candidate]!,
          obstacles,
        )
      ) {
        visible = candidate;
        break;
      }
    }
    result.push(copyPoint(path[visible]!));
    anchor = visible;
  }
  return result;
}

function resampleGuide(
  guide: readonly OverviewThreadD3CablePoint[],
  requestedCount: number,
): readonly OverviewThreadD3CablePoint[] {
  const count = Math.max(
    Math.min(Math.trunc(requestedCount), MAX_PARTICLES),
    Math.min(guide.length, MAX_PARTICLES),
  );
  if (guide.length >= count) return Object.freeze(guide.map(copyPoint));

  const segmentLengths = guide.slice(1).map((point, index) =>
    distance(guide[index]!, point)
  );
  const extras = count - guide.length;
  const allocation = segmentLengths.map(() => 0);
  for (let extra = 0; extra < extras; extra++) {
    let selected = 0;
    let selectedSpacing = -Infinity;
    for (let index = 0; index < segmentLengths.length; index++) {
      const spacing = segmentLengths[index]! / (allocation[index]! + 1);
      if (
        spacing > selectedSpacing + COST_EPSILON ||
        Math.abs(spacing - selectedSpacing) <= COST_EPSILON && index < selected
      ) {
        selected = index;
        selectedSpacing = spacing;
      }
    }
    allocation[selected]! += 1;
  }
  const result: OverviewThreadD3CablePoint[] = [copyPoint(guide[0]!)];
  for (let index = 0; index < segmentLengths.length; index++) {
    const source = guide[index]!;
    const target = guide[index + 1]!;
    const divisor = allocation[index]! + 1;
    for (let step = 1; step <= divisor; step++) {
      const ratio = step / divisor;
      result.push({
        x: source.x + (target.x - source.x) * ratio,
        y: source.y + (target.y - source.y) * ratio,
      });
    }
  }
  return Object.freeze(result);
}

function relaxCableParticles(
  guide: readonly OverviewThreadD3CablePoint[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
  tickCount: number,
): OverviewThreadD3CablePoint[] {
  const particles: CableParticle[] = guide.map((point, ordinal) => ({
    x: point.x,
    y: point.y,
    vx: 0,
    vy: 0,
    fx: ordinal === 0 || ordinal === guide.length - 1 ? point.x : undefined,
    fy: ordinal === 0 || ordinal === guide.length - 1 ? point.y : undefined,
    guideX: point.x,
    guideY: point.y,
    ordinal,
  }));
  const targetSpacing = polylineLength(guide) /
    Math.max(1, particles.length - 1) * 0.84;
  const links: CableLink[] = particles.slice(1).map((_, index) => ({
    source: index,
    target: index + 1,
  }));
  const simulation = forceSimulation<CableParticle>(particles)
    .stop()
    .randomSource(seededRandom(0x51f15e))
    .alpha(1)
    .alphaMin(0.001)
    .alphaDecay(1 - Math.pow(0.001, 1 / tickCount))
    .velocityDecay(0.48)
    .force(
      "tension",
      forceLink<CableParticle, CableLink>(links)
        .id((particle) => particle.ordinal)
        .distance(targetSpacing)
        .strength(0.72),
    )
    .force("straighten", cableStraighteningForce())
    .force("guide", cableGuideForce())
    .force("hulls", cableRectangleRepulsionForce(obstacles));

  for (let tick = 0; tick < tickCount; tick++) {
    simulation.tick();
    hardProjectParticles(particles, obstacles);
    pinParticleEndpoints(particles, guide);
  }
  simulation.stop();
  const points = particles.map((particle) => ({
    x: particle.x,
    y: particle.y,
  }));
  points[0] = copyPoint(guide[0]!);
  points[points.length - 1] = copyPoint(guide.at(-1)!);
  return points;
}

function cableStraighteningForce(): Force<CableParticle, CableLink> {
  let particles: CableParticle[] = [];
  const force = ((alpha: number) => {
    const changes = particles.map(() => ({ x: 0, y: 0 }));
    for (let index = 1; index < particles.length - 1; index++) {
      const previous = particles[index - 1]!;
      const particle = particles[index]!;
      const next = particles[index + 1]!;
      changes[index] = {
        x: ((previous.x + next.x) / 2 - particle.x) * 0.31 * alpha,
        y: ((previous.y + next.y) / 2 - particle.y) * 0.31 * alpha,
      };
    }
    for (let index = 1; index < particles.length - 1; index++) {
      particles[index]!.vx += changes[index]!.x;
      particles[index]!.vy += changes[index]!.y;
    }
  }) as Force<CableParticle, CableLink>;
  force.initialize = (nextParticles) => {
    particles = nextParticles;
  };
  return force;
}

function cableGuideForce(): Force<CableParticle, CableLink> {
  let particles: CableParticle[] = [];
  const force = ((alpha: number) => {
    for (let index = 1; index < particles.length - 1; index++) {
      const particle = particles[index]!;
      particle.vx += (particle.guideX - particle.x) * 0.035 * alpha;
      particle.vy += (particle.guideY - particle.y) * 0.035 * alpha;
    }
  }) as Force<CableParticle, CableLink>;
  force.initialize = (nextParticles) => {
    particles = nextParticles;
  };
  return force;
}

function cableRectangleRepulsionForce(
  obstacles: readonly OverviewThreadD3CableObstacle[],
): Force<CableParticle, CableLink> {
  let particles: CableParticle[] = [];
  const force = ((alpha: number) => {
    for (let index = 1; index < particles.length - 1; index++) {
      const particle = particles[index]!;
      for (const obstacle of obstacles) {
        const displacement = rectangleRepulsionVector(particle, obstacle);
        if (!displacement) continue;
        particle.vx += displacement.x * 0.48 * alpha;
        particle.vy += displacement.y * 0.48 * alpha;
      }
    }
  }) as Force<CableParticle, CableLink>;
  force.initialize = (nextParticles) => {
    particles = nextParticles;
  };
  return force;
}

function rectangleRepulsionVector(
  particle: CableParticle,
  obstacle: OverviewThreadD3CableObstacle,
): OverviewThreadD3CablePoint | undefined {
  const nearestX = clamp(particle.x, obstacle.minimumX, obstacle.maximumX);
  const nearestY = clamp(particle.y, obstacle.minimumY, obstacle.maximumY);
  let deltaX = particle.x - nearestX;
  let deltaY = particle.y - nearestY;
  let separation = Math.hypot(deltaX, deltaY);
  if (separation > REPULSION_REACH) return undefined;
  if (separation <= VISIBILITY_EPSILON) {
    const projected = projectFromRectangleByGuide(particle, obstacle);
    deltaX = projected.x - particle.x;
    deltaY = projected.y - particle.y;
    separation = Math.max(VISIBILITY_EPSILON, Math.hypot(deltaX, deltaY));
  }
  const magnitude =
    Math.pow((REPULSION_REACH - separation) / REPULSION_REACH, 2) *
    5.5;
  return {
    x: deltaX / separation * magnitude,
    y: deltaY / separation * magnitude,
  };
}

function hardProjectParticles(
  particles: readonly CableParticle[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): void {
  for (let index = 1; index < particles.length - 1; index++) {
    const particle = particles[index]!;
    for (const obstacle of obstacles) {
      if (!pointInsideClosedRectangle(particle, obstacle)) continue;
      const projected = projectFromRectangleByGuide(particle, obstacle);
      particle.x = projected.x;
      particle.y = projected.y;
      particle.vx *= 0.2;
      particle.vy *= 0.2;
    }
  }
}

function projectFromRectangleByGuide(
  particle: CableParticle,
  obstacle: OverviewThreadD3CableObstacle,
): OverviewThreadD3CablePoint {
  const candidates = [
    {
      x: obstacle.minimumX - HARD_PROJECTION_CLEARANCE,
      y: clamp(particle.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: obstacle.maximumX + HARD_PROJECTION_CLEARANCE,
      y: clamp(particle.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: clamp(particle.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.minimumY - HARD_PROJECTION_CLEARANCE,
    },
    {
      x: clamp(particle.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.maximumY + HARD_PROJECTION_CLEARANCE,
    },
  ];
  return candidates.toSorted((left, right) =>
    squaredDistance(left, {
        x: particle.guideX,
        y: particle.guideY,
      }) - squaredDistance(right, {
        x: particle.guideX,
        y: particle.guideY,
      }) || left.x - right.x || left.y - right.y
  )[0]!;
}

function pinParticleEndpoints(
  particles: readonly CableParticle[],
  guide: readonly OverviewThreadD3CablePoint[],
): void {
  const first = particles[0]!;
  const last = particles.at(-1)!;
  first.x = guide[0]!.x;
  first.y = guide[0]!.y;
  first.vx = 0;
  first.vy = 0;
  last.x = guide.at(-1)!.x;
  last.y = guide.at(-1)!.y;
  last.vx = 0;
  last.vy = 0;
}

function boundedSafeGuide(
  guide: readonly OverviewThreadD3CablePoint[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
  maximumPoints: number,
): readonly OverviewThreadD3CablePoint[] {
  const result = guide.map(copyPoint);
  while (result.length > maximumPoints) {
    let removable = -1;
    let cost = Infinity;
    for (let index = 1; index < result.length - 1; index++) {
      if (
        !overviewThreadD3CableSegmentVisible(
          result[index - 1]!,
          result[index + 1]!,
          obstacles,
        )
      ) continue;
      const extra = distance(result[index - 1]!, result[index + 1]!) -
        distance(result[index - 1]!, result[index]!) -
        distance(result[index]!, result[index + 1]!);
      if (extra < cost) {
        cost = extra;
        removable = index;
      }
    }
    if (removable < 0) break;
    result.splice(removable, 1);
  }
  return Object.freeze(result);
}

/** Rebuilds the same centripetal Catmull-Rom geometry for animated points. */
export function overviewThreadD3CableCatmullRomPath(
  points: readonly OverviewThreadD3CablePoint[],
): string {
  const d = cableCatmullRomLine(points);
  if (!d) throw new Error("D3 could not render the cable field path");
  return d;
}

function segmentIntersectsClosedRectangle(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): boolean {
  let minimumT = 0;
  let maximumT = 1;
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const axes: readonly [number, number, number, number][] = [
    [source.x, deltaX, obstacle.minimumX, obstacle.maximumX],
    [source.y, deltaY, obstacle.minimumY, obstacle.maximumY],
  ];
  for (const [origin, delta, minimum, maximum] of axes) {
    if (Math.abs(delta) <= VISIBILITY_EPSILON) {
      if (
        origin < minimum - VISIBILITY_EPSILON ||
        origin > maximum + VISIBILITY_EPSILON
      ) {
        return false;
      }
      continue;
    }
    let entry = (minimum - origin) / delta;
    let exit = (maximum - origin) / delta;
    if (entry > exit) [entry, exit] = [exit, entry];
    minimumT = Math.max(minimumT, entry);
    maximumT = Math.min(maximumT, exit);
    if (minimumT > maximumT + VISIBILITY_EPSILON) return false;
  }
  return maximumT >= -VISIBILITY_EPSILON && minimumT <= 1 + VISIBILITY_EPSILON;
}

function pointInsideClosedRectangle(
  point: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): boolean {
  return point.x >= obstacle.minimumX - VISIBILITY_EPSILON &&
    point.x <= obstacle.maximumX + VISIBILITY_EPSILON &&
    point.y >= obstacle.minimumY - VISIBILITY_EPSILON &&
    point.y <= obstacle.maximumY + VISIBILITY_EPSILON;
}

function parseSvgPath(d: string): readonly SvgSegment[] {
  const tokens = d.match(
    /[MLC]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi,
  );
  if (!tokens || tokens.length < 3) return [];
  let index = 0;
  let current: OverviewThreadD3CablePoint | undefined;
  const segments: SvgSegment[] = [];
  while (index < tokens.length) {
    const command = tokens[index++]!.toUpperCase();
    if (command === "M") {
      current = readSvgPoint(tokens, index);
      index += 2;
      continue;
    }
    if (!current) throw new Error("SVG path segment precedes its move command");
    if (command === "L") {
      const target = readSvgPoint(tokens, index);
      index += 2;
      segments.push({ kind: "line", source: current, target });
      current = target;
      continue;
    }
    if (command === "C") {
      const control1 = readSvgPoint(tokens, index);
      const control2 = readSvgPoint(tokens, index + 2);
      const target = readSvgPoint(tokens, index + 4);
      index += 6;
      segments.push({
        kind: "cubic",
        source: current,
        control1,
        control2,
        target,
      });
      current = target;
      continue;
    }
    throw new Error(`Unsupported SVG cable command: ${command}`);
  }
  return segments;
}

function readSvgPoint(
  tokens: readonly string[],
  index: number,
): OverviewThreadD3CablePoint {
  const x = Number(tokens[index]);
  const y = Number(tokens[index + 1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error("Invalid SVG cable coordinate");
  }
  return { x, y };
}

function flattenCubic(
  source: OverviewThreadD3CablePoint,
  control1: OverviewThreadD3CablePoint,
  control2: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  tolerance: number,
  depth: number,
  output: OverviewThreadD3CablePoint[],
): void {
  if (
    depth >= 14 ||
    Math.max(
        pointLineDistance(control1, source, target),
        pointLineDistance(control2, source, target),
      ) <= tolerance
  ) {
    output.push(copyPoint(target));
    return;
  }
  const sourceControl = midpoint(source, control1);
  const controls = midpoint(control1, control2);
  const controlTarget = midpoint(control2, target);
  const leftControl = midpoint(sourceControl, controls);
  const rightControl = midpoint(controls, controlTarget);
  const split = midpoint(leftControl, rightControl);
  flattenCubic(
    source,
    sourceControl,
    leftControl,
    split,
    tolerance,
    depth + 1,
    output,
  );
  flattenCubic(
    split,
    rightControl,
    controlTarget,
    target,
    tolerance,
    depth + 1,
    output,
  );
}

function closestPolylineSide(
  points: readonly OverviewThreadD3CablePoint[],
  obstacle: OverviewThreadD3CableObstacle,
): "above" | "below" | "left" | "right" {
  const center = {
    x: (obstacle.minimumX + obstacle.maximumX) / 2,
    y: (obstacle.minimumY + obstacle.maximumY) / 2,
  };
  let closest = points[0]!;
  let closestDistance = Infinity;
  for (let index = 1; index < points.length; index++) {
    const candidate = closestPointOnSegment(
      center,
      points[index - 1]!,
      points[index]!,
    );
    const candidateDistance = squaredDistance(candidate, center);
    if (candidateDistance < closestDistance - COST_EPSILON) {
      closest = candidate;
      closestDistance = candidateDistance;
    }
  }
  const deltaX = closest.x - center.x;
  const deltaY = closest.y - center.y;
  const normalizedX = Math.abs(deltaX) /
    Math.max(1, (obstacle.maximumX - obstacle.minimumX) / 2);
  const normalizedY = Math.abs(deltaY) /
    Math.max(1, (obstacle.maximumY - obstacle.minimumY) / 2);
  if (normalizedY >= normalizedX) return deltaY <= 0 ? "above" : "below";
  return deltaX <= 0 ? "left" : "right";
}

function closestPointOnSegment(
  point: OverviewThreadD3CablePoint,
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const denominator = deltaX * deltaX + deltaY * deltaY;
  if (denominator <= VISIBILITY_EPSILON) return copyPoint(source);
  const ratio = clamp(
    ((point.x - source.x) * deltaX + (point.y - source.y) * deltaY) /
      denominator,
    0,
    1,
  );
  return { x: source.x + deltaX * ratio, y: source.y + deltaY * ratio };
}

function turnAngle(
  previous: OverviewThreadD3CablePoint,
  current: OverviewThreadD3CablePoint,
  next: OverviewThreadD3CablePoint,
): number {
  const incoming = normalizedVector(previous, current);
  const outgoing = normalizedVector(current, next);
  return Math.acos(clamp(
    incoming.x * outgoing.x + incoming.y * outgoing.y,
    -1,
    1,
  ));
}

function normalizedVector(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const length = Math.hypot(deltaX, deltaY);
  return length <= VISIBILITY_EPSILON
    ? { x: 0, y: 0 }
    : { x: deltaX / length, y: deltaY / length };
}

function polylineLength(points: readonly OverviewThreadD3CablePoint[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += distance(points[index - 1]!, points[index]!);
  }
  return length;
}

function distance(
  left: OverviewThreadD3CablePoint,
  right: OverviewThreadD3CablePoint,
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function squaredDistance(
  left: OverviewThreadD3CablePoint,
  right: OverviewThreadD3CablePoint,
): number {
  return (right.x - left.x) ** 2 + (right.y - left.y) ** 2;
}

function midpoint(
  left: OverviewThreadD3CablePoint,
  right: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function pointLineDistance(
  point: OverviewThreadD3CablePoint,
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
): number {
  return Math.sqrt(squaredDistance(
    point,
    closestPointOnSegment(point, source, target),
  ));
}

function candidateBetter(
  cost: number,
  lexicalPath: string,
  previous: SearchBest,
): boolean {
  return cost < previous.cost - COST_EPSILON ||
    Math.abs(cost - previous.cost) <= COST_EPSILON &&
      lexicalPath.localeCompare(previous.lexicalPath) < 0;
}

function searchEntryWorse(entry: SearchEntry, known: SearchBest): boolean {
  return entry.cost > known.cost + COST_EPSILON ||
    Math.abs(entry.cost - known.cost) <= COST_EPSILON &&
      entry.lexicalPath.localeCompare(known.lexicalPath) > 0;
}

function searchStateKey(previous: number | undefined, current: number): string {
  return `${previous ?? "start"}>${current}`;
}

class SearchHeap {
  readonly #entries: SearchEntry[] = [];

  get size(): number {
    return this.#entries.length;
  }

  push(entry: SearchEntry): void {
    this.#entries.push(entry);
    let index = this.#entries.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareSearchEntry(this.#entries[parent]!, entry) <= 0) break;
      this.#entries[index] = this.#entries[parent]!;
      index = parent;
    }
    this.#entries[index] = entry;
  }

  pop(): SearchEntry | undefined {
    const first = this.#entries[0];
    const last = this.#entries.pop();
    if (!first || !last || this.#entries.length === 0) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.#entries.length) break;
      let child = left;
      if (
        right < this.#entries.length &&
        compareSearchEntry(this.#entries[right]!, this.#entries[left]!) < 0
      ) child = right;
      if (compareSearchEntry(this.#entries[child]!, last) >= 0) break;
      this.#entries[index] = this.#entries[child]!;
      index = child;
    }
    this.#entries[index] = last;
    return first;
  }
}

function compareSearchEntry(left: SearchEntry, right: SearchEntry): number {
  return left.priority - right.priority || left.cost - right.cost ||
    left.lexicalPath.localeCompare(right.lexicalPath);
}

function canonicalCoordinate(value: number): string {
  return value.toFixed(7);
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return Number.isFinite(value) && value! > 0 ? value! : fallback;
}

function integerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const candidate = Number.isFinite(value) ? Math.trunc(value!) : fallback;
  return Math.max(minimum, Math.min(maximum, candidate));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1664525, state) + 1013904223 >>> 0;
    return state / 0x1_0000_0000;
  };
}
