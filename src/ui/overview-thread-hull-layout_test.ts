import { assert, assertEquals } from "@std/assert";
import {
  buildOverviewThreadD3FlowLayout,
  nextHullViewPlacement,
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
        assertEquals(
          layout.unroutedEdgeKeys,
          [],
          `${view} ${width} ${scrollRow}`,
        );
        assertEquals(layout.routes.length, rackEdges.length);
        const hull = layout.groups[0];
        for (const node of layout.nodes) {
          assert(
            node.x >= hull.x && node.x + node.width <= hull.x + hull.width,
          );
          assert(
            node.y >= hull.y && node.y + node.height <= hull.y + hull.height,
          );
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
  const rows = layout.nodes.filter((n) =>
    n.groupKey === "assembly" && !n.folded
  )
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

function assemblyNodes(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
) {
  return layout.nodes.filter((node) => node.groupKey === "assembly");
}

function lastVisibleBottom(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
): number {
  return Math.max(
    ...assemblyNodes(layout).filter((node) => !node.folded).map((node) =>
      node.y + node.height
    ),
  );
}

Deno.test("switching modes on an already resized hull drops stale blank extent", () => {
  const resized = { x: 400, y: 250, width: 620, height: 400 };
  const layouts = {
    tree: buildOverviewThreadD3FlowLayout(nodes, edges, {
      avoidGroupOverlap: true,
      groupPlacements: { [groupKey]: { ...resized, view: "tree" } },
    }),
    list: buildOverviewThreadD3FlowLayout(nodes, edges, {
      avoidGroupOverlap: true,
      groupPlacements: { [groupKey]: { ...resized, view: "list" } },
    }),
    matrix: buildOverviewThreadD3FlowLayout(nodes, edges, {
      avoidGroupOverlap: true,
      groupPlacements: { [groupKey]: { ...resized, view: "matrix" } },
    }),
  };
  for (const [view, layout] of Object.entries(layouts)) {
    const hull = layout.groups.find((group) => group.key === groupKey)!;
    assertEquals(hull.x, 400, `${view} keeps the operator origin`);
    assertEquals(hull.y, 250, `${view} keeps the operator origin`);
    assertEquals(hull.view, view);
    assertEquals(hull.collapsed, false);
    assertEquals(layout.unroutedEdgeKeys, [], `${view} keeps exact cables`);
    assert(
      hull.height < resized.height,
      `${view} must not keep the 400-unit blank`,
    );
    for (const node of assemblyNodes(layout)) {
      assert(node.x >= hull.x && node.x + node.width <= hull.x + hull.width);
      assert(node.y >= hull.y && node.y + node.height <= hull.y + hull.height);
    }
    const gap = OVERVIEW_THREAD_HULL_SEPARATION_GAP;
    for (const [index, a] of layout.groups.entries()) {
      for (const b of layout.groups.slice(index + 1)) {
        assert(
          a.x >= b.x + b.width + gap || b.x >= a.x + a.width + gap ||
            a.y >= b.y + b.height + gap || b.y >= a.y + a.height + gap,
        );
      }
    }
  }
  const tree = layouts.tree.groups.find((group) => group.key === groupKey)!;
  const list = layouts.list.groups.find((group) => group.key === groupKey)!;
  const points = layouts.matrix.groups.find((group) => group.key === groupKey)!;
  assertEquals(tree.visibleRows, tree.rowCount);
  assertEquals(list.visibleRows, Math.ceil(list.rowCount / list.columns));
  assertEquals(
    lastVisibleBottom(layouts.tree),
    tree.y + tree.height - tree.footerHeight,
  );
  assertEquals(
    lastVisibleBottom(layouts.list),
    list.y + list.height - list.footerHeight,
  );
  assertEquals(lastVisibleBottom(layouts.matrix), points.y + points.height);
  assert(points.width <= resized.width && points.height < tree.height);
  assertEquals(list.columns <= list.rowCount, true);
  assertEquals(points.columns <= points.nodeKeys.length, true);
});

Deno.test("explicit listed resize stays a content window after the same-mode layout", () => {
  const windowNodes: OverviewThreadD3FlowNodeInput[] = Array.from(
    { length: 10 },
    (_, i) => ({
      key: `leaf-${i}`,
      label: `Leaf ${i}`,
      lane: "geometry",
      groupKey: "assembly",
      ...(i > 0 ? { parentKey: "leaf-0" } : {}),
    }),
  );
  const layout = buildOverviewThreadD3FlowLayout(windowNodes, [], {
    groupPlacements: {
      [groupKey]: { view: "tree", width: 300, height: 88 },
    },
  });
  const hull = layout.groups.find((group) => group.key === groupKey)!;
  const row = layout.nodes.find((node) => node.listed && !node.folded)!;
  assertEquals(hull.view, "tree");
  assertEquals(hull.rowCount, 9);
  assertEquals(hull.visibleRows, 3);
  assertEquals(hull.width, 300);
  assertEquals(
    hull.height,
    hull.headerHeight + hull.visibleRows * row.height + hull.footerHeight,
  );
  const auto = buildOverviewThreadD3FlowLayout(windowNodes, [], {
    groupPlacements: { [groupKey]: { view: "tree" } },
  });
  const autoHull = auto.groups.find((group) => group.key === groupKey)!;
  assertEquals(autoHull.visibleRows, autoHull.rowCount);
  assert(autoHull.height > hull.height);
});

Deno.test("collapsed hulls keep the band after a stale oversized mode switch", () => {
  const layout = buildOverviewThreadD3FlowLayout(nodes, edges, {
    groupPlacements: {
      [groupKey]: {
        view: "matrix",
        width: 620,
        height: 400,
        collapsed: true,
        x: 40,
        y: 80,
      },
    },
  });
  const hull = layout.groups.find((group) => group.key === groupKey)!;
  assertEquals(hull.collapsed, true);
  assertEquals(hull.height, hull.headerHeight);
  assertEquals(hull.x, 40);
  assertEquals(hull.y, 80);
  assertEquals(layout.unroutedEdgeKeys, []);
});

Deno.test("nextHullViewPlacement keeps origin, fold and sort but drops stale size", () => {
  const next = nextHullViewPlacement({
    x: 120,
    y: 90,
    width: 400,
    height: 800,
    scrollRow: 6,
    collapsed: true,
    sort: "name",
    view: "tree",
    offsetX: 4,
    offsetY: -2,
  }, "matrix");
  assertEquals(next, {
    x: 120,
    y: 90,
    collapsed: true,
    sort: "name",
    view: "matrix",
  });
  assertEquals("width" in next, false);
  assertEquals("height" in next, false);
  assertEquals("scrollRow" in next, false);
  assertEquals("offsetX" in next, false);
  assertEquals("offsetY" in next, false);
  assertEquals(nextHullViewPlacement(undefined, "list"), { view: "list" });
});

Deno.test("switching hull views content-fits while a same-mode resize keeps its window", () => {
  const identity = overviewThreadD3FlowGroupIdentity(
    "geometry",
    "domain:geometry",
  );
  const records = Array.from({ length: 29 }, (_, index) => ({
    key: `artifact:geometry-${index}`,
    label: `Part ${index}`,
    lane: "geometry" as const,
    groupKey: "domain:geometry",
  }));
  const largeTreePlacement = {
    view: "tree" as const,
    width: 400,
    height: 800,
    scrollRow: 6,
    x: 120,
    y: 90,
  };
  const largeTree = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: { [identity]: largeTreePlacement },
  });
  const matrixAfterTree = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: {
      [identity]: nextHullViewPlacement(largeTreePlacement, "matrix"),
    },
  });
  const treeHull = largeTree.groups.find((group) => group.key === identity)!;
  const matrixHull = matrixAfterTree.groups.find((group) =>
    group.key === identity
  )!;
  assertEquals(treeHull.x, 120);
  assertEquals(matrixHull.x, 120);
  assertEquals(matrixHull.y, 90);
  assertEquals(matrixHull.view, "matrix");
  assertEquals(matrixHull.scrollRow, 0);
  assert(
    matrixHull.width < treeHull.width || matrixHull.height < treeHull.height,
  );
  assert(matrixHull.height < treeHull.height);

  const compactMatrixPlacement = {
    view: "matrix" as const,
    width: 112,
    height: 50,
    x: 40,
    y: 60,
  };
  const compactMatrix = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: { [identity]: compactMatrixPlacement },
  });
  const treeAfterMatrix = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: {
      [identity]: nextHullViewPlacement(compactMatrixPlacement, "tree"),
    },
  });
  const compactHull = compactMatrix.groups.find((group) =>
    group.key === identity
  )!;
  const recoveredTree = treeAfterMatrix.groups.find((group) =>
    group.key === identity
  )!;
  assertEquals(recoveredTree.x, 40);
  assertEquals(recoveredTree.y, 60);
  assertEquals(recoveredTree.view, "tree");
  assertEquals(recoveredTree.visibleRows, recoveredTree.rowCount);
  assert(recoveredTree.height > compactHull.height);
  assertEquals(recoveredTree.scrollRow, 0);

  const resizedTree = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: {
      [identity]: { view: "tree", width: 300, height: 88, x: 15, y: 25 },
    },
  });
  const resizedHull = resizedTree.groups.find((group) =>
    group.key === identity
  )!;
  assertEquals(resizedHull.x, 15);
  assertEquals(resizedHull.y, 25);
  assertEquals(resizedHull.width, 300);
  assertEquals(resizedHull.visibleRows, 3);
  assert(resizedHull.height < recoveredTree.height);
  assertEquals(resizedHull.rowCount, recoveredTree.rowCount);
});

