import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertLess,
  assertThrows,
} from "@std/assert";
import {
  buildOverviewThreadD3CableFieldRoute,
  type OverviewThreadD3CableObstacle,
  overviewThreadD3CablePolylineClear,
  overviewThreadD3CableSegmentVisible,
  overviewThreadD3CableSvgPathClear,
  sampleOverviewThreadD3CableSvgPath,
} from "./src/project/overview-thread-d3-cable-field.ts";

const EPSILON = 1e-9;

Deno.test("cable field leaves a visible direct edge on its shortest chord", () => {
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 5, y: 8 },
    { x: 205, y: 68 },
    [],
  );
  const chord = Math.hypot(200, 60);

  assertEquals(route.curve, "catmull-rom");
  assertEquals(route.points, [{ x: 5, y: 8 }, { x: 205, y: 68 }]);
  assertEquals(
    route.topologySignature,
    "cable-field/v1|direct|fan:0:0|curve:catmull-rom:1",
  );
  assertLess(polylineLength(route.points), chord * 1.01);
  assert(route.d.startsWith("M5,8L205,68"));
});

Deno.test("cable field selects a short stable side around one hull", () => {
  const obstacle = rectangle("hull", 65, 95, -15, 15);
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    [obstacle],
  );

  assert(route.topologySignature.includes("hull:below"));
  assertEquals(route.curve, "catmull-rom");
  assert(route.d.includes("C"));
  assert(route.points.some((point) => point.y > obstacle.maximumY));
  assertLess(polylineLength(route.points), 160 * 1.25);
  assertLess(Math.max(...route.points.map((point) => Math.abs(point.y))), 50);
  assert(overviewThreadD3CablePolylineClear(route.points, [obstacle]));
  assert(overviewThreadD3CableSvgPathClear(route.d, [obstacle]));
});

Deno.test("cable field finds a local route around several hulls, not a global outer bus", () => {
  const obstacles = [
    rectangle("first", 50, 90, -18, 14),
    rectangle("second", 125, 165, -12, 24),
  ];
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    obstacles,
  );

  assert(overviewThreadD3CablePolylineClear(route.points, obstacles));
  assert(overviewThreadD3CableSvgPathClear(route.d, obstacles));
  assertEquals(route.curve, "catmull-rom");
  assert(route.d.includes("C"));
  assertLess(polylineLength(route.points), 220 * 1.35);
  assertLess(
    Math.max(...route.points.map((point) => Math.abs(point.y))),
    60,
    "The router must not escape to an arbitrary page-wide bus",
  );
});

Deno.test("overlapping stacked hulls fail explicitly without an outer bus", () => {
  // This arrangement leaves a narrow approach to the target, but overlapping
  // inflated rectangles hide all useful individual offset corners. The local
  // corner graph is disconnected even though the finite union is not a cage.
  const obstacles = [
    rectangle("o0", 150, 254, -95, 49),
    rectangle("o1", 202, 330, 6, 169),
    rectangle("o2", 176, 282, 89, 248),
    rectangle("o3", 207, 333, -129, 1),
    rectangle("o4", 159, 232, -25, 94),
    rectangle("o5", 206, 258, 34, 156),
    rectangle("o6", 36, 138, -66, 41),
    rectangle("o7", 169, 205, -45, 35),
    rectangle("o8", 145, 181, 8, 137),
    rectangle("o9", 51, 111, 10, 58),
  ];
  for (const input of [obstacles, obstacles.toReversed()]) {
    assertThrows(
      () =>
        buildOverviewThreadD3CableFieldRoute(
          { x: 0, y: 0 },
          { x: 320, y: 5 },
          input,
        ),
      Error,
      "No obstacle-safe Catmull-Rom route exists",
    );
  }
});

Deno.test("actual D3 Catmull-Rom cubic samples remain outside the inflated hull", () => {
  const obstacle = rectangle("sampled", 65, 95, -15, 15);
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    [obstacle],
  );
  const samples = sampleOverviewThreadD3CableSvgPath(route.d, 0.04);

  assertEquals(route.curve, "catmull-rom");
  assert(route.d.includes("C"), "The obstacle route needs a real cubic");
  assert(samples.length > route.points.length);
  assert(overviewThreadD3CablePolylineClear(samples, [obstacle]));
  for (let index = 1; index < samples.length; index++) {
    assert(
      overviewThreadD3CableSegmentVisible(
        samples[index - 1]!,
        samples[index]!,
        [obstacle],
      ),
      `Rendered cubic sample ${index} intersects the hull`,
    );
  }
});

Deno.test("obstacle order cannot change route bytes or topology", () => {
  const obstacles = [
    rectangle("zeta", 125, 165, -12, 24),
    rectangle("alpha", 50, 90, -18, 14),
  ];
  const forward = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    obstacles,
  );
  const reversed = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 220, y: 0 },
    obstacles.toReversed(),
  );

  assertEquals(forward, reversed);
});

