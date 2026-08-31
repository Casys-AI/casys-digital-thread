/**
 * A whiteboard transform maps world coordinates to viewport coordinates:
 * `screen = world * k + translation`.
 *
 * This module intentionally has no browser, Preact, SVG or D3 dependency. It
 * is the deterministic state boundary shared by wheel, pointer and fit/reset
 * interactions; rendering stays with the Project surface.
 */

export interface OverviewThreadWhiteboardTransform {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

export interface OverviewThreadWhiteboardPoint {
  readonly x: number;
  readonly y: number;
}

export interface OverviewThreadWhiteboardSize {
  readonly width: number;
  readonly height: number;
}

export interface OverviewThreadWhiteboardRect
  extends OverviewThreadWhiteboardPoint, OverviewThreadWhiteboardSize {}

export interface OverviewThreadWhiteboardScaleBounds {
  readonly minScale?: number;
  readonly maxScale?: number;
}

export interface OverviewThreadWhiteboardBounds
  extends OverviewThreadWhiteboardScaleBounds {
  readonly viewport: OverviewThreadWhiteboardSize;
  readonly content: OverviewThreadWhiteboardRect;
  /** Empty viewport margin retained while clamping or fitting. */
  readonly padding?: number;
}

export interface OverviewThreadWhiteboardWheelOptions
  extends OverviewThreadWhiteboardScaleBounds {
  readonly sensitivity?: number;
  readonly bounds?: OverviewThreadWhiteboardBounds;
}

export const OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE = 0.35;
export const OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE = 4;
export const OVERVIEW_THREAD_WHITEBOARD_WHEEL_SENSITIVITY = 0.0015;
export const OVERVIEW_THREAD_WHITEBOARD_PADDING = 48;

const TRANSFORM_PRECISION = 1_000_000;
const MAX_WHEEL_EXPONENT = 50;

/**
 * Removes non-finite values, clamps scale, rounds away accumulated pointer
 * drift, and canonicalises negative zero. Equal inputs always return the same
 * serialisable transform.
 */
export function normalizeOverviewThreadWhiteboardTransform(
  transform: OverviewThreadWhiteboardTransform,
  scaleBounds: OverviewThreadWhiteboardScaleBounds = {},
): OverviewThreadWhiteboardTransform {
  const { minScale, maxScale } = resolveScaleBounds(scaleBounds);
  const rawScale = Number.isFinite(transform.k) ? transform.k : 1;

  return {
    x: stableNumber(Number.isFinite(transform.x) ? transform.x : 0),
    y: stableNumber(Number.isFinite(transform.y) ? transform.y : 0),
    k: stableNumber(clamp(rawScale, minScale, maxScale)),
  };
}

/**
 * Keeps the transformed content inside a fixed viewport. Large content may be
 * panned until its edge reaches `padding`; smaller content is centred instead
 * of drifting into unreachable empty space.
 */
export function clampOverviewThreadWhiteboardTransform(
  transform: OverviewThreadWhiteboardTransform,
  bounds: OverviewThreadWhiteboardBounds,
): OverviewThreadWhiteboardTransform {
  const normalized = normalizeOverviewThreadWhiteboardTransform(
    transform,
    bounds,
  );
  const geometry = resolveGeometry(bounds);
  if (!geometry) return normalized;

  const { viewport, content, padding } = geometry;
  return normalizeOverviewThreadWhiteboardTransform(
    {
      x: clampAxis(
        normalized.x,
        normalized.k,
        viewport.width,
        content.x,
        content.width,
        padding,
      ),
      y: clampAxis(
        normalized.y,
        normalized.k,
        viewport.height,
        content.y,
        content.height,
        padding,
      ),
      k: normalized.k,
    },
    bounds,
  );
}

/** Zooms around one viewport point, preserving the world point below it. */
export function zoomOverviewThreadWhiteboardAt(
  transform: OverviewThreadWhiteboardTransform,
  pointer: OverviewThreadWhiteboardPoint,
  nextScale: number,
  scaleBounds: OverviewThreadWhiteboardScaleBounds = {},
  bounds?: OverviewThreadWhiteboardBounds,
): OverviewThreadWhiteboardTransform {
  const effectiveBounds = bounds ?? scaleBounds;
  const base = bounds
    ? clampOverviewThreadWhiteboardTransform(transform, bounds)
    : normalizeOverviewThreadWhiteboardTransform(transform, scaleBounds);
  const normalizedTarget = normalizeOverviewThreadWhiteboardTransform(
    { x: base.x, y: base.y, k: nextScale },
    effectiveBounds,
  );
  const point = normalizePoint(pointer);
  const ratio = normalizedTarget.k / base.k;
  const zoomed = normalizeOverviewThreadWhiteboardTransform(
    {
      x: point.x - (point.x - base.x) * ratio,
      y: point.y - (point.y - base.y) * ratio,
      k: normalizedTarget.k,
    },
    effectiveBounds,
  );

  return bounds
    ? clampOverviewThreadWhiteboardTransform(zoomed, bounds)
    : zoomed;
}

/**
 * Converts a vertical wheel delta to exponential zoom. Positive deltas zoom
 * out and negative deltas zoom in, matching canvas and map conventions.
 */
export function zoomOverviewThreadWhiteboardByWheel(
  transform: OverviewThreadWhiteboardTransform,
  pointer: OverviewThreadWhiteboardPoint,
  deltaY: number,
  options: OverviewThreadWhiteboardWheelOptions = {},
): OverviewThreadWhiteboardTransform {
  const scaleBounds = options.bounds ?? options;
  const base = options.bounds
    ? clampOverviewThreadWhiteboardTransform(transform, options.bounds)
    : normalizeOverviewThreadWhiteboardTransform(transform, scaleBounds);
  const sensitivity = positiveOrDefault(
    options.sensitivity,
    OVERVIEW_THREAD_WHITEBOARD_WHEEL_SENSITIVITY,
  );
  const normalizedDelta = Number.isFinite(deltaY) ? deltaY : 0;
  const exponent = clamp(
    -normalizedDelta * sensitivity,
    -MAX_WHEEL_EXPONENT,
    MAX_WHEEL_EXPONENT,
  );

  return zoomOverviewThreadWhiteboardAt(
    base,
    pointer,
    base.k * Math.exp(exponent),
    scaleBounds,
    options.bounds,
  );
}

/** Adds a viewport-space pointer delta, then applies optional canvas bounds. */
export function panOverviewThreadWhiteboard(
  transform: OverviewThreadWhiteboardTransform,
  delta: OverviewThreadWhiteboardPoint,
  bounds?: OverviewThreadWhiteboardBounds,
): OverviewThreadWhiteboardTransform {
  const base = bounds
    ? clampOverviewThreadWhiteboardTransform(transform, bounds)
    : normalizeOverviewThreadWhiteboardTransform(transform);
  const normalizedDelta = normalizePoint(delta);
  const panned = normalizeOverviewThreadWhiteboardTransform(
    {
      x: base.x + normalizedDelta.x,
      y: base.y + normalizedDelta.y,
      k: base.k,
    },
    bounds,
  );

  return bounds
    ? clampOverviewThreadWhiteboardTransform(panned, bounds)
    : panned;
}

/** Returns the canonical identity view, constrained when geometry is known. */
export function resetOverviewThreadWhiteboardTransform(
  bounds?: OverviewThreadWhiteboardBounds,
): OverviewThreadWhiteboardTransform {
  const identity = normalizeOverviewThreadWhiteboardTransform(
    { x: 0, y: 0, k: 1 },
    bounds,
  );
  return bounds
    ? clampOverviewThreadWhiteboardTransform(identity, bounds)
    : identity;
}

/** Fits the complete content rectangle within the fixed viewport. */
export function fitOverviewThreadWhiteboardTransform(
  bounds: OverviewThreadWhiteboardBounds,
): OverviewThreadWhiteboardTransform {
  const geometry = resolveGeometry(bounds);
  if (!geometry) return resetOverviewThreadWhiteboardTransform(bounds);

  const { viewport, content, padding } = geometry;
  const fitScale = Math.min(
    (viewport.width - padding * 2) / content.width,
    (viewport.height - padding * 2) / content.height,
  );
  const { minScale, maxScale } = resolveScaleBounds(bounds);
  const k = clamp(fitScale, minScale, maxScale);

  return clampOverviewThreadWhiteboardTransform(
    {
      x: (viewport.width - content.width * k) / 2 - content.x * k,
      y: (viewport.height - content.height * k) / 2 - content.y * k,
      k,
    },
    bounds,
  );
}

/**
 * Returns the finite union of scene rectangles. This lets an explicit Fit
 * recover graph content and off-graph viewers without making ordinary pan or
 * zoom finite.
 */
export function unionOverviewThreadWhiteboardRects(
  rectangles: readonly OverviewThreadWhiteboardRect[],
): OverviewThreadWhiteboardRect | undefined {
  const valid = rectangles.filter((rectangle) =>
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    isPositiveFinite(rectangle.width) &&
    isPositiveFinite(rectangle.height)
  );
  if (valid.length === 0) return undefined;

  const left = Math.min(...valid.map((rectangle) => rectangle.x));
  const top = Math.min(...valid.map((rectangle) => rectangle.y));
  const right = Math.max(
    ...valid.map((rectangle) => rectangle.x + rectangle.width),
  );
  const bottom = Math.max(
    ...valid.map((rectangle) => rectangle.y + rectangle.height),
  );

  return {
    x: stableNumber(left),
    y: stableNumber(top),
    width: stableNumber(right - left),
    height: stableNumber(bottom - top),
  };
}

/**
 * Fits sparse whiteboard content to the records and viewers that actually
 * exist. The nominal world is only a coordinate surface; including its whole
 * rectangle would keep a two-hull project tiny in the middle of an otherwise
 * empty canvas. An empty scene still falls back to that world so reset and
 * loading states remain deterministic.
 */
export function overviewThreadWhiteboardContentBounds(
  world: OverviewThreadWhiteboardSize,
  sceneRectangles: readonly OverviewThreadWhiteboardRect[],
): OverviewThreadWhiteboardRect | undefined {
  return unionOverviewThreadWhiteboardRects(sceneRectangles) ??
    unionOverviewThreadWhiteboardRects([{
      x: 0,
      y: 0,
      width: world.width,
      height: world.height,
    }]);
}

function resolveScaleBounds(
  bounds: OverviewThreadWhiteboardScaleBounds,
): { readonly minScale: number; readonly maxScale: number } {
  const first = positiveOrDefault(
    bounds.minScale,
    OVERVIEW_THREAD_WHITEBOARD_MIN_SCALE,
  );
  const second = positiveOrDefault(
    bounds.maxScale,
    OVERVIEW_THREAD_WHITEBOARD_MAX_SCALE,
  );
  return {
    minScale: Math.min(first, second),
    maxScale: Math.max(first, second),
  };
}

function resolveGeometry(
  bounds: OverviewThreadWhiteboardBounds,
): {
  readonly viewport: OverviewThreadWhiteboardSize;
  readonly content: OverviewThreadWhiteboardRect;
  readonly padding: number;
} | undefined {
  const viewport = bounds.viewport;
  const content = bounds.content;
  if (
    !isPositiveFinite(viewport.width) ||
    !isPositiveFinite(viewport.height) ||
    !Number.isFinite(content.x) ||
    !Number.isFinite(content.y) ||
    !isPositiveFinite(content.width) ||
    !isPositiveFinite(content.height)
  ) return undefined;

  const maxPadding = Math.min(viewport.width, viewport.height) / 2;
  const requestedPadding = Number.isFinite(bounds.padding)
    ? Math.max(0, bounds.padding!)
    : OVERVIEW_THREAD_WHITEBOARD_PADDING;

  return {
    viewport,
    content,
    padding: Math.min(requestedPadding, maxPadding),
  };
}

function clampAxis(
  translation: number,
  k: number,
  viewportSize: number,
  contentStart: number,
  contentSize: number,
  padding: number,
): number {
  const scaledSize = contentSize * k;
  const availableSize = viewportSize - padding * 2;
  if (scaledSize <= availableSize) {
    return (viewportSize - scaledSize) / 2 - contentStart * k;
  }

  const minimum = viewportSize - padding - (contentStart + contentSize) * k;
  const maximum = padding - contentStart * k;
  return clamp(translation, minimum, maximum);
}

function normalizePoint(
  point: OverviewThreadWhiteboardPoint,
): OverviewThreadWhiteboardPoint {
  return {
    x: Number.isFinite(point.x) ? point.x : 0,
    y: Number.isFinite(point.y) ? point.y : 0,
  };
}

function positiveOrDefault(
  value: number | undefined,
  fallback: number,
): number {
  return isPositiveFinite(value) ? value : fallback;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableNumber(value: number): number {
  const rounded = Math.round(value * TRANSFORM_PRECISION) /
    TRANSFORM_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}
