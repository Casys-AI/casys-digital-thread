// @deno-types="npm:@types/d3-force@^3.0.10"
import {
  type Force,
  forceLink,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  buildOverviewThreadD3CableFieldRoute,
  overviewThreadD3CableCatmullRomPath,
  type OverviewThreadD3CableObstacle,
  type OverviewThreadD3CablePoint,
  overviewThreadD3CableSvgPathClear,
  sampleOverviewThreadD3CableSvgPath,
} from "./overview-thread-d3-cable-field.ts";

const PARTICLES_PER_ROUTE = 8;
const DEFAULT_TICKS = 44;
const MAX_TICKS = 180;
const EPSILON = 1e-7;
const LINK_STRENGTH = 0.38;
const LAPLACIAN_STRENGTH = 0.28;
const SHAPE_MEMORY_STRENGTH = 0.34;
const BUNDLE_STRENGTH = 0.12;
const BUNDLE_CAPTURE_DISTANCE = 72;
const PORT_STRENGTH = 0.54;
const OBSTACLE_REACH = 18;
const OBSTACLE_GAP = 0.6;

/** One exact recorded edge. No pair/hull aggregation happens in this input. */
export interface OverviewThreadD3JointCorridorTrajectoryInput {
  readonly key: string;
  /** Caller-owned compatibility partition; proximity never invents it. */
  readonly bundleKey: string;
  readonly sourceAnchor: OverviewThreadD3CablePoint;
  /** Direction from source anchor towards target. */
  readonly sourceTangent: OverviewThreadD3CablePoint;
  readonly targetAnchor: OverviewThreadD3CablePoint;
  /** Direction arriving into target anchor. */
  readonly targetTangent: OverviewThreadD3CablePoint;
  readonly weight?: number;
  /** Owning endpoint hulls this exact edge may leave/enter. */
  readonly excludedObstacleKeys?: readonly string[];
}

export interface OverviewThreadD3JointCorridorInput {
  readonly trajectories:
    readonly OverviewThreadD3JointCorridorTrajectoryInput[];
  /** Immutable, already-inflated hulls. */
  readonly obstacles?: readonly OverviewThreadD3CableObstacle[];
  /** Fixed manual D3 ticks; no simulation timer is started. */
  readonly ticks?: number;
}

export interface OverviewThreadD3JointCorridorRoute {
  readonly key: string;
  readonly bundleKey: string;
  readonly points: readonly OverviewThreadD3CablePoint[];
  readonly d: string;
  readonly curve: "catmull-rom";
  readonly departureTangent: OverviewThreadD3CablePoint;
  readonly arrivalTangent: OverviewThreadD3CablePoint;
  readonly topologySignature: string;
}

export interface OverviewThreadD3JointCorridorResult {
  /** One route per exact input key, kept distinct even when visually bundled. */
  readonly routes: ReadonlyMap<string, OverviewThreadD3JointCorridorRoute>;
  readonly topologySignature: string;
}

interface NormalizedTrajectory {
  readonly key: string;
  readonly bundleKey: string;
  readonly source: OverviewThreadD3CablePoint;
  readonly sourceTangent: OverviewThreadD3CablePoint;
  readonly target: OverviewThreadD3CablePoint;
  readonly targetTangent: OverviewThreadD3CablePoint;
  readonly weight: number;
  readonly obstacles: readonly OverviewThreadD3CableObstacle[];
}

interface RouteParticle extends SimulationNodeDatum {
  readonly id: string;
  readonly routeKey: string;
  readonly step: number;
  readonly progress: number;
  readonly obstacleKeys: ReadonlySet<string>;
  readonly shapeX: number;
  readonly shapeY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fx?: number | null;
  fy?: number | null;
}

interface RouteLink extends SimulationLinkDatum<RouteParticle> {
  source: string | RouteParticle;
  target: string | RouteParticle;
  readonly distance: number;
  readonly strength: number;
}

