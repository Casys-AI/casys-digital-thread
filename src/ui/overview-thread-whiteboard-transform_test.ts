import { assert, assertEquals } from "@std/assert";
import {
  clampOverviewThreadWhiteboardTransform,
  fitOverviewThreadWhiteboardTransform,
  normalizeOverviewThreadWhiteboardTransform,
  type OverviewThreadWhiteboardBounds,
  overviewThreadWhiteboardContentBounds,
  type OverviewThreadWhiteboardPoint,
  type OverviewThreadWhiteboardTransform,
  panOverviewThreadWhiteboard,
  resetOverviewThreadWhiteboardTransform,
  unionOverviewThreadWhiteboardRects,
  zoomOverviewThreadWhiteboardAt,
  zoomOverviewThreadWhiteboardByWheel,
} from "./src/project/overview-thread-whiteboard-transform.ts";

const BOUNDS: OverviewThreadWhiteboardBounds = {
  viewport: { width: 800, height: 600 },
  content: { x: 0, y: 0, width: 1000, height: 800 },
  padding: 50,
  minScale: 0.4,
  maxScale: 3,
};

Deno.test("whiteboard transforms normalise invalid values and scale deterministically", () => {
  assertEquals(
    normalizeOverviewThreadWhiteboardTransform(
      { x: Number.NaN, y: Number.NEGATIVE_INFINITY, k: 0 },
      { minScale: 0.4, maxScale: 3 },
    ),
    { x: 0, y: 0, k: 0.4 },
  );
  assertEquals(
    normalizeOverviewThreadWhiteboardTransform(
      { x: -0, y: 1 / 3, k: Number.POSITIVE_INFINITY },
      { minScale: 3, maxScale: 0.4 },
    ),
    { x: 0, y: 0.333333, k: 1 },
  );

  const input = { x: 12.34567891, y: -98.76543219, k: 1.23456789 };
  assertEquals(
    normalizeOverviewThreadWhiteboardTransform(input),
    normalizeOverviewThreadWhiteboardTransform(input),
  );
});

Deno.test("pointer-centred zoom preserves the exact world point below the pointer", () => {
  const transform = { x: -180, y: 42, k: 0.8 };
  const pointer = { x: 317, y: 211 };
  const worldBefore = viewportToWorld(pointer, transform);
  const zoomed = zoomOverviewThreadWhiteboardAt(
    transform,
    pointer,
    1.7,
    { minScale: 0.4, maxScale: 3 },
  );
  const worldAfter = viewportToWorld(pointer, zoomed);

  assertClose(worldBefore.x, worldAfter.x);
  assertClose(worldBefore.y, worldAfter.y);
  assertEquals(zoomed.k, 1.7);
});

Deno.test("wheel zoom uses canvas direction, scale bounds, and stable results", () => {
  const transform = { x: 0, y: 0, k: 1 };
  const pointer = { x: 200, y: 160 };
  const zoomedIn = zoomOverviewThreadWhiteboardByWheel(
    transform,
    pointer,
    -120,
    { minScale: 0.4, maxScale: 3 },
  );
  const zoomedOut = zoomOverviewThreadWhiteboardByWheel(
    transform,
    pointer,
    120,
    { minScale: 0.4, maxScale: 3 },
  );

  assert(zoomedIn.k > 1);
  assert(zoomedOut.k < 1);
  assertEquals(
    zoomedIn,
    zoomOverviewThreadWhiteboardByWheel(
      transform,
      pointer,
      -120,
      { minScale: 0.4, maxScale: 3 },
    ),
  );
  assertEquals(
    zoomOverviewThreadWhiteboardByWheel(
      transform,
      pointer,
      -1_000_000,
      { minScale: 0.4, maxScale: 3 },
    ).k,
    3,
  );
  assertEquals(
    zoomOverviewThreadWhiteboardByWheel(
      transform,
      pointer,
      1_000_000,
      { minScale: 0.4, maxScale: 3 },
    ).k,
    0.4,
  );
});

