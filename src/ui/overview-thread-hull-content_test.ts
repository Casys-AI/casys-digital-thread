import { assert, assertEquals } from "@std/assert";
import { buildOverviewHullContents } from "./src/project/overview-thread-hull-content.ts";
import {
  buildOverviewThreadD3FlowLayout,
  overviewThreadD3FlowGroupIdentity as groupId,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import type { OverviewRecordedHeroNode } from "./src/project/overview-thread-hero-model.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";

function record(
  id: string,
  lane: OverviewRecordedHeroNode["lane"],
  groupKey: string,
  parent?: string,
): OverviewRecordedHeroNode {
  const key = `artifact:${id}`;
  return {
    key,
    lane,
    groupKey,
    label: id,
    kind: "recorded",
    color: "black",
    emphasis: false,
    ...(parent ? { parentKey: `artifact:${parent}` } : {}),
    node: {
      id: key,
      ref: { kind: "artifact", id },
      entityKind: "artifact",
      label: id,
      freshness: "fresh",
      system: "digital-thread",
      summary: id,
      recordedAt: "2026-09-07T00:00:00Z",
    },
  };
}
const nodes = [
  record("architecture-current", "system-model", "syson"),
  record("architecture-old", "system-model", "syson"),
  record("geometry", "geometry", "canonical"),
  record("geometry-step", "geometry", "build123d"),
  record("brief", "requirements", "brief"),
  record("brief-child", "requirements", "brief", "brief"),
  record("proof", "physics", "proof"),
];
const hierarchy: ThreadViewerHierarchyProjection = {
  schemaVersion: "thread-viewer-hierarchy/1.0",
  status: "available",
  architectureArtifactId: "architecture-current",
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      label: "Assembly",
      partDefinitionElementId: "root-def",
      geometryArtifactId: "geometry",
      artifactIds: ["geometry", "geometry-step"],
      sessionIds: ["app"],
    },
    {
      id: "left",
      parentId: "root",
      label: "Arm",
      usageId: "use-left",
      usageLabel: "Left arm",
      partDefinitionElementId: "arm-def",
      sessionIds: [],
    },
    {
      id: "right",
      parentId: "root",
      label: "Arm",
      usageId: "use-right",
      usageLabel: "Right arm",
      partDefinitionElementId: "arm-def",
      sessionIds: [],
    },
  ],
};
const session: ThreadViewerSession = {
  id: "app",
  kind: "mcp-app",
  anchor: { kind: "artifact", id: "geometry" },
  app: { id: "example", version: "1.0.0" },
  manifest: {
    uri: "ui://example/manifest",
    fingerprint: `sha256:${"a".repeat(64)}`,
  },
  resource: {
    uri: "ui://example/app",
    fingerprint: `sha256:${"b".repeat(64)}`,
    ownership: "whole-view",
    mimeType: "text/html;profile=mcp-app",
    bytes: 1,
  },
  launchUri: "/api/viewer/app",
  readResources: [],
  session: {
    action: "viewer.session.apply",
    schema: "example/1.0",
    payload: {},
    fingerprint: `sha256:${"c".repeat(64)}`,
  },
};

const modelSession: ThreadViewerSession = {
  ...session,
  id: "model-app",
  anchor: { kind: "artifact", id: "architecture-current" },
  app: { id: "io.casys.mcp-syson", version: "1.0.0" },
};

Deno.test("architecture and geometry hulls share the occurrence tree but never borrow each other's App actions", () => {
  const before = JSON.stringify({ nodes, hierarchy });
  const contents = buildOverviewHullContents(
    nodes,
    [session, modelSession],
    hierarchy,
  );
  const syson = contents.get(groupId("system-model", "syson"))!;
  const canonical = contents.get(groupId("geometry", "canonical"))!;
  const build = contents.get(groupId("geometry", "build123d"))!;
  assert(canonical.rows === build.rows);
  assertEquals(
    syson.rows.map(({ sessionIds: _sessions, ...row }) => row),
    canonical.rows.map(({ sessionIds: _sessions, ...row }) => row),
  );
  assertEquals(
    syson.rows.map((row) => [row.key, row.label, row.depth, row.sessionIds]),
    [["root", "Assembly", 0, ["model-app"]], ["left", "Left arm", 1, []], [
      "right",
      "Right arm",
      1,
      [],
    ]],
  );
  assertEquals(syson.records.length, 2);
  assertEquals(canonical.rows[0]!.sessionIds, ["app"]);
  assertEquals(syson.rows.some((row) => row.sessionIds.includes("app")), false);
  assertEquals(JSON.stringify({ nodes, hierarchy }), before);
});