Deno.test("fixed endpoints remain exact and caller inputs stay untouched", () => {
  const source = { x: 0, y: 0 };
  const target = { x: 160, y: 0 };
  const obstacles = [rectangle("immutable", 65, 95, -15, 15)];
  const before = structuredClone({ source, target, obstacles });
  const route = buildOverviewThreadD3CableFieldRoute(
    source,
    target,
    obstacles,
  );

  assertEquals(route.points[0], source);
  assertEquals(route.points.at(-1), target);
  assertAlmostEquals(route.points[0]!.x, 0, EPSILON);
  assertAlmostEquals(route.points.at(-1)!.x, 160, EPSILON);
  assertEquals({ source, target, obstacles }, before);
});

Deno.test("relaxed cable coordinates are finite and particle count is bounded", () => {
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: -40, y: 15 },
    { x: 420, y: -10 },
    [
      rectangle("one", 40, 90, -20, 30),
      rectangle("two", 150, 205, -30, 20),
      rectangle("three", 275, 330, -15, 35),
    ],
    { maxParticles: 12 },
  );

  assert(route.points.length >= 4);
  assert(route.points.length <= 12);
  assert(
    route.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  );
  assert(!/[Nn]a[Nn]|Infinity/.test(route.d));
});

Deno.test("a small endpoint drag keeps the same obstacle-side topology", () => {
  const obstacles = [rectangle("drag-hull", 65, 95, -18, 12)];
  const first = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 160, y: 7 },
    obstacles,
  );
  const dragged = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 161, y: 8 },
    obstacles,
  );

  assertEquals(first.topologySignature, dragged.topologySignature);
  assertLess(
    meanMatchedDisplacement(first.points, dragged.points),
    8,
    "A one-unit drag should retension the same cable, not flip its route",
  );
});

Deno.test("feeder tangent guards make fan-in gradual without moving endpoints", () => {
  const obstacle = rectangle("fan-hull", 65, 95, -15, 15);
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    [obstacle],
    {
      sourceTangentTarget: { x: 40, y: 0 },
      targetTangentSource: { x: 120, y: 0 },
      endpointGuardCount: 2,
      endpointGuardLength: 28,
    },
  );

  assert(route.topologySignature.includes("|fan:2:2|curve:catmull-rom:"));
  assertEquals(route.points[0], { x: 0, y: 0 });
  assertEquals(route.points.at(-1), { x: 160, y: 0 });
  assert(route.points.length >= 6);
  assert(
    route.points[1]!.x > route.points[0]!.x &&
      route.points[1]!.y < 6,
    "The source branch must depart along the requested common tangent",
  );
  assert(
    route.points.at(-2)!.x < route.points.at(-1)!.x &&
      route.points.at(-2)!.y < 6,
    "The target branch must arrive progressively along its tangent",
  );
  assert(overviewThreadD3CableSvgPathClear(route.d, [obstacle]));
});

Deno.test("tight geometry retries until it yields a safe Catmull-Rom curve", () => {
  const obstacle = rectangle("tight", 65, 95, -15, 15);
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 160, y: 0 },
    [obstacle],
    { cornerClearance: 0.25, tickCount: 200 },
  );

  assertEquals(route.curve, "catmull-rom");
  assert(route.d.includes("C"));
  assert(overviewThreadD3CablePolylineClear(route.points, [obstacle]));
  assert(overviewThreadD3CableSvgPathClear(route.d, [obstacle]));
});

Deno.test("visibility graph and fixed D3 ticks remain practical for many hulls", () => {
  const obstacles = Array.from({ length: 24 }, (_, index) =>
    rectangle(
      `hull-${String(index).padStart(2, "0")}`,
      30 + index * 26,
      42 + index * 26,
      -9 - index % 3,
      11 + index % 4,
    ));
  const started = performance.now();
  const route = buildOverviewThreadD3CableFieldRoute(
    { x: 0, y: 0 },
    { x: 680, y: 0 },
    obstacles,
  );
  const duration = performance.now() - started;

  assertLess(duration, 1_000, `Routing took ${duration.toFixed(1)} ms`);
  assert(route.points.length <= 12);
  assert(overviewThreadD3CableSvgPathClear(route.d, obstacles));
});

function rectangle(
  key: string,
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
): OverviewThreadD3CableObstacle {
  return { key, minimumX, maximumX, minimumY, maximumY };
}

function polylineLength(
  points: readonly { readonly x: number; readonly y: number }[],
): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
  }
  return length;
}

function meanMatchedDisplacement(
  left: readonly { readonly x: number; readonly y: number }[],
  right: readonly { readonly x: number; readonly y: number }[],
): number {
  const count = Math.min(left.length, right.length);
  let sum = 0;
  for (let index = 0; index < count; index++) {
    sum += Math.hypot(
      left[index]!.x - right[index]!.x,
      left[index]!.y - right[index]!.y,
    );
  }
  return sum / Math.max(1, count);
}
