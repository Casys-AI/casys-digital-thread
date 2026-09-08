import { curveBumpX, line } from "d3-shape";
import { overviewThreadD3CableCatmullRomPath } from "../../overview-thread-d3-cable-field.ts";
import {
  type OverviewThreadD3FlowCurve,
  type OverviewThreadD3FlowPoint,
  overviewThreadD3FlowRoundedPath,
} from "../../overview-thread-d3-flow-layout.ts";
import { clampNumber, nonNegativeFinite } from "./geometry.ts";

// A strong critically damped response reads as a cable under tension: it
// follows quickly without the rubber-band overshoot of an underdamped spring.
const FLOW_MOTION_OMEGA = 40;
const FLOW_DRAG_MOTION_OMEGA = 54;
const FLOW_PRESENCE_MOTION_OMEGA = 34;
const FLOW_MOTION_MAX_DELTA_MS = 34;
const FLOW_MOTION_POSITION_EPSILON = 0.012;
const FLOW_MOTION_VELOCITY_EPSILON = 0.04;
const FLOW_MOTION_SCALAR_EPSILON = 0.001;

const flowMotionBumpLine = line<OverviewThreadD3FlowPoint>()
  .x((point) => point.x)
  .y((point) => point.y)
  .curve(curveBumpX);

export interface OverviewFlowMotionTarget {
  readonly key: string;
  readonly kind: string;
  readonly curve: OverviewThreadD3FlowCurve;
  readonly points: readonly OverviewThreadD3FlowPoint[];
  readonly topologySignature: string;
  readonly targetD: string;
  readonly width: number;
  readonly edgeKeys: readonly string[];
  readonly pathKeys: readonly string[];
  readonly pinEndpoints: boolean;
}

export interface OverviewFlowMotionPointSnapshot
  extends OverviewThreadD3FlowPoint {
  readonly vx: number;
  readonly vy: number;
}

export interface OverviewFlowMotionVisualSnapshot {
  readonly id: string;
  readonly key: string;
  readonly kind: string;
  readonly curve: OverviewThreadD3FlowCurve;
  readonly phase: "active" | "exiting";
  readonly points: readonly OverviewFlowMotionPointSnapshot[];
  readonly width: number;
  readonly widthVelocity: number;
  readonly presence: number;
  readonly presenceVelocity: number;
  readonly topologySignature: string;
  readonly targetD: string;
  readonly geometrySettled: boolean;
}

interface MutableOverviewFlowMotionPoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface MutableOverviewFlowMotionEntry {
  readonly id: string;
  readonly key: string;
  kind: string;
  curve: OverviewThreadD3FlowCurve;
  phase: "active" | "exiting";
  points: MutableOverviewFlowMotionPoint[];
  targetPoints: readonly OverviewThreadD3FlowPoint[];
  width: number;
  widthVelocity: number;
  targetWidth: number;
  presence: number;
  presenceVelocity: number;
  targetPresence: number;
  topologySignature: string;
  targetD: string;
  edgeKeys: readonly string[];
  pathKeys: readonly string[];
  pinEndpoints: boolean;
}

interface OverviewFlowMotionScalar {
  readonly value: number;
  readonly velocity: number;
}

/**
 * Exact critically damped spring step. Retargeting only changes `target`, so
 * the incoming velocity is preserved instead of restarting an ease at zero.
 */
export function advanceOverviewFlowMotionScalar(
  value: number,
  velocity: number,
  target: number,
  omega: number,
  deltaSeconds: number,
): OverviewFlowMotionScalar {
  if (
    !Number.isFinite(value) || !Number.isFinite(velocity) ||
    !Number.isFinite(target) || !Number.isFinite(omega) || omega <= 0 ||
    !Number.isFinite(deltaSeconds) || deltaSeconds <= 0
  ) {
    return { value, velocity };
  }
  const displacement = value - target;
  const coefficient = velocity + omega * displacement;
  const decay = Math.exp(-omega * deltaSeconds);
  return {
    value: target + (displacement + coefficient * deltaSeconds) * decay,
    velocity: (velocity - omega * coefficient * deltaSeconds) * decay,
  };
}

