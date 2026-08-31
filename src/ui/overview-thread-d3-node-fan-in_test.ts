import { assert, assertEquals, assertLess, assertThrows } from "@std/assert";
import {
  sampleOverviewThreadD3CableSvgPath,
} from "./src/project/overview-thread-d3-cable-field.ts";
import {
  buildOverviewThreadD3NodeFanIn,
  type OverviewThreadD3NodeFanInLeaf,
  reverseOverviewThreadD3NodeFanInRoute,
} from "./src/project/overview-thread-d3-node-fan-in.ts";

const JUNCTION = { x: 160, y: 35 } as const;
const TANGENT = { x: 1, y: 0 } as const;
const EPSILON = 1e-7;

Deno.test(
  "node fan-in gives eight leaves one ordered physical field before the gate",
  () => {
    const leaves = fanLeaves(8, 10);
    const routes = buildOverviewThreadD3NodeFanIn({
      junction: JUNCTION,
      trunkTangent: TANGENT,
      leaves,
    });

    assertEquals([...routes.keys()], leaves.map((leaf) => leaf.key));
    assertEquals(routes.size, 8);
    for (const leaf of leaves) {
      const route = routes.get(leaf.key)!;
      assertEquals(route.curve, "catmull-rom");
      assertEquals(route.points.length, 6);
      assertEquals(route.points[0], leaf.anchor);
      assertEquals(route.points.at(-1), JUNCTION);
      assert(route.d.includes("C"));
      assert(!/[LQAS]/.test(route.d));
      assert(
        dot(route.departureTangent, TANGENT) >= 0.995,
        `${leaf.key} must leave its node with the requested tangent`,
      );
      assert(
        dot(route.arrivalTangent, TANGENT) >= 0.995,
        `${leaf.key} must enter the gate with the shared trunk tangent`,
      );
    }

    const anchorSpread = spreadAtX(routes, 0);
    const earlySpread = spreadAtX(routes, 60);
    const lateSpread = spreadAtX(routes, 125);
    assert(
      earlySpread > anchorSpread * 0.5,
      "Leaves must remain individually legible through the first half",
    );
    assert(
      lateSpread < earlySpread * 0.45,
      "Normal-only attraction must progressively collect the leaves near the gate",
    );

    const orderedRoutes = [...routes.values()].toSorted((left, right) =>
      left.points[0]!.y - right.points[0]!.y
    );
    for (let x = 5; x <= 140; x += 5) {
      const transverse = orderedRoutes.map((route) => pathYAtX(route.d, x));
      for (let index = 1; index < transverse.length; index++) {
        assert(
          transverse[index]! > transverse[index - 1]! - EPSILON,
          `Leaf order crossed before the convergence zone at x=${x}`,
        );
      }
    }
    const arrivalPitch = 1.2;
    const tailStarts = orderedRoutes.map((route) => route.points[4]!);
    for (let index = 1; index < tailStarts.length; index++) {
      assert(
        Math.abs(
          tailStarts[index]!.y - tailStarts[index - 1]!.y - arrivalPitch,
        ) < 1e-6,
        "Combed arrival teeth must sit 1.2 units apart along the throat normal",
      );
      assert(
        Math.abs(tailStarts[index]!.x - tailStarts[0]!.x) < 1e-6,
        "Arrival teeth must share the same axial station before the gate",
      );
    }
  },
);

Deno.test(
  "node fan-in is byte-stable under leaf permutation and never mutates callers",
  () => {
    const leaves = fanLeaves(8, 10);
    const input = {
      junction: { ...JUNCTION },
      trunkTangent: { ...TANGENT },
      leaves: leaves.map((leaf) => ({
        ...leaf,
        anchor: { ...leaf.anchor },
        anchorTangent: { ...leaf.anchorTangent },
      })),
      obstacles: [
        {
          key: "far-hull",
          minimumX: 20,
          maximumX: 30,
          minimumY: 200,
          maximumY: 220,
        },
      ],
    };
    const snapshot = structuredClone(input);
    const baseline = buildOverviewThreadD3NodeFanIn(input);
    const permuted = buildOverviewThreadD3NodeFanIn({
      ...input,
      leaves: input.leaves.toReversed(),
      obstacles: input.obstacles.toReversed(),
    });

    assertEquals([...baseline], [...permuted]);
    assertEquals(input, snapshot);
  },
);

