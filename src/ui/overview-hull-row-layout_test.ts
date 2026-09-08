import { assert, assertEquals } from "@std/assert";
import {
  layoutOverviewHullHierarchyLinks,
  layoutOverviewHullRows,
  OVERVIEW_HULL_LIST_COLUMN_GAP,
  overviewHullRowCableSurface,
} from "./src/project/overview/hulls/row-layout.ts";
import {
  type OverviewHullContentRow,
  overviewHullStructureRowCounts,
} from "./src/project/overview/hulls/content.ts";
import { overviewHullRowGraphRefs } from "./src/project/overview/hulls/types.ts";
import { overviewThreadD3CableAnchor } from "./src/project/overview-thread-d3-cable-anchorage.ts";
import {
  buildOverviewThreadD3FlowLayout,
  overviewThreadD3FlowGroupIdentity,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import { overviewInspectionRelatedGraphKeys } from "./src/project/overview-thread-inspection.ts";

const rows: OverviewHullContentRow[] = Array.from({ length: 29 }, (_, i) => ({
  key: `occurrence:${i}`,
  kind: "navigation",
  label: `Part ${i}`,
  depth: i === 0 ? 0 : 1,
  sessionIds: i === 4 ? ["exact-recorded-viewer"] : [],
  ...(i === 4 ? { viewerNodeKey: "artifact:exact-capture" } : {}),
  endpoint: i === 0,
  graphRefs: i === 0 ? ["artifact:geometry-root"] : [],
  role: i === 0 ? "overlay" : "folder",
}));
const box = {
  x: 10,
  y: 20,
  width: 300,
  height: 800,
  headerHeight: 30,
  footerHeight: 20,
  columns: 3,
  visibleRows: 29,
  scrollRow: 0,
  collapsed: false,
};

Deno.test("hull tree, list and points arrange the same 29 exact rows and actions", () => {
  const before = JSON.stringify(rows);
  for (const view of ["tree", "list", "matrix"] as const) {
    const laidOut = layoutOverviewHullRows(rows, { ...box, view });
    assertEquals(
      laidOut.map((item) => item.row.key),
      rows.map((row) => row.key),
    );
    assertEquals(laidOut.map((item) => item.row), rows);
    assertEquals(
      laidOut.map((item) => overviewHullRowGraphRefs(item.row)),
      rows.map((row) => overviewHullRowGraphRefs(row)),
    );
    assertEquals(laidOut[0]!.row.graphRefs, ["artifact:geometry-root"]);
    assertEquals(laidOut[4]!.row.viewerNodeKey, "artifact:exact-capture");
    assertEquals(laidOut[4]!.row.sessionIds, ["exact-recorded-viewer"]);
    assertEquals(laidOut.every((item) => item.depth === 0), view !== "tree");
    assertEquals(
      laidOut.every((item) =>
        item.x >= box.x && item.x + item.width <= box.x + box.width &&
        item.y >= box.y + box.headerHeight &&
        item.y + item.height <= box.y + box.height - box.footerHeight + 1e-9
      ),
      true,
    );
  }
  assertEquals(JSON.stringify(rows), before);
});

Deno.test("listed hull rows scroll down each column without selecting evidence records", () => {
  const laidOut = layoutOverviewHullRows(rows, {
    ...box,
    view: "list",
    visibleRows: 3,
    scrollRow: 2,
  });
  assertEquals(laidOut.map((item) => item.row.key), [
    "occurrence:2",
    "occurrence:3",
    "occurrence:4",
    "occurrence:12",
    "occurrence:13",
    "occurrence:14",
    "occurrence:22",
    "occurrence:23",
    "occurrence:24",
  ]);
});

Deno.test("listed hull columns keep a gutter and the same 29 rows in 2 and 3 columns", () => {
  const before = JSON.stringify(rows);
  for (const columns of [2, 3]) {
    const group = { ...box, view: "list" as const, columns, visibleRows: 29 };
    const laidOut = layoutOverviewHullRows(rows, group);
    assertEquals(
      laidOut.map((item) => item.row.key),
      rows.map((row) => row.key),
    );
    assertEquals(laidOut.every((item) => item.depth === 0), true);
    const byColumn = new Map<number, typeof laidOut>();
    for (const item of laidOut) {
      const column = Math.round(
        (item.x - group.x) / (item.width + OVERVIEW_HULL_LIST_COLUMN_GAP),
      );
      byColumn.set(column, [...byColumn.get(column) ?? [], item]);
    }
    assertEquals(byColumn.size, columns);
    const items = [...laidOut];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const left = items[i]!;
        const right = items[j]!;
        const differentColumns = Math.abs(left.x - right.x) > 1e-6;
        const overlapX = left.x + 1e-6 < right.x + right.width &&
          left.x + left.width > right.x + 1e-6;
        const overlapY = left.y + 1e-6 < right.y + right.height &&
          left.y + left.height > right.y + 1e-6;
        assertEquals(
          differentColumns && overlapX && overlapY,
          false,
          `${columns}-column cells ${left.row.key} and ${right.row.key} overlap`,
        );
      }
    }
  }
  assertEquals(JSON.stringify(rows), before);
});