interface RelaxedTrajectory {
  readonly input: NormalizedTrajectory;
  readonly initialTopology: string;
  /**
   * Obstacle-safe individual route produced before magnetic relaxation.
   * Bundling is optional physics; it must never erase a valid exact cable.
   */
  readonly baseline: {
    readonly points: readonly OverviewThreadD3CablePoint[];
    readonly d: string;
  };
  readonly particles: readonly RouteParticle[];
}

interface CubicSegment {
  readonly source: OverviewThreadD3CablePoint;
  readonly control1: OverviewThreadD3CablePoint;
  readonly control2: OverviewThreadD3CablePoint;
  readonly target: OverviewThreadD3CablePoint;
}

/**
 * Stage 1 independently routes every exact edge. Stage 2 relaxes all copied
 * particle chains in one deterministic D3 simulation. Compatible trajectories
 * converge progressively through their middle, but never share a fixed star
 * junction or lose their exact identity.
 */
export function buildOverviewThreadD3JointCorridor(
  input: OverviewThreadD3JointCorridorInput,
): OverviewThreadD3JointCorridorResult {
  const obstacles = normalizeObstacles(input.obstacles ?? []);
  const obstacleByKey = new Map(
    obstacles.map((obstacle) => [obstacle.key, obstacle]),
  );
  const trajectories = normalizeTrajectories(input.trajectories, obstacles);
  if (trajectories.length === 0) {
    throw new RangeError("Joint corridor needs at least one exact trajectory");
  }
  const ticks = integerInRange(
    input.ticks,
    defaultTickCount(trajectories.length),
    1,
    MAX_TICKS,
  );
  const particles: RouteParticle[] = [];
  const links: RouteLink[] = [];
  const relaxed: RelaxedTrajectory[] = [];
  // Same length as GROUP_HUB_MARGIN: a combed stub has to travel the hub
  // offset before it is allowed to bend toward the tray.
  const COMBED_STUB = 20;

  // Stage 1: every edge gets its own obstacle-safe guide before any bundling.
  for (const trajectory of trajectories) {
    const span = distance(trajectory.source, trajectory.target);
    const vertical = Math.abs(trajectory.source.y - trajectory.target.y) >=
      Math.abs(trajectory.source.x - trajectory.target.x);
    const guard = clamp(span * 0.12, 6, 20);
    const independent = buildOverviewThreadD3CableFieldRoute(
      trajectory.source,
      trajectory.target,
      trajectory.obstacles,
      {
        maxParticles: 12,
        tickCount: 8,
        cornerClearance: vertical && span < 160 ? 4 : undefined,
        sourceTangentTarget: addScaled(
          trajectory.source,
          trajectory.sourceTangent,
          guard,
        ),
        targetTangentSource: addScaled(
          trajectory.target,
          trajectory.targetTangent,
          -guard,
        ),
      },
    );
    const sampled = sampleOverviewThreadD3CableSvgPath(independent.d, 0.2);
    const routePoints = resamplePolyline(sampled, PARTICLES_PER_ROUTE);
    const shapeGuide = buildIndividualShapeGuide(
      trajectory,
      independent.topologySignature,
      routePoints,
    );
    const baselineD = catmullPathWithExactTangents(
      shapeGuide,
      trajectory.sourceTangent,
      trajectory.targetTangent,
    );
    if (
      !baselineD.includes("C") || /[LQAS]/.test(baselineD) ||
      !overviewThreadD3CableSvgPathClear(
        baselineD,
        trajectory.obstacles,
        0.16,
      )
    ) {
      throw new Error(
        `${trajectory.key} has no safe individual Catmull-Rom baseline`,
      );
    }
    const combStubs = span > 2 * COMBED_STUB + 8;
    const stubSource = addScaled(
      trajectory.source,
      trajectory.sourceTangent,
      COMBED_STUB,
    );
    const stubTarget = addScaled(
      trajectory.target,
      trajectory.targetTangent,
      -COMBED_STUB,
    );
    const lastStep = PARTICLES_PER_ROUTE - 1;
    const routeParticles = routePoints.map((point, step) => {
      const combStep = combStubs && (step === 1 || step === lastStep - 1);
      const placed = !combStep ? point : step === 1 ? stubSource : stubTarget;
      const fixed = step === 0 || step === lastStep || combStep;
      const node: RouteParticle = {
        id: `${encodeURIComponent(trajectory.key)}:${step}`,
        routeKey: trajectory.key,
        step,
        progress: step / (PARTICLES_PER_ROUTE - 1),
        obstacleKeys: new Set(
          trajectory.obstacles.map((obstacle) => obstacle.key),
        ),
        shapeX: shapeGuide[step]!.x,
        shapeY: shapeGuide[step]!.y,
        x: placed.x,
        y: placed.y,
        vx: 0,
        vy: 0,
        fx: fixed ? placed.x : undefined,
        fy: fixed ? placed.y : undefined,
      };
      particles.push(node);
      return node;
    });
    for (let step = 1; step < routeParticles.length; step++) {
      const source = routeParticles[step - 1]!;
      const target = routeParticles[step]!;
      links.push({
        source: source.id,
        target: target.id,
        distance: Math.max(2, distance(source, target)),
        strength: LINK_STRENGTH *
          clamp(Math.sqrt(trajectory.weight), 0.7, 1.8),
      });
    }
    relaxed.push({
      input: trajectory,
      initialTopology: independent.topologySignature,
      baseline: {
        points: Object.freeze(shapeGuide.map(copyPoint)),
        d: baselineD,
      },
      particles: routeParticles,
    });
  }

  const groups = compatibleGroups(relaxed);
  const simulation = forceSimulation<RouteParticle>(particles)
    .stop()
    .randomSource(seededRandom(0x65646765))
    .alpha(1)
    .alphaMin(0.001)
    .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
    .velocityDecay(0.54)
    .force(
      "tension",
      forceLink<RouteParticle, RouteLink>(links)
        .id((node) => node.id)
        .distance((link) => link.distance)
        .strength((link) => link.strength),
    )
    .force("laplacian", routeLaplacianForce(relaxed))
    .force("individual-shape", individualShapeMemoryForce(relaxed))
    .force("progressive-bundle", progressiveBundleForce(groups))
    .force("port-tangents", endpointTangentForce(relaxed))
    .force("hulls", obstacleForce(obstacleByKey));

  for (let tick = 0; tick < ticks; tick++) {
    simulation.tick();
    projectOutsideObstacles(particles, obstacleByKey);
    pinEndpoints(particles);
  }
  simulation.stop();

  const routes = new Map<string, OverviewThreadD3JointCorridorRoute>();
  for (const route of relaxed) {
    const relaxedPoints = Object.freeze(route.particles.map(copyPoint));
    const relaxedD = catmullPathWithExactTangents(
      relaxedPoints,
      route.input.sourceTangent,
      route.input.targetTangent,
    );
    if (!relaxedD.includes("C") || /[LQAS]/.test(relaxedD)) {
      throw new Error(
        `${route.input.key} did not produce cubic-only Catmull-Rom`,
      );
    }
    const bundled = overviewThreadD3CableSvgPathClear(
      relaxedD,
      route.input.obstacles,
      0.16,
    );
    const points = bundled ? relaxedPoints : route.baseline.points;
    const d = bundled ? relaxedD : route.baseline.d;
    routes.set(
      route.input.key,
      Object.freeze({
        key: route.input.key,
        bundleKey: route.input.bundleKey,
        points,
        d,
        curve: "catmull-rom" as const,
        departureTangent: copyPoint(route.input.sourceTangent),
        arrivalTangent: copyPoint(route.input.targetTangent),
        topologySignature: `${route.initialTopology}|joint-corridor:v2|bundle:${
          encodeURIComponent(route.input.bundleKey)
        }|particles:${PARTICLES_PER_ROUTE}|mode:${
          bundled ? "magnetic" : "individual"
        }`,
      }),
    );
  }
  return Object.freeze({
    routes,
    topologySignature: `joint-corridor/v2|routes:${
      trajectories.map((trajectory) => encodeURIComponent(trajectory.key)).join(
        ",",
      )
    }|bundles:${
      [...new Set(trajectories.map((trajectory) => trajectory.bundleKey))]
        .toSorted().map(encodeURIComponent).join(",")
    }`,
  });
}

