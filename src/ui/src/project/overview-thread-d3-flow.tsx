import type {
  CSSProperties,
  JSX,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { curveBumpX, line } from "d3-shape";
import type { EngineeringPhaseStatus } from "../../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../../domain/project/engineering-path-lane.ts";
import {
  overviewGroupCaption,
  type OverviewHeroNode,
} from "./overview-thread-hero-model.ts";
import { overviewThreadD3CableCatmullRomPath } from "./overview-thread-d3-cable-field.ts";
import type { OverviewThreadD3FlowHullView } from "./overview-thread-d3-flow-layout.ts";
import {
  type OverviewThreadD3FlowCurve,
  type OverviewThreadD3FlowGroupLayout,
  type OverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowNodeLayout,
  type OverviewThreadD3FlowPoint,
  overviewThreadD3FlowRoundedPath,
  type OverviewThreadD3FlowSegmentLayout,
} from "./overview-thread-d3-flow-layout.ts";
import {
  overviewThreadHullControlsVisible,
  overviewThreadHullLabel,
  overviewThreadHullLabelBudget,
  overviewThreadHullNameParts,
} from "./overview-thread-hull-model.ts";
import {
  overviewThreadGroupContextValue,
  overviewThreadNodeContextValue,
} from "./overview-thread-context-target.ts";
import { DropdownMenuContextTrigger } from "../ui/dropdown-menu.tsx";

export type OverviewThreadD3FlowMoveDirection =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

export interface OverviewThreadStageSummary {
  readonly lane: EngineeringPathLaneId;
  readonly label: string;
  readonly status: EngineeringPhaseStatus;
  readonly count: string;
}

export interface OverviewThreadD3FlowProps {
  readonly layout: OverviewThreadD3FlowLayout;
  readonly nodesByKey: ReadonlyMap<string, OverviewHeroNode>;
  readonly stages?: readonly OverviewThreadStageSummary[];
  readonly showLaneStrip?: boolean;
  readonly activeKey?: string;
  readonly selectedKey?: string;
  readonly focusedKey?: string;
  readonly onHover: (key: string | undefined) => void;
  readonly onFocus: (key: string) => void;
  readonly onToggle: (key: string) => void;
  readonly onMoveGroup?: (
    key: string,
    position: { readonly x: number; readonly y: number },
  ) => void;
  readonly onMoveNode?: (
    key: string,
    delta: { readonly x: number; readonly y: number },
  ) => void;
  /** Resize one hull. The matrix re-flows; no leaf is ever dropped. */
  readonly onResizeGroup?: (
    key: string,
    size: { readonly width: number; readonly height: number },
  ) => void;
  /** Fold or unfold one hull down to its band. */
  readonly onToggleGroupFold?: (key: string) => void;
  /** Choose how one hull presents its contents. */
  readonly onSetGroupView?: (
    key: string,
    view: OverviewThreadD3FlowHullView,
  ) => void;
  /** Cycle the hull's reading order. */
  readonly onCycleGroupSort?: (key: string) => void;
  /** Scroll a listed hull's window, in rows. */
  readonly onScrollGroup?: (key: string, rows: number) => void;
  readonly onMove: (
    key: string,
    direction: OverviewThreadD3FlowMoveDirection,
  ) => void;
  readonly refNode: (key: string, node: HTMLButtonElement | null) => void;
  /** Live board scale: hull controls retract when zoomed out. */
  readonly boardScale?: number;
}

interface OverviewFlowDragState {
  readonly kind: "group" | "node";
  readonly key: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originX: number;
  readonly originY: number;
  readonly minimumX: number;
  readonly minimumY: number;
  readonly maximumX: number;
  readonly maximumY: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  appliedX: number;
  appliedY: number;
  pendingX?: number;
  pendingY?: number;
  moved: boolean;
}

interface OverviewFlowResizeState {
  readonly key: string;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly originWidth: number;
  readonly originHeight: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

interface OverviewFlowDragTarget {
  readonly kind: OverviewFlowDragState["kind"];
  readonly key: string;
}

const FLOW_DRAG_THRESHOLD_PX = 4;
const FLOW_HULL_MINIMUM_WIDTH = 24;
/** Drawn hull bleeds this far past the layout box on every side. */
const FLOW_HULL_MARGIN = 7;
const FLOW_HULL_MINIMUM_HEIGHT = 28;
const FLOW_KEYBOARD_MOVE_STEP = 12;
const FLOW_PRACTICAL_WORLD_LIMIT = 10_000_000;
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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readPrefersReducedMotion);
  useEffect(() => {
    if (typeof globalThis.matchMedia !== "function") return;
    const query = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

function readPrefersReducedMotion(): boolean {
  return typeof globalThis.matchMedia === "function" &&
    globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
    : overviewThreadD3FlowRoundedPath(points);
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

function overviewFlowMotionGeometrySettled(
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

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Read-only, left-to-right projection. D3 owns the shared cable geometry and
 * the compact group matrices; the HTML node layer keeps tooltips and focus
 * targets legible when the SVG contracts to a narrow workbench.
 */
export function OverviewThreadD3Flow({
  layout,
  nodesByKey,
  stages = [],
  showLaneStrip = true,
  activeKey,
  selectedKey,
  focusedKey,
  onHover,
  onFocus,
  onToggle,
  onMoveGroup,
  onMoveNode,
  onResizeGroup,
  onToggleGroupFold,
  onSetGroupView,
  onCycleGroupSort,
  onScrollGroup,
  onMove,
  refNode,
  boardScale = 1,
}: OverviewThreadD3FlowProps): JSX.Element {
  const titleId = useId();
  const descriptionId = useId();
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<OverviewFlowDragState>();
  const resizeRef = useRef<OverviewFlowResizeState>();
  const dragFrameRef = useRef<number>();
  const suppressedClicksRef = useRef(new Set<string>());
  const [dragging, setDragging] = useState<OverviewFlowDragTarget>();
  const reducedMotion = usePrefersReducedMotion();
  const [viewBoxX, viewBoxY, viewBoxWidth, viewBoxHeight] = layout.viewBox;
  // Folder controls are noise at a distance: past this scale they retract and
  // the hull is read by its band alone.
  const controlsVisible = overviewThreadHullControlsVisible(boardScale);
  /** A band narrower than this has room for its name or its controls, not both. */
  const bandFitsControls = (width: number) => width >= 120;
  const relatedKeys = useMemo(
    () => flowRelatedNodeKeys(layout, activeKey),
    [activeKey, layout],
  );
  const laneColorById = useMemo(
    () => new Map(layout.lanes.map((lane) => [lane.lane, lane.color])),
    [layout.lanes],
  );
  const stageByLane = useMemo(
    () => new Map(stages.map((stage) => [stage.lane, stage])),
    [stages],
  );
  const activityStatuses = useMemo(
    () => overviewFlowActivityStatuses(nodesByKey),
    [nodesByKey],
  );
  const movingNodeKeys = useMemo(() => {
    if (!dragging) return new Set<string>();
    if (dragging.kind === "node") return new Set([dragging.key]);
    return new Set(
      layout.groups.find((group) => group.key === dragging.key)?.nodeKeys ?? [],
    );
  }, [dragging, layout.groups]);
  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== undefined) {
        globalThis.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);
  const commitPendingDrag = () => {
    dragFrameRef.current = undefined;
    const drag = dragRef.current;
    if (drag?.pendingX === undefined || drag.pendingY === undefined) return;
    const nextX = drag.pendingX;
    const nextY = drag.pendingY;
    drag.pendingX = undefined;
    drag.pendingY = undefined;
    if (drag.kind === "group") {
      onMoveGroup?.(drag.key, { x: nextX, y: nextY });
    } else {
      onMoveNode?.(drag.key, {
        x: nextX - drag.appliedX,
        y: nextY - drag.appliedY,
      });
    }
    drag.appliedX = nextX;
    drag.appliedY = nextY;
  };
  const beginResize = (
    key: string,
    event: ReactPointerEvent<Element>,
  ) => {
    if (event.button !== 0 || !event.isPrimary || !onResizeGroup) return;
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (!canvasBounds || canvasBounds.width <= 0) return;
    const group = layout.groups.find((candidate) => candidate.key === key);
    if (!group) return;
    event.stopPropagation();
    resizeRef.current = {
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originWidth: group.width,
      originHeight: group.height,
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveResize = (event: ReactPointerEvent<Element>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId || !onResizeGroup) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onResizeGroup(resize.key, {
      width: Math.max(
        FLOW_HULL_MINIMUM_WIDTH,
        resize.originWidth +
          (event.clientX - resize.startClientX) * viewBoxWidth /
            resize.canvasWidth,
      ),
      height: Math.max(
        FLOW_HULL_MINIMUM_HEIGHT,
        resize.originHeight +
          (event.clientY - resize.startClientY) * viewBoxHeight /
            resize.canvasHeight,
      ),
    });
  };

  const endResize = (event: ReactPointerEvent<Element>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    event.stopPropagation();
  };

  const beginDrag = (
    kind: OverviewFlowDragState["kind"],
    key: string,
    event: ReactPointerEvent<Element>,
  ) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (kind === "group" && !onMoveGroup) return;
    if (kind === "node" && !onMoveNode) return;
    const canvasBounds = canvasRef.current?.getBoundingClientRect();
    if (
      !canvasBounds || canvasBounds.width <= 0 || canvasBounds.height <= 0
    ) return;
    const group = layout.groups.find((candidate) =>
      kind === "group"
        ? candidate.key === key
        : candidate.nodeKeys.includes(key)
    );
    if (!group) return;
    const node = kind === "node"
      ? layout.nodes.find((candidate) => candidate.key === key)
      : undefined;
    let originX: number;
    let originY: number;
    let minimumX: number;
    let minimumY: number;
    let maximumX: number;
    let maximumY: number;
    if (kind === "group") {
      originX = group.x;
      originY = group.y;
      minimumX = -FLOW_PRACTICAL_WORLD_LIMIT;
      minimumY = -FLOW_PRACTICAL_WORLD_LIMIT;
      maximumX = FLOW_PRACTICAL_WORLD_LIMIT;
      maximumY = FLOW_PRACTICAL_WORLD_LIMIT;
    } else {
      if (!node) return;
      originX = node.x;
      originY = node.y;
      minimumX = group.x;
      minimumY = group.y;
      maximumX = group.x + group.width - node.width;
      maximumY = group.y + group.height - node.height;
    }
    event.stopPropagation();
    dragRef.current = {
      kind,
      key,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX,
      originY,
      minimumX,
      minimumY,
      maximumX,
      maximumY,
      canvasWidth: canvasBounds.width,
      canvasHeight: canvasBounds.height,
      appliedX: originX,
      appliedY: originY,
      moved: false,
    };
    setDragging({ kind, key });
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientDeltaX = event.clientX - drag.startClientX;
    const clientDeltaY = event.clientY - drag.startClientY;
    if (
      !drag.moved &&
      Math.hypot(clientDeltaX, clientDeltaY) < FLOW_DRAG_THRESHOLD_PX
    ) return;
    drag.moved = true;
    event.preventDefault();
    event.stopPropagation();
    const nextX = clampNumber(
      drag.originX + clientDeltaX * viewBoxWidth / drag.canvasWidth,
      drag.minimumX,
      drag.maximumX,
    );
    const nextY = clampNumber(
      drag.originY + clientDeltaY * viewBoxHeight / drag.canvasHeight,
      drag.minimumY,
      drag.maximumY,
    );
    if (
      nextX === (drag.pendingX ?? drag.appliedX) &&
      nextY === (drag.pendingY ?? drag.appliedY)
    ) return;
    drag.pendingX = nextX;
    drag.pendingY = nextY;
    if (dragFrameRef.current === undefined) {
      dragFrameRef.current = globalThis.requestAnimationFrame(
        commitPendingDrag,
      );
    }
  };
  const endDrag = (
    event: ReactPointerEvent<Element>,
    suppressClick = true,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (dragFrameRef.current !== undefined) {
      globalThis.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = undefined;
    }
    commitPendingDrag();
    if (suppressClick && drag.moved && drag.kind === "node") {
      suppressedClicksRef.current.add(drag.key);
      globalThis.setTimeout(() => {
        suppressedClicksRef.current.delete(drag.key);
      }, 0);
    }
    dragRef.current = undefined;
    setDragging(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const toggleUnlessDragged = (
    key: string,
    event: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    if (suppressedClicksRef.current.delete(key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onToggle(key);
  };

  return (
    <section
      className="overview-thread-flow"
      role="group"
      aria-labelledby={`${titleId} ${descriptionId}`}
      data-inspection={selectedKey ? "selected" : activeKey ? "hover" : "idle"}
      data-dragging={dragging ? "true" : "false"}
    >
      <h3 id={titleId} className="overview-thread-flow-sr-only">
        Project digital thread
      </h3>
      <p id={descriptionId} className="overview-thread-flow-sr-only">
        A left-to-right hierarchy from requirements to verdicts. Shared D3 cable
        segments merge related records and reroute while groups or records move.
        Group labels are drag handles and can be moved with the arrow keys.
        Records can be dragged within their group. Use the arrow keys on a
        record to navigate, then Enter or Space to inspect it.
      </p>

      <div
        className={showLaneStrip
          ? "overview-thread-flow-lane-strip"
          : "overview-thread-flow-sr-only"}
        role="list"
        aria-label="Engineering thread stages"
      >
        {layout.lanes.map((lane, index) => {
          const stage = stageByLane.get(lane.lane);
          return (
            <div
              key={lane.lane}
              role="listitem"
              className="overview-thread-flow-lane"
              data-lane={lane.lane}
              data-stage-status={stage?.status}
              style={{
                "--flow-x": flowXPercent(lane.x, layout.viewBox),
                "--flow-color": lane.color,
              } as CSSProperties}
            >
              <span
                className="overview-thread-flow-lane-index"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              {stage
                ? (
                  <span className="overview-thread-flow-lane-copy">
                    <span className="overview-thread-flow-stage-title">
                      {stage.label}
                    </span>
                    <span className="overview-thread-flow-lane-meta">
                      <span className="overview-thread-flow-lane-title">
                        {lane.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="overview-thread-flow-stage-count">
                        {stage.count}
                      </span>
                      <span
                        className="overview-thread-flow-stage-status"
                        data-status={stage.status}
                      >
                        <span
                          className="overview-thread-flow-status-dot"
                          aria-hidden="true"
                        />
                        <span className="overview-thread-flow-status-label">
                          {flowStatusCaption(stage.status)}
                        </span>
                      </span>
                    </span>
                  </span>
                )
                : (
                  <span className="overview-thread-flow-lane-title">
                    {lane.title}
                  </span>
                )}
            </div>
          );
        })}
      </div>

      <div
        ref={canvasRef}
        className="overview-thread-flow-canvas"
        style={{
          aspectRatio: `${viewBoxWidth} / ${viewBoxHeight}`,
        }}
      >
        {activityStatuses.length > 0 && (
          <div
            className="overview-thread-flow-activity-legend"
            role="list"
            aria-label="Project activity status"
          >
            {activityStatuses.map((status) => (
              <span key={status} role="listitem">
                <span
                  className="overview-thread-flow-activity-key"
                  data-status={status}
                  aria-hidden="true"
                />
                {flowStatusCaption(status)}
              </span>
            ))}
          </div>
        )}
        <svg
          viewBox={`${viewBoxX} ${viewBoxY} ${viewBoxWidth} ${viewBoxHeight}`}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          className="overview-thread-flow-svg"
          aria-hidden="true"
          focusable="false"
        >
          <g className="overview-thread-flow-guides">
            {layout.lanes.map((lane) => (
              <line
                key={lane.lane}
                x1={lane.x}
                x2={lane.x}
                y1={viewBoxY}
                y2={viewBoxY + viewBoxHeight}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
          <g className="overview-thread-flow-groups">
            {layout.groups.map((group) => (
              <DropdownMenuContextTrigger
                key={group.key}
                value={overviewThreadGroupContextValue(group.key)}
                asChild
              >
                <rect
                  x={group.x - FLOW_HULL_MARGIN}
                  y={group.y - FLOW_HULL_MARGIN}
                  width={group.width + FLOW_HULL_MARGIN * 2}
                  height={group.height + FLOW_HULL_MARGIN * 2}
                  rx="12"
                  data-lane={group.lane}
                  data-draggable={onMoveGroup ? "true" : "false"}
                  data-overview-context-target={overviewThreadGroupContextValue(
                    group.key,
                  )}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) =>
                    beginDrag("group", group.key, event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={(event) => endDrag(event, false)}
                  onLostPointerCapture={(event) => endDrag(event, false)}
                />
              </DropdownMenuContextTrigger>
            ))}
          </g>
          <FlowSegmentLayer
            layout={layout}
            activeKey={activeKey}
            movingNodeKeys={movingNodeKeys}
            dragging={Boolean(dragging)}
            reducedMotion={reducedMotion}
          />
        </svg>

        <div className="overview-thread-flow-group-labels">
          {layout.groups.map((group) => (
            <div
              key={group.key}
              className="overview-thread-flow-group-band"
              data-lane={group.lane}
              onWheel={onScrollGroup && group.view === "list" &&
                  !group.collapsed
                ? (event) => {
                  if (group.rowCount <= group.visibleRows * group.columns) {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  onScrollGroup(group.key, event.deltaY > 0 ? 1 : -1);
                }
                : undefined}
              data-collapsed={group.collapsed ? "true" : "false"}
              style={{
                "--flow-x": flowXPercent(
                  group.x + group.width / 2,
                  layout.viewBox,
                ),
                "--flow-y": flowYPercent(
                  group.y - FLOW_HULL_MARGIN +
                    (group.headerHeight + FLOW_HULL_MARGIN) / 2,
                  layout.viewBox,
                ),
                "--hull-width": flowWidthPercent(
                  group.width + FLOW_HULL_MARGIN * 2,
                  layout.viewBox,
                ),
                "--hull-header": flowHeightPercent(
                  group.headerHeight + FLOW_HULL_MARGIN,
                  layout.viewBox,
                ),
                "--flow-color": laneColorById.get(group.lane) ??
                  "currentColor",
              } as CSSProperties}
            >
              <DropdownMenuContextTrigger
                value={overviewThreadGroupContextValue(group.key)}
                asChild
              >
                <button
                  type="button"
                  className="overview-thread-flow-group-label"
                  data-lane={group.lane}
                  data-draggable={onMoveGroup ? "true" : "false"}
                  data-overview-context-target={overviewThreadGroupContextValue(
                    group.key,
                  )}
                  disabled={!onMoveGroup}
                  aria-label={`Move ${
                    flowGroupCaption(group)
                  } group. Drag, use the arrow keys, or open its context menu.`}
                  aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"
                  title={group.title ?? flowGroupCaption(group)}
                  onPointerDown={(event) =>
                    beginDrag("group", group.key, event)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={(event) => endDrag(event, false)}
                  onLostPointerCapture={(event) => endDrag(event, false)}
                  onKeyDown={(event) => {
                    if (!onMoveGroup || !isFlowMoveDirection(event.key)) return;
                    event.preventDefault();
                    const delta = flowKeyboardMoveDelta(event.key);
                    onMoveGroup(group.key, {
                      x: clampNumber(
                        group.x + delta.x,
                        -FLOW_PRACTICAL_WORLD_LIMIT,
                        FLOW_PRACTICAL_WORLD_LIMIT,
                      ),
                      y: clampNumber(
                        group.y + delta.y,
                        -FLOW_PRACTICAL_WORLD_LIMIT,
                        FLOW_PRACTICAL_WORLD_LIMIT,
                      ),
                    });
                  }}
                >
                  <span className="overview-thread-flow-group-name">
                    {overviewThreadHullLabel(
                      group.title ?? flowGroupCaption(group),
                      overviewThreadHullLabelBudget(group.width),
                    )}
                  </span>
                  {bandFitsControls(group.width) && (
                    <span
                      className="overview-thread-flow-group-scope"
                      aria-hidden="true"
                    >
                      {group.lane}
                    </span>
                  )}
                </button>
              </DropdownMenuContextTrigger>
              {controlsVisible && bandFitsControls(group.width) &&
                !group.collapsed && onSetGroupView && (
                <>
                  <button
                    type="button"
                    className="overview-thread-flow-group-control"
                    data-active={group.view === "list" ? "true" : "false"}
                    aria-pressed={group.view === "list"}
                    aria-label={`List ${flowGroupCaption(group)}`}
                    title="Liste — colonnes selon la largeur"
                    onClick={() => onSetGroupView(group.key, "list")}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    ≣
                  </button>
                  <button
                    type="button"
                    className="overview-thread-flow-group-control"
                    data-active={group.view === "matrix" ? "true" : "false"}
                    aria-pressed={group.view === "matrix"}
                    aria-label={`Compact ${flowGroupCaption(group)}`}
                    title="Matrice de points"
                    onClick={() => onSetGroupView(group.key, "matrix")}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    ⠿
                  </button>
                </>
              )}
              {controlsVisible && bandFitsControls(group.width) &&
                !group.collapsed && onCycleGroupSort && (
                <button
                  type="button"
                  className="overview-thread-flow-group-control"
                  aria-label={`Reading order of ${flowGroupCaption(group)}`}
                  title="Ordre de lecture — enregistré / récent / nom"
                  onClick={() => onCycleGroupSort(group.key)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  ↓t
                </button>
              )}
              {onToggleGroupFold && (controlsVisible || group.collapsed) && (
                <button
                  type="button"
                  className="overview-thread-flow-group-fold"
                  aria-label={`${group.collapsed ? "Unfold" : "Fold"} ${
                    flowGroupCaption(group)
                  } hull`}
                  aria-expanded={!group.collapsed}
                  title={group.collapsed ? "Déplier" : "Plier"}
                  onClick={() => onToggleGroupFold(group.key)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {group.collapsed ? "▸" : "▾"}
                </button>
              )}
            </div>
          ))}
          {layout.groups.filter((group) =>
            group.view === "list" && !group.collapsed
          )
            .map((group) => (
              <div
                key={`foot:${group.key}`}
                className="overview-thread-flow-group-foot"
                data-lane={group.lane}
                style={{
                  "--flow-x": flowXPercent(
                    group.x + group.width / 2,
                    layout.viewBox,
                  ),
                  "--flow-y": flowYPercent(
                    group.y + group.height - group.footerHeight / 2,
                    layout.viewBox,
                  ),
                  "--hull-width": flowWidthPercent(
                    group.width + FLOW_HULL_MARGIN * 2,
                    layout.viewBox,
                  ),
                  "--flow-color": laneColorById.get(group.lane) ??
                    "currentColor",
                } as CSSProperties}
              >
                {Math.min(group.visibleRows * group.columns, group.rowCount)}
                {" / "}
                {group.rowCount}
                {group.rowCount > group.visibleRows * group.columns &&
                  " — molette dans le hull"}
              </div>
            ))}
          {layout.groups.filter((group) => !group.collapsed).map((group) => {
            const live = group.nodeKeys.filter((key) => {
              const item = nodesByKey.get(key);
              return item?.kind === "recorded" &&
                item.node.freshness === "running";
            }).length;
            const failed = group.nodeKeys.some((key) => {
              const item = nodesByKey.get(key);
              return item?.kind === "recorded" &&
                item.node.freshness === "failed";
            });
            return (
              <span
                key={`monitor:${group.key}`}
                className="overview-thread-flow-group-monitor"
                data-alert={failed ? "true" : "false"}
                style={{
                  "--flow-x": flowXPercent(
                    group.x + group.width,
                    layout.viewBox,
                  ),
                  "--flow-y": flowYPercent(group.y, layout.viewBox),
                  "--flow-color": laneColorById.get(group.lane) ??
                    "currentColor",
                } as CSSProperties}
              >
                <i aria-hidden="true" />
                {group.rowCount}
                {live > 0 && ` · ${live} live`}
                {failed && " · ⚠"}
              </span>
            );
          })}
          {onResizeGroup && controlsVisible &&
            layout.groups.filter((group) => !group.collapsed).map((group) => (
              <button
                key={`resize:${group.key}`}
                type="button"
                className="overview-thread-flow-group-resize"
                aria-label={`Resize ${flowGroupCaption(group)} hull`}
                tabIndex={-1}
                style={{
                  "--flow-x": flowXPercent(
                    group.x + group.width,
                    layout.viewBox,
                  ),
                  "--flow-y": flowYPercent(
                    group.y + group.height,
                    layout.viewBox,
                  ),
                } as CSSProperties}
                onPointerDown={(event) => beginResize(group.key, event)}
                onPointerMove={moveResize}
                onPointerUp={endResize}
                onPointerCancel={endResize}
                onLostPointerCapture={endResize}
              />
            ))}
        </div>

        <div className="overview-thread-flow-nodes">
          {layout.nodes.map((position) => {
            const item = nodesByKey.get(position.key);
            if (!item || position.folded) return null;
            return (
              <FlowNode
                key={position.key}
                item={item}
                position={position}
                viewBox={layout.viewBox}
                color={laneColorById.get(position.lane) ?? "currentColor"}
                selected={position.key === selectedKey}
                focused={position.key === focusedKey}
                related={activeKey === undefined ||
                  relatedKeys.has(position.key)}
                tabIndex={position.key === focusedKey ? 0 : -1}
                draggable={Boolean(onMoveNode)}
                refNode={(node) => refNode(position.key, node)}
                onHover={(hovered) =>
                  onHover(hovered ? position.key : undefined)}
                onFocus={() => onFocus(position.key)}
                onToggle={(event) =>
                  event
                    ? toggleUnlessDragged(position.key, event)
                    : onToggle(position.key)}
                onDragStart={(event) => beginDrag("node", position.key, event)}
                onDrag={moveDrag}
                onDragEnd={endDrag}
                onDragCancel={(event) => endDrag(event, false)}
                onMove={(direction) => onMove(position.key, direction)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}

/**
 * The contents of one listed row: status, name, and the one figure that dates
 * it. The name's distinguishing tail is lifted out of the ellipsis so a long
 * title loses its middle rather than the part that tells it from its siblings.
 */
function FlowRowBody(
  { item }: { readonly item: OverviewHeroNode },
): JSX.Element {
  const label = item.kind === "activity"
    ? item.activity.title
    : item.node.label;
  const { head, tail } = overviewThreadHullNameParts(label);
  const meta = flowRowMeta(item);
  return (
    <>
      <span className="overview-thread-flow-row-dot" aria-hidden="true" />
      <span className="overview-thread-flow-row-name" title={label}>
        <span className="overview-thread-flow-row-head">{head}</span>
        {tail && <span className="overview-thread-flow-row-tail">{tail}</span>}
      </span>
      {meta && (
        <span
          className="overview-thread-flow-row-meta"
          data-live={item.kind === "recorded" &&
              item.node.freshness === "running"
            ? "true"
            : "false"}
        >
          {meta}
        </span>
      )}
    </>
  );
}

/** The single figure a row carries: what it is doing, or when it settled. */
function flowRowMeta(item: OverviewHeroNode): string {
  if (item.kind === "activity") return flowStatusCaption(item.activity.status);
  if (item.node.freshness === "running") return "RUNNING";
  if (item.node.freshness === "failed") return "échec";
  const at = overviewThreadRecordedTime(item.node.recordedAt);
  if (!at) return item.node.freshness === "stale" ? "périmé" : "";
  return item.node.freshness === "stale" ? `${at} périmé` : `${at} ✓`;
}

/** Wall-clock only: a compact row shows a time, never a full timestamp. */
function overviewThreadRecordedTime(
  recordedAt: string | undefined,
): string | undefined {
  if (!recordedAt) return undefined;
  const parsed = new Date(recordedAt);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return `${String(parsed.getHours()).padStart(2, "0")}:${
    String(parsed.getMinutes()).padStart(2, "0")
  }`;
}

function FlowNode({
  item,
  position,
  viewBox,
  color,
  selected,
  focused,
  related,
  tabIndex,
  draggable,
  refNode,
  onHover,
  onFocus,
  onToggle,
  onDragStart,
  onDrag,
  onDragEnd,
  onDragCancel,
  onMove,
}: {
  readonly item: OverviewHeroNode;
  readonly position: OverviewThreadD3FlowNodeLayout;
  readonly viewBox: readonly [number, number, number, number];
  readonly color: string;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly related: boolean;
  readonly tabIndex: number;
  readonly draggable: boolean;
  readonly refNode: (node: HTMLButtonElement | null) => void;
  readonly onHover: (hovered: boolean) => void;
  readonly onFocus: () => void;
  readonly onToggle: (event?: ReactMouseEvent<HTMLButtonElement>) => void;
  readonly onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  readonly onDragCancel: (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void;
  readonly onMove: (direction: OverviewThreadD3FlowMoveDirection) => void;
}): JSX.Element {
  return (
    <DropdownMenuContextTrigger
      value={overviewThreadNodeContextValue(item.key)}
      asChild
    >
      <button
        ref={refNode}
        type="button"
        tabIndex={tabIndex}
        aria-label={flowNodeAriaLabel(item)}
        aria-pressed={selected}
        aria-controls={selected ? "overview-thread-selection" : undefined}
        aria-expanded={selected}
        className="overview-thread-flow-node"
        data-kind={item.kind}
        data-status={item.kind === "activity"
          ? item.activity.status
          : undefined}
        data-lane={position.lane}
        data-state={selected ? "selected" : related ? "related" : "muted"}
        data-focused={focused ? "true" : "false"}
        data-draggable={draggable ? "true" : "false"}
        data-emphasis={item.kind === "recorded" && item.emphasis
          ? "true"
          : "false"}
        data-overview-context-target={overviewThreadNodeContextValue(item.key)}
        data-listed={position.listed ? "true" : "false"}
        aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+F10"
        style={{
          "--flow-x": position.listed
            ? flowXPercent(position.x, viewBox)
            : flowXPercent(position.centerX, viewBox),
          "--flow-y": flowYPercent(position.centerY, viewBox),
          "--row-width": flowWidthPercent(position.width, viewBox),
          "--row-height": flowHeightPercent(position.height, viewBox),
          "--flow-color": color,
        } as CSSProperties}
        onClick={onToggle}
        onPointerDown={onDragStart}
        onPointerMove={onDrag}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragCancel}
        onLostPointerCapture={onDragCancel}
        onMouseEnter={() => onHover(true)}
        onMouseLeave={() => onHover(false)}
        onFocus={onFocus}
        onBlur={() => onHover(false)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
            return;
          }
          if (isFlowMoveDirection(event.key)) {
            event.preventDefault();
            onMove(event.key);
          }
        }}
      >
        {position.listed ? <FlowRowBody item={item} /> : (
          <span
            className="overview-thread-flow-node-dot"
            aria-hidden="true"
          />
        )}
        {item.kind === "activity"
          ? (
            <span
              className="overview-thread-flow-activity-label"
              data-status={item.activity.status}
              aria-hidden="true"
            >
              <strong>{item.activity.title}</strong>
              <span className="overview-thread-flow-activity-status">
                <span
                  className="overview-thread-flow-activity-status-mark"
                  aria-hidden="true"
                />
                {flowStatusCaption(item.activity.status)}
              </span>
            </span>
          )
          : (
            <span
              className="overview-thread-flow-node-tooltip"
              aria-hidden="true"
            >
              <strong>{item.label}</strong>
              <span>{flowNodeDescription(item)}</span>
            </span>
          )}
      </button>
    </DropdownMenuContextTrigger>
  );
}

type OverviewFlowSegmentState = ReturnType<typeof flowSegmentState>;

interface OverviewFlowSegmentPresentation {
  readonly segment: OverviewThreadD3FlowSegmentLayout;
  readonly state: OverviewFlowSegmentState;
  readonly connectedToDrag: boolean;
}

interface OverviewFlowSegmentElement {
  readonly path: SVGPathElement;
  presentation?: OverviewFlowSegmentPresentation;
  renderedD?: string;
  renderedWidth?: string;
  renderedPresence?: string;
}

function FlowSegmentLayer({
  layout,
  activeKey,
  movingNodeKeys,
  dragging,
  reducedMotion,
}: {
  readonly layout: OverviewThreadD3FlowLayout;
  readonly activeKey: string | undefined;
  readonly movingNodeKeys: ReadonlySet<string>;
  readonly dragging: boolean;
  readonly reducedMotion: boolean;
}): JSX.Element {
  const layerRef = useRef<SVGGElement>(null);
  const sceneRef = useRef(new OverviewFlowMotionScene());
  const elementsRef = useRef(new Map<string, OverviewFlowSegmentElement>());
  const presentationByKeyRef = useRef(
    new Map<string, OverviewFlowSegmentPresentation>(),
  );
  const animationFrameRef = useRef<number>();
  const previousFrameAtRef = useRef<number>();
  const frameCallbackRef = useRef<(now: number) => void>();

  const syncScene = () => {
    const layer = layerRef.current;
    if (!layer) return;
    const liveIds = new Set<string>();
    sceneRef.current.visit((visual) => {
      liveIds.add(visual.id);
      let element = elementsRef.current.get(visual.id);
      if (!element) {
        const path = globalThis.document.createElementNS(
          "http://www.w3.org/2000/svg",
          "path",
        );
        path.setAttribute("fill", "none");
        path.setAttribute("class", "overview-thread-flow-segment");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-linejoin", "round");
        path.setAttribute("vector-effect", "non-scaling-stroke");
        layer.appendChild(path);
        element = { path };
        elementsRef.current.set(visual.id, element);
      }
      const presentation = visual.phase === "active"
        ? presentationByKeyRef.current.get(visual.key)
        : element.presentation;
      if (presentation) {
        element.presentation = presentation;
        applyOverviewFlowSegmentPresentation(element.path, presentation);
      }
      element.path.dataset.motionPhase = visual.phase;
      const renderedD = overviewFlowMotionGeometrySettled(visual) &&
          visual.phase === "active"
        ? visual.targetD
        : overviewFlowMotionPath(visual.points, visual.kind, visual.curve);
      const renderedWidth = formatOverviewFlowMotionNumber(visual.width);
      const renderedPresence = formatOverviewFlowMotionNumber(visual.presence);
      if (element.renderedD !== renderedD) {
        element.path.setAttribute("d", renderedD);
        element.renderedD = renderedD;
      }
      if (element.renderedWidth !== renderedWidth) {
        element.path.setAttribute("stroke-width", renderedWidth);
        element.renderedWidth = renderedWidth;
      }
      if (element.renderedPresence !== renderedPresence) {
        element.path.setAttribute("stroke-opacity", renderedPresence);
        element.renderedPresence = renderedPresence;
      }
    });
    for (const [id, element] of elementsRef.current) {
      if (liveIds.has(id)) continue;
      element.path.remove();
      elementsRef.current.delete(id);
    }
  };

  const requestMotionFrame = () => {
    if (
      animationFrameRef.current !== undefined ||
      !sceneRef.current.needsAnimation()
    ) return;
    animationFrameRef.current = globalThis.requestAnimationFrame((now) =>
      frameCallbackRef.current?.(now)
    );
  };

  frameCallbackRef.current = (now: number) => {
    animationFrameRef.current = undefined;
    const previous = previousFrameAtRef.current;
    previousFrameAtRef.current = now;
    sceneRef.current.advance(
      previous === undefined ? 1_000 / 60 : now - previous,
    );
    syncScene();
    if (sceneRef.current.needsAnimation()) {
      requestMotionFrame();
    } else {
      previousFrameAtRef.current = undefined;
    }
  };

  useLayoutEffect(() => {
    const presentations = overviewFlowSegmentPresentations(
      layout,
      activeKey,
      movingNodeKeys,
      dragging,
    );
    presentationByKeyRef.current = new Map(
      presentations.map((presentation) => [
        presentation.segment.key,
        presentation,
      ]),
    );
    sceneRef.current.reconcile(
      presentations.map(({ segment, connectedToDrag }) => {
        const points = canonicalOverviewFlowMotionPoints(segment, layout);
        const declaredTopology =
          (segment as OverviewThreadD3FlowSegmentLayout & {
            readonly topologySignature?: string;
          }).topologySignature;
        return {
          key: segment.key,
          kind: segment.kind,
          curve: segment.curve,
          points,
          topologySignature: declaredTopology?.trim() ||
            overviewFlowMotionTopologySignature(segment.kind, points),
          targetD: segment.d,
          width: flowSegmentWidth(segment),
          edgeKeys: segment.edgeKeys,
          pathKeys: segment.pathKeys,
          pinEndpoints: connectedToDrag,
        };
      }),
      reducedMotion,
    );
    syncScene();
    if (reducedMotion && animationFrameRef.current !== undefined) {
      globalThis.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
      previousFrameAtRef.current = undefined;
    } else {
      requestMotionFrame();
    }
  }, [activeKey, dragging, layout, movingNodeKeys, reducedMotion]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== undefined) {
        globalThis.cancelAnimationFrame(animationFrameRef.current);
      }
      animationFrameRef.current = undefined;
      previousFrameAtRef.current = undefined;
    };
  }, []);

  return <g ref={layerRef} className="overview-thread-flow-segments" />;
}

function overviewFlowSegmentPresentations(
  layout: OverviewThreadD3FlowLayout,
  activeKey: string | undefined,
  movingNodeKeys: ReadonlySet<string>,
  dragging: boolean,
): readonly OverviewFlowSegmentPresentation[] {
  return overviewFlowVisualSegments(layout).map((segment) => ({
    segment,
    state: flowSegmentState(segment, activeKey),
    connectedToDrag: dragging && segmentTouchesKeys(segment, movingNodeKeys),
  }));
}

function overviewFlowVisualSegments(
  layout: OverviewThreadD3FlowLayout,
): readonly OverviewThreadD3FlowSegmentLayout[] {
  const extended = layout as OverviewThreadD3FlowLayout & {
    readonly corridors?: readonly OverviewThreadD3FlowSegmentLayout[];
  };
  if (!extended.corridors || extended.corridors.length === 0) {
    return layout.segments;
  }
  const byKey = new Map(
    [...extended.corridors, ...layout.segments].map((segment) => [
      segment.key,
      segment,
    ]),
  );
  return [...byKey.values()];
}

function canonicalOverviewFlowMotionPoints(
  segment: OverviewThreadD3FlowSegmentLayout,
  layout: OverviewThreadD3FlowLayout,
): readonly OverviewThreadD3FlowPoint[] {
  if (segment.kind !== "same-lane-trunk" || segment.points.length < 2) {
    return segment.points;
  }
  const first = segment.points[0]!;
  const last = segment.points.at(-1)!;
  const firstGroup = layout.groups.find((group) =>
    sameOverviewFlowPoint(group.outHub, first) ||
    sameOverviewFlowPoint(group.inHub, first)
  );
  const lastGroup = layout.groups.find((group) =>
    sameOverviewFlowPoint(group.outHub, last) ||
    sameOverviewFlowPoint(group.inHub, last)
  );
  return firstGroup && lastGroup &&
      firstGroup.key.localeCompare(lastGroup.key) > 0
    ? segment.points.toReversed()
    : segment.points;
}

function sameOverviewFlowPoint(
  left: OverviewThreadD3FlowPoint,
  right: OverviewThreadD3FlowPoint,
): boolean {
  return left.x === right.x && left.y === right.y;
}

function applyOverviewFlowSegmentPresentation(
  path: SVGPathElement,
  presentation: OverviewFlowSegmentPresentation,
): void {
  path.dataset.kind = presentation.segment.kind;
  path.dataset.role = presentation.segment.role;
  path.dataset.direction = presentation.segment.direction;
  path.dataset.state = presentation.state;
  path.dataset.dragRoute = presentation.connectedToDrag ? "connected" : "idle";
}

function formatOverviewFlowMotionNumber(value: number): string {
  return String(Math.round(value * 1_000) / 1_000);
}

function segmentTouchesKeys(
  segment: OverviewThreadD3FlowSegmentLayout,
  keys: ReadonlySet<string>,
): boolean {
  if (keys.size === 0) return false;
  return segment.fromKeys.some((key) => keys.has(key)) ||
    segment.toKeys.some((key) => keys.has(key));
}

function flowSegmentState(
  segment: OverviewThreadD3FlowSegmentLayout,
  activeKey: string | undefined,
): "default" | "emphasis" | "incoming" | "outgoing" | "muted" {
  if (!activeKey) return segment.emphasis ? "emphasis" : "default";
  if (segment.fromKeys.includes(activeKey)) return "outgoing";
  if (segment.toKeys.includes(activeKey)) return "incoming";
  return "muted";
}

function flowSegmentWidth(segment: OverviewThreadD3FlowSegmentLayout): number {
  return nonNegativeFinite(segment.width);
}

function flowRelatedNodeKeys(
  layout: OverviewThreadD3FlowLayout,
  activeKey: string | undefined,
): ReadonlySet<string> {
  if (!activeKey) return new Set();
  const keys = new Set([activeKey]);
  for (const route of layout.routes) {
    if (route.fromKey === activeKey) keys.add(route.toKey);
    if (route.toKey === activeKey) keys.add(route.fromKey);
  }
  return keys;
}

function flowXPercent(
  x: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${((x - viewBox[0]) / viewBox[2]) * 100}%`;
}

function flowWidthPercent(
  width: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${(width / viewBox[2]) * 100}%`;
}

function flowHeightPercent(
  height: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${(height / viewBox[3]) * 100}%`;
}

function flowYPercent(
  y: number,
  viewBox: readonly [number, number, number, number],
): string {
  return `${((y - viewBox[1]) / viewBox[3]) * 100}%`;
}

export function flowGroupCaption(
  group: OverviewThreadD3FlowGroupLayout,
): string {
  return overviewGroupCaption(group.groupKey, group.lane);
}

function flowNodeDescription(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `Current activity \u00b7 ${flowStatusCaption(item.activity.status)}`;
  }
  return item.node.summary;
}

function flowNodeAriaLabel(item: OverviewHeroNode): string {
  if (item.kind === "activity") {
    return `Inspect current activity ${item.activity.title}, ${
      flowStatusCaption(item.activity.status)
    }`;
  }
  return `Inspect ${item.node.label}, ${item.node.freshness}, ${item.node.ref.id}`;
}

const FLOW_ACTIVITY_STATUS_ORDER = [
  "planned",
  "active",
  "blocked",
] as const satisfies readonly EngineeringPhaseStatus[];

function overviewFlowActivityStatuses(
  nodesByKey: ReadonlyMap<string, OverviewHeroNode>,
): readonly EngineeringPhaseStatus[] {
  const present = new Set<EngineeringPhaseStatus>();
  for (const item of nodesByKey.values()) {
    if (item.kind === "activity") present.add(item.activity.status);
  }
  return FLOW_ACTIVITY_STATUS_ORDER.filter((status) => present.has(status));
}

function flowStatusCaption(status: EngineeringPhaseStatus): string {
  if (status === "blocked") return "BLOCKED";
  if (status === "active") return "IN PROGRESS";
  if (status === "planned") return "PENDING";
  return "COMPLETED";
}

function isFlowMoveDirection(
  key: string,
): key is OverviewThreadD3FlowMoveDirection {
  return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" ||
    key === "ArrowRight";
}

function flowKeyboardMoveDelta(
  direction: OverviewThreadD3FlowMoveDirection,
): { readonly x: number; readonly y: number } {
  if (direction === "ArrowUp") {
    return { x: 0, y: -FLOW_KEYBOARD_MOVE_STEP };
  }
  if (direction === "ArrowDown") {
    return { x: 0, y: FLOW_KEYBOARD_MOVE_STEP };
  }
  if (direction === "ArrowLeft") {
    return { x: -FLOW_KEYBOARD_MOVE_STEP, y: 0 };
  }
  return { x: FLOW_KEYBOARD_MOVE_STEP, y: 0 };
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