Deno.test("collapsed and empty hulls do not render navigation rows", () => {
  assertEquals(
    layoutOverviewHullRows(rows, { ...box, view: "tree", collapsed: true }),
    [],
  );
  assertEquals(layoutOverviewHullRows([], { ...box, view: "matrix" }), []);
});

Deno.test("records-mode hulls keep the same rows in tree, list, and points", () => {
  const recordRows: OverviewHullContentRow[] = [
    {
      key: "artifact:proof-a",
      kind: "record",
      label: "Proof A",
      depth: 0,
      nodeKey: "artifact:proof-a",
      graphRefs: ["artifact:proof-a"],
      sessionIds: [],
      endpoint: true,
    },
    {
      key: "artifact:proof-b",
      kind: "record",
      label: "Proof B",
      depth: 0,
      nodeKey: "artifact:proof-b",
      graphRefs: ["artifact:proof-b"],
      sessionIds: [],
      endpoint: true,
    },
  ];
  const contents = new Map([["physics-proof", {
    groupKey: "physics-proof",
    mode: "records" as const,
    rows: recordRows,
    records: recordRows,
  }]]);
  const counts = overviewHullStructureRowCounts(contents);
  assertEquals(counts["physics-proof"], 2);
  for (const view of ["tree", "list", "matrix"] as const) {
    const laidOut = layoutOverviewHullRows(recordRows, { ...box, view });
    assertEquals(
      laidOut.map((item) => item.row.key),
      recordRows.map((row) => row.key),
    );
    assertEquals(laidOut.map((item) => item.row), recordRows);
  }
});

Deno.test("all structured hull modes keep content counts and only real graph cable identities", () => {
  for (
    const [lane, domain, count] of [
      ["geometry", "domain:geometry", 29],
      ["system-model", "domain:sysml-model", 31],
      ["requirements", "brief", 13],
    ] as const
  ) {
    const groupKey = overviewThreadD3FlowGroupIdentity(lane, domain);
    const records = Array.from({ length: 57 }, (_, index) => ({
      key: `artifact:${domain}-${index}`,
      label: `Capture ${index}`,
      lane,
      groupKey: domain,
    }));
    const graphNodes = [...records, {
      key: "observation:proof",
      label: "Proof",
      lane: "physics" as const,
      groupKey: "domain:fea",
    }];
    const edges = [{
      key: "recorded-edge",
      fromKey: records[0]!.key,
      toKey: "observation:proof",
      pathCount: 1,
      pathKeys: ["exact-evidence"],
      emphasis: false,
    }];
    for (const view of ["tree", "list", "matrix"] as const) {
      const layout = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
        groupStructureRowCounts: { [groupKey]: count },
        groupPlacements: { [groupKey]: { view, width: 400, height: 800 } },
      });
      const hull = layout.groups.find((group) => group.key === groupKey)!;
      assertEquals(hull.rowCount, count);
      assertEquals(hull.structureRowCount, count);
      assertEquals(
        new Set(hull.nodeKeys),
        new Set(records.map((node) => node.key)),
      );
      assertEquals(
        new Set(layout.nodes.map((node) => node.key)),
        new Set(graphNodes.map((node) => node.key)),
      );
      assertEquals(
        layout.nodes.filter((node) => node.groupKey === domain)
          .every((node) => node.folded),
        true,
      );
      assertEquals(layout.unroutedEdgeKeys, []);
      assertEquals(layout.routes[0]!.fromKey, records[0]!.key);
      assertEquals(layout.routes[0]!.toKey, "observation:proof");
    }
  }
});

function navigationRow(
  key: string,
  depth: number,
  parentKey?: string,
): OverviewHullContentRow {
  return {
    key,
    kind: "navigation",
    label: key,
    depth,
    sessionIds: [],
    endpoint: false,
    ...(parentKey ? { parentKey } : {}),
  };
}