function buildIndividualShapeGuide(
  trajectory: NormalizedTrajectory,
  topology: string,
  initial: readonly OverviewThreadD3CablePoint[],
): readonly OverviewThreadD3CablePoint[] {
  const span = distance(trajectory.source, trajectory.target);
  const chord = unitVector({
    x: trajectory.target.x - trajectory.source.x,
    y: trajectory.target.y - trajectory.source.y,
  }, `${trajectory.key} chord`);
  const maximumDeviation = Math.max(
    ...initial.map((point) =>
      pointToLineDistance(
        point,
        trajectory.source,
        chord,
      )
    ),
  );
  const quasiStraight = topology.includes("|direct|") &&
    maximumDeviation <= Math.max(1.5, span * 0.015);
  if (!quasiStraight) return initial.map(copyPoint);

  const normal = { x: -chord.y, y: chord.x };
  const vertical = Math.abs(chord.y) >= Math.abs(chord.x);
  const rightSign = normal.x > 0 ? 1 : normal.x < 0 ? -1 : 1;
  const amplitude = vertical ? clamp(span * 0.35, 16, 24) : 0;
  const preferredSign = vertical
    ? rightSign
    : stableStringHash(trajectory.key) % 2 === 0
    ? 1
    : -1;
  for (const sign of [preferredSign, -preferredSign]) {
    const candidate = initial.map((point, step) => {
      const progress = step / (initial.length - 1);
      const envelope = Math.pow(Math.sin(Math.PI * progress), 2);
      return {
        x: point.x + normal.x * amplitude * envelope * sign,
        y: point.y + normal.y * amplitude * envelope * sign,
      };
    });
    const d = catmullPathWithExactTangents(
      candidate,
      trajectory.sourceTangent,
      trajectory.targetTangent,
    );
    if (overviewThreadD3CableSvgPathClear(d, trajectory.obstacles, 0.16)) {
      return candidate;
    }
  }
  throw new Error(
    `${trajectory.key} has no safe deterministic individual arc`,
  );
}

