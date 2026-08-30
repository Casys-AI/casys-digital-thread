import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildOverviewThreadViewerConnectorGeometry,
  clampOverviewThreadViewerGeometry,
  nearestOverviewThreadViewerAttachmentPoint,
  normalizeOverviewThreadViewerGeometry,
  type OverviewThreadViewerGeometryBounds,
  overviewThreadViewerScreenDeltaToWorld,
  overviewThreadViewerScreenPointToWorld,
  resizeOverviewThreadViewerByScreenDelta,
} from "./src/project/overview-thread-viewer-geometry.ts";

const BOUNDS: OverviewThreadViewerGeometryBounds = {
  worldSize: { width: 1_200, height: 800 },
  padding: 24,
  minWidth: 260,
  minHeight: 180,
};

Deno.test("viewer screen coordinates convert to stable world coordinates under pan and zoom", () => {
  assertEquals(
    overviewThreadViewerScreenPointToWorld(
      { x: 350, y: 175 },
      { x: -150, y: 25, k: 0.5 },
    ),
    { x: 1_000, y: 300 },
  );
  assertEquals(
    overviewThreadViewerScreenDeltaToWorld(
      { x: 25, y: -10 },
      { x: 4_000, y: -9_000, k: 0.5 },
    ),
    { x: 50, y: -20 },
  );
});

Deno.test("viewer geometry respects padded world bounds and configurable minima", () => {
  assertEquals(
    clampOverviewThreadViewerGeometry(
      { x: 1_100, y: -50, width: 100, height: 900 },
      BOUNDS,
    ),
    { x: 916, y: 24, width: 260, height: 752 },
  );
  assertEquals(
    clampOverviewThreadViewerGeometry(
      { x: 100, y: 80, width: 440, height: 320 },
      BOUNDS,
    ),
    { x: 100, y: 80, width: 440, height: 320 },
  );
});

Deno.test("viewer geometry degrades deterministically in tiny or unavailable worlds", () => {
  assertEquals(
    clampOverviewThreadViewerGeometry(
      { x: 99, y: -4, width: 300, height: 200 },
      {
        worldSize: { width: 100, height: 80 },
        padding: 20,
        minWidth: 260,
        minHeight: 180,
      },
    ),
    { x: 20, y: 20, width: 60, height: 40 },
  );
  assertEquals(
    clampOverviewThreadViewerGeometry(
      { x: 99, y: -4, width: 300, height: 200 },
      { worldSize: { width: 0, height: Number.NaN } },
    ),
    { x: 0, y: 0, width: 0, height: 0 },
  );
});

Deno.test("viewer geometry stays finite without being confined to the graph world", () => {
  assertEquals(
    normalizeOverviewThreadViewerGeometry(
      { x: -2_400, y: 3_600, width: 90, height: 70 },
      { minWidth: 260, minHeight: 210 },
    ),
    { x: -2_400, y: 3_600, width: 260, height: 210 },
  );
  assertEquals(
    normalizeOverviewThreadViewerGeometry({
      x: Number.POSITIVE_INFINITY,
      y: Number.NEGATIVE_INFINITY,
      width: Number.NaN,
      height: Number.POSITIVE_INFINITY,
    }),
    { x: 0, y: 0, width: 260, height: 180 },
  );
});

Deno.test("south-east viewer resize divides pointer movement by zoom and keeps origin fixed", () => {
  assertEquals(
    resizeOverviewThreadViewerByScreenDelta(
      { x: 100, y: 80, width: 400, height: 300 },
      { x: 50, y: -30 },
      { x: -900, y: 400, k: 0.5 },
      BOUNDS,
    ),
    { x: 100, y: 80, width: 500, height: 240 },
  );
  assertEquals(
    resizeOverviewThreadViewerByScreenDelta(
      { x: 900, y: 650, width: 276, height: 126 },
      { x: 5_000, y: 5_000 },
      { x: 0, y: 0, k: 2 },
      BOUNDS,
    ),
    { x: 900, y: 596, width: 276, height: 180 },
  );
  assertEquals(
    resizeOverviewThreadViewerByScreenDelta(
      { x: -900, y: 1_400, width: 400, height: 300 },
      { x: 250, y: 100 },
      { x: 12_000, y: -7_000, k: 0.5 },
      { minWidth: 260, minHeight: 210 },
    ),
    { x: -900, y: 1_400, width: 900, height: 500 },
  );
});

Deno.test("viewer attachment chooses the nearest edge and avoids rounded corners", () => {
  const viewer = { x: 300, y: 200, width: 400, height: 300 };
  assertEquals(
    nearestOverviewThreadViewerAttachmentPoint(
      { x: 80, y: 310 },
      viewer,
    ),
    { edge: "left", x: 300, y: 310 },
  );
  assertEquals(
    nearestOverviewThreadViewerAttachmentPoint(
      { x: 760, y: 100 },
      viewer,
    ),
    { edge: "top", x: 682, y: 200 },
  );
  assertEquals(
    nearestOverviewThreadViewerAttachmentPoint(
      { x: 520, y: 700 },
      viewer,
    ),
    { edge: "bottom", x: 520, y: 500 },
  );
});

Deno.test("viewer connector is a deterministic D3 bump from the exact supplied anchor", () => {
  const first = buildOverviewThreadViewerConnectorGeometry(
    { x: 100, y: 320 },
    { x: 400, y: 200, width: 440, height: 320 },
  );
  const second = buildOverviewThreadViewerConnectorGeometry(
    { x: 100, y: 320 },
    { x: 400, y: 200, width: 440, height: 320 },
  );

  assertEquals(first, second);
  assertEquals(first.source, { x: 100, y: 320 });
  assertEquals(first.target, { edge: "left", x: 400, y: 320 });
  assert(first.d.startsWith("M100,320"));
  assertStringIncludes(first.d, "C");
  assert(first.d.endsWith("400,320"));
});
