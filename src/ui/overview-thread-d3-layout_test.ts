import { assert, assertEquals } from "@std/assert";
import {
  buildOverviewThreadD3Layout,
  type OverviewThreadD3EdgeInput,
  type OverviewThreadD3NodeInput,
} from "./src/project/overview-thread-d3-layout.ts";

const REQUIREMENT_COUNT = 10;
const GEOMETRY_PART_COUNT = 50;
const PROJECTED_PATH_COUNT = REQUIREMENT_COUNT * GEOMETRY_PART_COUNT;

Deno.test(
  "D3 Overview layout preserves and deterministically bundles a 10 by 50 engineering thread",
  () => {
    const fixture = denseEngineeringThreadFixture();
    const layout = buildOverviewThreadD3Layout(fixture.nodes, fixture.edges);
    const reversed = buildOverviewThreadD3Layout(
      fixture.nodes.toReversed(),
      fixture.edges.toReversed(),
    );

    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout.nodes.length, REQUIREMENT_COUNT + GEOMETRY_PART_COUNT);
    assertEquals(layout.edges.length, PROJECTED_PATH_COUNT);

    const inputLabels = new Map(
      fixture.nodes.map((node) => [node.key, node.label]),
    );
    assertEquals(
      new Map(layout.nodes.map((node) => [node.key, node.label])),
      inputLabels,
    );

    assertEquals(
      layout.edges.reduce((count, edge) => count + edge.pathCount, 0),
      PROJECTED_PATH_COUNT,
    );
    const projectedPathKeys = layout.edges.flatMap((edge) => edge.pathKeys);
    assertEquals(projectedPathKeys.length, PROJECTED_PATH_COUNT);
    assertEquals(new Set(projectedPathKeys).size, PROJECTED_PATH_COUNT);

    for (const node of layout.nodes) {
      assert(
        [
          node.angle,
          node.radius,
          node.anchorX,
          node.anchorY,
          node.labelX,
          node.labelY,
        ].every(Number.isFinite),
        `Layout coordinates must be finite for ${node.key}`,
      );
      assert(node.leaderD.length > 0, `Missing label leader for ${node.key}`);
    }
    for (const edge of layout.edges) {
      assert(edge.d.length > 0, `Missing D3 route for ${edge.key}`);
      assert(
        edge.route.length > 2,
        `Bundled route needs hierarchy control points for ${edge.key}`,
      );
      assert(
        edge.route.every((point) =>
          Number.isFinite(point.x) && Number.isFinite(point.y)
        ),
        `Route coordinates must be finite for ${edge.key}`,
      );
    }

    assertEquals(normalizeLayout(layout), normalizeLayout(reversed));

    const first = layout.edges.find((edge) =>
      edge.fromKey === requirementKey(0) &&
      edge.toKey === geometryPartKey(0)
    );
    const second = layout.edges.find((edge) =>
      edge.fromKey === requirementKey(1) &&
      edge.toKey === geometryPartKey(11)
    );
    assert(first, "First reference route must be present");
    assert(second, "Second reference route must be present");
    const firstGroupPoints = new Set(
      first.route.filter((point) => point.kind === "group").map((point) => point.key),
    );
    const sharedGroupPoints = second.route.filter((point) =>
      point.kind === "group" && firstGroupPoints.has(point.key)
    );
    assert(
      sharedGroupPoints.length > 0,
      "Routes from distinct leaves in the same requirement group must share a bundling control point",
    );
  },
);

function denseEngineeringThreadFixture(): {
  readonly nodes: readonly OverviewThreadD3NodeInput[];
  readonly edges: readonly OverviewThreadD3EdgeInput[];
} {
  const requirements: OverviewThreadD3NodeInput[] = Array.from(
    { length: REQUIREMENT_COUNT },
    (_, index) => ({
      key: requirementKey(index),
      lane: "requirements",
      groupKey: `requirement-set:${Math.floor(index / 5)}`,
      label: `Scale requirement ${
        String(index + 1).padStart(2, "0")
      } — complete retained label`,
    }),
  );
  const geometryParts: OverviewThreadD3NodeInput[] = Array.from(
    { length: GEOMETRY_PART_COUNT },
    (_, index) => ({
      key: geometryPartKey(index),
      lane: "geometry",
      groupKey: `geometry-assembly:${Math.floor(index / 10)}`,
      label: `Scale geometry part ${
        String(index + 1).padStart(2, "0")
      } — complete retained label`,
    }),
  );
  const edges: OverviewThreadD3EdgeInput[] = requirements.flatMap(
    (requirement) =>
      geometryParts.map((part) => {
        const key = `trace:${requirement.key}>${part.key}`;
        return {
          key,
          fromKey: requirement.key,
          toKey: part.key,
          pathCount: 1,
          pathKeys: [key],
          emphasis: false,
        };
      }),
  );
  return { nodes: [...requirements, ...geometryParts], edges };
}

function normalizeLayout(
  layout: ReturnType<typeof buildOverviewThreadD3Layout>,
): unknown {
  return {
    viewBox: layout.viewBox,
    nodes: layout.nodes.toSorted((left, right) => left.key.localeCompare(right.key)),
    edges: layout.edges.toSorted((left, right) => left.key.localeCompare(right.key)),
    lanes: layout.lanes.toSorted((left, right) => left.lane.localeCompare(right.lane)),
    unroutedEdgeKeys: layout.unroutedEdgeKeys.toSorted(),
  };
}

function requirementKey(index: number): string {
  return `requirement:scale-${String(index + 1).padStart(2, "0")}`;
}

function geometryPartKey(index: number): string {
  return `artifact:scale-part-${String(index + 1).padStart(2, "0")}`;
}
