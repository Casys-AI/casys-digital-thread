import { curveBumpX, line } from "d3-shape";
import type {
  OverviewThreadWhiteboardPoint,
  OverviewThreadWhiteboardSize,
  OverviewThreadWhiteboardTransform,
} from "./overview-thread-whiteboard-transform.ts";

/**
 * World-space rectangle occupied by one independently movable viewer.
 *
 * Viewer geometry is deliberately presentation-only. The node-to-viewer
 * authority remains with the caller; this module never derives a relation
 * from labels, layout proximity or graph shape.
 */
export interface OverviewThreadViewerGeometry
  extends OverviewThreadWhiteboardPoint, OverviewThreadWhiteboardSize {}

export interface OverviewThreadViewerGeometryBounds {
  readonly worldSize: OverviewThreadWhiteboardSize;
  readonly padding?: number;
  readonly minWidth?: number;
  readonly minHeight?: number;
}

export interface OverviewThreadViewerGeometryConstraints {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly maxWidth?: number;
  readonly maxHeight?: number;
  readonly maxAbsoluteCoordinate?: number;
}

export type OverviewThreadViewerAttachmentEdge =
  | "left"
  | "right"
  | "top"
  | "bottom";

export interface OverviewThreadViewerAttachmentPoint
  extends OverviewThreadWhiteboardPoint {
  readonly edge: OverviewThreadViewerAttachmentEdge;
}

export interface OverviewThreadViewerConnectorGeometry {
  /** Exact world-space anchor supplied by the caller. */
  readonly source: OverviewThreadWhiteboardPoint;
  readonly target: OverviewThreadViewerAttachmentPoint;
  /** Deterministic D3 curveBumpX SVG path. */
  readonly d: string;
}

export interface OverviewThreadViewerConnectorOptions {
  /** Keeps connectors away from rounded viewer corners. */
  readonly edgeInset?: number;
}

export const OVERVIEW_THREAD_VIEWER_MIN_WIDTH = 260;
export const OVERVIEW_THREAD_VIEWER_MIN_HEIGHT = 180;
export const OVERVIEW_THREAD_VIEWER_WORLD_PADDING = 24;
export const OVERVIEW_THREAD_VIEWER_EDGE_INSET = 18;
export const OVERVIEW_THREAD_VIEWER_MAX_ABSOLUTE_COORDINATE = 10_000_000;

const GEOMETRY_PRECISION = 1_000_000;

const viewerConnectorLine = line<OverviewThreadWhiteboardPoint>()
  .x((point: OverviewThreadWhiteboardPoint) => point.x)
  .y((point: OverviewThreadWhiteboardPoint) => point.y)
  .curve(curveBumpX)
  .digits(3);

/**
 * Converts a viewport-local screen point to whiteboard world coordinates.
 * Callers using `clientX`/`clientY` must first subtract the viewport origin.
 */
export function overviewThreadViewerScreenPointToWorld(
  point: OverviewThreadWhiteboardPoint,
  transform: OverviewThreadWhiteboardTransform,
): OverviewThreadWhiteboardPoint {
  const normalizedPoint = normalizePoint(point);
  const normalizedTransform = normalizeTransform(transform);
  return {
    x: stableNumber(
      (normalizedPoint.x - normalizedTransform.x) / normalizedTransform.k,
    ),
    y: stableNumber(
      (normalizedPoint.y - normalizedTransform.y) / normalizedTransform.k,
    ),
  };
}

/** Converts a viewport-space pointer delta to a world-space delta. */
export function overviewThreadViewerScreenDeltaToWorld(
  delta: OverviewThreadWhiteboardPoint,
  transform: OverviewThreadWhiteboardTransform,
): OverviewThreadWhiteboardPoint {
  const normalizedDelta = normalizePoint(delta);
  const scale = normalizeTransform(transform).k;
  return {
    x: stableNumber(normalizedDelta.x / scale),
    y: stableNumber(normalizedDelta.y / scale),
  };
}

/**
 * Sanitises dimensions and keeps the complete viewer inside the world.
 * Impossible zero-sized worlds collapse to a canonical empty rectangle.
 */
export function clampOverviewThreadViewerGeometry(
  geometry: OverviewThreadViewerGeometry,
  bounds: OverviewThreadViewerGeometryBounds,
): OverviewThreadViewerGeometry {
  const resolved = resolveBounds(bounds);
  if (!resolved) return { x: 0, y: 0, width: 0, height: 0 };

  const { width: worldWidth, height: worldHeight } = resolved.worldSize;
  const padding = resolved.padding;
  const availableWidth = Math.max(0, worldWidth - padding * 2);
  const availableHeight = Math.max(0, worldHeight - padding * 2);
  const minimumWidth = Math.min(resolved.minWidth, availableWidth);
  const minimumHeight = Math.min(resolved.minHeight, availableHeight);
  const width = clamp(
    positiveOrDefault(geometry.width, minimumWidth),
    minimumWidth,
    availableWidth,
  );
  const height = clamp(
    positiveOrDefault(geometry.height, minimumHeight),
    minimumHeight,
    availableHeight,
  );
  const x = clamp(
    finiteOrDefault(geometry.x, padding),
    padding,
    worldWidth - padding - width,
  );
  const y = clamp(
    finiteOrDefault(geometry.y, padding),
    padding,
    worldHeight - padding - height,
  );

  return stableGeometry({ x, y, width, height });
}

