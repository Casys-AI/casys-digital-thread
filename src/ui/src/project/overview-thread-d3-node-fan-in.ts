// @deno-types="npm:@types/d3-force@^3.0.10"
import {
  type Force,
  forceLink,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  overviewThreadD3CableCatmullRomPath,
  type OverviewThreadD3CableObstacle,
  type OverviewThreadD3CablePoint,
  overviewThreadD3CableSvgPathClear,
} from "./overview-thread-d3-cable-field.ts";

const PARTICLES_PER_LEAF = 6;
const DEFAULT_TICKS = 32;
const MIN_TICKS = 1;
const MAX_TICKS = 160;
const EPSILON = 1e-7;
const TENSION_STRENGTH = 0.24;
const LAPLACIAN_STRENGTH = 0.18;
const OBSTACLE_REACH = 16;
const OBSTACLE_PROJECTION_GAP = 0.5;

export interface OverviewThreadD3NodeFanInLeaf {
  readonly key: string;
  readonly anchor: OverviewThreadD3CablePoint;
  /** Direction vector pointing from the node towards the hull gate. */
  readonly anchorTangent: OverviewThreadD3CablePoint;
  readonly weight?: number;
}

export interface OverviewThreadD3NodeFanInInput {
  readonly junction: OverviewThreadD3CablePoint;
  /** Direction vector followed by the shared cable after `junction`. */
  readonly trunkTangent: OverviewThreadD3CablePoint;
  readonly leaves: readonly OverviewThreadD3NodeFanInLeaf[];
  /** Already-inflated foreign hulls. The owning hull is excluded by the caller. */
  readonly obstacles?: readonly OverviewThreadD3CableObstacle[];
  readonly ticks?: number;
}

export interface OverviewThreadD3NodeFanInRoute {
  readonly key: string;
  readonly points: readonly OverviewThreadD3CablePoint[];
  readonly d: string;
  readonly curve: "catmull-rom";
  readonly topologySignature: string;
  readonly departureTangent: OverviewThreadD3CablePoint;
  readonly arrivalTangent: OverviewThreadD3CablePoint;
}

/** Reverses one exact cubic without fitting a second curve. */
export function reverseOverviewThreadD3NodeFanInRoute(
  route: OverviewThreadD3NodeFanInRoute,
): OverviewThreadD3NodeFanInRoute {
  const cubics = parseCubicPath(route.d);
  if (cubics.length === 0) {
    throw new Error(`${route.key} has no Catmull-Rom cubic to reverse`);
  }
  const reversedCubics = cubics.toReversed().map((segment) => ({
    source: copyPoint(segment.target),
    control1: copyPoint(segment.control2),
    control2: copyPoint(segment.control1),
    target: copyPoint(segment.source),
  }));
  const first = reversedCubics[0]!.source;
  return Object.freeze({
    key: route.key,
    points: Object.freeze(route.points.toReversed().map(copyPoint)),
    d: [
      `M${formatNumber(first.x)},${formatNumber(first.y)}`,
      ...reversedCubics.map(serializeCubic),
    ].join(""),
    curve: "catmull-rom" as const,
    topologySignature: `${route.topologySignature}|direction:reverse`,
    departureTangent: Object.freeze({
      x: -route.arrivalTangent.x,
      y: -route.arrivalTangent.y,
    }),
    arrivalTangent: Object.freeze({
      x: -route.departureTangent.x,
      y: -route.departureTangent.y,
    }),
  });
}

interface NormalizedLeaf {
  readonly key: string;
  readonly anchor: OverviewThreadD3CablePoint;
  readonly tangent: OverviewThreadD3CablePoint;
  readonly weight: number;
  readonly transverse: number;
  transverseRank: number;
}

