import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  overviewThreadD3CablePolylineClear,
  overviewThreadD3CableSvgPathClear,
} from "./src/project/overview-thread-d3-cable-field.ts";
import { buildOverviewThreadD3JointCorridor } from "./src/project/overview-thread-d3-joint-corridor.ts";

Deno.test("joint corridor keeps exact trajectories distinct while bundling them progressively", () => {
  const trajectories = [-30, 0, 30].map((y, index) => ({
    key: `edge-${index}`,
    bundleKey: "requirements-to-geometry",
    sourceAnchor: { x: 0, y },
    sourceTangent: { x: 1, y: 0 },
    targetAnchor: { x: 300, y: y * 0.5 },
    targetTangent: { x: 1, y: 0 },
  }));
  const result = buildOverviewThreadD3JointCorridor({
    trajectories,
    ticks: 36,
  });

  assertEquals(result.routes.size, trajectories.length);
  for (const trajectory of trajectories) {
    const route = result.routes.get(trajectory.key);
    assert(route);
    assertEquals(route.key, trajectory.key);
    assertEquals(route.points[0], trajectory.sourceAnchor);
    assertEquals(route.points.at(-1), trajectory.targetAnchor);
    assert(route.d.startsWith("M") && route.d.includes("C"));
    assertEquals(/[LQAS]/.test(route.d), false);
  }
});

Deno.test(
  "joint corridor keeps an individual cubic around overlapping 112-wide hulls",
  () => {
    const obstacles = [
      rectangle("foreign-requirement", 479.322, 615.322, 224.432, 282.432),
      rectangle("foreign-model", 483.322, 619.322, 227.432, 285.432),
      rectangle("foreign-physics", 487.322, 623.322, 230.432, 288.432),
      rectangle("foreign-verdict", 491.322, 627.322, 233.432, 291.432),
    ];
    const source = { x: 486, y: 159 };
    const target = { x: 486, y: 315 };
    const result = buildOverviewThreadD3JointCorridor({
      trajectories: [{
        key: "trace:local-cable",
        bundleKey: "same-lane",
        sourceAnchor: source,
        sourceTangent: { x: 0, y: 1 },
        targetAnchor: target,
        targetTangent: { x: 0, y: 1 },
      }],
      obstacles,
    });
    const reversed = buildOverviewThreadD3JointCorridor({
      trajectories: [{
        key: "trace:local-cable",
        bundleKey: "same-lane",
        sourceAnchor: source,
        sourceTangent: { x: 0, y: 1 },
        targetAnchor: target,
        targetTangent: { x: 0, y: 1 },
      }],
      obstacles: obstacles.toReversed(),
    });
    const route = result.routes.get("trace:local-cable");
    assert(route);
    assertEquals(route.points[0], source);
    assertEquals(route.points.at(-1), target);
    assertEquals(route.points.length, 8);
    assert(route.d.includes("C") && !/[LQAS]/.test(route.d));
    assert(overviewThreadD3CablePolylineClear(route.points, obstacles));
    assert(overviewThreadD3CableSvgPathClear(route.d, obstacles));
    assertEquals(result, reversed);
    assert(
      route.points.every((point) =>
        point.x >= source.x - 40 && point.x <= source.x + 40
      ),
      "The local return must stay near its hubs, not escape as an outer bus",
    );
  },
);

Deno.test(
  "joint corridor exposes a polyline that clears the same hull as its cubic",
  () => {
    const obstacle = rectangle("blocking-hull", 232, 368, 133, 191);
    const source = { x: 176, y: 167 };
    const target = { x: 424, y: 167 };
    const result = buildOverviewThreadD3JointCorridor({
      trajectories: [{
        key: "obstacle-edge",
        bundleKey: "cross-lane",
        sourceAnchor: source,
        sourceTangent: { x: 1, y: 0 },
        targetAnchor: target,
        targetTangent: { x: 1, y: 0 },
      }],
      obstacles: [obstacle],
    });
    const route = result.routes.get("obstacle-edge");
    assert(route);
    assertEquals(route.points[0], source);
    assertEquals(route.points.at(-1), target);
    assertEquals(route.points.length, 8);
    assert(route.d.includes("C") && !/[LQAS]/.test(route.d));
    assert(
      overviewThreadD3CablePolylineClear(route.points, [obstacle]),
      "Exposed control-point chords must clear the inflated hull",
    );
    assert(
      overviewThreadD3CableSvgPathClear(route.d, [obstacle]),
      "The rendered cubic must remain clear of the inflated hull",
    );
  },
);

Deno.test(
  "joint corridor still fails closed when overlapping hulls hide local corners",
  () => {
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
    assertThrows(
      () =>
        buildOverviewThreadD3JointCorridor({
          trajectories: [{
            key: "blocked",
            bundleKey: "blocked",
            sourceAnchor: { x: 0, y: 0 },
            sourceTangent: { x: 1, y: 0 },
            targetAnchor: { x: 320, y: 5 },
            targetTangent: { x: 1, y: 0 },
          }],
          obstacles,
        }),
      Error,
    );
  },
);

function rectangle(
  key: string,
  minimumX: number,
  maximumX: number,
  minimumY: number,
  maximumY: number,
) {
  return { key, minimumX, maximumX, minimumY, maximumY };
}