function individualShapeMemoryForce(
  routes: readonly RelaxedTrajectory[],
): Force<RouteParticle, RouteLink> {
  const force = ((alpha: number) => {
    for (const route of routes) {
      for (let step = 1; step < route.particles.length - 1; step++) {
        const node = route.particles[step]!;
        const envelope = Math.pow(Math.sin(Math.PI * node.progress), 2);
        const strength = SHAPE_MEMORY_STRENGTH * envelope * alpha;
        node.vx += (node.shapeX - node.x) * strength;
        node.vy += (node.shapeY - node.y) * strength;
      }
    }
  }) as Force<RouteParticle, RouteLink>;
  force.initialize = () => {};
  return force;
}

function pointToLineDistance(
  point: OverviewThreadD3CablePoint,
  origin: OverviewThreadD3CablePoint,
  direction: OverviewThreadD3CablePoint,
): number {
  const delta = { x: point.x - origin.x, y: point.y - origin.y };
  return Math.abs(delta.x * direction.y - delta.y * direction.x);
}

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compatibleGroups(
  routes: readonly RelaxedTrajectory[],
): ReadonlyMap<string, readonly RelaxedTrajectory[]> {
  const groups = new Map<string, RelaxedTrajectory[]>();
  for (const route of routes) {
    // The caller authorizes semantic compatibility with bundleKey; the
    // independent obstacle topology prevents top/bottom homotopies merging.
    const key = `${route.input.bundleKey}\u0000${
      obstacleHomotopyClass(route.initialTopology)
    }`;
    const group = groups.get(key) ?? [];
    group.push(route);
    groups.set(key, group);
  }
  return new Map([...groups.entries()].map(([key, group]) => [
    key,
    // Rank 0 is the topmost source so pitch offsets follow the ladder.
    // A lexical key can belong to a geometrically higher hub and invert
    // the bundle even when identity mapping would not cross.
    group.toSorted((left, right) =>
      left.input.source.y - right.input.source.y ||
      left.input.source.x - right.input.source.x ||
      left.input.key.localeCompare(right.input.key)
    ),
  ]));
}

