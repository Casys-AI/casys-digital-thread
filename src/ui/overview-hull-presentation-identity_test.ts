import { assertEquals } from "@std/assert";
import type {
  OverviewHeroNode,
  OverviewRecordedHeroNode,
} from "./src/project/overview-thread-hero-model.ts";
import { overviewThreadD3FlowGroupIdentity } from "./src/project/overview-thread-d3-flow-layout.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import type { OverviewHullContent } from "./src/project/overview/hulls/types.ts";
import { overviewHullRowGraphRefs } from "./src/project/overview/hulls/types.ts";
import { overviewHullRowAnchors } from "./src/project/overview/hulls/row-anchors.ts";
import { buildOverviewHullContents } from "./src/project/overview/hulls/content.ts";
import {
  nextOverviewHullPresentationRowKey,
  overviewContextActionPresentationRowKey,
  overviewHullGraphKeysByPresentationRow,
  overviewHullHierarchyLinkState,
  overviewHullMappedGraphKey,
  overviewHullPresentationRowKey,
  overviewHullPresentationRowLookup,
  parseOverviewHullPresentationRowKey,
} from "./src/project/overview/hulls/presentation-identity.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";

const SYSML_HULL = overviewThreadD3FlowGroupIdentity(
  "system-model",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);
const GEOMETRY_HULL = overviewThreadD3FlowGroupIdentity(
  "geometry",
  OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
);
const ARCHITECTURE_ID = "architecture-8fdff1a0e99f1";
const GEOMETRY_ROOT_ID = "geometry-root";
const GEOMETRY_AIRFRAME_ID = "geometry-airframe";
const ROOT = "root";
const AIRFRAME = "airframe";

function artifact(
  id: string,
  lane: OverviewRecordedHeroNode["lane"],
  groupKey: string,
): OverviewRecordedHeroNode {
  return {
    key: `artifact:${id}`,
    lane,
    groupKey,
    label: id,
    kind: "recorded",
    color: "black",
    emphasis: false,
    node: {
      id: `artifact:${id}`,
      ref: { kind: "artifact", id },
      entityKind: "artifact",
      label: id,
      freshness: "fresh",
      system: "digital-thread",
      summary: id,
    },
  };
}

function navigationRow(
  key: string,
  parentKey?: string,
): OverviewHullContent["rows"][number] {
  return {
    key,
    kind: "navigation",
    label: key,
    depth: parentKey ? 1 : 0,
    ...(parentKey ? { parentKey } : {}),
    sessionIds: [],
    endpoint: false,
  };
}

function content(
  groupKey: string,
  rows: OverviewHullContent["rows"],
): OverviewHullContent {
  return { groupKey, mode: "tree", rows, records: [] };
}

function hierarchy(
  nodes: ThreadViewerHierarchyProjection["nodes"],
  extras: {
    readonly architectureArtifactId?: string;
    readonly rootIds?: readonly string[];
  } = {},
): ThreadViewerHierarchyProjection {
  const rootIds = extras.rootIds ??
    nodes.filter((node) => node.parentId === undefined).map((node) => node.id);
  return {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    ...(extras.architectureArtifactId
      ? { architectureArtifactId: extras.architectureArtifactId }
      : {}),
    nodes,
    rootIds,
  };
}

function liveShapedWorld() {
  const nodes: readonly OverviewHeroNode[] = [
    artifact(
      ARCHITECTURE_ID,
      "system-model",
      OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    ),
    artifact(
      GEOMETRY_ROOT_ID,
      "geometry",
      OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
    ),
    artifact(
      GEOMETRY_AIRFRAME_ID,
      "geometry",
      OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
    ),
  ];
  const rows = [
    navigationRow(ROOT),
    navigationRow(AIRFRAME, ROOT),
  ];
  const contents = new Map([
    [SYSML_HULL, content(SYSML_HULL, rows)],
    [GEOMETRY_HULL, content(GEOMETRY_HULL, rows)],
  ]);
  const projection = hierarchy(
    [
      {
        id: ROOT,
        label: "Assembly",
        partDefinitionElementId: "def-root",
        geometryArtifactId: GEOMETRY_ROOT_ID,
        artifactIds: [GEOMETRY_ROOT_ID],
        sessionIds: [],
      },
      {
        id: AIRFRAME,
        parentId: ROOT,
        label: "Airframe",
        partDefinitionElementId: "def-airframe",
        geometryArtifactId: GEOMETRY_AIRFRAME_ID,
        artifactIds: [GEOMETRY_AIRFRAME_ID],
        sessionIds: [],
      },
    ],
    { architectureArtifactId: ARCHITECTURE_ID },
  );
  const anchors = overviewHullRowAnchors(contents, nodes, projection);
  return { nodes, contents, anchors };
}