Deno.test("a SysON hull without an exact architecture App stays non-actionable even when CAD is registered", () => {
  const contents = buildOverviewHullContents(nodes, [session], hierarchy);
  assertEquals(
    contents.get(groupId("system-model", "syson"))!.rows.flatMap((row) =>
      row.sessionIds
    ),
    [],
  );
  assertEquals(
    contents.get(groupId("geometry", "canonical"))!.rows[0]!.sessionIds,
    ["app"],
  );
});

Deno.test("geometry navigation refuses session IDs anchored to unrelated records", () => {
  const contents = buildOverviewHullContents(nodes, [session, modelSession], {
    ...hierarchy,
    nodes: hierarchy.nodes.map((node) => ({
      ...node,
      sessionIds: ["model-app"],
    })),
  });
  assertEquals(
    contents.get(groupId("geometry", "canonical"))!.rows.flatMap((row) =>
      row.sessionIds
    ),
    [],
  );
  assertEquals(
    contents.get(groupId("system-model", "syson"))!.rows[0]!.sessionIds,
    ["model-app"],
  );
});

Deno.test("every other hull shares exact record hierarchy with its menu and never borrows geometry by label", () => {
  const contents = buildOverviewHullContents(
    [...nodes, {
      ...record("unrelated", "verdicts", "same-name"),
      label: "Assembly",
    }],
    [session],
    hierarchy,
  );
  const brief = contents.get(groupId("requirements", "brief"))!;
  assert(brief.rows === brief.records);
  assertEquals(brief.rows.map((row) => [row.key, row.depth]), [[
    "artifact:brief",
    0,
  ], ["artifact:brief-child", 1]]);
  assertEquals(contents.get(groupId("verdicts", "same-name"))!.mode, "records");
  assertEquals(contents.get(groupId("physics", "proof"))!.mode, "records");
});

Deno.test("missing current anchors and unavailable hierarchy fail closed while missing Apps stay plain structure", () => {
  const old = buildOverviewHullContents([nodes[1]!], [], hierarchy);
  assertEquals([...old.values()][0]!.mode, "records");
  const noApps = buildOverviewHullContents(nodes, [], hierarchy);
  assertEquals(
    noApps.get(groupId("system-model", "syson"))!.rows[0]!.sessionIds,
    [],
  );
  const unavailable = buildOverviewHullContents(nodes, [session], {
    schemaVersion: hierarchy.schemaVersion,
    status: "unavailable",
    nodes: [],
    rootIds: [],
  });
  assert(
    [...unavailable.values()].every((content) => content.mode === "records"),
  );
});

Deno.test("navigation tree capacity never manufactures graph nodes or sends provenance cables to occurrences", () => {
  const groupKey = groupId("system-model", "syson");
  const graphNodes = nodes.map((node) => ({
    key: node.key,
    label: node.label,
    lane: node.lane,
    groupKey: node.groupKey,
  }));
  const edges = [{
    key: "architecture-requirement",
    fromKey: nodes[0]!.key,
    toKey: nodes[4]!.key,
    pathCount: 1,
    pathKeys: ["canonical-edge"],
    emphasis: false,
  }];
  const layout = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
    avoidGroupOverlap: true,
    groupStructureRowCounts: { [groupKey]: 29 },
    groupPlacements: {
      [groupKey]: { view: "tree", width: 400, height: 170, scrollRow: 24 },
    },
  });
  const hull = layout.groups.find((g) => g.key === groupKey)!;
  assertEquals(hull.rowCount, 29);
  assert(hull.scrollRow > 0);
  assertEquals(layout.nodes.length, graphNodes.length);
  assert(
    layout.nodes.filter((node) => node.groupKey === "syson").every((node) =>
      node.folded
    ),
  );
  assertEquals(layout.unroutedEdgeKeys, []);
  assertEquals(layout.routes.length, edges.length);
  const listed = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
    groupStructureRowCounts: { [groupKey]: 29 },
    groupPlacements: { [groupKey]: { view: "list" } },
  });
  assertEquals(listed.groups.find((g) => g.key === groupKey)!.rowCount, 2);
});