function obstacleHomotopyClass(topology: string): string {
  if (topology.endsWith("|direct")) return "direct";
  const sides = new Set(
    topology.slice(topology.indexOf("|") + 1).split(",").flatMap((token) => {
      const separator = token.lastIndexOf(":");
      const side = separator >= 0 ? token.slice(separator + 1) : "";
      return side === "top" || side === "bottom" ? [side] : [];
    }),
  );
  return sides.size === 0 ? "direct" : [...sides].toSorted().join("+");
}

function defaultTickCount(routeCount: number): number {
  if (routeCount <= 0) return DEFAULT_TICKS;
  return clamp(Math.round(96 / Math.sqrt(routeCount)), 12, DEFAULT_TICKS);
}

function routeLaplacianForce(
  routes: readonly RelaxedTrajectory[],
): Force<RouteParticle, RouteLink> {
  const force = ((alpha: number) => {
    for (const route of routes) {
      for (let step = 1; step < route.particles.length - 1; step++) {
        const previous = route.particles[step - 1]!;
        const node = route.particles[step]!;
        const next = route.particles[step + 1]!;
        node.vx += ((previous.x + next.x) / 2 - node.x) *
          LAPLACIAN_STRENGTH * alpha;
        node.vy += ((previous.y + next.y) / 2 - node.y) *
          LAPLACIAN_STRENGTH * alpha;
      }
    }
  }) as Force<RouteParticle, RouteLink>;
  force.initialize = () => {};
  return force;
}

function progressiveBundleForce(
  groups: ReadonlyMap<string, readonly RelaxedTrajectory[]>,
): Force<RouteParticle, RouteLink> {
  const INTER_CABLE_GAP = 3;
  const force = ((alpha: number) => {
    for (const routes of groups.values()) {
      if (routes.length < 2) continue;
      const meanDirection = weightedMeanDirection(routes);
      const normal = { x: -meanDirection.y, y: meanDirection.x };
      // Must stay aligned with segmentWidth("bundle-trunk") in
      // overview-thread-d3-flow-layout.ts; pitch is a rendered gap, not
      // a topological merge.
      const widths = routes.map((route) =>
        0.95 + Math.min(
          2.5,
          Math.log2(Math.max(0, route.input.weight) + 1) * 0.34,
        )
      );
      const totalWidth = widths.reduce((sum, width) => sum + width, 0);
      let cursor = -(totalWidth + INTER_CABLE_GAP * (routes.length - 1)) /
        2;
      const offsets = widths.map((width) => {
        const offset = cursor + width / 2;
        cursor += width + INTER_CABLE_GAP;
        return offset;
      });
      for (let step = 1; step < PARTICLES_PER_ROUTE - 1; step++) {
        const progress = step / (PARTICLES_PER_ROUTE - 1);
        const envelope = Math.pow(Math.sin(Math.PI * progress), 1.7);
        const totalWeight = routes.reduce(
          (sum, route) => sum + route.input.weight,
          0,
        );
        const centroid = routes.reduce(
          (point, route) => ({
            x: point.x +
              route.particles[step]!.x * route.input.weight / totalWeight,
            y: point.y +
              route.particles[step]!.y * route.input.weight / totalWeight,
          }),
          { x: 0, y: 0 },
        );
        for (const [rank, route] of routes.entries()) {
          const node = route.particles[step]!;
          const separation = offsets[rank]! * envelope;
          const target = {
            x: centroid.x + normal.x * separation,
            y: centroid.y + normal.y * separation,
          };
          const gap = Math.hypot(target.x - node.x, target.y - node.y);
          if (gap >= BUNDLE_CAPTURE_DISTANCE) continue;
          const magneticFalloff = Math.pow(
            1 - gap / BUNDLE_CAPTURE_DISTANCE,
            2,
          );
          const strength = BUNDLE_STRENGTH * envelope * magneticFalloff *
            alpha;
          node.vx += (target.x - node.x) * strength;
          node.vy += (target.y - node.y) * strength;
        }
      }
    }
  }) as Force<RouteParticle, RouteLink>;
  force.initialize = () => {};
  return force;
}

