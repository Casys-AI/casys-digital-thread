import type { ThreadGraphRef } from "./types.ts";
import {
  THREAD_GRAPH_NODE_HEIGHT,
  THREAD_GRAPH_NODE_WIDTH,
} from "./thread-graph-layout-model.ts";
const MAX_ZOOM = 4.5;
const DEFAULT_COMPONENT_ROW_WIDTH = 1320;

export interface GraphViewportPoint {
  x: number;
  y: number;
}

export interface GraphViewportOptions {
  /** Visible canvas ratio. Omit it for the layout's native ratio. */
  aspectRatio?: number;
  /** Explicit camera centre, used while the operator pans the canvas. */
  center?: GraphViewportPoint;
}

export interface ThreadGraphViewport {
  x: number;
  y: number;
  width: number;
  height: number;
  zoom: number;
}

export interface GraphViewportLayout {
  width: number;
  height: number;
  nodes: ReadonlyArray<{
    node: { ref: ThreadGraphRef };
    x: number;
    y: number;
  }>;
}

/**
 * Gives disconnected evidence islands more horizontal room on a wide canvas.
 * The bound keeps ultra-wide screens from turning the thread into one endless
 * row, while embedded projections retain the compact default packing.
 */
export function canvasComponentRowWidth(
  aspectRatio: number,
  baseWidth = DEFAULT_COMPONENT_ROW_WIDTH,
): number {
  const frameAspectRatio = safeAspectRatio(aspectRatio, 1);
  const widthFactor = Math.min(
    3.25,
    Math.max(1, frameAspectRatio * 1.4),
  );
  return Math.round(baseWidth * widthFactor);
}

/**
 * A deterministic, bounded camera for the SVG canvas.
 *
 * The fit viewport adopts the visible frame ratio instead of retaining a tall
 * graph's native ratio inside a wide canvas. At readable zoom levels, a target
 * or an explicit pan centre chooses the visible portion of the complete graph.
 */
export function graphViewport(
  layout: GraphViewportLayout,
  zoom: number,
  target?: ThreadGraphRef,
  options: GraphViewportOptions = {},
): ThreadGraphViewport {
  const boundedZoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const layoutAspectRatio = positiveAspectRatio(layout.width, layout.height);
  const frameAspectRatio = options.aspectRatio === undefined
    ? layoutAspectRatio
    : safeAspectRatio(options.aspectRatio, 1);
  const fitWidth = layoutAspectRatio > frameAspectRatio
    ? layout.width
    : layout.height * frameAspectRatio;
  const fitHeight = layoutAspectRatio > frameAspectRatio
    ? layout.width / frameAspectRatio
    : layout.height;
  const width = fitWidth / boundedZoom;
  const height = fitHeight / boundedZoom;
  const positionedTarget = target
    ? layout.nodes.find((item) => refKey(item.node.ref) === refKey(target))
    : undefined;
  const centerX = options.center?.x ??
    (positionedTarget
      ? positionedTarget.x + (THREAD_GRAPH_NODE_WIDTH / 2)
      : layout.width / 2);
  const centerY = options.center?.y ??
    (positionedTarget
      ? positionedTarget.y + (THREAD_GRAPH_NODE_HEIGHT / 2)
      : layout.height / 2);

  return {
    x: cameraAxis(centerX, width, layout.width),
    y: cameraAxis(centerY, height, layout.height),
    width,
    height,
    zoom: boundedZoom,
  };
}

function cameraAxis(
  center: number,
  viewportSize: number,
  layoutSize: number,
): number {
  if (viewportSize >= layoutSize) return (layoutSize - viewportSize) / 2;
  return clamp(center - (viewportSize / 2), 0, layoutSize - viewportSize);
}

function safeAspectRatio(width: number, height: number): number {
  return Math.min(4, Math.max(0.5, positiveAspectRatio(width, height)));
}

function positiveAspectRatio(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return 1;
  }
  return Math.max(Number.EPSILON, width / height);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}
