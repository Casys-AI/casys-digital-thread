import { assert, assertEquals } from "@std/assert";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowNodeInput,
  rememberOverviewThreadHullPositions,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import { OVERVIEW_THREAD_HULL_SEPARATION_GAP } from "./src/project/overview-thread-hull-physics.ts";
import { overviewThreadD3CableSvgPathClear } from "./src/project/overview-thread-d3-cable-field.ts";

const nodes: OverviewThreadD3FlowNodeInput[] = [
  { key: "root", label: "Assembly", lane: "geometry", groupKey: "assembly" },
  {
    key: "module",
    label: "Module",
    parentKey: "root",
    lane: "geometry",
    groupKey: "assembly",
  },
  {
    key: "part",
    label: "Part",
    parentKey: "module",
    lane: "geometry",
    groupKey: "assembly",
  },
  {
    key: "other",
    label: "Other module",
    parentKey: "root",
    lane: "geometry",
    groupKey: "assembly",
  },
  { key: "proof", label: "Proof", lane: "physics", groupKey: "proof" },
  { key: "result", label: "Result", lane: "verdicts", groupKey: "result" },
];
const edges: OverviewThreadD3FlowEdgeInput[] = [
  ["root", "module"],
  ["module", "part"],
  ["root", "other"],
  ["root", "proof"],
  ["proof", "result"],
].map(([fromKey, toKey]) => ({
  key: `${fromKey}->${toKey}`,
  fromKey,
  toKey,
  pathCount: 1,
  pathKeys: [`${fromKey}->${toKey}`],
  emphasis: false,
}));
const groupKey = overviewThreadD3FlowGroupIdentity("geometry", "assembly");

Deno.test("rack cables retain all identities and clear visible rows across list and tree scroll windows", () => {
  const rackNodes = Array.from(
    { length: 33 },
    (_, i) => ({
      key: `part-${i}`,
      label: `Part ${i}`,
      lane: "geometry" as const,
      groupKey: "rack",
      ...(i > 0 ? { parentKey: "part-0" } : {}),
    }),
  );
  const rackEdges = rackNodes.slice(1).map((node, i) => ({
    key: `edge-${i}`,
    fromKey: `part-${i}`,
    toKey: node.key,
    pathCount: 1,
    pathKeys: [`edge-${i}`],
    emphasis: false,
  }));
  for (const view of ["list", "tree"] as const) {
    for (const width of [300, 620]) {
      for (const scrollRow of [0, 5, 100]) {
        const layout = buildOverviewThreadD3FlowLayout(rackNodes, rackEdges, {
          avoidGroupOverlap: true,
          groupPlacements: {
            [overviewThreadD3FlowGroupIdentity("geometry", "rack")]: {
              view,
              width,
              height: 170,
              scrollRow,
            },
          },
        });
        assertEquals(layout.unroutedEdgeKeys, [], `${view} ${width} ${scrollRow}`);
        assertEquals(layout.routes.length, rackEdges.length);
        const hull = layout.groups[0];
        for (const node of layout.nodes) {
          assert(node.x >= hull.x && node.x + node.width <= hull.x + hull.width);
          assert(node.y >= hull.y && node.y + node.height <= hull.y + hull.height);
        }
        for (const segment of layout.segments) {
          const endpoints = new Set([...segment.fromKeys, ...segment.toKeys]);
          const obstacles = layout.nodes.filter((n) =>
            !n.folded && !endpoints.has(n.key)
          ).map((n) => ({
            key: n.key,
            minimumX: n.x,
            maximumX: n.x + n.width,
            minimumY: n.y,
            maximumY: n.y + n.height,
          }));
          assert(
            overviewThreadD3CableSvgPathClear(segment.d, obstacles),
            `${view} ${width} ${scrollRow} ${segment.key}`,
          );
        }
      }
    }
  }
});