function endpointTangentForce(
  routes: readonly RelaxedTrajectory[],
): Force<RouteParticle, RouteLink> {
  const force = ((alpha: number) => {
    for (const route of routes) {
      pullGuard(
        route.particles[0]!,
        route.particles[1]!,
        route.input.sourceTangent,
        alpha,
      );
      pullGuard(
        route.particles.at(-1)!,
        route.particles.at(-2)!,
        {
          x: -route.input.targetTangent.x,
          y: -route.input.targetTangent.y,
        },
        alpha,
      );
    }
  }) as Force<RouteParticle, RouteLink>;
  force.initialize = () => {};
  return force;
}

function pullGuard(
  anchor: RouteParticle,
  guard: RouteParticle,
  tangent: OverviewThreadD3CablePoint,
  alpha: number,
): void {
  const length = Math.max(4, distance(anchor, guard));
  const target = addScaled(anchor, tangent, length);
  guard.vx += (target.x - guard.x) * PORT_STRENGTH * alpha;
  guard.vy += (target.y - guard.y) * PORT_STRENGTH * alpha;
}

function weightedMeanDirection(
  routes: readonly RelaxedTrajectory[],
): OverviewThreadD3CablePoint {
  const vector = routes.reduce(
    (sum, route) => ({
      x: sum.x +
        (route.input.target.x - route.input.source.x) * route.input.weight,
      y: sum.y +
        (route.input.target.y - route.input.source.y) * route.input.weight,
    }),
    { x: 0, y: 0 },
  );
  return unitVector(vector, "bundle mean direction");
}

function obstacleForce(
  obstacleByKey: ReadonlyMap<string, OverviewThreadD3CableObstacle>,
): Force<RouteParticle, RouteLink> {
  let nodes: readonly RouteParticle[] = [];
  const force = ((alpha: number) => {
    for (const node of nodes) {
      if (node.fx != null) continue;
      for (const key of node.obstacleKeys) {
        const obstacle = obstacleByKey.get(key);
        if (!obstacle) continue;
        const nearest = {
          x: clamp(node.x, obstacle.minimumX, obstacle.maximumX),
          y: clamp(node.y, obstacle.minimumY, obstacle.maximumY),
        };
        let dx = node.x - nearest.x;
        let dy = node.y - nearest.y;
        let gap = Math.hypot(dx, dy);
        if (gap >= OBSTACLE_REACH) continue;
        if (gap <= EPSILON) {
          const exit = nearestExit(node, obstacle);
          dx = exit.x - node.x;
          dy = exit.y - node.y;
          gap = Math.max(EPSILON, Math.hypot(dx, dy));
        }
        const magnitude = Math.pow(
          (OBSTACLE_REACH - gap) / OBSTACLE_REACH,
          2,
        ) * 5 * alpha;
        node.vx += dx / gap * magnitude;
        node.vy += dy / gap * magnitude;
      }
    }
  }) as Force<RouteParticle, RouteLink>;
  force.initialize = (nextNodes) => {
    nodes = nextNodes;
  };
  return force;
}

function projectOutsideObstacles(
  nodes: readonly RouteParticle[],
  obstacleByKey: ReadonlyMap<string, OverviewThreadD3CableObstacle>,
): void {
  for (const node of nodes) {
    if (node.fx != null) continue;
    for (const key of node.obstacleKeys) {
      const obstacle = obstacleByKey.get(key);
      if (!obstacle || !inside(node, obstacle)) continue;
      const exit = nearestExit(node, obstacle);
      node.x = exit.x;
      node.y = exit.y;
      node.vx *= 0.18;
      node.vy *= 0.18;
    }
  }
}