/**
 * Pure numeric motion state for one complete SVG cable scene. Rendering owns
 * one rAF and visits these entries; this class never reads or writes the DOM.
 */
export class OverviewFlowMotionScene {
  readonly #entries = new Map<string, MutableOverviewFlowMotionEntry>();
  readonly #activeIdByKey = new Map<string, string>();
  #generation = 0;
  #hasReconciled = false;

  reconcile(
    targets: readonly OverviewFlowMotionTarget[],
    reducedMotion: boolean,
  ): void {
    const targetByKey = new Map(targets.map((target) => [target.key, target]));

    for (const [key, id] of this.#activeIdByKey) {
      if (targetByKey.has(key)) continue;
      const entry = this.#entries.get(id);
      if (entry) markOverviewFlowMotionExit(entry);
      this.#activeIdByKey.delete(key);
    }

    const firstPopulation = !this.#hasReconciled;
    for (const target of targetByKey.values()) {
      let entry = this.#activeEntry(target.key);
      if (entry && !overviewFlowMotionCompatible(entry, target)) {
        markOverviewFlowMotionExit(entry);
        this.#activeIdByKey.delete(target.key);
        entry = undefined;
      }
      entry ??= this.#reviveEntry(target);
      if (!entry) {
        entry = this.#createEntry(target, firstPopulation || reducedMotion);
        this.#entries.set(entry.id, entry);
      }
      entry.phase = "active";
      entry.kind = target.kind;
      entry.curve = target.curve;
      entry.targetPoints = copyOverviewFlowPoints(target.points);
      entry.targetWidth = nonNegativeFinite(target.width);
      entry.targetPresence = 1;
      entry.topologySignature = target.topologySignature;
      entry.targetD = target.targetD;
      entry.edgeKeys = target.edgeKeys;
      entry.pathKeys = target.pathKeys;
      entry.pinEndpoints = target.pinEndpoints;
      this.#activeIdByKey.set(target.key, entry.id);
      pinOverviewFlowMotionEndpoints(entry);
      if (reducedMotion) snapOverviewFlowMotionEntry(entry);
    }
    this.#hasReconciled = true;

    if (reducedMotion) {
      for (const [id, entry] of this.#entries) {
        if (entry.phase === "exiting") this.#entries.delete(id);
      }
    }
  }

  advance(deltaMilliseconds: number): void {
    const deltaSeconds = Math.min(
      FLOW_MOTION_MAX_DELTA_MS,
      Math.max(0, Number.isFinite(deltaMilliseconds) ? deltaMilliseconds : 0),
    ) / 1_000;
    if (deltaSeconds <= 0) return;

    for (const [id, entry] of this.#entries) {
      const omega = entry.pinEndpoints
        ? FLOW_DRAG_MOTION_OMEGA
        : FLOW_MOTION_OMEGA;
      for (const [index, point] of entry.points.entries()) {
        const target = entry.targetPoints[index];
        if (!target) continue;
        if (
          entry.pinEndpoints &&
          (index === 0 || index === entry.points.length - 1)
        ) {
          point.x = target.x;
          point.y = target.y;
          point.vx = 0;
          point.vy = 0;
          continue;
        }
        const x = advanceOverviewFlowMotionMonotoneScalar(
          point.x,
          point.vx,
          target.x,
          omega,
          deltaSeconds,
        );
        const y = advanceOverviewFlowMotionMonotoneScalar(
          point.y,
          point.vy,
          target.y,
          omega,
          deltaSeconds,
        );
        point.x = x.value;
        point.vx = x.velocity;
        point.y = y.value;
        point.vy = y.velocity;
        settleOverviewFlowMotionPoint(point, target);
      }

      const width = advanceOverviewFlowMotionMonotoneScalar(
        entry.width,
        entry.widthVelocity,
        entry.targetWidth,
        FLOW_MOTION_OMEGA,
        deltaSeconds,
      );
      entry.width = Math.max(0, width.value);
      entry.widthVelocity = width.velocity;
      if (
        scalarMotionSettled(
          entry.width,
          entry.widthVelocity,
          entry.targetWidth,
        )
      ) {
        entry.width = entry.targetWidth;
        entry.widthVelocity = 0;
      }

      const presence = advanceOverviewFlowMotionMonotoneScalar(
        entry.presence,
        entry.presenceVelocity,
        entry.targetPresence,
        FLOW_PRESENCE_MOTION_OMEGA,
        deltaSeconds,
      );
      entry.presence = clampNumber(presence.value, 0, 1);
      entry.presenceVelocity = presence.velocity;
      if (entry.presence === 0 || entry.presence === 1) {
        entry.presenceVelocity = 0;
      }
      if (
        scalarMotionSettled(
          entry.presence,
          entry.presenceVelocity,
          entry.targetPresence,
        )
      ) {
        entry.presence = entry.targetPresence;
        entry.presenceVelocity = 0;
      }

      if (
        entry.phase === "exiting" && entry.presence === 0 &&
        entry.presenceVelocity === 0
      ) {
        this.#entries.delete(id);
      }
    }
  }