interface FanParticle extends SimulationNodeDatum {
  readonly id: string;
  readonly leafKey: string;
  readonly step: number;
  readonly progress: number;
  readonly guideX: number;
  readonly guideY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface FanLink extends SimulationLinkDatum<FanParticle> {
  source: string | FanParticle;
  target: string | FanParticle;
  readonly distance: number;
}

interface CubicSegment {
  readonly source: OverviewThreadD3CablePoint;
  readonly control1: OverviewThreadD3CablePoint;
  readonly control2: OverviewThreadD3CablePoint;
  readonly target: OverviewThreadD3CablePoint;
}

/**
 * Relaxes every visual node branch in one shared deterministic D3 simulation.
 * Caller nodes, hulls, endpoints and options are copied and never mutated.
 */
export function buildOverviewThreadD3NodeFanIn(
  input: OverviewThreadD3NodeFanInInput,
): ReadonlyMap<string, OverviewThreadD3NodeFanInRoute> {
  const junction = finitePoint(input.junction, "junction");
  const trunkTangent = unitVector(input.trunkTangent, "trunkTangent");
  const obstacles = normalizeObstacles(input.obstacles ?? []);
  const ticks = integerInRange(
    input.ticks,
    DEFAULT_TICKS,
    MIN_TICKS,
    MAX_TICKS,
  );
  const lexicalLeaves = normalizeLeaves(input.leaves, trunkTangent);
  if (lexicalLeaves.length === 0) {
    throw new RangeError("Node fan-in needs at least one leaf");
  }

  const physicalLeaves = lexicalLeaves.toSorted((left, right) =>
    left.transverse - right.transverse || left.key.localeCompare(right.key)
  );
  for (const [rank, leaf] of physicalLeaves.entries()) {
    leaf.transverseRank = rank;
  }
  const normal = { x: -trunkTangent.y, y: trunkTangent.x };
  assertDistinctAnchors(lexicalLeaves);

  const minimumSpan = Math.min(
    ...lexicalLeaves.map((leaf) => distance(leaf.anchor, junction)),
  );
  if (minimumSpan <= 8) {
    throw new RangeError(
      "Node fan-in leaves need at least 8 units before the gate",
    );
  }
  const sharedTailLength = clamp(minimumSpan * 0.09, 6, 14);
  const sharedTailStart = {
    x: junction.x - trunkTangent.x * sharedTailLength,
    y: junction.y - trunkTangent.y * sharedTailLength,
  };
  // A patch-panel comb has ordered teeth at the throat, not a single
  // shared pin that would collapse every strand into one wire.
  const ARRIVAL_PITCH = 1.2;
  const rankOffsets = new Map(
    physicalLeaves.map((leaf) => {
      const rawOffset = (leaf.transverseRank - (lexicalLeaves.length - 1) / 2) *
        ARRIVAL_PITCH;
      const clampedOffset = Math.max(
        -sharedTailLength * 0.8,
        Math.min(sharedTailLength * 0.8, rawOffset),
      );
      return [leaf.key, clampedOffset];
    }),
  );
  const particleRoutes = new Map<string, FanParticle[]>();
  const particles: FanParticle[] = [];
  const links: FanLink[] = [];

  for (const leaf of lexicalLeaves) {
    const offset = rankOffsets.get(leaf.key)!;
    const perLeafTailStart = {
      x: sharedTailStart.x + normal.x * offset,
      y: sharedTailStart.y + normal.y * offset,
    };
    const route = initialParticleRoute(
      leaf,
      junction,
      trunkTangent,
      perLeafTailStart,
    );
    particleRoutes.set(leaf.key, route);
    particles.push(...route);
    for (let step = 1; step < route.length; step++) {
      links.push({
        source: route[step - 1]!.id,
        target: route[step]!.id,
        distance: distance(route[step - 1]!, route[step]!),
      });
    }
  }

  const simulation = forceSimulation<FanParticle>(particles)
    .stop()
    .randomSource(seededRandom(0x6e6f6465))
    .alpha(1)
    .alphaMin(0.001)
    .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
    .velocityDecay(0.55)
    .force(
      "tension",
      forceLink<FanParticle, FanLink>(links)
        .id((particle) => particle.id)
        .distance((link) => link.distance)
        .strength(TENSION_STRENGTH),
    )
    .force("smooth", fanLaplacianForce(particleRoutes))
    .force(
      "capture",
      fanNormalCaptureForce(
        particleRoutes,
        lexicalLeaves,
        normal,
        junction,
      ),
    )
    .force("hulls", fanObstacleForce(obstacles));

  const baseSeparation = transverseSeparation(physicalLeaves);
  for (let tick = 0; tick < ticks; tick++) {
    simulation.tick();
    hardProjectFreeParticles(particles, obstacles);
    preserveTransverseOrder(
      physicalLeaves,
      particleRoutes,
      normal,
      baseSeparation,
    );
    pinConstrainedParticles(particleRoutes);
  }
  simulation.stop();

  const routes = new Map<string, OverviewThreadD3NodeFanInRoute>();
  for (const leaf of lexicalLeaves) {
    const routeParticles = particleRoutes.get(leaf.key)!;
    const points = Object.freeze(
      routeParticles.map((particle) => ({ x: particle.x, y: particle.y })),
    );
    assertRouteFinite(points, leaf.key);
    assertSamePoint(points[0]!, leaf.anchor, `${leaf.key} anchor`);
    assertSamePoint(points.at(-1)!, junction, `${leaf.key} junction`);
    const d = catmullPathWithExactEndpointTangents(
      points,
      leaf.tangent,
      trunkTangent,
    );
    if (!d.includes("C") || /[LQAS]/.test(d)) {
      throw new Error(`${leaf.key} did not produce a Catmull-Rom cubic route`);
    }
    if (!overviewThreadD3CableSvgPathClear(d, obstacles)) {
      throw new Error(`${leaf.key} has no safe Catmull-Rom fan-in route`);
    }
    const cubics = parseCubicPath(d);
    const departure = unitBetween(
      cubics[0]!.source,
      cubics[0]!.control1,
      `${leaf.key} departure`,
    );
    const arrival = unitBetween(
      cubics.at(-1)!.control2,
      cubics.at(-1)!.target,
      `${leaf.key} arrival`,
    );
    assertAligned(departure, leaf.tangent, `${leaf.key} departure tangent`);
    assertAligned(arrival, trunkTangent, `${leaf.key} arrival tangent`);
    routes.set(
      leaf.key,
      Object.freeze({
        key: leaf.key,
        points,
        d,
        curve: "catmull-rom" as const,
        topologySignature: `node-fan-in/v1|leaf:${
          encodeURIComponent(leaf.key)
        }|rank:${leaf.transverseRank}|count:${lexicalLeaves.length}|particles:${PARTICLES_PER_LEAF}|curve:catmull-rom`,
        departureTangent: departure,
        arrivalTangent: arrival,
      }),
    );
  }
  return routes;
}

function initialParticleRoute(
  leaf: NormalizedLeaf,
  junction: OverviewThreadD3CablePoint,
  trunkTangent: OverviewThreadD3CablePoint,
  sharedTailStart: OverviewThreadD3CablePoint,
): FanParticle[] {
  // Stub length is a field constant (the shared throat), so every port
  // shows the same slack before its first bend.
  const departureLength = clamp(
    distance(junction, sharedTailStart) * 0.6,
    4,
    10,
  );
  const departureGuard = {
    x: leaf.anchor.x + leaf.tangent.x * departureLength,
    y: leaf.anchor.y + leaf.tangent.y * departureLength,
  };
  const freeSpan = distance(departureGuard, sharedTailStart);
  const firstControl = {
    x: departureGuard.x + leaf.tangent.x * freeSpan * 0.34,
    y: departureGuard.y + leaf.tangent.y * freeSpan * 0.34,
  };
  const secondControl = {
    x: sharedTailStart.x - trunkTangent.x * freeSpan * 0.28,
    y: sharedTailStart.y - trunkTangent.y * freeSpan * 0.28,
  };
  const coordinates = [
    leaf.anchor,
    departureGuard,
    cubicPoint(
      departureGuard,
      firstControl,
      secondControl,
      sharedTailStart,
      0.38,
    ),
    cubicPoint(
      departureGuard,
      firstControl,
      secondControl,
      sharedTailStart,
      0.7,
    ),
    sharedTailStart,
    junction,
  ];
  return coordinates.map((point, step) => {
    const constrained = step <= 1 || step >= PARTICLES_PER_LEAF - 2;
    return {
      id: `${encodeURIComponent(leaf.key)}:${step}`,
      leafKey: leaf.key,
      step,
      progress: step / (PARTICLES_PER_LEAF - 1),
      guideX: point.x,
      guideY: point.y,
      x: point.x,
      y: point.y,
      vx: 0,
      vy: 0,
      fx: constrained ? point.x : undefined,
      fy: constrained ? point.y : undefined,
    };
  });
}

function fanLaplacianForce(
  routes: ReadonlyMap<string, readonly FanParticle[]>,
): Force<FanParticle, FanLink> {
  const force = ((alpha: number) => {
    for (const route of routes.values()) {
      for (let step = 2; step <= 3; step++) {
        const previous = route[step - 1]!;
        const particle = route[step]!;
        const next = route[step + 1]!;
        particle.vx += ((previous.x + next.x) / 2 - particle.x) *
          LAPLACIAN_STRENGTH * alpha;
        particle.vy += ((previous.y + next.y) / 2 - particle.y) *
          LAPLACIAN_STRENGTH * alpha;
      }
    }
  }) as Force<FanParticle, FanLink>;
  force.initialize = () => {};
  return force;
}

function fanNormalCaptureForce(
  routes: ReadonlyMap<string, readonly FanParticle[]>,
  leaves: readonly NormalizedLeaf[],
  normal: OverviewThreadD3CablePoint,
  junction: OverviewThreadD3CablePoint,
): Force<FanParticle, FanLink> {
  const totalWeight = leaves.reduce((sum, leaf) => sum + leaf.weight, 0);
  const meanAnchorNormal = leaves.reduce(
    (sum, leaf) => sum + dot(leaf.anchor, normal) * leaf.weight,
    0,
  ) / totalWeight;
  const junctionNormal = dot(junction, normal);
  const leafByKey = new Map(leaves.map((leaf) => [leaf.key, leaf]));
  const force = ((alpha: number) => {
    for (const [key, route] of routes) {
      const leaf = leafByKey.get(key)!;
      const anchorNormal = dot(leaf.anchor, normal);
      for (let step = 2; step <= 3; step++) {
        const particle = route[step]!;
        const progress = particle.progress;
        const individualGuide = lerp(anchorNormal, junctionNormal, progress);
        const sharedGuide = lerp(meanAnchorNormal, junctionNormal, progress);
        const capture = smoothstep(0.16, 0.92, progress);
        const desiredNormal = lerp(individualGuide, sharedGuide, capture);
        const currentNormal = dot(particle, normal);
        const strength = 0.05 + 0.35 * progress * progress;
        const change = (desiredNormal - currentNormal) * strength * alpha;
        particle.vx += normal.x * change;
        particle.vy += normal.y * change;
      }
    }
  }) as Force<FanParticle, FanLink>;
  force.initialize = () => {};
  return force;
}

function fanObstacleForce(
  obstacles: readonly OverviewThreadD3CableObstacle[],
): Force<FanParticle, FanLink> {
  let particles: readonly FanParticle[] = [];
  const force = ((alpha: number) => {
    for (const particle of particles) {
      if (particle.step < 2 || particle.step > 3) continue;
      for (const obstacle of obstacles) {
        const nearest = {
          x: clamp(particle.x, obstacle.minimumX, obstacle.maximumX),
          y: clamp(particle.y, obstacle.minimumY, obstacle.maximumY),
        };
        let deltaX = particle.x - nearest.x;
        let deltaY = particle.y - nearest.y;
        let separation = Math.hypot(deltaX, deltaY);
        if (separation >= OBSTACLE_REACH) continue;
        if (separation <= EPSILON) {
          const projected = nearestObstacleExit(particle, obstacle);
          deltaX = projected.x - particle.x;
          deltaY = projected.y - particle.y;
          separation = Math.max(EPSILON, Math.hypot(deltaX, deltaY));
        }
        const magnitude = Math.pow(
          (OBSTACLE_REACH - separation) / OBSTACLE_REACH,
          2,
        ) * 4.5 * alpha;
        particle.vx += deltaX / separation * magnitude;
        particle.vy += deltaY / separation * magnitude;
      }
    }
  }) as Force<FanParticle, FanLink>;
  force.initialize = (nextParticles) => {
    particles = nextParticles;
  };
  return force;
}

function preserveTransverseOrder(
  physicalLeaves: readonly NormalizedLeaf[],
  routes: ReadonlyMap<string, readonly FanParticle[]>,
  normal: OverviewThreadD3CablePoint,
  baseSeparation: number,
): void {
  for (let step = 2; step <= 3; step++) {
    const progress = step / (PARTICLES_PER_LEAF - 1);
    const separation = baseSeparation * Math.pow(1 - progress, 1.6);
    for (let pass = 0; pass < 3; pass++) {
      for (let rank = 1; rank < physicalLeaves.length; rank++) {
        const previous = routes.get(physicalLeaves[rank - 1]!.key)![step]!;
        const current = routes.get(physicalLeaves[rank]!.key)![step]!;
        const gap = dot(current, normal) - dot(previous, normal);
        if (gap >= separation) continue;
        const correction = (separation - gap) / 2;
        previous.x -= normal.x * correction;
        previous.y -= normal.y * correction;
        current.x += normal.x * correction;
        current.y += normal.y * correction;
        previous.vx -= normal.x * correction * 0.2;
        previous.vy -= normal.y * correction * 0.2;
        current.vx += normal.x * correction * 0.2;
        current.vy += normal.y * correction * 0.2;
      }
    }
  }
}

function pinConstrainedParticles(
  routes: ReadonlyMap<string, readonly FanParticle[]>,
): void {
  for (const route of routes.values()) {
    for (const step of [0, 1, 4, 5]) {
      const particle = route[step]!;
      particle.x = particle.fx!;
      particle.y = particle.fy!;
      particle.vx = 0;
      particle.vy = 0;
    }
  }
}

function hardProjectFreeParticles(
  particles: readonly FanParticle[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): void {
  for (const particle of particles) {
    if (particle.step < 2 || particle.step > 3) continue;
    for (const obstacle of obstacles) {
      if (!pointInsideClosedRectangle(particle, obstacle)) continue;
      const projected = nearestObstacleExit(particle, obstacle);
      particle.x = projected.x;
      particle.y = projected.y;
      particle.vx *= 0.2;
      particle.vy *= 0.2;
    }
  }
}

function nearestObstacleExit(
  point: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): OverviewThreadD3CablePoint {
  const candidates = [
    {
      x: obstacle.minimumX - OBSTACLE_PROJECTION_GAP,
      y: clamp(point.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: obstacle.maximumX + OBSTACLE_PROJECTION_GAP,
      y: clamp(point.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: clamp(point.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.minimumY - OBSTACLE_PROJECTION_GAP,
    },
    {
      x: clamp(point.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.maximumY + OBSTACLE_PROJECTION_GAP,
    },
  ];
  return candidates.toSorted((left, right) =>
    squaredDistance(left, point) - squaredDistance(right, point) ||
    left.x - right.x || left.y - right.y
  )[0]!;
}

function catmullPathWithExactEndpointTangents(
  points: readonly OverviewThreadD3CablePoint[],
  departureTangent: OverviewThreadD3CablePoint,
  arrivalTangent: OverviewThreadD3CablePoint,
): string {
  const departureLength = Math.max(2, distance(points[0]!, points[1]!));
  const arrivalLength = Math.max(2, distance(points.at(-2)!, points.at(-1)!));
  const augmented = [
    {
      x: points[0]!.x - departureTangent.x * departureLength,
      y: points[0]!.y - departureTangent.y * departureLength,
    },
    ...points,
    {
      x: points.at(-1)!.x + arrivalTangent.x * arrivalLength,
      y: points.at(-1)!.y + arrivalTangent.y * arrivalLength,
    },
  ];
  const fullPath = overviewThreadD3CableCatmullRomPath(augmented);
  const cubics = parseCubicPath(fullPath);
  if (cubics.length !== augmented.length - 1) {
    throw new Error("D3 Catmull-Rom emitted an unexpected command topology");
  }
  const visible = cubics.slice(1, -1);
  if (visible.length !== points.length - 1) {
    throw new Error("D3 Catmull-Rom endpoint trimming failed");
  }
  // Ghost points only produce the requested tangent when the last two
  // particles sit on the trunk. Combed teeth sit off-axis, so the last
  // cubic handle has to be rewritten the same way joint-corridor does.
  const exact = visible.map((segment, index) => {
    const first = index === 0;
    const last = index === visible.length - 1;
    const departureHandle = first
      ? Math.max(2, distance(segment.source, segment.control1))
      : 0;
    const arrivalHandle = last
      ? Math.max(2, distance(segment.control2, segment.target))
      : 0;
    return {
      ...segment,
      control1: first
        ? {
          x: segment.source.x + departureTangent.x * departureHandle,
          y: segment.source.y + departureTangent.y * departureHandle,
        }
        : segment.control1,
      control2: last
        ? {
          x: segment.target.x - arrivalTangent.x * arrivalHandle,
          y: segment.target.y - arrivalTangent.y * arrivalHandle,
        }
        : segment.control2,
    };
  });
  return [
    `M${formatNumber(points[0]!.x)},${formatNumber(points[0]!.y)}`,
    ...exact.map(serializeCubic),
  ].join("");
}

function serializeCubic(segment: CubicSegment): string {
  return `C${formatNumber(segment.control1.x)},${
    formatNumber(segment.control1.y)
  },${formatNumber(segment.control2.x)},${formatNumber(segment.control2.y)},${
    formatNumber(segment.target.x)
  },${formatNumber(segment.target.y)}`;
}

function parseCubicPath(d: string): CubicSegment[] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+(?:[eE][-+]?\d+)?)/g) ?? [];
  const result: CubicSegment[] = [];
  let cursor: OverviewThreadD3CablePoint | undefined;
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++]!;
    if (command === "M") {
      cursor = {
        x: numberToken(tokens, index++),
        y: numberToken(tokens, index++),
      };
      continue;
    }
    if (command !== "C" || !cursor) {
      throw new Error(
        `Node fan-in accepts Catmull-Rom cubic commands only: ${command}`,
      );
    }
    const segment: CubicSegment = {
      source: cursor,
      control1: {
        x: numberToken(tokens, index++),
        y: numberToken(tokens, index++),
      },
      control2: {
        x: numberToken(tokens, index++),
        y: numberToken(tokens, index++),
      },
      target: {
        x: numberToken(tokens, index++),
        y: numberToken(tokens, index++),
      },
    };
    cursor = segment.target;
    result.push(segment);
  }
  return result;
}

function normalizeLeaves(
  inputs: readonly OverviewThreadD3NodeFanInLeaf[],
  trunkTangent: OverviewThreadD3CablePoint,
): NormalizedLeaf[] {
  const seen = new Set<string>();
  const normal = { x: -trunkTangent.y, y: trunkTangent.x };
  return inputs.map((input) => {
    const key = input.key.trim();
    if (!key) throw new TypeError("Node fan-in leaf key must not be empty");
    if (seen.has(key)) {
      throw new TypeError(`Duplicate node fan-in leaf key: ${key}`);
    }
    seen.add(key);
    const anchor = finitePoint(input.anchor, `${key} anchor`);
    const tangent = unitVector(input.anchorTangent, `${key} anchorTangent`);
    const weight = Number.isFinite(input.weight) && input.weight! > 0
      ? input.weight!
      : 1;
    return {
      key,
      anchor,
      tangent,
      weight,
      transverse: dot(anchor, normal),
      transverseRank: 0,
    };
  }).toSorted((left, right) => left.key.localeCompare(right.key));
}

function normalizeObstacles(
  inputs: readonly OverviewThreadD3CableObstacle[],
): readonly OverviewThreadD3CableObstacle[] {
  return Object.freeze(
    inputs.map((input) => {
      const key = input.key.trim();
      const values = [
        input.minimumX,
        input.maximumX,
        input.minimumY,
        input.maximumY,
      ];
      if (!key || values.some((value) => !Number.isFinite(value))) {
        throw new TypeError(
          "Node fan-in obstacle must have a key and finite bounds",
        );
      }
      if (input.minimumX > input.maximumX || input.minimumY > input.maximumY) {
        throw new RangeError(`Node fan-in obstacle ${key} has inverted bounds`);
      }
      return Object.freeze({
        key,
        minimumX: input.minimumX,
        maximumX: input.maximumX,
        minimumY: input.minimumY,
        maximumY: input.maximumY,
      });
    }).toSorted((left, right) => left.key.localeCompare(right.key)),
  );
}

function assertDistinctAnchors(leaves: readonly NormalizedLeaf[]): void {
  for (let left = 0; left < leaves.length; left++) {
    for (let right = left + 1; right < leaves.length; right++) {
      if (distance(leaves[left]!.anchor, leaves[right]!.anchor) <= EPSILON) {
        throw new RangeError(
          `Node fan-in leaves ${leaves[left]!.key} and ${
            leaves[right]!.key
          } share one anchor`,
        );
      }
    }
  }
}

function transverseSeparation(leaves: readonly NormalizedLeaf[]): number {
  if (leaves.length < 2) return 0;
  let minimum = Infinity;
  for (let index = 1; index < leaves.length; index++) {
    const gap = leaves[index]!.transverse - leaves[index - 1]!.transverse;
    if (gap > EPSILON) minimum = Math.min(minimum, gap);
  }
  // Closely packed hull columns would otherwise yield a sub-pixel
  // mid-path pitch and read as one thick stroke.
  return Number.isFinite(minimum) ? clamp(minimum * 0.16, 1.5, 2.4) : 1.5;
}

function assertRouteFinite(
  points: readonly OverviewThreadD3CablePoint[],
  key: string,
): void {
  if (
    points.length !== PARTICLES_PER_LEAF ||
    points.some((point) =>
      !Number.isFinite(point.x) || !Number.isFinite(point.y)
    )
  ) throw new Error(`${key} produced an invalid node fan-in particle chain`);
}

function assertAligned(
  actual: OverviewThreadD3CablePoint,
  expected: OverviewThreadD3CablePoint,
  label: string,
): void {
  if (dot(actual, expected) < 0.999_999) {
    throw new Error(`${label} is not preserved by the Catmull-Rom curve`);
  }
}

function assertSamePoint(
  actual: OverviewThreadD3CablePoint,
  expected: OverviewThreadD3CablePoint,
  label: string,
): void {
  if (distance(actual, expected) > EPSILON) {
    throw new Error(`${label} moved during node fan-in relaxation`);
  }
}

function finitePoint(
  input: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  if (!Number.isFinite(input.x) || !Number.isFinite(input.y)) {
    throw new TypeError(`${label} must be finite`);
  }
  return Object.freeze({ x: input.x, y: input.y });
}

function unitVector(
  input: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  const length = Math.hypot(input.x, input.y);
  if (!Number.isFinite(length) || length <= EPSILON) {
    throw new TypeError(`${label} must be a non-zero finite vector`);
  }
  return Object.freeze({ x: input.x / length, y: input.y / length });
}

function unitBetween(
  source: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  return unitVector({ x: target.x - source.x, y: target.y - source.y }, label);
}

function cubicPoint(
  source: OverviewThreadD3CablePoint,
  control1: OverviewThreadD3CablePoint,
  control2: OverviewThreadD3CablePoint,
  target: OverviewThreadD3CablePoint,
  t: number,
): OverviewThreadD3CablePoint {
  const inverse = 1 - t;
  return {
    x: inverse ** 3 * source.x + 3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x + t ** 3 * target.x,
    y: inverse ** 3 * source.y + 3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y + t ** 3 * target.y,
  };
}

function pointInsideClosedRectangle(
  point: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): boolean {
  return point.x >= obstacle.minimumX && point.x <= obstacle.maximumX &&
    point.y >= obstacle.minimumY && point.y <= obstacle.maximumY;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = Math.imul(1_664_525, state) + 1_013_904_223 >>> 0;
    return state / 0x1_0000_0000;
  };
}

function integerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return Number.isFinite(value)
    ? clamp(Math.floor(value!), minimum, maximum)
    : fallback;
}

function numberToken(tokens: readonly string[], index: number): number {
  const value = Number(tokens[index]);
  if (!Number.isFinite(value)) throw new Error("Invalid D3 cubic path number");
  return value;
}

function formatNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  const ratio = clamp((value - minimum) / (maximum - minimum), 0, 1);
  return ratio * ratio * (3 - 2 * ratio);
}

function lerp(source: number, target: number, ratio: number): number {
  return source + (target - source) * ratio;
}

function dot(
  left: OverviewThreadD3CablePoint,
  right: OverviewThreadD3CablePoint,
): number {
  return left.x * right.x + left.y * right.y;
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

function copyPoint(
  point: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  return { x: point.x, y: point.y };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
