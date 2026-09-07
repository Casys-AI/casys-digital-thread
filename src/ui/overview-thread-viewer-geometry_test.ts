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
  separateOverviewThreadInitialViewer,
  separateOverviewThreadViewers,
} from "./src/project/overview-thread-viewer-geometry.ts";

const BOUNDS: OverviewThreadViewerGeometryBounds = {
  worldSize: { width: 1_200, height: 800 },
  padding: 24,
  minWidth: 260,
  minHeight: 180,
};

Deno.test("viewer repulsion keeps the dragged window fixed and pushes a whole chain", () => {
  const windows = [0, 1, 2].map((index) => ({
    id: `viewer-${index}`,
    sessionId: `registered-${index}`,
    x: index * 644,
    y: 40,
    width: 620,
    height: 460,
    z: index,
  }));
  const moved = windows.map((window, index) =>
    index === 0 ? { ...window, x: 500 } : window
  );
  const before = structuredClone(moved);
  const settled = separateOverviewThreadViewers(moved, "viewer-0");
  assert(settled[0] === moved[0]);
  assertEquals(moved, before);
  assertEquals(
    settled.map((window) => [window.id, window.sessionId, window.z]),
    moved.map((window) => [window.id, window.sessionId, window.z]),
  );
  assertViewerWindowsSeparate(settled);
  assertEquals(separateOverviewThreadViewers(settled, "viewer-0"), settled);
});

Deno.test("resized and restored overlapping viewers separate without losing content geometry", () => {
  const windows = [
    { id: "cad", x: -600, y: -500, width: 950, height: 700 },
    { id: "brief", x: -150, y: -400, width: 620, height: 460 },
    { id: "module", x: 20, y: -350, width: 620, height: 460 },
  ];
  const resized = separateOverviewThreadViewers(windows, "cad");
  assert(resized[0] === windows[0]);
  assertViewerWindowsSeparate(resized);
  assertViewerWindowsSeparate(separateOverviewThreadViewers(windows));
  assertEquals(
    resized.map(({ width, height }) => ({ width, height })),
    windows.map(({ width, height }) => ({ width, height })),
  );
});

Deno.test("expanded viewer focus does not displace ordinary windows until restored", () => {
  const restoreGeometry = { x: 0, y: 0, width: 620, height: 460 };
  const expanded = {
    id: "cad",
    x: -200,
    y: -200,
    width: 1600,
    height: 1000,
    restoreGeometry,
  };
  const brief = { id: "brief", x: 200, y: 100, width: 620, height: 460 };
  const focused = separateOverviewThreadViewers([expanded, brief], "cad");
  assert(focused[0] === expanded);
  assert(focused[1] === brief);
  assertViewerWindowsSeparate(separateOverviewThreadViewers([
    { ...expanded, ...restoreGeometry, restoreGeometry: undefined },
    brief,
  ], "cad"));
});

function assertViewerWindowsSeparate(
  windows: readonly { x: number; y: number; width: number; height: number }[],
): void {
  for (const [index, left] of windows.entries()) {
    for (const right of windows.slice(index + 1)) {
      assert(
        !(left.x < right.x + right.width + 24 &&
          right.x < left.x + left.width + 24 &&
          left.y < right.y + right.height + 24 &&
          right.y < left.y + left.height + 24),
      );
    }
  }
}

Deno.test("automatic viewers open beside existing panels without moving them", () => {
  const brief = { x: 60, y: 100, width: 620, height: 460 };
  const drone = { x: 53, y: 260, width: 620, height: 460 };
  assertEquals(separateOverviewThreadInitialViewer(drone, [brief], 1388), {
    ...drone,
    x: 704,
  });
  assertEquals(brief, { x: 60, y: 100, width: 620, height: 460 });
  const free = { ...drone, y: 700 };
  assert(separateOverviewThreadInitialViewer(free, [brief], 1388) === free);
});

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