const hierarchyRows: OverviewHullContentRow[] = [
  navigationRow("sysml:root", 0),
  navigationRow("sysml:child-a", 1, "sysml:root"),
  navigationRow("sysml:child-b", 1, "sysml:root"),
  navigationRow("sysml:grand", 2, "sysml:child-a"),
  {
    key: "artifact:historical",
    kind: "record",
    label: "Historical capture",
    depth: 0,
    sessionIds: [],
    endpoint: true,
    parentKey: "sysml:root",
  },
  {
    key: "brief:current",
    kind: "source",
    label: "Current brief clause",
    depth: 0,
    sessionIds: [],
    endpoint: false,
    parentKey: "sysml:root",
  },
];

const hierarchyBox = {
  ...box,
  columns: 1,
  visibleRows: 8,
};

function pointOn(
  points: readonly { readonly x: number; readonly y: number }[],
  expected: { readonly x: number; readonly y: number },
): boolean {
  return points.some((point) =>
    Math.abs(point.x - expected.x) <= 1e-9 &&
    Math.abs(point.y - expected.y) <= 1e-9
  );
}

Deno.test(
  "row-parent links use orthogonal elbows at exact row docks in tree, list and matrix",
  () => {
    const before = JSON.stringify(hierarchyRows);
    for (const view of ["tree", "list", "matrix"] as const) {
      const group = {
        ...hierarchyBox,
        view,
        columns: view === "matrix" ? 3 : 1,
      };
      const laidOut = layoutOverviewHullRows(hierarchyRows, group);
      assertEquals(
        laidOut.map((item) => item.row.key),
        hierarchyRows.map((row) => row.key),
      );
      const links = layoutOverviewHullHierarchyLinks(hierarchyRows, group);
      assertEquals(
        links.map((link) => `${link.fromKey}>${link.toKey}`).toSorted(),
        [
          "sysml:child-a>sysml:grand",
          "sysml:root>artifact:historical",
          "sysml:root>brief:current",
          "sysml:root>sysml:child-a",
          "sysml:root>sysml:child-b",
        ],
      );
      assertEquals(
        links.every((link) => link.relationKind === "row-parent"),
        true,
      );
      const parent = laidOut.find((item) => item.row.key === "sysml:root")!;
      const parentDock = overviewThreadD3CableAnchor(
        overviewHullRowCableSurface(parent, view),
        "right",
      );
      const siblings = links.filter((link) => link.fromKey === "sysml:root");
      assertEquals(siblings.length, 4);
      for (const link of siblings) {
        assert(link.d.includes("L") || link.points.length === 1);
        assertEquals(/[CQA]/.test(link.d), false);
        assertOrthogonal(link.points);
        assert(pointOn(link.points, parentDock));
        const child = laidOut.find((item) => item.row.key === link.toKey)!;
        assert(pointOn(
          link.points,
          overviewThreadD3CableAnchor(
            overviewHullRowCableSurface(child, view),
            "right",
          ),
        ));
        assertNoInteriorOverlap(link.points, laidOut, [
          parent.row.key,
          child.row.key,
        ], view);
      }
    }
    assertEquals(JSON.stringify(hierarchyRows), before);
  },
);

Deno.test(
  "row-parent links appear only for visible rows with a present parentKey",
  () => {
    const before = JSON.stringify(hierarchyRows);
    assertEquals(
      layoutOverviewHullHierarchyLinks(hierarchyRows, {
        ...hierarchyBox,
        view: "tree",
        collapsed: true,
      }),
      [],
    );
    const scrolled = layoutOverviewHullHierarchyLinks(hierarchyRows, {
      ...hierarchyBox,
      view: "list",
      columns: 1,
      visibleRows: 2,
      scrollRow: 0,
    });
    assertEquals(
      scrolled.map((link) => `${link.fromKey}>${link.toKey}`).toSorted(),
      ["sysml:root>sysml:child-a"],
    );
    const offscreenParent = layoutOverviewHullHierarchyLinks(hierarchyRows, {
      ...hierarchyBox,
      view: "list",
      columns: 1,
      visibleRows: 3,
      scrollRow: 1,
    });
    assertEquals(
      offscreenParent.map((link) => `${link.fromKey}>${link.toKey}`),
      ["sysml:child-a>sysml:grand"],
    );
    assertEquals(JSON.stringify(hierarchyRows), before);
  },
);

