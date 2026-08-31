import { assert, assertEquals } from "@std/assert";
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