/**
 * Keeps viewer geometry finite and usable without tying its position to the
 * graph rectangle. The numeric ceiling matches the persisted presentation
 * contract, yielding a practically infinite canvas without unserialisable
 * coordinates.
 */
export function normalizeOverviewThreadViewerGeometry(
  geometry: OverviewThreadViewerGeometry,
  constraints: OverviewThreadViewerGeometryConstraints = {},
): OverviewThreadViewerGeometry {
  const minWidth = positiveOrDefault(
    constraints.minWidth,
    OVERVIEW_THREAD_VIEWER_MIN_WIDTH,
  );
  const minHeight = positiveOrDefault(
    constraints.minHeight,
    OVERVIEW_THREAD_VIEWER_MIN_HEIGHT,
  );
  const maxCoordinate = positiveOrDefault(
    constraints.maxAbsoluteCoordinate,
    OVERVIEW_THREAD_VIEWER_MAX_ABSOLUTE_COORDINATE,
  );
  const maxWidth = Math.max(
    minWidth,
    positiveOrDefault(constraints.maxWidth, maxCoordinate),
  );
  const maxHeight = Math.max(
    minHeight,
    positiveOrDefault(constraints.maxHeight, maxCoordinate),
  );

  return stableGeometry({
    x: clamp(finiteOrDefault(geometry.x, 0), -maxCoordinate, maxCoordinate),
    y: clamp(finiteOrDefault(geometry.y, 0), -maxCoordinate, maxCoordinate),
    width: clamp(
      positiveOrDefault(geometry.width, minWidth),
      minWidth,
      maxWidth,
    ),
    height: clamp(
      positiveOrDefault(geometry.height, minHeight),
      minHeight,
      maxHeight,
    ),
  });
}

/**
 * Resizes from the viewer's south-east handle. Pointer movement is received
 * in screen pixels and divided by the current whiteboard zoom. The north-west
 * corner remains fixed while dimensions stop at configured minima. Supplying
 * a finite `worldSize` additionally retains the legacy padded-world clamp;
 * constraint-only callers remain free to resize anywhere on the whiteboard.
 */
export function resizeOverviewThreadViewerByScreenDelta(
  geometry: OverviewThreadViewerGeometry,
  screenDelta: OverviewThreadWhiteboardPoint,
  transform: OverviewThreadWhiteboardTransform,
  constraints:
    | OverviewThreadViewerGeometryBounds
    | OverviewThreadViewerGeometryConstraints = {},
): OverviewThreadViewerGeometry {
  if (!("worldSize" in constraints)) {
    const base = normalizeOverviewThreadViewerGeometry(geometry, constraints);
    const delta = overviewThreadViewerScreenDeltaToWorld(
      screenDelta,
      transform,
    );
    return normalizeOverviewThreadViewerGeometry(
      {
        ...base,
        width: base.width + delta.x,
        height: base.height + delta.y,
      },
      constraints,
    );
  }

  const bounds = constraints;
  const base = clampOverviewThreadViewerGeometry(geometry, bounds);
  const resolved = resolveBounds(bounds);
  if (!resolved) return base;

  const delta = overviewThreadViewerScreenDeltaToWorld(
    screenDelta,
    transform,
  );
  const maximumWidth = Math.max(
    0,
    resolved.worldSize.width - resolved.padding - base.x,
  );
  const maximumHeight = Math.max(
    0,
    resolved.worldSize.height - resolved.padding - base.y,
  );
  const minimumWidth = Math.min(resolved.minWidth, maximumWidth);
  const minimumHeight = Math.min(resolved.minHeight, maximumHeight);

  return stableGeometry({
    x: base.x,
    y: base.y,
    width: clamp(base.width + delta.x, minimumWidth, maximumWidth),
    height: clamp(base.height + delta.y, minimumHeight, maximumHeight),
  });
}

/**
 * Chooses the Euclidean-nearest point on a viewer edge. The edge inset keeps
 * the point clear of rounded corners and is reduced for small rectangles.
 */