  needsAnimation(): boolean {
    for (const entry of this.#entries.values()) {
      if (!overviewFlowMotionEntrySettled(entry)) return true;
    }
    return false;
  }

  visit(
    visitor: (entry: Readonly<MutableOverviewFlowMotionEntry>) => void,
  ): void {
    for (const entry of this.#entries.values()) visitor(entry);
  }

  snapshot(): readonly OverviewFlowMotionVisualSnapshot[] {
    return [...this.#entries.values()].map((entry) => ({
      id: entry.id,
      key: entry.key,
      kind: entry.kind,
      curve: entry.curve,
      phase: entry.phase,
      points: entry.points.map((point) => ({ ...point })),
      width: entry.width,
      widthVelocity: entry.widthVelocity,
      presence: entry.presence,
      presenceVelocity: entry.presenceVelocity,
      topologySignature: entry.topologySignature,
      targetD: entry.targetD,
      geometrySettled: overviewFlowMotionGeometrySettled(entry),
    }));
  }

  #activeEntry(key: string): MutableOverviewFlowMotionEntry | undefined {
    const id = this.#activeIdByKey.get(key);
    return id ? this.#entries.get(id) : undefined;
  }

  #reviveEntry(
    target: OverviewFlowMotionTarget,
  ): MutableOverviewFlowMotionEntry | undefined {
    for (const entry of this.#entries.values()) {
      if (
        entry.phase === "exiting" && entry.key === target.key &&
        overviewFlowMotionCompatible(entry, target)
      ) {
        return entry;
      }
    }
    return undefined;
  }

  #createEntry(
    target: OverviewFlowMotionTarget,
    initiallyVisible: boolean,
  ): MutableOverviewFlowMotionEntry {
    const predecessor = this.#findPredecessor(target);
    const points = predecessor
      ? predecessor.points.map((point) => ({ ...point }))
      : mutableOverviewFlowPoints(target.points);
    return {
      id: `${target.key}@${++this.#generation}`,
      key: target.key,
      kind: target.kind,
      curve: target.curve,
      phase: "active",
      points,
      targetPoints: copyOverviewFlowPoints(target.points),
      width: predecessor?.width ?? nonNegativeFinite(target.width),
      widthVelocity: predecessor?.widthVelocity ?? 0,
      targetWidth: nonNegativeFinite(target.width),
      presence: initiallyVisible ? 1 : 0,
      presenceVelocity: 0,
      targetPresence: 1,
      topologySignature: target.topologySignature,
      targetD: target.targetD,
      edgeKeys: target.edgeKeys,
      pathKeys: target.pathKeys,
      pinEndpoints: target.pinEndpoints,
    };
  }

  #findPredecessor(
    target: OverviewFlowMotionTarget,
  ): MutableOverviewFlowMotionEntry | undefined {
    let result: MutableOverviewFlowMotionEntry | undefined;
    let resultScore = 0;
    for (const entry of this.#entries.values()) {
      if (!overviewFlowMotionCompatible(entry, target)) continue;
      const score = exactStringOverlap(entry.edgeKeys, target.edgeKeys) * 2 +
        exactStringOverlap(entry.pathKeys, target.pathKeys);
      if (score > resultScore) {
        result = entry;
        resultScore = score;
      }
    }
    return result;
  }
}