Deno.test(
  "moving one leaf retargets its own branch and gently influences the joint field",
  () => {
    const leaves = fanLeaves(8, 10);
    const baseline = buildOverviewThreadD3NodeFanIn({
      junction: JUNCTION,
      trunkTangent: TANGENT,
      leaves,
    });
    const movedLeaves = leaves.map((leaf) =>
      leaf.key === "node-02"
        ? { ...leaf, anchor: { x: leaf.anchor.x, y: leaf.anchor.y + 6 } }
        : leaf
    );
    const moved = buildOverviewThreadD3NodeFanIn({
      junction: JUNCTION,
      trunkTangent: TANGENT,
      leaves: movedLeaves,
    });

    assert(baseline.get("node-02")!.d !== moved.get("node-02")!.d);
    assertEquals(moved.get("node-02")!.points[0], { x: 0, y: 26 });
    assertEquals(moved.get("node-03")!.points[0], { x: 0, y: 30 });
    assert(
      distance(
        baseline.get("node-03")!.points[2]!,
        moved.get("node-03")!.points[2]!,
      ) > 0.01,
      "One shared simulation should let the neighboring field react softly",
    );
  },
);

Deno.test("node fan-in reversal preserves the exact cubic geometry", () => {
  const route = buildOverviewThreadD3NodeFanIn({
    junction: JUNCTION,
    trunkTangent: TANGENT,
    leaves: fanLeaves(1, 10),
  }).get("node-00")!;
  const reversed = reverseOverviewThreadD3NodeFanInRoute(route);

  assertEquals(reversed.points, route.points.toReversed());
  assertEquals(reversed.points[0], JUNCTION);
  assertEquals(reversed.points.at(-1), { x: 0, y: 0 });
  assert(reversed.d.includes("C"));
  assert(!/[LQAS]/.test(reversed.d));
  assert(dot(reversed.departureTangent, { x: -1, y: 0 }) >= 0.995);
  assert(dot(reversed.arrivalTangent, { x: -1, y: 0 }) >= 0.995);
  const sourceSamples = sampleOverviewThreadD3CableSvgPath(route.d);
  const reversedSamples = sampleOverviewThreadD3CableSvgPath(reversed.d);
  assertEquals(reversedSamples[0], sourceSamples.at(-1));
  assertEquals(reversedSamples.at(-1), sourceSamples[0]);
});

Deno.test(
  "node fan-in keeps one bounded six-particle chain for each of one hundred leaves",
  () => {
    const leaves = fanLeaves(100, 3);
    const startedAt = performance.now();
    const routes = buildOverviewThreadD3NodeFanIn({
      junction: { x: 300, y: 148.5 },
      trunkTangent: TANGENT,
      leaves,
    });
    const elapsed = performance.now() - startedAt;

    assertEquals(routes.size, 100);
    assertEquals(
      [...routes.values()].reduce((sum, route) => sum + route.points.length, 0),
      600,
    );
    assertLess(elapsed, 1_000, `100-leaf fan-in took ${elapsed.toFixed(1)}ms`);
  },
);

Deno.test("node fan-in fails explicitly when no safe cubic exists", () => {
  assertThrows(
    () =>
      buildOverviewThreadD3NodeFanIn({
        junction: JUNCTION,
        trunkTangent: TANGENT,
        leaves: fanLeaves(2, 10),
        obstacles: [{
          key: "blocked-gate",
          minimumX: 140,
          maximumX: 170,
          minimumY: 20,
          maximumY: 50,
        }],
      }),
    Error,
    "no safe Catmull-Rom fan-in route",
  );
});

function fanLeaves(
  count: number,
  spacing: number,
): OverviewThreadD3NodeFanInLeaf[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `node-${String(index).padStart(2, "0")}`,
    anchor: { x: 0, y: index * spacing },
    anchorTangent: { x: 1, y: 0 },
    weight: 1,
  }));
}

function spreadAtX(
  routes: ReadonlyMap<
    string,
    { readonly d: string }
  >,
  x: number,
): number {
  const values = [...routes.values()].map((route) => pathYAtX(route.d, x));
  return Math.max(...values) - Math.min(...values);
}

function pathYAtX(d: string, x: number): number {
  const samples = sampleOverviewThreadD3CableSvgPath(d, 0.08);
  for (let index = 1; index < samples.length; index++) {
    const left = samples[index - 1]!;
    const right = samples[index]!;
    const minimumX = Math.min(left.x, right.x) - EPSILON;
    const maximumX = Math.max(left.x, right.x) + EPSILON;
    if (x < minimumX || x > maximumX) continue;
    if (Math.abs(right.x - left.x) <= EPSILON) return (left.y + right.y) / 2;
    const ratio = (x - left.x) / (right.x - left.x);
    return left.y + (right.y - left.y) * ratio;
  }
  throw new Error(`Path has no sample crossing x=${x}`);
}

function dot(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  return left.x * right.x + left.y * right.y;
}

function distance(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}