export function nearestOverviewThreadViewerAttachmentPoint(
  exactNodeAnchor: OverviewThreadWhiteboardPoint,
  viewer: OverviewThreadViewerGeometry,
  options: OverviewThreadViewerConnectorOptions = {},
): OverviewThreadViewerAttachmentPoint {
  const anchor = normalizePoint(exactNodeAnchor);
  const rectangle = normalizeRectangle(viewer);
  const requestedInset = nonNegativeOrDefault(
    options.edgeInset,
    OVERVIEW_THREAD_VIEWER_EDGE_INSET,
  );
  const horizontalInset = Math.min(requestedInset, rectangle.width / 2);
  const verticalInset = Math.min(requestedInset, rectangle.height / 2);
  const left = rectangle.x;
  const right = rectangle.x + rectangle.width;
  const top = rectangle.y;
  const bottom = rectangle.y + rectangle.height;

  const candidates: readonly OverviewThreadViewerAttachmentPoint[] = [
    {
      edge: "left",
      x: left,
      y: clamp(anchor.y, top + verticalInset, bottom - verticalInset),
    },
    {
      edge: "right",
      x: right,
      y: clamp(anchor.y, top + verticalInset, bottom - verticalInset),
    },
    {
      edge: "top",
      x: clamp(anchor.x, left + horizontalInset, right - horizontalInset),
      y: top,
    },
    {
      edge: "bottom",
      x: clamp(anchor.x, left + horizontalInset, right - horizontalInset),
      y: bottom,
    },
  ];

  const nearest = candidates.reduce((best, candidate) =>
    squaredDistance(anchor, candidate) < squaredDistance(anchor, best)
      ? candidate
      : best
  );
  return {
    edge: nearest.edge,
    x: stableNumber(nearest.x),
    y: stableNumber(nearest.y),
  };
}

/**
 * Builds a curved connector from an explicitly supplied node anchor to the
 * closest viewer edge. The function does not discover or infer graph joins.
 */
export function buildOverviewThreadViewerConnectorGeometry(
  exactNodeAnchor: OverviewThreadWhiteboardPoint,
  viewer: OverviewThreadViewerGeometry,
  options: OverviewThreadViewerConnectorOptions = {},
): OverviewThreadViewerConnectorGeometry {
  const source = normalizePoint(exactNodeAnchor);
  const target = nearestOverviewThreadViewerAttachmentPoint(
    source,
    viewer,
    options,
  );
  return {
    source,
    target,
    d: viewerConnectorLine([source, target]) ??
      `M${source.x},${source.y}L${target.x},${target.y}`,
  };
}

function resolveBounds(
  bounds: OverviewThreadViewerGeometryBounds,
): {
  readonly worldSize: OverviewThreadWhiteboardSize;
  readonly padding: number;
  readonly minWidth: number;
  readonly minHeight: number;
} | undefined {
  const width = bounds.worldSize.width;
  const height = bounds.worldSize.height;
  if (!isPositiveFinite(width) || !isPositiveFinite(height)) return undefined;

  const requestedPadding = nonNegativeOrDefault(
    bounds.padding,
    OVERVIEW_THREAD_VIEWER_WORLD_PADDING,
  );
  return {
    worldSize: { width, height },
    padding: Math.min(requestedPadding, width / 2, height / 2),
    minWidth: positiveOrDefault(
      bounds.minWidth,
      OVERVIEW_THREAD_VIEWER_MIN_WIDTH,
    ),
    minHeight: positiveOrDefault(
      bounds.minHeight,
      OVERVIEW_THREAD_VIEWER_MIN_HEIGHT,
    ),
  };
}

function normalizeTransform(
  transform: OverviewThreadWhiteboardTransform,
): OverviewThreadWhiteboardTransform {
  return {
    x: finiteOrDefault(transform.x, 0),
    y: finiteOrDefault(transform.y, 0),
    k: positiveOrDefault(transform.k, 1),
  };
}

function normalizeRectangle(
  rectangle: OverviewThreadViewerGeometry,
): OverviewThreadViewerGeometry {
  return {
    x: finiteOrDefault(rectangle.x, 0),
    y: finiteOrDefault(rectangle.y, 0),
    width: Math.max(0, finiteOrDefault(rectangle.width, 0)),
    height: Math.max(0, finiteOrDefault(rectangle.height, 0)),
  };
}

function normalizePoint(
  point: OverviewThreadWhiteboardPoint,
): OverviewThreadWhiteboardPoint {
  return {
    x: stableNumber(finiteOrDefault(point.x, 0)),
    y: stableNumber(finiteOrDefault(point.y, 0)),
  };
}

function squaredDistance(
  left: OverviewThreadWhiteboardPoint,
  right: OverviewThreadWhiteboardPoint,
): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}

function stableGeometry(
  geometry: OverviewThreadViewerGeometry,
): OverviewThreadViewerGeometry {
  return {
    x: stableNumber(geometry.x),
    y: stableNumber(geometry.y),
    width: stableNumber(geometry.width),
    height: stableNumber(geometry.height),
  };
}

function finiteOrDefault(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return isPositiveFinite(value) ? value : fallback;
}

function nonNegativeOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableNumber(value: number): number {
  const rounded = Math.round(value * GEOMETRY_PRECISION) /
    GEOMETRY_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}