Deno.test("pan moves in viewport pixels and cannot lose large content beyond its margin", () => {
  assertEquals(
    panOverviewThreadWhiteboard(
      { x: -100, y: -100, k: 1 },
      { x: 25, y: -30 },
    ),
    { x: -75, y: -130, k: 1 },
  );
  assertEquals(
    panOverviewThreadWhiteboard(
      { x: -100, y: -100, k: 1 },
      { x: 10_000, y: 10_000 },
      BOUNDS,
    ),
    { x: 50, y: 50, k: 1 },
  );
  assertEquals(
    panOverviewThreadWhiteboard(
      { x: -100, y: -100, k: 1 },
      { x: -10_000, y: -10_000 },
      BOUNDS,
    ),
    { x: -250, y: -250, k: 1 },
  );
});

Deno.test("clamp centres content that is smaller than the fixed viewport", () => {
  const bounds: OverviewThreadWhiteboardBounds = {
    viewport: { width: 800, height: 600 },
    content: { x: 100, y: 50, width: 400, height: 200 },
    padding: 50,
  };
  assertEquals(
    clampOverviewThreadWhiteboardTransform(
      { x: 10_000, y: -10_000, k: 1 },
      bounds,
    ),
    { x: 100, y: 150, k: 1 },
  );
});

Deno.test("fit accounts for content origin, viewport padding, and configured scale bounds", () => {
  const bounds: OverviewThreadWhiteboardBounds = {
    viewport: { width: 800, height: 600 },
    content: { x: 100, y: 50, width: 1000, height: 400 },
    padding: 50,
    minScale: 0.4,
    maxScale: 3,
  };
  assertEquals(fitOverviewThreadWhiteboardTransform(bounds), {
    x: -20,
    y: 125,
    k: 0.7,
  });

  assertEquals(
    fitOverviewThreadWhiteboardTransform({
      ...bounds,
      minScale: 0.9,
    }).k,
    0.9,
  );
});

Deno.test("scene bounds include off-graph viewers in every direction", () => {
  assertEquals(
    unionOverviewThreadWhiteboardRects([
      { x: 0, y: 0, width: 1_000, height: 600 },
      { x: -720, y: 120, width: 320, height: 240 },
      { x: 1_450, y: -500, width: 400, height: 300 },
    ]),
    { x: -720, y: -500, width: 2_570, height: 1_100 },
  );
});

Deno.test("sparse scene fit ignores the nominal infinite-canvas frame", () => {
  assertEquals(
    overviewThreadWhiteboardContentBounds(
      { width: 1_000, height: 560 },
      [
        { x: 280, y: 210, width: 80, height: 70 },
        { x: 490, y: 230, width: 60, height: 50 },
      ],
    ),
    { x: 280, y: 210, width: 270, height: 70 },
  );
  assertEquals(
    overviewThreadWhiteboardContentBounds(
      { width: 1_000, height: 560 },
      [],
    ),
    { x: 0, y: 0, width: 1_000, height: 560 },
  );
});

Deno.test("reset returns identity when possible and a constrained centred view otherwise", () => {
  assertEquals(resetOverviewThreadWhiteboardTransform(), {
    x: 0,
    y: 0,
    k: 1,
  });
  assertEquals(resetOverviewThreadWhiteboardTransform(BOUNDS), {
    x: 0,
    y: 0,
    k: 1,
  });
  assertEquals(
    resetOverviewThreadWhiteboardTransform({
      viewport: { width: 800, height: 600 },
      content: { x: 0, y: 0, width: 300, height: 200 },
      padding: 50,
    }),
    { x: 250, y: 200, k: 1 },
  );
});

Deno.test("invalid transient geometry preserves a finite scale-clamped transform", () => {
  assertEquals(
    fitOverviewThreadWhiteboardTransform({
      viewport: { width: 0, height: 600 },
      content: { x: 0, y: 0, width: 1000, height: 800 },
      minScale: 0.4,
      maxScale: 3,
    }),
    { x: 0, y: 0, k: 1 },
  );
});

function viewportToWorld(
  point: OverviewThreadWhiteboardPoint,
  transform: OverviewThreadWhiteboardTransform,
): OverviewThreadWhiteboardPoint {
  return {
    x: (point.x - transform.x) / transform.k,
    y: (point.y - transform.y) / transform.k,
  };
}

function assertClose(actual: number, expected: number): void {
  assert(
    Math.abs(actual - expected) <= 0.000002,
    `${actual} is not close to ${expected}`,
  );
}