Deno.test("live SYSML and Geometry hull identities stay distinct while reusing occurrence keys", () => {
  assertEquals(
    SYSML_HULL,
    "group:12:system-model|18:domain:sysml-model",
  );
  assertEquals(GEOMETRY_HULL, "group:8:geometry|15:domain:geometry");
  assertEquals(SYSML_HULL === GEOMETRY_HULL, false);
});

Deno.test("presentation row keys are group-scoped and parse only exact composites", () => {
  const sysmlRoot = overviewHullPresentationRowKey(SYSML_HULL, ROOT);
  const geometryRoot = overviewHullPresentationRowKey(GEOMETRY_HULL, ROOT);
  assertEquals(sysmlRoot === geometryRoot, false);
  assertEquals(parseOverviewHullPresentationRowKey(sysmlRoot), {
    groupKey: SYSML_HULL,
    rowKey: ROOT,
  });
  assertEquals(parseOverviewHullPresentationRowKey(geometryRoot), {
    groupKey: GEOMETRY_HULL,
    rowKey: ROOT,
  });
  assertEquals(parseOverviewHullPresentationRowKey(ROOT), undefined);
  assertEquals(
    parseOverviewHullPresentationRowKey(`hull-row:["${SYSML_HULL}"]`),
    undefined,
  );
  assertEquals(
    parseOverviewHullPresentationRowKey(
      `hull-row: [ "${SYSML_HULL}", "${ROOT}" ]`,
    ),
    undefined,
  );
});

Deno.test("two hulls with identical occurrence keys cannot cross-select, cross-highlight, or cross-anchor viewers", () => {
  const { contents, anchors } = liveShapedWorld();
  const known = new Set([
    `artifact:${ARCHITECTURE_ID}`,
    `artifact:${GEOMETRY_ROOT_ID}`,
    `artifact:${GEOMETRY_AIRFRAME_ID}`,
  ]);
  const graphKeys = overviewHullGraphKeysByPresentationRow(contents, anchors);
  const sysmlRoot = overviewHullPresentationRowKey(SYSML_HULL, ROOT);
  const geometryRoot = overviewHullPresentationRowKey(GEOMETRY_HULL, ROOT);
  const sysmlChild = overviewHullPresentationRowKey(SYSML_HULL, AIRFRAME);
  const geometryChild = overviewHullPresentationRowKey(
    GEOMETRY_HULL,
    AIRFRAME,
  );
  const sysmlRows = contents.get(SYSML_HULL)!.rows;
  const geometryRows = contents.get(GEOMETRY_HULL)!.rows;

  assertEquals(graphKeys.get(sysmlRoot), [`artifact:${ARCHITECTURE_ID}`]);
  assertEquals(graphKeys.get(geometryRoot), [`artifact:${GEOMETRY_ROOT_ID}`]);
  assertEquals(graphKeys.get(sysmlChild) ?? [], []);
  assertEquals(graphKeys.get(geometryChild), [
    `artifact:${GEOMETRY_AIRFRAME_ID}`,
  ]);

  assertEquals(
    overviewHullMappedGraphKey(
      SYSML_HULL,
      sysmlRows[0]!,
      anchors,
      sysmlRows,
      known,
    ),
    `artifact:${ARCHITECTURE_ID}`,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      GEOMETRY_HULL,
      geometryRows[0]!,
      anchors,
      geometryRows,
      known,
    ),
    `artifact:${GEOMETRY_ROOT_ID}`,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      SYSML_HULL,
      sysmlRows[1]!,
      anchors,
      sysmlRows,
      known,
    ),
    undefined,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      GEOMETRY_HULL,
      geometryRows[1]!,
      anchors,
      geometryRows,
      known,
    ),
    `artifact:${GEOMETRY_AIRFRAME_ID}`,
  );

  assertEquals(
    overviewHullHierarchyLinkState(SYSML_HULL, ROOT, AIRFRAME, sysmlRoot),
    "outgoing",
  );
  assertEquals(
    overviewHullHierarchyLinkState(GEOMETRY_HULL, ROOT, AIRFRAME, sysmlRoot),
    "muted",
  );
  assertEquals(
    overviewHullHierarchyLinkState(SYSML_HULL, ROOT, AIRFRAME, geometryRoot),
    "muted",
  );
  assertEquals(
    overviewHullHierarchyLinkState(
      GEOMETRY_HULL,
      ROOT,
      AIRFRAME,
      geometryRoot,
    ),
    "outgoing",
  );

  assertEquals(
    overviewHullPresentationRowLookup(sysmlRoot, contents),
    { groupKey: SYSML_HULL, rowKey: ROOT, index: 0 },
  );
  assertEquals(
    overviewHullPresentationRowLookup(geometryRoot, contents),
    { groupKey: GEOMETRY_HULL, rowKey: ROOT, index: 0 },
  );
  assertEquals(
    overviewHullPresentationRowLookup(ROOT, contents),
    undefined,
  );
});