Deno.test("hull layout pushes neighbors before routing and remembers the settled positions", () => {
  const placements = {
    [groupKey]: {
      x: 400,
      y: 250,
      width: 450,
      height: 300,
      view: "tree" as const,
    },
    [overviewThreadD3FlowGroupIdentity("physics", "proof")]: { x: 650, y: 300 },
    [overviewThreadD3FlowGroupIdentity("verdicts", "result")]: {
      x: 820,
      y: 300,
    },
  };
  const layout = buildOverviewThreadD3FlowLayout(nodes, edges, {
    avoidGroupOverlap: true,
    fixedGroupKey: groupKey,
    groupPlacements: placements,
  });
  assertEquals(layout.unroutedEdgeKeys, []);
  assertEquals(
    layout.routes.map((r) => r.edgeKey).toSorted(),
    edges.map((e) => e.key).toSorted(),
  );
  const fixed = layout.groups.find((g) => g.key === groupKey)!;
  assertEquals([fixed.x, fixed.y], [400, 250]);
  const gap = OVERVIEW_THREAD_HULL_SEPARATION_GAP;
  for (const [index, a] of layout.groups.entries()) {
    for (const b of layout.groups.slice(index + 1)) {
      assert(
        a.x >= b.x + b.width + gap || b.x >= a.x + a.width + gap ||
          a.y >= b.y + b.height + gap || b.y >= a.y + a.height + gap,
      );
    }
    assertEquals(a.outHub.x, a.x + a.width + 20);
    assertEquals(a.topHub.y, a.y - 20);
    for (const node of layout.nodes.filter((n) => a.nodeKeys.includes(n.key))) {
      assert(node.x >= a.x && node.x + node.width <= a.x + a.width);
      assert(node.y >= a.y && node.y + node.height <= a.y + a.height);
      assertEquals(node.leftPort.x, node.x);
      assertEquals(node.rightPort.x, node.x + node.width);
    }
  }
  const remembered = rememberOverviewThreadHullPositions(
    placements,
    layout.groups,
  );
  const replay = buildOverviewThreadD3FlowLayout(nodes, edges, {
    avoidGroupOverlap: true,
    fixedGroupKey: groupKey,
    groupPlacements: remembered,
  });
  assertEquals(replay, layout);
  assert(
    rememberOverviewThreadHullPositions(remembered, replay.groups) ===
      remembered,
  );
  assertEquals(placements[groupKey].x, 400);
});

Deno.test("hull tree retains parent-first levels and widens a single readable column", () => {
  const layout = buildOverviewThreadD3FlowLayout(nodes.toReversed(), [], {
    groupPlacements: {
      [groupKey]: { view: "tree", width: 620, height: 260, sort: "name" },
    },
  });
  const group = layout.groups.find((g) => g.key === groupKey)!;
  assertEquals(group.promotedKey, "root");
  assertEquals(group.columns, 1);
  assertEquals(group.width, 620);
  const rows = layout.nodes.filter((n) => n.groupKey === "assembly" && !n.folded)
    .toSorted((a, b) => a.y - b.y);
  assertEquals(rows.map((n) => [n.key, n.depth]), [["module", 0], ["part", 1], [
    "other",
    0,
  ]]);
  assert(rows[1].x > rows[0].x);
  assertEquals(rows[1].rightPort.x, rows[0].rightPort.x);
  assertEquals(group.rowCount, 3);
  assertEquals(layout.nodes.length, nodes.length);
});

Deno.test("hull tree never promotes an unrelated root over a disconnected cycle", () => {
  const cyclic: OverviewThreadD3FlowNodeInput[] = [
    { key: "alone", label: "Alone", lane: "geometry", groupKey: "cycle" },
    {
      key: "a",
      label: "A",
      parentKey: "b",
      lane: "geometry",
      groupKey: "cycle",
    },
    {
      key: "b",
      label: "B",
      parentKey: "a",
      lane: "geometry",
      groupKey: "cycle",
    },
  ];
  const key = overviewThreadD3FlowGroupIdentity("geometry", "cycle");
  const layout = buildOverviewThreadD3FlowLayout(cyclic, [], {
    groupPlacements: { [key]: { view: "tree" } },
  });
  assertEquals(layout.groups[0].promotedKey, undefined);
  assertEquals(layout.nodes.map((n) => n.key).toSorted(), ["a", "alone", "b"]);
  assertEquals(layout.nodes.filter((n) => !n.folded).length, 3);
});

Deno.test("hull position remembering consumes old offsets once without moving them twice", () => {
  const placements = {
    a: {
      x: 10,
      y: 20,
      offsetX: 5,
      offsetY: -4,
      width: 260,
      view: "tree" as const,
    },
  };
  const remembered = rememberOverviewThreadHullPositions(placements, [{
    key: "a",
    x: 15,
    y: 16,
  }]);
  assertEquals(remembered.a, {
    x: 15,
    y: 16,
    offsetX: 0,
    offsetY: 0,
    width: 260,
    view: "tree",
  });
  assert(
    rememberOverviewThreadHullPositions(remembered, [{
      key: "a",
      x: 15,
      y: 16,
    }]) === remembered,
  );
});