function nearestExit(
  point: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): OverviewThreadD3CablePoint {
  return [
    {
      x: obstacle.minimumX - OBSTACLE_GAP,
      y: clamp(point.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: obstacle.maximumX + OBSTACLE_GAP,
      y: clamp(point.y, obstacle.minimumY, obstacle.maximumY),
    },
    {
      x: clamp(point.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.minimumY - OBSTACLE_GAP,
    },
    {
      x: clamp(point.x, obstacle.minimumX, obstacle.maximumX),
      y: obstacle.maximumY + OBSTACLE_GAP,
    },
  ].toSorted((left, right) =>
    distance(left, point) - distance(right, point) ||
    left.x - right.x || left.y - right.y
  )[0]!;
}

function pinEndpoints(nodes: readonly RouteParticle[]): void {
  for (const node of nodes) {
    if (node.fx == null || node.fy == null) continue;
    node.x = node.fx;
    node.y = node.fy;
    node.vx = 0;
    node.vy = 0;
  }
}

function normalizeTrajectories(
  inputs: readonly OverviewThreadD3JointCorridorTrajectoryInput[],
  obstacles: readonly OverviewThreadD3CableObstacle[],
): NormalizedTrajectory[] {
  const seen = new Set<string>();
  return inputs.map((input) => {
    const key = input.key.trim();
    const bundleKey = input.bundleKey.trim();
    if (!key || seen.has(key) || !bundleKey) {
      throw new TypeError(
        `Trajectory key/bundleKey must be unique and non-empty: ${key}`,
      );
    }
    seen.add(key);
    const excluded = new Set(input.excludedObstacleKeys ?? []);
    return {
      key,
      bundleKey,
      source: finitePoint(input.sourceAnchor, `${key} sourceAnchor`),
      sourceTangent: unitVector(
        input.sourceTangent,
        `${key} sourceTangent`,
      ),
      target: finitePoint(input.targetAnchor, `${key} targetAnchor`),
      targetTangent: unitVector(
        input.targetTangent,
        `${key} targetTangent`,
      ),
      weight: Number.isFinite(input.weight) && input.weight! > 0
        ? input.weight!
        : 1,
      obstacles: obstacles.filter((obstacle) => !excluded.has(obstacle.key)),
    };
  }).toSorted((left, right) => left.key.localeCompare(right.key));
}

function normalizeObstacles(
  inputs: readonly OverviewThreadD3CableObstacle[],
): readonly OverviewThreadD3CableObstacle[] {
  const seen = new Set<string>();
  return Object.freeze(
    inputs.map((input) => {
      const key = input.key.trim();
      if (!key || seen.has(key)) {
        throw new TypeError(`Duplicate/empty obstacle key: ${key}`);
      }
      seen.add(key);
      if (
        ![
          input.minimumX,
          input.maximumX,
          input.minimumY,
          input.maximumY,
        ].every(Number.isFinite) || input.minimumX > input.maximumX ||
        input.minimumY > input.maximumY
      ) throw new RangeError(`Invalid obstacle bounds: ${key}`);
      return Object.freeze({ ...input, key });
    }).toSorted((left, right) => left.key.localeCompare(right.key)),
  );
}

function resamplePolyline(
  points: readonly OverviewThreadD3CablePoint[],
  count: number,
): OverviewThreadD3CablePoint[] {
  const cumulative = [0];
  for (let index = 1; index < points.length; index++) {
    cumulative.push(
      cumulative.at(-1)! + distance(points[index - 1]!, points[index]!),
    );
  }
  const total = cumulative.at(-1)!;
  if (points.length < 2 || total <= EPSILON) {
    throw new RangeError("Degenerate trajectory");
  }
  return Array.from({ length: count }, (_, ordinal) => {
    const offset = total * ordinal / (count - 1);
    let segment = 1;
    while (
      segment < cumulative.length - 1 && cumulative[segment]! < offset
    ) segment++;
    const startOffset = cumulative[segment - 1]!;
    const segmentLength = cumulative[segment]! - startOffset;
    const ratio = segmentLength <= EPSILON
      ? 0
      : (offset - startOffset) / segmentLength;
    const source = points[segment - 1]!;
    const target = points[segment]!;
    return {
      x: source.x + (target.x - source.x) * ratio,
      y: source.y + (target.y - source.y) * ratio,
    };
  });
}

function catmullPathWithExactTangents(
  points: readonly OverviewThreadD3CablePoint[],
  departure: OverviewThreadD3CablePoint,
  arrival: OverviewThreadD3CablePoint,
): string {
  const before = addScaled(
    points[0]!,
    departure,
    -Math.max(2, distance(points[0]!, points[1]!)),
  );
  const after = addScaled(
    points.at(-1)!,
    arrival,
    Math.max(2, distance(points.at(-2)!, points.at(-1)!)),
  );
  const cubics = parseCubics(
    overviewThreadD3CableCatmullRomPath([before, ...points, after]),
  );
  const visible = cubics.slice(1, -1);
  if (visible.length !== points.length - 1) {
    throw new Error("Unexpected Catmull topology");
  }
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
        ? addScaled(segment.source, departure, departureHandle)
        : segment.control1,
      control2: last
        ? addScaled(segment.target, arrival, -arrivalHandle)
        : segment.control2,
    };
  });
  return [
    `M${format(points[0]!.x)},${format(points[0]!.y)}`,
    ...exact.map(serialize),
  ].join("");
}