Deno.test("SYSML unique declared root anchors exact architecture and children stay navigation-only", () => {
  const { contents, anchors } = liveShapedWorld();
  assertEquals(anchors[SYSML_HULL], {
    [`artifact:${ARCHITECTURE_ID}`]: 0,
  });
  assertEquals(anchors[GEOMETRY_HULL], {
    [`artifact:${GEOMETRY_ROOT_ID}`]: 0,
    [`artifact:${GEOMETRY_AIRFRAME_ID}`]: 1,
  });
  assertEquals(
    `artifact:${ARCHITECTURE_ID}` in (anchors[GEOMETRY_HULL] ?? {}),
    false,
  );
  assertEquals(
    `artifact:${GEOMETRY_ROOT_ID}` in (anchors[SYSML_HULL] ?? {}),
    false,
  );
  const sysmlRows = contents.get(SYSML_HULL)!.rows;
  assertEquals(sysmlRows[1]?.key, AIRFRAME);
  assertEquals(
    Object.values(anchors[SYSML_HULL] ?? {}).includes(1),
    false,
  );
});

Deno.test("ambiguous SYSML roots or a nonmember architecture artifact fail closed", () => {
  const rows = [navigationRow(ROOT), navigationRow(AIRFRAME, ROOT)];
  const sysmlOnly = new Map([[SYSML_HULL, content(SYSML_HULL, rows)]]);
  const architecture = artifact(
    ARCHITECTURE_ID,
    "system-model",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const multipleRoots = overviewHullRowAnchors(
    sysmlOnly,
    [architecture],
    hierarchy(
      [
        {
          id: ROOT,
          label: "Assembly",
          partDefinitionElementId: "def-root",
          sessionIds: [],
        },
        {
          id: AIRFRAME,
          label: "Airframe",
          partDefinitionElementId: "def-airframe",
          sessionIds: [],
        },
      ],
      {
        architectureArtifactId: ARCHITECTURE_ID,
        rootIds: [ROOT, AIRFRAME],
      },
    ),
  );
  assertEquals(multipleRoots[SYSML_HULL], {});

  const nonmember = overviewHullRowAnchors(
    sysmlOnly,
    [
      artifact(
        "other-architecture",
        "system-model",
        OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
      ),
    ],
    hierarchy(
      [{
        id: ROOT,
        label: "Assembly",
        partDefinitionElementId: "def-root",
        sessionIds: [],
      }],
      { architectureArtifactId: ARCHITECTURE_ID },
    ),
  );
  assertEquals(nonmember[SYSML_HULL], {});
});

Deno.test("raw and hierarchy projections retarget the same graph ref through graphRefs", () => {
  const geometry = artifact(
    GEOMETRY_ROOT_ID,
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const raw = buildOverviewHullContents([geometry], []);
  const rawRows = raw.get(GEOMETRY_HULL)!.rows;
  const rawRow = rawRows.find((row) =>
    row.key === `artifact:${GEOMETRY_ROOT_ID}`
  )!;
  assertEquals(overviewHullRowGraphRefs(rawRow), [
    `artifact:${GEOMETRY_ROOT_ID}`,
  ]);
  const structuredNodes = [{
    id: ROOT,
    label: "Assembly",
    partDefinitionElementId: "def-root",
    geometryArtifactId: GEOMETRY_ROOT_ID,
    artifactIds: [GEOMETRY_ROOT_ID],
    sessionIds: [] as string[],
  }];
  const structuredHierarchy = hierarchy(structuredNodes);
  const structured = buildOverviewHullContents(
    [geometry],
    [],
    structuredHierarchy,
  );
  const structuredRows = structured.get(GEOMETRY_HULL)!.rows;
  const overlay = structuredRows.find((row) =>
    overviewHullRowGraphRefs(row).includes(`artifact:${GEOMETRY_ROOT_ID}`)
  )!;
  assertEquals(overlay.key, ROOT);
  assertEquals(overlay.key === rawRow.key, false);
  const known = new Set([`artifact:${GEOMETRY_ROOT_ID}`]);
  const rawAnchors = overviewHullRowAnchors(raw, [geometry]);
  const structuredAnchors = overviewHullRowAnchors(
    structured,
    [geometry],
    structuredHierarchy,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      GEOMETRY_HULL,
      rawRow,
      rawAnchors,
      rawRows,
      known,
    ),
    `artifact:${GEOMETRY_ROOT_ID}`,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      GEOMETRY_HULL,
      overlay,
      structuredAnchors,
      structuredRows,
      known,
    ),
    `artifact:${GEOMETRY_ROOT_ID}`,
  );
  const graphKeys = overviewHullGraphKeysByPresentationRow(
    structured,
    structuredAnchors,
  );
  assertEquals(
    graphKeys.get(overviewHullPresentationRowKey(GEOMETRY_HULL, overlay.key)),
    [`artifact:${GEOMETRY_ROOT_ID}`],
  );
});