Deno.test("row-parent links cover navigation, brief source, and record children only when parentKey is present", () => {
  const briefRoot: OverviewHullContentRow = {
    key: "brief-root",
    kind: "navigation",
    label: "Brief courant",
    depth: 0,
    sessionIds: [],
    endpoint: false,
  };
  const briefChild: OverviewHullContentRow = {
    key: "brief-source:objective",
    kind: "source",
    label: "objective",
    depth: 1,
    parentKey: "brief-root",
    sessionIds: [],
    endpoint: false,
  };
  const orphan: OverviewHullContentRow = {
    key: "brief-source:loose",
    kind: "source",
    label: "loose",
    depth: 0,
    sessionIds: [],
    endpoint: false,
  };
  const recordParent: OverviewHullContentRow = {
    key: "artifact:fea-root",
    kind: "record",
    label: "FEA root",
    depth: 0,
    sessionIds: [],
    endpoint: true,
  };
  const recordChild: OverviewHullContentRow = {
    key: "artifact:fea-child",
    kind: "record",
    label: "FEA child",
    depth: 1,
    parentKey: "artifact:fea-root",
    sessionIds: [],
    endpoint: true,
  };
  const treeBox = { ...hierarchyBox, view: "tree" as const };
  const briefLinks = layoutOverviewHullHierarchyLinks(
    [briefRoot, briefChild, orphan],
    treeBox,
  );
  const recordLinks = layoutOverviewHullHierarchyLinks(
    [recordParent, recordChild],
    treeBox,
  );
  assertEquals(
    briefLinks.map((link) => `${link.fromKey}>${link.toKey}`),
    ["brief-root>brief-source:objective"],
  );
  assertEquals(
    recordLinks.map((link) => `${link.fromKey}>${link.toKey}`),
    ["artifact:fea-root>artifact:fea-child"],
  );
  assertEquals(
    layoutOverviewHullHierarchyLinks([orphan, recordParent], treeBox),
    [],
  );
});

Deno.test("row-parent links never join Thread graph routes or inspection keys", () => {
  const group = { ...hierarchyBox, view: "tree" as const };
  const links = layoutOverviewHullHierarchyLinks(hierarchyRows, group);
  const layout = buildOverviewThreadD3FlowLayout(
    [{
      key: "artifact:geometry-root",
      label: "Geometry root",
      lane: "geometry",
      groupKey: "domain:geometry",
    }],
    [],
  );
  assertEquals(links.every((link) => link.relationKind === "row-parent"), true);
  assertEquals(
    links.some((link) =>
      layout.routes.some((route) =>
        route.fromKey === link.fromKey && route.toKey === link.toKey
      )
    ),
    false,
  );
  assertEquals(
    [...overviewInspectionRelatedGraphKeys(layout.routes, [
      "artifact:geometry-root",
    ])].includes("sysml:root"),
    false,
  );
  assertEquals(
    overviewInspectionRelatedGraphKeys(
      links.map((link) => ({ fromKey: link.fromKey, toKey: link.toKey })),
      ["artifact:geometry-root"],
    ).has("sysml:root"),
    false,
  );
});

function assertOrthogonal(
  points: readonly { readonly x: number; readonly y: number }[],
): void {
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1]!;
    const to = points[index]!;
    assert(
      from.x === to.x || from.y === to.y,
      `segment ${index} is not orthogonal: ${from.x},${from.y} → ${to.x},${to.y}`,
    );
  }
}

function assertNoInteriorOverlap(
  points: readonly { readonly x: number; readonly y: number }[],
  laidOut: ReturnType<typeof layoutOverviewHullRows>,
  involved: readonly string[],
  view: "tree" | "list" | "matrix",
): void {
  const skip = new Set(involved);
  for (const row of laidOut) {
    if (skip.has(row.row.key)) continue;
    const box = view === "matrix"
      ? overviewHullRowCableSurface(row, view)
      : row;
    const minX = box.x + 0.5;
    const maxX = box.x + box.width - 0.5;
    const minY = box.y + 0.5;
    const maxY = box.y + box.height - 0.5;
    if (maxX <= minX || maxY <= minY) continue;
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1]!;
      const to = points[index]!;
      const hits = from.y === to.y
        ? from.y > minY && from.y < maxY &&
          Math.max(from.x, to.x) > minX && Math.min(from.x, to.x) < maxX
        : from.x === to.x && from.x > minX && from.x < maxX &&
          Math.max(from.y, to.y) > minY && Math.min(from.y, to.y) < maxY;
      assertEquals(
        hits,
        false,
        `${row.row.key} is crossed by a parent guide in ${view}`,
      );
    }
  }
}