Deno.test("structured tree to points drops the blank 800-unit hull", () => {
  const identity = overviewThreadD3FlowGroupIdentity(
    "geometry",
    "domain:geometry",
  );
  const records = Array.from({ length: 29 }, (_, index) => ({
    key: `artifact:geometry-${index}`,
    label: `Part ${index}`,
    lane: "geometry" as const,
    groupKey: "domain:geometry",
  }));
  const tree = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: {
      [identity]: { view: "tree", width: 400, height: 800, x: 120, y: 90 },
    },
  });
  const points = buildOverviewThreadD3FlowLayout(records, [], {
    groupStructureRowCounts: { [identity]: 29 },
    groupPlacements: {
      [identity]: { view: "matrix", width: 400, height: 800, x: 120, y: 90 },
    },
  });
  const treeHull = tree.groups.find((group) => group.key === identity)!;
  const pointHull = points.groups.find((group) => group.key === identity)!;
  assertEquals(treeHull.x, 120);
  assertEquals(pointHull.x, 120);
  assertEquals(pointHull.y, 90);
  assertEquals(treeHull.visibleRows, treeHull.rowCount);
  assert(treeHull.height < 800);
  assert(pointHull.height < treeHull.height);
  assert(pointHull.width <= 400);
  assertEquals(pointHull.view, "matrix");
  assertEquals(pointHull.rowCount, 29);
});