export function overviewFlowMotionPath(
  points: readonly OverviewThreadD3FlowPoint[],
  kind: string,
  curve: OverviewThreadD3FlowCurve = kind === "node-branch"
    ? "bump"
    : "rounded",
): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x} ${points[0]!.y}`;
  if (curve === "catmull-rom") {
    return overviewThreadD3CableCatmullRomPath(points);
  }
  const generated = curve === "bump" || kind === "node-branch"
    ? flowMotionBumpLine(points)
    : overviewThreadD3FlowRoundedPath(points, curve === "rack" ? 2 : undefined);
  return generated ?? "";
}

/**
 * Qualitative route shape used only to decide whether a numeric morph is
 * visually safe. Coordinates never enter the signature: moving an existing
 * detour keeps its velocity, while changing obstacle side/topology cross-fades
 * two valid paths instead of interpolating a shortcut through a hull.
 */
export function overviewFlowMotionTopologySignature(
  kind: string,
  points: readonly OverviewThreadD3FlowPoint[],
): string {
  const simplified = simplifyOverviewFlowTopologyPoints(points);
  const axes: string[] = [];
  const turns: string[] = [];
  for (let index = 1; index < simplified.length; index++) {
    const previous = simplified[index - 1]!;
    const current = simplified[index]!;
    axes.push(
      overviewFlowTopologyAxis(current.x - previous.x, current.y - previous.y),
    );
  }
  for (let index = 1; index + 1 < simplified.length; index++) {
    const first = simplified[index - 1]!;
    const middle = simplified[index]!;
    const last = simplified[index + 1]!;
    const firstX = middle.x - first.x;
    const firstY = middle.y - first.y;
    const secondX = last.x - middle.x;
    const secondY = last.y - middle.y;
    const magnitude = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
    const normalizedTurn = magnitude > 0
      ? (firstX * secondY - firstY * secondX) / magnitude
      : 0;
    turns.push(
      normalizedTurn > 0.08 ? "L" : normalizedTurn < -0.08 ? "R" : "S",
    );
  }
  return `${kind}|${simplified.length}|${axes.join("")}|${turns.join("")}`;
}

function markOverviewFlowMotionExit(
  entry: MutableOverviewFlowMotionEntry,
): void {
  entry.phase = "exiting";
  entry.targetPresence = 0;
  entry.pinEndpoints = false;
  entry.targetPoints = entry.points.map(({ x, y }) => ({ x, y }));
  entry.targetWidth = entry.width;
}

function advanceOverviewFlowMotionMonotoneScalar(
  value: number,
  velocity: number,
  target: number,
  omega: number,
  deltaSeconds: number,
): OverviewFlowMotionScalar {
  const advanced = advanceOverviewFlowMotionScalar(
    value,
    velocity,
    target,
    omega,
    deltaSeconds,
  );
  const minimum = Math.min(value, target);
  const maximum = Math.max(value, target);
  if (advanced.value >= minimum && advanced.value <= maximum) return advanced;
  return {
    value: clampNumber(advanced.value, minimum, maximum),
    velocity: 0,
  };
}

function snapOverviewFlowMotionEntry(
  entry: MutableOverviewFlowMotionEntry,
): void {
  entry.points = mutableOverviewFlowPoints(entry.targetPoints);
  entry.width = entry.targetWidth;
  entry.widthVelocity = 0;
  entry.presence = entry.targetPresence;
  entry.presenceVelocity = 0;
}

function pinOverviewFlowMotionEndpoints(
  entry: MutableOverviewFlowMotionEntry,
): void {
  if (!entry.pinEndpoints || entry.points.length === 0) return;
  const lastIndex = entry.points.length - 1;
  for (const index of new Set([0, lastIndex])) {
    const point = entry.points[index];
    const target = entry.targetPoints[index];
    if (!point || !target) continue;
    point.x = target.x;
    point.y = target.y;
    point.vx = 0;
    point.vy = 0;
  }
}

function settleOverviewFlowMotionPoint(
  point: MutableOverviewFlowMotionPoint,
  target: OverviewThreadD3FlowPoint,
): void {
  if (
    Math.abs(point.x - target.x) > FLOW_MOTION_POSITION_EPSILON ||
    Math.abs(point.y - target.y) > FLOW_MOTION_POSITION_EPSILON ||
    Math.abs(point.vx) > FLOW_MOTION_VELOCITY_EPSILON ||
    Math.abs(point.vy) > FLOW_MOTION_VELOCITY_EPSILON
  ) return;
  point.x = target.x;
  point.y = target.y;
  point.vx = 0;
  point.vy = 0;
}

function scalarMotionSettled(
  value: number,
  velocity: number,
  target: number,
): boolean {
  return Math.abs(value - target) <= FLOW_MOTION_SCALAR_EPSILON &&
    Math.abs(velocity) <= FLOW_MOTION_VELOCITY_EPSILON;
}

export function overviewFlowMotionGeometrySettled(
  entry: Readonly<MutableOverviewFlowMotionEntry>,
): boolean {
  if (entry.points.length !== entry.targetPoints.length) return false;
  return entry.points.every((point, index) => {
    const target = entry.targetPoints[index];
    return target !== undefined && point.x === target.x &&
      point.y === target.y &&
      point.vx === 0 && point.vy === 0;
  });
}

function overviewFlowMotionEntrySettled(
  entry: MutableOverviewFlowMotionEntry,
): boolean {
  return overviewFlowMotionGeometrySettled(entry) &&
    entry.width === entry.targetWidth && entry.widthVelocity === 0 &&
    entry.presence === entry.targetPresence && entry.presenceVelocity === 0;
}

function overviewFlowMotionCompatible(
  entry: MutableOverviewFlowMotionEntry,
  target: OverviewFlowMotionTarget,
): boolean {
  return entry.kind === target.kind &&
    entry.curve === target.curve &&
    entry.points.length === target.points.length &&
    entry.topologySignature === target.topologySignature;
}

function simplifyOverviewFlowTopologyPoints(
  points: readonly OverviewThreadD3FlowPoint[],
): readonly OverviewThreadD3FlowPoint[] {
  const simplified: OverviewThreadD3FlowPoint[] = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    if (previous && previous.x === point.x && previous.y === point.y) continue;
    simplified.push(point);
  }
  return simplified;
}

function overviewFlowTopologyAxis(deltaX: number, deltaY: number): string {
  const x = Math.abs(deltaX);
  const y = Math.abs(deltaY);
  if (x <= Number.EPSILON && y <= Number.EPSILON) return "Z";
  if (y <= x * 0.08) return "H";
  if (x <= y * 0.08) return "V";
  return "D";
}

function mutableOverviewFlowPoints(
  points: readonly OverviewThreadD3FlowPoint[],
): MutableOverviewFlowMotionPoint[] {
  return points.map(({ x, y }) => ({ x, y, vx: 0, vy: 0 }));
}

function copyOverviewFlowPoints(
  points: readonly OverviewThreadD3FlowPoint[],
): readonly OverviewThreadD3FlowPoint[] {
  return points.map(({ x, y }) => ({ x, y }));
}

function exactStringOverlap(
  left: readonly string[],
  right: readonly string[],
): number {
  if (left.length === 0 || right.length === 0) return 0;
  const rightSet = new Set(right);
  return left.reduce(
    (count, value) => count + (rightSet.has(value) ? 1 : 0),
    0,
  );
}