Deno.test("toggle-off and explicit clear drop the presentation row without leaking the other hull", () => {
  const sysmlRoot = overviewHullPresentationRowKey(SYSML_HULL, ROOT);
  const geometryRoot = overviewHullPresentationRowKey(GEOMETRY_HULL, ROOT);
  assertEquals(
    nextOverviewHullPresentationRowKey(undefined, sysmlRoot),
    sysmlRoot,
  );
  assertEquals(
    nextOverviewHullPresentationRowKey(sysmlRoot, sysmlRoot),
    undefined,
  );
  assertEquals(
    nextOverviewHullPresentationRowKey(sysmlRoot, geometryRoot),
    geometryRoot,
  );
  assertEquals(
    overviewContextActionPresentationRowKey(undefined),
    undefined,
  );
  assertEquals(
    overviewContextActionPresentationRowKey(sysmlRoot),
    sysmlRoot,
  );
  assertEquals(
    overviewContextActionPresentationRowKey(undefined) === geometryRoot,
    false,
  );
});

Deno.test("records-mode graphRefs stay exact identities and never select a folder key", () => {
  const hullKey = overviewThreadD3FlowGroupIdentity(
    "physics",
    OVERVIEW_DOMAIN_GROUP_KEYS.fea,
  );
  const row: OverviewHullContent["rows"][number] = {
    key: "artifact:fea-proof",
    kind: "record",
    label: "Proof",
    depth: 0,
    nodeKey: "artifact:fea-proof",
    graphRefs: ["artifact:fea-proof"],
    sessionIds: [],
    endpoint: true,
  };
  const folder: OverviewHullContent["rows"][number] = {
    key: "engineering-case:series",
    kind: "navigation",
    label: "Series",
    depth: 0,
    graphRefs: [],
    sessionIds: [],
    endpoint: false,
  };
  const contents = new Map([
    [hullKey, {
      groupKey: hullKey,
      mode: "records" as const,
      rows: [folder, row],
      records: [row],
    }],
  ]);
  const known = new Set(["artifact:fea-proof"]);
  const anchors = overviewHullRowAnchors(contents, [
    artifact("fea-proof", "physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea),
  ]);
  assertEquals(anchors[hullKey], { "artifact:fea-proof": 1 });
  assertEquals(
    overviewHullMappedGraphKey(hullKey, row, anchors, [folder, row], known),
    "artifact:fea-proof",
  );
  assertEquals(
    overviewHullMappedGraphKey(hullKey, folder, anchors, [folder, row], known),
    undefined,
  );
  assertEquals(overviewHullRowGraphRefs(folder), []);
});
