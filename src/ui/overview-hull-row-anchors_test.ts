import { assert, assertEquals } from "@std/assert";
import type {
  OverviewHeroNode,
  OverviewRecordedHeroNode,
} from "./src/project/overview-thread-hero-model.ts";
import {
  buildOverviewThreadD3FlowLayout,
  overviewThreadD3FlowGroupIdentity,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import type { OverviewHullContent } from "./src/project/overview/hulls/content.ts";
import { overviewHullRowAnchors } from "./src/project/overview/hulls/row-anchors.ts";
import { layoutOverviewHullRowCells } from "./src/project/overview/hulls/row-layout.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";

const GEOMETRY_GROUP = "geometry-assembly";
const GEOMETRY_HULL = overviewThreadD3FlowGroupIdentity(
  "geometry",
  GEOMETRY_GROUP,
);
const BRIEF_GROUP = "brief";
const BRIEF_HULL = overviewThreadD3FlowGroupIdentity(
  "requirements",
  BRIEF_GROUP,
);

function artifact(
  id: string,
  groupKey = GEOMETRY_GROUP,
  label = id,
): OverviewRecordedHeroNode {
  return {
    key: `artifact:${id}`,
    lane: "geometry",
    groupKey,
    label,
    kind: "recorded",
    color: "black",
    emphasis: false,
    node: {
      id: `artifact:${id}`,
      ref: { kind: "artifact", id },
      entityKind: "artifact",
      label,
      freshness: "fresh",
      system: "digital-thread",
      summary: label,
    },
  };
}

function briefSource(key: string): OverviewHeroNode {
  // Row anchoring needs only the existing graph identity. The brief model is
  // intentionally not consulted to manufacture a Thread relation.
  return {
    key,
    lane: "requirements",
    groupKey: BRIEF_GROUP,
    label: key,
    kind: "brief-source",
  } as OverviewHeroNode;
}

function content(
  groupKey: string,
  rows: OverviewHullContent["rows"],
): OverviewHullContent {
  return { groupKey, mode: "tree", rows, records: [] };
}

function hierarchy(
  nodes: ThreadViewerHierarchyProjection["nodes"],
): ThreadViewerHierarchyProjection {
  return {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    nodes,
    rootIds: nodes.filter((node) => node.parentId === undefined).map((node) => node.id),
  };
}

function navigationRow(
  key: string,
  label = key,
): OverviewHullContent["rows"][number] {
  return {
    key,
    kind: "navigation",
    label,
    depth: 0,
    sessionIds: [],
    endpoint: false,
  };
}

function endpointRow(
  key: string,
  nodeKey: string,
  kind: "record" | "source" = "record",
): OverviewHullContent["rows"][number] {
  return {
    key,
    kind,
    label: key,
    depth: 1,
    nodeKey,
    sessionIds: [],
    endpoint: true,
  };
}

Deno.test("row anchors retain direct record and source identities without label or cross-hull matching", () => {
  const sourceKey = "brief-source:criterion-a";
  const nodes = [
    artifact("direct"),
    artifact("geometry-a", GEOMETRY_GROUP, "same visible label"),
    artifact("label-only", GEOMETRY_GROUP, "same visible label"),
    artifact("foreign", "other-geometry", "same visible label"),
    briefSource(sourceKey),
  ];
  const contents = new Map([
    [
      GEOMETRY_HULL,
      content(GEOMETRY_HULL, [
        navigationRow("occurrence:geometry-a", "same visible label"),
        endpointRow("direct-row", "artifact:direct"),
      ]),
    ],
    [
      BRIEF_HULL,
      content(BRIEF_HULL, [
        navigationRow("brief:r1"),
        endpointRow("source-row", sourceKey, "source"),
      ]),
    ],
  ]);

  const anchors = overviewHullRowAnchors(
    contents,
    nodes,
    hierarchy([{
      id: "occurrence:geometry-a",
      label: "same visible label",
      partDefinitionElementId: "definition:geometry-a",
      geometryArtifactId: "geometry-a",
      sessionIds: [],
    }]),
  );

  assertEquals(anchors[GEOMETRY_HULL], {
    "artifact:geometry-a": 0,
    "artifact:direct": 1,
  });
  assertEquals(anchors[BRIEF_HULL], { [sourceKey]: 1 });
  assertEquals("artifact:label-only" in anchors[GEOMETRY_HULL]!, false);
  assertEquals("artifact:foreign" in anchors[GEOMETRY_HULL]!, false);
});

Deno.test("navigation artifacts require one occurrence while direct assets retain separate record identities", () => {
  const nodes = [artifact("shared"), artifact("step"), artifact("glb")];
  const contents = new Map([[
    GEOMETRY_HULL,
    content(GEOMETRY_HULL, [
      navigationRow("occurrence:one"),
      navigationRow("occurrence:two"),
    ]),
  ]]);
  const anchors = overviewHullRowAnchors(
    contents,
    nodes,
    hierarchy([
      {
        id: "occurrence:one",
        label: "One",
        partDefinitionElementId: "definition:one",
        geometryArtifactId: "shared",
        artifactIds: ["shared", "step", "glb"],
        sessionIds: [],
      },
      {
        id: "occurrence:two",
        label: "Two",
        partDefinitionElementId: "definition:two",
        geometryArtifactId: "shared",
        sessionIds: [],
      },
    ]),
  );

  assertEquals(anchors[GEOMETRY_HULL], {
    "artifact:step": 0,
    "artifact:glb": 0,
  });
  assertEquals("artifact:shared" in anchors[GEOMETRY_HULL]!, false);
});

function localLayout(
  view: "tree" | "list",
  anchors: Readonly<Record<string, number>>,
  rows = 2,
  scrollRow = 0,
) {
  const nodes = [
    {
      key: "artifact:a",
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: "A",
    },
    {
      key: "artifact:b",
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: "B",
    },
  ];
  return buildOverviewThreadD3FlowLayout(nodes, [{
    key: "edge:a-b",
    fromKey: "artifact:a",
    toKey: "artifact:b",
    pathCount: 1,
    pathKeys: ["recorded:path:a-b"],
    emphasis: false,
  }], {
    groupStructureRowCounts: { [GEOMETRY_HULL]: rows },
    groupRowAnchors: { [GEOMETRY_HULL]: anchors },
    groupPlacements: {
      [GEOMETRY_HULL]: { view, width: 300, height: 108, scrollRow },
    },
  });
}

function samePoint(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
): boolean {
  return left.x === right.x && left.y === right.y;
}

function routeSegment(
  layout: ReturnType<typeof localLayout>,
) {
  const route = layout.routes.find((candidate) => candidate.edgeKey === "edge:a-b");
  assert(route);
  assertEquals(route.segmentKeys.length, 1);
  const segment = layout.segments.find((candidate) =>
    candidate.key === route.segmentKeys[0]
  );
  assert(segment);
  return segment;
}

Deno.test("same-hull Tree and List cables use real exact row ports only when both records are visible", () => {
  for (const view of ["tree", "list"] as const) {
    const layout = localLayout(view, { "artifact:a": 0, "artifact:b": 1 });
    const source = layout.nodes.find((node) => node.key === "artifact:a")!;
    const target = layout.nodes.find((node) => node.key === "artifact:b")!;
    const segment = routeSegment(layout);

    assertEquals(source.rowAnchored, true);
    assertEquals(target.rowAnchored, true);
    assertEquals(source.folded, false);
    assertEquals(target.folded, false);
    assert(segment.d.length > 1);
    assert(!samePoint(segment.points[0]!, segment.points.at(-1)!));
    assert(
      samePoint(segment.points[0]!, source.leftPort) ||
        samePoint(segment.points[0]!, source.rightPort),
    );
    assert(
      samePoint(segment.points.at(-1)!, target.leftPort) ||
        samePoint(segment.points.at(-1)!, target.rightPort),
    );
  }
});

Deno.test("missing or offscreen local row docks use a nonzero hull stub", () => {
  const missingCases: readonly Readonly<Record<string, number>>[] = [{}, {
    "artifact:a": 0,
  }];
  for (const anchors of missingCases) {
    const layout = localLayout("tree", anchors);
    const segment = routeSegment(layout);
    assert(segment.key.startsWith("same-hull-folded-stub:"));
    assert(segment.d.length > 1);
    assert(!samePoint(segment.points[0]!, segment.points.at(-1)!));
  }

  const offscreen = localLayout(
    "list",
    { "artifact:a": 0, "artifact:b": 2 },
    20,
    1,
  );
  const source = offscreen.nodes.find((node) => node.key === "artifact:a")!;
  const target = offscreen.nodes.find((node) => node.key === "artifact:b")!;
  const segment = routeSegment(offscreen);
  assertEquals(source.folded, true);
  assertEquals(target.rowAnchored, true);
  assert(segment.key.startsWith("same-hull-folded-stub:"));
  assert(!samePoint(segment.points[0]!, segment.points.at(-1)!));
});

function liveShapedLayout(view: "tree" | "list" | "matrix") {
  const root = "artifact:geometry-root";
  const rootStep = "artifact:cad-asset-root-step";
  const rootGlb = "artifact:cad-asset-root-glb";
  const module = "artifact:geometry-module";
  const moduleStep = "artifact:cad-asset-module-step";
  const moduleGlb = "artifact:cad-asset-module-glb";
  const nodes = [root, rootStep, rootGlb, module, moduleStep, moduleGlb].map(
    (key) => ({
      key,
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: key,
    }),
  );
  const edges = [
    [root, rootStep],
    [root, rootGlb],
    [root, module],
    [module, moduleStep],
    [module, moduleGlb],
  ].map(([fromKey, toKey]) => ({
    key: `${fromKey}>${toKey}`,
    fromKey,
    toKey,
    pathCount: 1,
    pathKeys: [`recorded:${fromKey}>${toKey}`],
    emphasis: false,
  }));
  return {
    nodeKeys: { root, rootStep, rootGlb, module, moduleStep, moduleGlb },
    layout: buildOverviewThreadD3FlowLayout(nodes, edges, {
      groupStructureRowCounts: { [GEOMETRY_HULL]: 2 },
      groupRowAnchors: {
        [GEOMETRY_HULL]: {
          [root]: 0,
          [rootStep]: 0,
          [rootGlb]: 0,
          [module]: 1,
          [moduleStep]: 1,
          [moduleGlb]: 1,
        },
      },
      groupPlacements: { [GEOMETRY_HULL]: { view } },
    }),
  };
}

function segmentFor(
  layout: ReturnType<typeof liveShapedLayout>["layout"],
  edgeKey: string,
) {
  const route = layout.routes.find((candidate) => candidate.edgeKey === edgeKey);
  assert(route, `Missing exact route ${edgeKey}`);
  assertEquals(route.segmentKeys.length, 1);
  const segment = layout.segments.find((candidate) =>
    candidate.key === route.segmentKeys[0]
  );
  assert(segment, `Missing exact segment ${edgeKey}`);
  return segment;
}

Deno.test("three exact artifacts per occurrence retain distinct ports and nonzero local routes in every hull mode", () => {
  for (const view of ["tree", "list", "matrix"] as const) {
    const { layout, nodeKeys } = liveShapedLayout(view);
    const nodes = new Map(layout.nodes.map((node) => [node.key, node]));
    const rowZero = [nodeKeys.root, nodeKeys.rootStep, nodeKeys.rootGlb].map(
      (key) => nodes.get(key)!,
    );
    const rowOne = [nodeKeys.module, nodeKeys.moduleStep, nodeKeys.moduleGlb]
      .map((key) => nodes.get(key)!);

    assertEquals(layout.unroutedEdgeKeys, []);
    for (const node of [...rowZero, ...rowOne]) {
      assertEquals(node.rowAnchored, true);
      assertEquals(node.folded, false);
      assert(node.width > 0 && node.height > 0);
    }
    for (
      const [fromKey, toKey] of [
        [nodeKeys.root, nodeKeys.rootStep],
        [nodeKeys.root, nodeKeys.rootGlb],
        [nodeKeys.root, nodeKeys.module],
        [nodeKeys.module, nodeKeys.moduleStep],
        [nodeKeys.module, nodeKeys.moduleGlb],
      ]
    ) {
      const segment = segmentFor(layout, `${fromKey}>${toKey}`);
      const source = nodes.get(fromKey)!;
      const target = nodes.get(toKey)!;
      assert(segment.d.length > 1);
      assert(!samePoint(segment.points[0]!, segment.points.at(-1)!));
      assert(
        samePoint(segment.points[0]!, source.leftPort) ||
          samePoint(segment.points[0]!, source.rightPort),
      );
      assert(
        samePoint(segment.points.at(-1)!, target.leftPort) ||
          samePoint(segment.points.at(-1)!, target.rightPort),
      );
    }

    if (view === "matrix") {
      const cells = layoutOverviewHullRowCells(2, layout.groups[0]!);
      for (const [index, row] of [rowZero, rowOne].entries()) {
        const cell = cells.find((candidate) => candidate.index === index)!;
        const minimumX = Math.min(...row.map((node) => node.x));
        const maximumX = Math.max(...row.map((node) => node.x + node.width));
        const minimumY = Math.min(...row.map((node) => node.y));
        const maximumY = Math.max(...row.map((node) => node.y + node.height));
        assert(maximumX - minimumX <= 10);
        assert(maximumY - minimumY <= 10);
        assert(row.every((node) => node.centerX === cell.x + cell.width / 2));
        assertEquals(
          (Math.min(...row.map((node) => node.centerY)) +
            Math.max(...row.map((node) => node.centerY))) / 2,
          cell.y + cell.height / 2,
        );
        assertEquals(
          new Set(row.map((node) => `${node.centerX}:${node.centerY}`)).size,
          3,
        );
      }
      continue;
    }

    for (const row of [rowZero, rowOne]) {
      assert(row.every((node) => node.width > 10));
      assert(
        new Set(row.map((node) => node.centerY)).size === 3,
        "Each direct artifact owns one disjoint vertical row subslot.",
      );
      for (const node of row) {
        assertEquals(node.rightPort.x - node.leftPort.x, node.width);
      }
    }
  }
});