function parseCubics(d: string): CubicSegment[] {
  const tokens = d.match(/[A-Za-z]|[-+]?(?:\d*\.?\d+(?:[eE][-+]?\d+)?)/g) ?? [];
  const result: CubicSegment[] = [];
  let cursor: OverviewThreadD3CablePoint | undefined;
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++]!;
    if (command === "M") {
      cursor = { x: numeric(tokens[index++]!), y: numeric(tokens[index++]!) };
      continue;
    }
    if (command !== "C" || !cursor) {
      throw new Error(`Unexpected SVG command: ${command}`);
    }
    const segment = {
      source: cursor,
      control1: {
        x: numeric(tokens[index++]!),
        y: numeric(tokens[index++]!),
      },
      control2: {
        x: numeric(tokens[index++]!),
        y: numeric(tokens[index++]!),
      },
      target: {
        x: numeric(tokens[index++]!),
        y: numeric(tokens[index++]!),
      },
    };
    result.push(segment);
    cursor = segment.target;
  }
  return result;
}

function serialize(segment: CubicSegment): string {
  return `C${format(segment.control1.x)},${format(segment.control1.y)},${
    format(segment.control2.x)
  },${format(segment.control2.y)},${format(segment.target.x)},${
    format(segment.target.y)
  }`;
}

function inside(
  point: OverviewThreadD3CablePoint,
  obstacle: OverviewThreadD3CableObstacle,
): boolean {
  return point.x >= obstacle.minimumX && point.x <= obstacle.maximumX &&
    point.y >= obstacle.minimumY && point.y <= obstacle.maximumY;
}

function finitePoint(
  point: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must be finite`);
  }
  return Object.freeze(copyPoint(point));
}

function unitVector(
  point: OverviewThreadD3CablePoint,
  label: string,
): OverviewThreadD3CablePoint {
  const magnitude = Math.hypot(point.x, point.y);
  if (!Number.isFinite(magnitude) || magnitude <= EPSILON) {
    throw new RangeError(`${label} must be non-zero`);
  }
  return Object.freeze({ x: point.x / magnitude, y: point.y / magnitude });
}

function addScaled(
  point: OverviewThreadD3CablePoint,
  vector: OverviewThreadD3CablePoint,
  scale: number,
): OverviewThreadD3CablePoint {
  return { x: point.x + vector.x * scale, y: point.y + vector.y * scale };
}

function copyPoint(
  point: OverviewThreadD3CablePoint,
): OverviewThreadD3CablePoint {
  return Object.freeze({ x: point.x, y: point.y });
}

function distance(
  left: OverviewThreadD3CablePoint,
  right: OverviewThreadD3CablePoint,
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function integerInRange(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return clamp(
    Number.isFinite(value) ? Math.floor(value!) : fallback,
    minimum,
    maximum,
  );
}

function numeric(token: string): number {
  const value = Number(token);
  if (!Number.isFinite(value)) throw new Error("Invalid SVG number");
  return value;
}

function format(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
