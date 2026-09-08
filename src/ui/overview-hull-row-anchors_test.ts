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
import {
  layoutOverviewHullRowCells,
  overviewHullRowCableSurface,
} from "./src/project/overview/hulls/row-layout.ts";
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
    rootIds: nodes.filter((node) => node.parentId === undefined).map((node) =>
      node.id
    ),
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

function hierarchyWithArchitecture(
  nodes: ThreadViewerHierarchyProjection["nodes"],
  architectureArtifactId: string,
): ThreadViewerHierarchyProjection {
  return {
    ...hierarchy(nodes),
    architectureArtifactId,
  };
}

Deno.test("SYSML unique declared root visually anchors the hull architecture artifact only", () => {
  const architectureId = "architecture-8fdff1a0e99f1";
  const sysmlGroup = "domain:sysml-model";
  const sysmlHull = overviewThreadD3FlowGroupIdentity(
    "system-model",
    sysmlGroup,
  );
  const architecture = {
    ...artifact(architectureId, sysmlGroup, architectureId),
    lane: "system-model" as const,
    groupKey: sysmlGroup,
  };
  const nodes = [
    architecture,
    artifact("geometry-root"),
    artifact("geometry-airframe"),
  ];
  const contents = new Map([
    [
      sysmlHull,
      content(sysmlHull, [
        navigationRow("root", "Assembly"),
        navigationRow("airframe", "Airframe"),
      ]),
    ],
    [
      GEOMETRY_HULL,
      content(GEOMETRY_HULL, [
        navigationRow("root", "Assembly"),
        navigationRow("airframe", "Airframe"),
      ]),
    ],
  ]);
  const anchors = overviewHullRowAnchors(
    contents,
    nodes,
    hierarchyWithArchitecture(
      [
        {
          id: "root",
          label: "Assembly",
          partDefinitionElementId: "def-root",
          geometryArtifactId: "geometry-root",
          artifactIds: ["geometry-root"],
          sessionIds: [],
        },
        {
          id: "airframe",
          parentId: "root",
          label: "Airframe",
          partDefinitionElementId: "def-airframe",
          geometryArtifactId: "geometry-airframe",
          artifactIds: ["geometry-airframe"],
          sessionIds: [],
        },
      ],
      architectureId,
    ),
  );

  assertEquals(anchors[sysmlHull], { [`artifact:${architectureId}`]: 0 });
  assertEquals(anchors[GEOMETRY_HULL], {
    "artifact:geometry-root": 0,
    "artifact:geometry-airframe": 1,
  });
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
  const route = layout.routes.find((candidate) =>
    candidate.edgeKey === "edge:a-b"
  );
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

Deno.test("expanded folded stubs dock on the hull body rail outside the header band", () => {
  const layout = localLayout("tree", {});
  const group = layout.groups[0]!;
  const segment = routeSegment(layout);
  assertEquals(segment.dock, "hull-body");
  assertEquals(layout.unroutedEdgeKeys, []);
  const headerBottom = group.y + group.headerHeight;
  const edgeX = group.x + group.width;
  const hullEdge = segment.points.filter((point) =>
    Math.abs(point.x - edgeX) <= 1e-6
  );
  assert(hullEdge.length > 0);
  for (const point of hullEdge) {
    assert(
      point.y >= headerBottom - 1e-6,
      "expanded stubs must not attach to the caption band",
    );
  }

  const collapsed = buildOverviewThreadD3FlowLayout(
    [{
      key: "artifact:a",
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: "A",
    }, {
      key: "artifact:b",
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: "B",
    }],
    [{
      key: "edge:a-b",
      fromKey: "artifact:a",
      toKey: "artifact:b",
      pathCount: 1,
      pathKeys: ["recorded:path:a-b"],
      emphasis: false,
    }],
    {
      groupStructureRowCounts: { [GEOMETRY_HULL]: 2 },
      groupRowAnchors: { [GEOMETRY_HULL]: {} },
      groupPlacements: {
        [GEOMETRY_HULL]: { collapsed: true, width: 300, height: 24 },
      },
    },
  );
  const collapsedSegment = collapsed.segments.find((candidate) =>
    candidate.key.startsWith("same-hull-folded-stub:") ||
    candidate.key.startsWith("folded-hull-stub:")
  );
  assertEquals(collapsed.unroutedEdgeKeys, []);
  assert(collapsedSegment);
  assertEquals(collapsedSegment.dock, "hull-collapsed");
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
  const route = layout.routes.find((candidate) =>
    candidate.edgeKey === edgeKey
  );
  assert(route, `Missing exact route ${edgeKey}`);
  assertEquals(route.segmentKeys.length, 1);
  const segment = layout.segments.find((candidate) =>
    candidate.key === route.segmentKeys[0]
  );
  assert(segment, `Missing exact segment ${edgeKey}`);
  return { route, segment };
}

function polylineLength(
  points: readonly { readonly x: number; readonly y: number }[],
): number {
  return points.slice(1).reduce(
    (sum, point, index) =>
      sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
    0,
  );
}

function assertSharedRowDock(
  row: ReturnType<typeof liveShapedLayout>["layout"]["nodes"],
  cell: ReturnType<typeof layoutOverviewHullRowCells>[number],
  view: "tree" | "list" | "matrix",
): void {
  const surface = overviewHullRowCableSurface(cell, view, 10);
  const dockKeys = new Set(row.map((node) => node.dockKey));
  assertEquals(dockKeys.size, 1);
  assert(row[0]?.dockKey);
  for (const node of row) {
    assertEquals(node.rowAnchored, true);
    assertEquals(node.folded, false);
    assertEquals(node.x, surface.x);
    assertEquals(node.y, surface.y);
    assertEquals(node.width, surface.width);
    assertEquals(node.height, surface.height);
    assertEquals(node.leftPort, row[0]!.leftPort);
    assertEquals(node.rightPort, row[0]!.rightPort);
  }
}

Deno.test("several graphRefs on one row share one visual dock and keep every exact local route", () => {
  for (const view of ["tree", "list", "matrix"] as const) {
    const { layout, nodeKeys } = liveShapedLayout(view);
    const nodes = new Map(layout.nodes.map((node) => [node.key, node]));
    const rowZero = [nodeKeys.root, nodeKeys.rootStep, nodeKeys.rootGlb].map(
      (key) => nodes.get(key)!,
    );
    const rowOne = [nodeKeys.module, nodeKeys.moduleStep, nodeKeys.moduleGlb]
      .map((key) => nodes.get(key)!);
    const cells = layoutOverviewHullRowCells(2, layout.groups[0]!);

    assertEquals(layout.unroutedEdgeKeys, []);
    assertSharedRowDock(
      rowZero,
      cells.find((cell) => cell.index === 0)!,
      view,
    );
    assertSharedRowDock(
      rowOne,
      cells.find((cell) => cell.index === 1)!,
      view,
    );
    assert(rowZero[0]!.dockKey !== rowOne[0]!.dockKey);

    const sameRowZero = [
      segmentFor(layout, `${nodeKeys.root}>${nodeKeys.rootStep}`),
      segmentFor(layout, `${nodeKeys.root}>${nodeKeys.rootGlb}`),
    ];
    const sameRowOne = [
      segmentFor(layout, `${nodeKeys.module}>${nodeKeys.moduleStep}`),
      segmentFor(layout, `${nodeKeys.module}>${nodeKeys.moduleGlb}`),
    ];
    const across = segmentFor(
      layout,
      `${nodeKeys.root}>${nodeKeys.module}`,
    );

    assertEquals(sameRowZero[0]!.segment.key, sameRowZero[1]!.segment.key);
    assertEquals(sameRowOne[0]!.segment.key, sameRowOne[1]!.segment.key);
    assert(sameRowZero[0]!.segment.key !== sameRowOne[0]!.segment.key);
    assertEquals(sameRowZero[0]!.segment.fromKeys, [nodeKeys.root]);
    assertEquals(sameRowZero[0]!.segment.toKeys, [
      nodeKeys.rootGlb,
      nodeKeys.rootStep,
    ]);
    assertEquals(sameRowZero[0]!.segment.edgeKeys, [
      `${nodeKeys.root}>${nodeKeys.rootGlb}`,
      `${nodeKeys.root}>${nodeKeys.rootStep}`,
    ]);
    assertEquals(sameRowZero[0]!.segment.pathCount, 2);
    assertEquals(sameRowZero[0]!.segment.pathKeys, [
      `recorded:${nodeKeys.root}>${nodeKeys.rootGlb}`,
      `recorded:${nodeKeys.root}>${nodeKeys.rootStep}`,
    ]);

    for (
      const { route, segment } of [...sameRowZero, ...sameRowOne, across]
    ) {
      assertEquals(
        layout.routes.some((candidate) => candidate.edgeKey === route.edgeKey),
        true,
      );
      assert(segment.d.length > 1);
      assert(polylineLength(segment.points) > 0);
      assert(!samePoint(segment.points[0]!, segment.points.at(-1)!));
    }

    assert(
      samePoint(across.segment.points[0]!, rowZero[0]!.rightPort) ||
        samePoint(across.segment.points[0]!, rowZero[0]!.leftPort),
    );
    assert(
      samePoint(across.segment.points.at(-1)!, rowOne[0]!.rightPort) ||
        samePoint(across.segment.points.at(-1)!, rowOne[0]!.leftPort),
    );
    assertEquals(across.segment.fromKeys, [nodeKeys.root]);
    assertEquals(across.segment.toKeys, [nodeKeys.module]);
  }
});

const PHYSICS_GROUP = "physics-proof";
const PHYSICS_HULL = overviewThreadD3FlowGroupIdentity(
  "physics",
  PHYSICS_GROUP,
);

function crossHullSharedDockLayout(view: "tree" | "list" | "matrix") {
  const geometryKeys = [
    "artifact:geometry-root",
    "artifact:cad-asset-root-step",
    "artifact:cad-asset-root-glb",
    "artifact:geometry-module",
    "artifact:cad-asset-module-step",
    "artifact:cad-asset-module-glb",
  ] as const;
  const targetKey = "observation:proof";
  const nodes = [
    ...geometryKeys.map((key) => ({
      key,
      lane: "geometry" as const,
      groupKey: GEOMETRY_GROUP,
      label: key,
    })),
    {
      key: targetKey,
      lane: "physics" as const,
      groupKey: PHYSICS_GROUP,
      label: targetKey,
    },
  ];
  const edges = geometryKeys.map((fromKey, index) => ({
    key: `${fromKey}>${targetKey}`,
    fromKey,
    toKey: targetKey,
    pathCount: fromKey.endsWith("-step") ? 2 : 1,
    pathKeys: [`recorded:${fromKey}>${targetKey}`],
    emphasis: index === 0,
  }));
  return {
    geometryKeys,
    targetKey,
    layout: buildOverviewThreadD3FlowLayout(nodes, edges, {
      groupStructureRowCounts: { [GEOMETRY_HULL]: 2 },
      groupRowAnchors: {
        [GEOMETRY_HULL]: {
          [geometryKeys[0]]: 0,
          [geometryKeys[1]]: 0,
          [geometryKeys[2]]: 0,
          [geometryKeys[3]]: 1,
          [geometryKeys[4]]: 1,
          [geometryKeys[5]]: 1,
        },
      },
      groupPlacements: {
        [GEOMETRY_HULL]: { view },
        [PHYSICS_HULL]: { view: "matrix" },
      },
    }),
  };
}

Deno.test("shared row docks keep one branch per row/role/side and sum exact metadata", () => {
  for (const view of ["tree", "list", "matrix"] as const) {
    const { layout, geometryKeys, targetKey } = crossHullSharedDockLayout(
      view,
    );
    const nodes = new Map(layout.nodes.map((node) => [node.key, node]));
    const rowZero = geometryKeys.slice(0, 3).map((key) => nodes.get(key)!);
    const rowOne = geometryKeys.slice(3).map((key) => nodes.get(key)!);
    const cells = layoutOverviewHullRowCells(
      2,
      layout.groups.find((group) => group.key === GEOMETRY_HULL)!,
    );

    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(
      layout.routes.map((route) => route.edgeKey).toSorted(),
      [
        ...geometryKeys.map((key) => `${key}>${targetKey}`),
      ].toSorted(),
    );
    assertSharedRowDock(
      rowZero,
      cells.find((cell) => cell.index === 0)!,
      view,
    );
    assertSharedRowDock(
      rowOne,
      cells.find((cell) => cell.index === 1)!,
      view,
    );

    const sourceBranches = layout.segments.filter((segment) =>
      segment.kind === "node-branch" && segment.role === "source"
    );
    const targetBranches = layout.segments.filter((segment) =>
      segment.kind === "node-branch" && segment.role === "target"
    );
    assertEquals(sourceBranches.length, 2);
    assertEquals(targetBranches.length, 1);

    const rowZeroRoutes = geometryKeys.slice(0, 3).map((key) =>
      layout.routes.find((route) => route.fromKey === key)!
    );
    const rowOneRoutes = geometryKeys.slice(3).map((key) =>
      layout.routes.find((route) => route.fromKey === key)!
    );
    assertEquals(
      new Set(rowZeroRoutes.map((route) => route.segmentKeys[0])).size,
      1,
    );
    assertEquals(
      new Set(rowOneRoutes.map((route) => route.segmentKeys[0])).size,
      1,
    );
    assert(
      rowZeroRoutes[0]!.segmentKeys[0] !== rowOneRoutes[0]!.segmentKeys[0],
    );

    const rowZeroBranch = layout.segments.find((segment) =>
      segment.key === rowZeroRoutes[0]!.segmentKeys[0]
    )!;
    const rowOneBranch = layout.segments.find((segment) =>
      segment.key === rowOneRoutes[0]!.segmentKeys[0]
    )!;
    assertEquals(
      rowZeroBranch.fromKeys,
      [...geometryKeys.slice(0, 3)].toSorted(),
    );
    assertEquals(rowZeroBranch.toKeys, [targetKey]);
    assertEquals(
      rowZeroBranch.edgeKeys,
      [
        `${geometryKeys[0]}>${targetKey}`,
        `${geometryKeys[1]}>${targetKey}`,
        `${geometryKeys[2]}>${targetKey}`,
      ].toSorted(),
    );
    assertEquals(rowZeroBranch.pathCount, 4);
    assertEquals(rowZeroBranch.pathKeys.length, 3);
    assertEquals(rowZeroBranch.emphasis, true);
    assertEquals(rowOneBranch.fromKeys, [...geometryKeys.slice(3)].toSorted());
    assertEquals(rowOneBranch.pathCount, 4);
    assertEquals(targetBranches[0]!.fromKeys, [...geometryKeys].toSorted());
    assertEquals(targetBranches[0]!.toKeys, [targetKey]);
    assertEquals(targetBranches[0]!.pathCount, 8);

    for (const route of [...rowZeroRoutes, ...rowOneRoutes]) {
      assertEquals(
        route.segmentKeys.map((key) =>
          layout.segments.find((segment) => segment.key === key)?.kind
        ),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
    }
  }
});
