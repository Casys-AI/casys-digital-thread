import { assert, assertEquals } from "@std/assert";
import {
  buildOverviewHullContents,
  overviewAnalysisBasisGroupKey,
  overviewBriefSnapshotGroupKey,
  overviewHullCanHostViewerHierarchy,
  overviewHullHierarchyPendingPlaceholders,
  overviewHullStructureRowCounts,
} from "./src/project/overview/hulls/content.ts";
import {
  overviewBriefReferencedSnapshotLabel,
  withOverviewCurrentBriefContent,
} from "./src/project/overview/hulls/current-brief.ts";
import { overviewHullMappedGraphKey } from "./src/project/overview/hulls/presentation-identity.ts";
import { overviewHullRowGraphRefs } from "./src/project/overview/hulls/types.ts";
import { overviewHullRowAnchors } from "./src/project/overview/hulls/row-anchors.ts";
import {
  activateOverviewHullRow,
  overviewHullRowActions,
  overviewHullRowPresentation,
  overviewHullRowTooltip,
} from "./src/project/overview/hulls/row.ts";
import {
  buildOverviewThreadD3FlowLayout,
  overviewThreadD3FlowGroupIdentity as groupId,
} from "./src/project/overview-thread-d3-flow-layout.ts";
import {
  type OverviewBriefSourceHeroNode,
  overviewBriefSourceKey,
} from "./src/project/overview-thread-brief-correspondence.ts";
import type { OverviewRecordedHeroNode } from "./src/project/overview-thread-hero-model.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import { overviewRequirementSourceViewerAliases } from "./src/project/overview-thread-viewer-discovery.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";

function hullContents(
  members: Parameters<typeof buildOverviewHullContents>[0],
  sessions: Parameters<typeof buildOverviewHullContents>[1] = [],
  hierarchy?: Parameters<typeof buildOverviewHullContents>[2],
) {
  return withOverviewCurrentBriefContent(
    buildOverviewHullContents(members, sessions, hierarchy),
    members,
    undefined,
  );
}

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
  record("geometry", "geometry", "domain:geometry"),
  record("geometry-step", "geometry", "domain:geometry"),
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
  const canonical = contents.get(groupId("geometry", "domain:geometry"))!;
  assertEquals(canonical.records.length, 2);
  assertEquals(
    [...contents.values()].filter((content) =>
      content.groupKey === groupId("geometry", "domain:geometry")
    ).length,
    1,
  );
  const sharedTree = (
    {
      sessionIds: _sessions,
      viewerNodeKey: _viewer,
      graphRefs: _graphRefs,
      role: _role,
      selectable: _selectable,
      focusable: _focusable,
      detail: _detail,
      availability: _availability,
      ...row
    }: (typeof syson.rows)[number],
  ) => row;
  assertEquals(syson.rows.map(sharedTree), canonical.rows.map(sharedTree));
  assertEquals(overviewHullRowGraphRefs(syson.rows[0]!), [
    "artifact:architecture-current",
  ]);
  assertEquals(syson.rows[0]!.role, "overlay");
  assertEquals(overviewHullRowGraphRefs(canonical.rows[0]!), [
    "artifact:geometry",
    "artifact:geometry-step",
  ]);
  assertEquals(canonical.rows[0]!.role, "overlay");
  assertEquals(overviewHullRowGraphRefs(syson.rows[1]!), []);
  assertEquals(syson.rows[1]!.role, "folder");
  assertEquals(syson.rows[1]!.endpoint, false);
  assertEquals(syson.rows[1]!.detail, "Arm");
  assertEquals(syson.rows[1]!.availability, undefined);
  assertEquals(canonical.rows[1]!.detail, "unjoined · pending CAD");
  assertEquals(canonical.rows[1]!.availability, "unresolved");
  assertEquals(canonical.rows[2]!.detail, "unjoined · pending CAD");
  assertEquals(overviewHullRowGraphRefs(canonical.rows[1]!), []);
  assertEquals(canonical.rows[1]!.endpoint, false);
  assertEquals(canonical.rows[1]!.sessionIds, []);
  assertEquals(canonical.rows[0]!.detail, undefined);
  assertEquals(canonical.rows[0]!.availability, undefined);
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

Deno.test("the same geometry graph ref survives raw records and hierarchy overlay", () => {
  const geometryMembers = nodes.filter((node) => node.lane === "geometry");
  const geometryKey = groupId("geometry", "domain:geometry");
  const raw = buildOverviewHullContents(geometryMembers, []);
  const rawRow = raw.get(geometryKey)!.rows.find((row) =>
    row.key === "artifact:geometry"
  )!;
  assertEquals(overviewHullRowGraphRefs(rawRow), ["artifact:geometry"]);
  assertEquals(rawRow.endpoint, true);
  const structured = buildOverviewHullContents(
    geometryMembers,
    [],
    hierarchy,
  );
  const overlay = structured.get(geometryKey)!.rows.find((row) =>
    overviewHullRowGraphRefs(row).includes("artifact:geometry")
  )!;
  assertEquals(overlay.key === rawRow.key, false);
  assertEquals(overlay.role, "overlay");
  assertEquals(
    overviewHullRowGraphRefs(overlay).includes("artifact:geometry"),
    true,
  );
  const known = { has: (key: string) => key === "artifact:geometry" };
  const rawAnchors = overviewHullRowAnchors(raw, geometryMembers);
  const structuredAnchors = overviewHullRowAnchors(
    structured,
    geometryMembers,
    hierarchy,
  );
  assertEquals(
    overviewHullMappedGraphKey(
      geometryKey,
      rawRow,
      rawAnchors,
      raw.get(geometryKey)!.rows,
      known,
    ),
    "artifact:geometry",
  );
  assertEquals(
    overviewHullMappedGraphKey(
      geometryKey,
      overlay,
      structuredAnchors,
      structured.get(geometryKey)!.rows,
      known,
    ),
    "artifact:geometry",
  );
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
    contents.get(groupId("geometry", "domain:geometry"))!.rows[0]!.sessionIds,
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
    contents.get(groupId("geometry", "domain:geometry"))!.rows.flatMap((row) =>
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

Deno.test("pending hierarchy placeholders use graph outline counts on candidate hulls only", () => {
  const contents = buildOverviewHullContents(nodes, [], undefined);
  const placeholders = overviewHullHierarchyPendingPlaceholders(
    nodes,
    contents,
  );
  const sysonKey = groupId("system-model", "syson");
  const geometryKey = groupId("geometry", "domain:geometry");
  const briefKey = groupId("requirements", "brief");
  const proofKey = groupId("physics", "proof");
  assertEquals(
    overviewHullCanHostViewerHierarchy(
      nodes.filter((node) => groupId(node.lane, node.groupKey) === sysonKey),
    ),
    true,
  );
  assertEquals(
    overviewHullCanHostViewerHierarchy(
      nodes.filter((node) => groupId(node.lane, node.groupKey) === geometryKey),
    ),
    true,
  );
  assertEquals(
    overviewHullCanHostViewerHierarchy(
      nodes.filter((node) => groupId(node.lane, node.groupKey) === briefKey),
    ),
    false,
  );
  assertEquals(placeholders.get(sysonKey), contents.get(sysonKey)!.rows.length);
  assertEquals(
    placeholders.get(geometryKey),
    contents.get(geometryKey)!.rows.length,
  );
  assertEquals(placeholders.has(briefKey), false);
  assertEquals(placeholders.has(proofKey), false);
  assertEquals(
    [...placeholders.values()].every((count) => count > 0),
    true,
  );
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
  const fallback = overviewHullHierarchyPendingPlaceholders(nodes, unavailable);
  assertEquals(fallback.get(groupId("system-model", "syson"))! > 0, true);
  assertEquals(fallback.get(groupId("geometry", "domain:geometry"))! > 0, true);
  assertEquals(fallback.has(groupId("requirements", "brief")), false);
});

Deno.test("every non-empty hull, including records mode, contributes the same structure row count", () => {
  const contents = buildOverviewHullContents(nodes, [], undefined);
  const counts = overviewHullStructureRowCounts(contents);
  for (const [groupKey, content] of contents) {
    if (content.rows.length === 0) {
      assertEquals(counts[groupKey], undefined);
      continue;
    }
    assertEquals(counts[groupKey], content.rows.length);
  }
  const briefKey = groupId("requirements", "brief");
  const proofKey = groupId("physics", "proof");
  assertEquals(contents.get(briefKey)?.mode, "records");
  assertEquals(contents.get(proofKey)?.mode, "records");
  assertEquals(counts[briefKey], contents.get(briefKey)!.rows.length);
  assertEquals(counts[proofKey], contents.get(proofKey)!.rows.length);
  const pending = overviewHullHierarchyPendingPlaceholders(nodes, contents);
  const overlaid = overviewHullStructureRowCounts(contents, pending);
  for (const [key, count] of pending) {
    assertEquals(overlaid[key], count);
  }
});

Deno.test("records-mode rows keep exact graph docks without becoming a second renderer", () => {
  const contents = buildOverviewHullContents(nodes, [], undefined);
  const briefKey = groupId("requirements", "brief");
  const brief = contents.get(briefKey)!;
  assertEquals(brief.mode, "records");
  const anchors = overviewHullRowAnchors(contents, nodes);
  assertEquals(anchors[briefKey]?.["artifact:brief"], 0);
  assertEquals(anchors[briefKey]?.["artifact:brief-child"], 1);
});

function briefSource(
  snapshotId: string,
  briefId: string,
  revision: number,
  sourceItemId: string,
  extras: {
    readonly statement?: string;
    readonly dependsOnItemIds?: readonly string[];
  } = {},
): OverviewBriefSourceHeroNode {
  return {
    kind: "brief-source",
    key: overviewBriefSourceKey(snapshotId, sourceItemId),
    lane: "requirements",
    groupKey: "brief",
    label: sourceItemId,
    color: "#7c3aed",
    emphasis: false,
    brief: { briefId, snapshotId, revision },
    sourceItem: {
      id: sourceItemId,
      kind: "success-criterion",
      statement: extras.statement ?? "Exact approved clause.",
      sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
      ...(extras.dependsOnItemIds ? { dependsOnItemIds: extras.dependsOnItemIds } : {}),
    },
    correspondences: [{
      trace: {
        artifactId: "claim",
        status: "available",
        threadRequirementIds: ["REQ-1"],
        originalBrief: { briefId, snapshotId, revision },
        currentBrief: { briefId, snapshotId, revision },
        container: {
          sourceItemId,
          originalSourceItem: {
            id: sourceItemId,
            kind: "success-criterion",
            statement: extras.statement ?? "Exact approved clause.",
            sourceRefs: [{ kind: "intent", reference: "conversation:fixture" }],
          },
          state: "unchanged",
        },
        requirements: [],
      },
      requirementId: "metric",
      threadRequirementId: "REQ-1",
      sourceItemId,
    }],
  };
}

const BRIEF_ANALYSIS_BASIS =
  "903b6e7f4a890d3ba29c01a9e89db922a9fce6a4978a36340079854d50b07829";

function analysisRecord(
  id: string,
  semantic: {
    readonly domain:
      | "brief"
      | "sysml"
      | "cad"
      | "modelica"
      | "calculix"
      | "thread";
    readonly kind: string;
    readonly id: string;
    readonly basisFingerprint?: string;
  },
  extras: { readonly parentKey?: string } = {},
): OverviewRecordedHeroNode {
  const key = `analysis-node:${id}`;
  return {
    key,
    lane: "requirements",
    groupKey: "brief",
    label: semantic.id,
    kind: "recorded",
    color: "black",
    emphasis: false,
    ...(extras.parentKey ? { parentKey: extras.parentKey } : {}),
    node: {
      id: key,
      ref: { kind: "analysis-node", id },
      entityKind: "analysis-node",
      label: semantic.id,
      freshness: "fresh",
      system: semantic.domain,
      summary: `${semantic.kind} · ${semantic.domain}`,
      analysis: { semanticRef: semantic },
    },
  };
}

Deno.test("brief hull groups exact source notes by snapshot identity without parenting the baseline record", () => {
  const baseline = record(
    "approved-brief-document-r1",
    "requirements",
    "brief",
  );
  const source = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "camera-bracket-bench-stress",
  );
  const contents = hullContents([baseline, source]);
  const brief = contents.get(groupId("requirements", "brief"))!;
  const groupKey = overviewBriefSnapshotGroupKey(source.brief);
  assertEquals(brief.mode, "tree");
  assertEquals(
    brief.rows.map((row) => [
      row.key,
      row.kind,
      row.depth,
      row.parentKey,
      row.nodeKey,
      row.endpoint,
    ]),
    [[
      baseline.key,
      "record",
      0,
      undefined,
      baseline.key,
      true,
    ], [
      groupKey,
      "navigation",
      0,
      undefined,
      undefined,
      false,
    ], [
      source.key,
      "source",
      1,
      groupKey,
      source.key,
      true,
    ]],
  );
  assertEquals(
    brief.records.map((row) => [row.key, row.kind, row.nodeKey]),
    [
      [baseline.key, "record", baseline.key],
      [source.key, "source", source.key],
    ],
  );
  assertEquals(
    brief.rows.some((row) => row.parentKey === baseline.key),
    false,
  );
});

Deno.test("the same sourceItemId in two snapshots stays distinct and never invents an r3-to-r1 parent", () => {
  const r1 = briefSource(
    "fixture:brief:r1:historic",
    "fixture:brief",
    1,
    "clause",
  );
  const r3 = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "clause",
  );
  const contents = hullContents([r1, r3]);
  const brief = contents.get(groupId("requirements", "brief"))!;
  const groupR1 = overviewBriefSnapshotGroupKey(r1.brief);
  const groupR3 = overviewBriefSnapshotGroupKey(r3.brief);
  assertEquals(r1.key === r3.key, false);
  assertEquals(
    brief.rows.map((row) => [row.key, row.parentKey, row.nodeKey]),
    [
      [groupR1, undefined, undefined],
      [r1.key, groupR1, r1.key],
      [groupR3, undefined, undefined],
      [r3.key, groupR3, r3.key],
    ],
  );
  assertEquals(
    brief.rows.some((row) => row.parentKey === groupR1 && row.nodeKey === r3.key),
    false,
  );
});

Deno.test("multiple requirements sharing one exact clause keep a single source row", () => {
  const source = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "clause",
  );
  const contents = hullContents([source, { ...source }]);
  const brief = contents.get(groupId("requirements", "brief"))!;
  assertEquals(
    brief.rows.filter((row) => row.kind === "source").map((row) => row.key),
    [source.key],
  );
});

Deno.test("conflicting or dangling brief identity fails closed instead of inventing a snapshot tree", () => {
  const dangling = briefSource(" ", "fixture:brief", 3, "dangling");
  const conflictA = briefSource("same-snapshot", "brief-a", 3, "clause-a");
  const conflictB = briefSource("same-snapshot", "brief-b", 3, "clause-b");
  const contents = hullContents(
    [dangling, conflictA, conflictB],
  );
  const brief = contents.get(groupId("requirements", "brief"))!;
  assertEquals(brief.mode, "tree");
  assertEquals(
    brief.rows.map((row) => [row.key, row.kind, row.depth, row.parentKey]),
    [
      [dangling.key, "source", 0, undefined],
      [conflictA.key, "source", 0, undefined],
      [conflictB.key, "source", 0, undefined],
    ],
  );
  assertEquals(brief.rows.every((row) => row.kind !== "navigation"), true);
});

Deno.test("dependsOnItemIds never become brief tree containment", () => {
  const parent = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "parent-clause",
  );
  const child = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "child-clause",
    { dependsOnItemIds: ["parent-clause"] },
  );
  const contents = hullContents([parent, child]);
  const brief = contents.get(groupId("requirements", "brief"))!;
  const groupKey = overviewBriefSnapshotGroupKey(parent.brief);
  assertEquals(
    brief.rows.filter((row) => row.kind === "source").map((row) => [
      row.key,
      row.parentKey,
      row.depth,
    ]),
    [
      [child.key, groupKey, 1],
      [parent.key, groupKey, 1],
    ],
  );
});

Deno.test("product hierarchy stays a navigation tree with App actions separated from the brief hull", () => {
  const source = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "clause",
  );
  const contents = hullContents(
    [...nodes, source],
    [session, modelSession],
    hierarchy,
  );
  const syson = contents.get(groupId("system-model", "syson"))!;
  const brief = contents.get(groupId("requirements", "brief"))!;
  assertEquals(syson.mode, "tree");
  assertEquals(brief.mode, "tree");
  assertEquals(
    syson.rows.map((row) => [row.kind, row.endpoint, row.sessionIds]),
    [
      ["navigation", false, ["model-app"]],
      ["navigation", false, []],
      ["navigation", false, []],
    ],
  );
  assertEquals(brief.rows.every((row) => row.sessionIds.length === 0), true);
  assertEquals(
    brief.records.map((row) => row.key).sort(),
    ["artifact:brief", "artifact:brief-child", source.key].sort(),
  );
});

Deno.test("canvas and contextual menu share one hull row action model", () => {
  const source = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "clause",
  );
  const contents = hullContents(
    [...nodes, source],
    [session, modelSession],
    hierarchy,
  );
  const syson = contents.get(groupId("system-model", "syson"))!;
  const brief = contents.get(groupId("requirements", "brief"))!;
  const root = syson.rows[0]!;
  const group = brief.rows.find((row) => row.kind === "navigation")!;
  const clause = brief.rows.find((row) => row.kind === "source")!;
  assertEquals(overviewHullRowActions(root), [{
    kind: "open-session",
    sessionId: "model-app",
    nodeKey: "artifact:architecture-current",
  }]);
  assertEquals(overviewHullRowActions(group), []);
  assertEquals(overviewHullRowActions(clause), [{
    kind: "select-node",
    nodeKey: source.key,
  }]);
  assertEquals(
    overviewHullRowPresentation(group).caption.includes("Navigation"),
    true,
  );
  assertEquals(overviewHullRowTooltip(group, "tree").title, group.label);
  assertEquals(overviewHullRowTooltip(clause, "matrix"), {
    title: clause.label,
    body: "Source clause",
  });
  assertEquals(overviewHullRowTooltip(root, "matrix").body, "Open viewer");
  assertEquals(root.kind === "record", false);
  const selected: string[] = [];
  const opened: string[] = [];
  activateOverviewHullRow(clause, {
    selectNode: (key) => selected.push(key),
    openSession: (sessionId, nodeKey) => opened.push(`${sessionId}:${nodeKey}`),
  });
  activateOverviewHullRow(root, {
    selectNode: (key) => selected.push(key),
    openSession: (sessionId, nodeKey) => opened.push(`${sessionId}:${nodeKey}`),
  });
  activateOverviewHullRow(group, {
    selectNode: (key) => selected.push(key),
    openSession: (sessionId, nodeKey) => opened.push(`${sessionId}:${nodeKey}`),
  });
  assertEquals(selected, [source.key]);
  assertEquals(opened, ["model-app:artifact:architecture-current"]);
});

Deno.test("brief tree overlay keeps exact source endpoints and does not fabricate graph nodes", () => {
  const baseline = record(
    "approved-brief-document-r1",
    "requirements",
    "brief",
  );
  const source = briefSource(
    "fixture:brief:r3:exact",
    "fixture:brief",
    3,
    "clause",
  );
  const requirement = record("REQ-MECH-014", "requirements", "requirements");
  const graphNodes = [baseline, source, requirement].map((node) => ({
    key: node.key,
    label: node.label,
    lane: node.lane,
    groupKey: node.groupKey,
  }));
  const contents = hullContents(
    [baseline, source, requirement],
  );
  const briefKey = groupId("requirements", "brief");
  const brief = contents.get(briefKey)!;
  const edges = [{
    key: "brief-correspondence",
    fromKey: source.key,
    toKey: requirement.key,
    pathCount: 1,
    pathKeys: ["brief-correspondence"],
    emphasis: false,
  }];
  const tree = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
    avoidGroupOverlap: true,
    groupStructureRowCounts: { [briefKey]: brief.rows.length },
    groupPlacements: { [briefKey]: { view: "tree" } },
  });
  const hull = tree.groups.find((group) => group.key === briefKey)!;
  assertEquals(hull.rowCount, brief.rows.length);
  assertEquals(
    tree.nodes.map((node) => node.key).sort(),
    graphNodes.map((node) => node.key).sort(),
  );
  assertEquals(
    tree.nodes.some((node) => node.key === overviewBriefSnapshotGroupKey(source.brief)),
    false,
  );
  assertEquals(tree.unroutedEdgeKeys, []);
  assertEquals(tree.routes.map((route) => [route.fromKey, route.toKey]), [[
    source.key,
    requirement.key,
  ]]);
  const listed = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
    groupPlacements: { [briefKey]: { view: "list" } },
  });
  assertEquals(
    listed.groups.find((group) => group.key === briefKey)!.rowCount,
    2,
  );
  const points = buildOverviewThreadD3FlowLayout(graphNodes, edges, {
    groupPlacements: { [briefKey]: { view: "matrix" } },
  });
  assertEquals(
    points.groups.find((group) => group.key === briefKey)!.view,
    "matrix",
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
  assertEquals(listed.groups.find((g) => g.key === groupKey)!.rowCount, 29);
  assertEquals(listed.nodes.length, graphNodes.length);
});

Deno.test("brief tree retains recorded analysis, baseline, and exact r3 sources together", () => {
  const baseline = record(
    "approved-brief-document-e098fa2f286b770b02292d7f46752a3eecae363f03d10cab3e7c8f1267804bb1",
    "requirements",
    "brief",
  );
  const camera = analysisRecord("subsystem-camera", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-camera",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const airframe = analysisRecord("subsystem-airframe", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-airframe",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const cameraSource = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "camera-bracket-bench-stress",
  );
  const enduranceSource = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "endurance-hover-minutes",
  );
  const members = [
    baseline,
    camera,
    airframe,
    cameraSource,
    enduranceSource,
  ];
  const contents = hullContents(members);
  const brief = contents.get(groupId("requirements", "brief"))!;
  const analysisGroup = overviewAnalysisBasisGroupKey({
    domain: "brief",
    kind: "brief-item",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const snapshotGroup = overviewBriefSnapshotGroupKey(cameraSource.brief);
  const memberKeys = members.map((member) => member.key);
  assertEquals(brief.mode, "tree");
  assertEquals(
    brief.rows.map((row) => [
      row.key,
      row.kind,
      row.depth,
      row.parentKey,
      row.nodeKey,
      row.endpoint,
      row.label,
      row.detail,
    ]),
    [
      [
        baseline.key,
        "record",
        0,
        undefined,
        baseline.key,
        true,
        baseline.label,
        baseline.node.recordedAt,
      ],
      [
        analysisGroup,
        "navigation",
        0,
        undefined,
        undefined,
        false,
        "Brief analysis",
        BRIEF_ANALYSIS_BASIS,
      ],
      [
        airframe.key,
        "record",
        1,
        analysisGroup,
        airframe.key,
        true,
        airframe.label,
        undefined,
      ],
      [
        camera.key,
        "record",
        1,
        analysisGroup,
        camera.key,
        true,
        camera.label,
        undefined,
      ],
      [
        snapshotGroup,
        "navigation",
        0,
        undefined,
        undefined,
        false,
        overviewBriefReferencedSnapshotLabel(),
        cameraSource.brief.snapshotId,
      ],
      [
        cameraSource.key,
        "source",
        1,
        snapshotGroup,
        cameraSource.key,
        true,
        cameraSource.sourceItem.id,
        cameraSource.sourceItem.kind,
      ],
      [
        enduranceSource.key,
        "source",
        1,
        snapshotGroup,
        enduranceSource.key,
        true,
        enduranceSource.sourceItem.id,
        enduranceSource.sourceItem.kind,
      ],
    ],
  );
  assertEquals(
    brief.rows.flatMap((row) => row.nodeKey ? [row.nodeKey] : []).sort(),
    [...memberKeys].sort(),
  );
  assertEquals(
    brief.rows.some((row) =>
      row.nodeKey !== undefined && !memberKeys.includes(row.nodeKey)
    ),
    false,
  );
  assertEquals(
    brief.rows.filter((row) => row.kind === "navigation").every((row) =>
      !memberKeys.includes(row.key) && row.endpoint === false
    ),
    true,
  );
  assertEquals(
    brief.rows.some((row) =>
      row.parentKey === baseline.key ||
      row.key === baseline.key && row.parentKey === snapshotGroup
    ),
    false,
  );
  assertEquals(
    brief.records.map((row) => row.nodeKey).sort(),
    [
      airframe.key,
      baseline.key,
      camera.key,
      cameraSource.key,
      enduranceSource.key,
    ].sort(),
  );
});

Deno.test("distinct analysis bases stay separate and never invent an r1/r3 join", () => {
  const baseline = record(
    "approved-brief-document-r1",
    "requirements",
    "brief",
  );
  const otherBasis = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const camera = analysisRecord("subsystem-camera", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-camera",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const later = analysisRecord("subsystem-camera-r3", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-camera",
    basisFingerprint: otherBasis,
  });
  const source = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "camera-bracket-bench-stress",
  );
  const brief = hullContents(
    [baseline, camera, later, source],
  ).get(groupId("requirements", "brief"))!;
  const first = overviewAnalysisBasisGroupKey({
    domain: "brief",
    kind: "brief-item",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const second = overviewAnalysisBasisGroupKey({
    domain: "brief",
    kind: "brief-item",
    basisFingerprint: otherBasis,
  });
  const snapshot = overviewBriefSnapshotGroupKey(source.brief);
  assertEquals(first === second, false);
  assertEquals(
    brief.rows.filter((row) => row.kind === "navigation").map((row) => [
      row.key,
      row.detail,
    ]),
    [
      [first, BRIEF_ANALYSIS_BASIS],
      [second, otherBasis],
      [snapshot, source.brief.snapshotId],
    ],
  );
  assertEquals(
    brief.rows.find((row) => row.nodeKey === camera.key)?.parentKey,
    first,
  );
  assertEquals(
    brief.rows.find((row) => row.nodeKey === later.key)?.parentKey,
    second,
  );
  assertEquals(
    brief.rows.find((row) => row.nodeKey === source.key)?.parentKey,
    snapshot,
  );
  assertEquals(
    brief.rows.some((row) =>
      row.parentKey === baseline.key ||
      (row.nodeKey === source.key && row.parentKey === first) ||
      (row.nodeKey === camera.key && row.parentKey === snapshot)
    ),
    false,
  );
});

Deno.test("exact App action on the brief baseline stays only on that baseline row", () => {
  const baseline = record(
    "approved-brief-document-r1",
    "requirements",
    "brief",
  );
  const camera = analysisRecord("subsystem-camera", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-camera",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  const source = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "camera-bracket-bench-stress",
  );
  const briefSession: ThreadViewerSession = {
    ...session,
    id: "brief-app",
    anchor: { kind: "artifact", id: "approved-brief-document-r1" },
  };
  const brief = hullContents(
    [baseline, camera, source],
    [briefSession],
  ).get(groupId("requirements", "brief"))!;
  const baselineRow = brief.rows.find((row) => row.key === baseline.key)!;
  const analysisRow = brief.rows.find((row) => row.nodeKey === camera.key)!;
  const analysisGroup = brief.rows.find((row) =>
    row.kind === "navigation" && row.label === "Brief analysis"
  )!;
  const sourceRow = brief.rows.find((row) => row.nodeKey === source.key)!;
  assertEquals(baselineRow.sessionIds, ["brief-app"]);
  assertEquals(baselineRow.viewerNodeKey, baseline.key);
  assertEquals(overviewHullRowActions(baselineRow), [{
    kind: "open-session",
    sessionId: "brief-app",
    nodeKey: baseline.key,
  }]);
  assertEquals(analysisRow.sessionIds, []);
  assertEquals(sourceRow.sessionIds, []);
  assertEquals(analysisGroup.sessionIds, []);
  assertEquals(overviewHullRowActions(analysisRow), [{
    kind: "select-node",
    nodeKey: camera.key,
  }]);
  assertEquals(overviewHullRowActions(analysisGroup), []);
});

Deno.test("declared-dependency parentKey is not analysis containment and unknown identity stays visible", () => {
  const baseline = record(
    "approved-brief-document-r1",
    "requirements",
    "brief",
  );
  const camera = analysisRecord("subsystem-camera", {
    domain: "brief",
    kind: "brief-item",
    id: "subsystem-camera",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  }, { parentKey: baseline.key });
  const dependent = analysisRecord("payload-camera", {
    domain: "brief",
    kind: "brief-item",
    id: "payload-camera",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  }, { parentKey: camera.key });
  const unknown = analysisRecord("unresolved-item", {
    domain: "brief",
    kind: "brief-item",
    id: "unresolved-item",
  }, { parentKey: baseline.key });
  const source = briefSource(
    "inspection-drone-id01:brief:r3:bca2a461299be869",
    "inspection-drone-id01:brief",
    3,
    "camera-bracket-bench-stress",
  );
  const brief = hullContents(
    [baseline, camera, dependent, unknown, source],
  ).get(groupId("requirements", "brief"))!;
  const analysisGroup = overviewAnalysisBasisGroupKey({
    domain: "brief",
    kind: "brief-item",
    basisFingerprint: BRIEF_ANALYSIS_BASIS,
  });
  assertEquals(
    brief.rows.find((row) => row.nodeKey === camera.key)?.parentKey,
    analysisGroup,
  );
  assertEquals(
    brief.rows.find((row) => row.nodeKey === dependent.key)?.parentKey,
    analysisGroup,
  );
  const unknownRow = brief.rows.find((row) => row.nodeKey === unknown.key)!;
  assertEquals(unknownRow.kind, "record");
  assertEquals(unknownRow.depth, 0);
  assertEquals(unknownRow.parentKey, undefined);
  assertEquals(unknownRow.endpoint, true);
  assertEquals(
    brief.rows.some((row) =>
      row.parentKey === camera.key || row.parentKey === baseline.key
    ),
    false,
  );
  assertEquals(
    brief.rows.flatMap((row) => row.nodeKey ? [row.nodeKey] : []).sort(),
    [baseline.key, camera.key, dependent.key, source.key, unknown.key].sort(),
  );
});

function sysmlRecord(
  kind: OverviewRecordedHeroNode["node"]["entityKind"],
  id: string,
  extras: {
    readonly label?: string;
    readonly isRequirementsCapture?: boolean;
  } = {},
): OverviewRecordedHeroNode {
  const key = `${kind}:${id}`;
  return {
    key,
    lane: "system-model",
    groupKey: OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
    label: extras.label ?? id,
    kind: "recorded",
    color: "#2563eb",
    emphasis: false,
    ...(extras.isRequirementsCapture === true ? { isRequirementsCapture: true } : {}),
    node: {
      id: key,
      ref: { kind, id },
      entityKind: kind,
      label: extras.label ?? id,
      freshness: "fresh",
      system: "syson",
      summary: extras.label ?? id,
      recordedAt: "2026-09-07T00:00:00Z",
    },
  };
}

const SYSML_HULL = groupId(
  "system-model",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);
const GEOMETRY_HULL = groupId(
  "geometry",
  OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
);

function occurrenceHierarchy(
  architectureId: string,
): ThreadViewerHierarchyProjection {
  const nodes = Array.from({ length: 29 }, (_, index) => ({
    id: index === 0 ? "root" : `occ-${index}`,
    ...(index === 0 ? {} : { parentId: "root" }),
    label: index === 4
      ? "CameraMountBracket"
      : index === 0
      ? "Assembly"
      : `Part ${index}`,
    partDefinitionElementId: `def-${index}`,
    sessionIds: [] as string[],
  }));
  return {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    architectureArtifactId: architectureId,
    rootIds: ["root"],
    nodes,
  };
}

Deno.test("architecture tree keeps 29 occurrences and appends one root Requirements section", () => {
  const architecture = sysmlRecord("artifact", "architecture-current");
  const unknown = sysmlRecord("part-definition", "housing-def");
  const requirement = sysmlRecord("requirement", "REQ-MASS", {
    label: "CameraMountBracket must remain rigid",
  });
  const capture = sysmlRecord("artifact", "requirements-current", {
    label: "Requirements capture",
    isRequirementsCapture: true,
  });
  const members = [architecture, unknown, requirement, capture];
  const hierarchy = occurrenceHierarchy("architecture-current");
  const before = JSON.stringify({ members, hierarchy });
  const captureSession: ThreadViewerSession = {
    ...modelSession,
    id: "requirements-app",
    anchor: { kind: "artifact", id: "requirements-current" },
  };
  const aliases = overviewRequirementSourceViewerAliases(
    members.map((node) => ({
      key: node.key,
      groupKey: node.groupKey,
      ref: node.node.ref,
      ...(node.isRequirementsCapture === true ? { isRequirementsCapture: true } : {}),
    })),
    [{
      from: { kind: "artifact", id: "requirements-current" },
      to: { kind: "requirement", id: "REQ-MASS" },
      relation: "traces_to",
    }],
    [modelSession, captureSession],
  );
  const contents = buildOverviewHullContents(
    members,
    [modelSession, captureSession, session],
    hierarchy,
    {},
    aliases,
  );
  const hull = contents.get(SYSML_HULL)!;
  const geometry = contents.get(groupId("geometry", "domain:geometry"));
  const section = hull.rows.find((row) =>
    row.kind === "navigation" && row.label === "Requirements"
  )!;
  const requirementRows = hull.rows.filter((row) => row.nodeKey === requirement.key);
  const occurrenceRows = hull.rows.filter((row) => row.kind === "navigation");
  assertEquals(hull.mode, "tree");
  assertEquals(
    hull.rows.filter((row) => row.kind === "navigation" && row.label !== "Requirements")
      .length,
    29,
  );
  assertEquals(occurrenceRows.length, 30);
  assertEquals(section.depth, 0);
  assertEquals(section.parentKey, undefined);
  assertEquals(section.nodeKey, undefined);
  assertEquals(section.endpoint, false);
  assertEquals(section.sessionIds, []);
  assertEquals(section.role, "folder");
  assertEquals(overviewHullRowGraphRefs(section), []);
  assertEquals(hull.rows[0]!.role, "overlay");
  assertEquals(overviewHullRowGraphRefs(hull.rows[0]!), [architecture.key]);
  assertEquals(requirementRows, [{
    key: requirement.key,
    kind: "record",
    label: requirement.label,
    detail: requirement.node.recordedAt,
    depth: 1,
    parentKey: section.key,
    nodeKey: requirement.key,
    graphRefs: [requirement.key],
    viewerNodeKey: capture.key,
    sessionIds: ["requirements-app"],
    endpoint: true,
    selectable: true,
    focusable: true,
    provenance: { recordedAt: requirement.node.recordedAt },
  }]);
  assertEquals(section.role, "folder");
  assertEquals(overviewHullRowGraphRefs(section), []);
  assertEquals(requirementRows[0]!.parentKey === "occ-4", false);
  assertEquals(requirementRows[0]!.parentKey === "root", false);
  assertEquals(
    hull.rows.some((row) => row.nodeKey === capture.key),
    false,
  );
  assertEquals(
    hull.records.map((row) => row.nodeKey).sort(),
    members.map((member) => member.key).sort(),
  );
  assertEquals(hull.rows[0]!.sessionIds, ["model-app"]);
  assertEquals(
    hull.rows.slice(1, 29).every((row) => row.sessionIds.length === 0),
    true,
  );
  assertEquals(
    hull.rows.some((row) => row.sessionIds.includes("app")),
    false,
  );
  assertEquals(geometry, undefined);
  assertEquals(JSON.stringify({ members, hierarchy }), before);
});

Deno.test("a SYSML hull without hierarchy still shows the requirement and keeps captures in records", () => {
  const architecture = sysmlRecord("artifact", "architecture-current");
  const unknown = sysmlRecord("attribute-usage", "wall-attr");
  const requirement = sysmlRecord("requirement", "REQ-MASS");
  const capture = sysmlRecord("artifact", "requirements-current", {
    isRequirementsCapture: true,
  });
  const contents = buildOverviewHullContents(
    [architecture, unknown, requirement, capture],
    [],
  );
  const hull = contents.get(SYSML_HULL)!;
  const section = hull.rows.find((row) =>
    row.kind === "navigation" && row.label === "Requirements"
  )!;
  assertEquals(hull.mode, "tree");
  assertEquals(
    hull.rows.filter((row) => row.nodeKey === requirement.key).map((row) => [
      row.parentKey,
      row.depth,
      row.endpoint,
    ]),
    [[section.key, 1, true]],
  );
  assertEquals(
    hull.rows.map((row) => row.nodeKey).filter(Boolean).sort(),
    [architecture.key, unknown.key, requirement.key].sort(),
  );
  assertEquals(
    hull.rows.some((row) => row.nodeKey === capture.key),
    false,
  );
  assertEquals(
    hull.records.map((row) => row.nodeKey).sort(),
    [architecture.key, capture.key, requirement.key, unknown.key].sort(),
  );
});

Deno.test("hull row viewer binding is one non-React helper", async () => {
  const content = await Deno.readTextFile(
    new URL("./src/project/overview/hulls/content.ts", import.meta.url),
  );
  const currentCases = await Deno.readTextFile(
    new URL(
      "./src/project/overview/hulls/adapters/from-current-engineering-cases.ts",
      import.meta.url,
    ),
  );
  const helper = await Deno.readTextFile(
    new URL("./src/project/overview/hulls/row-viewer.ts", import.meta.url),
  );
  assertEquals(content.includes("function boundRowViewer("), false);
  assertEquals(currentCases.includes("function boundRowViewer("), false);
  assertEquals(content.includes("overviewHullBoundRowViewer("), true);
  assertEquals(currentCases.includes("overviewHullBoundRowViewer("), true);
  assertEquals(
    helper.includes("export function overviewHullBoundRowViewer("),
    true,
  );
});

const UNJOINED_GEOMETRY_DETAIL = "unjoined · pending CAD";

const UNJOINED_OCCURRENCE_IDENTITIES: readonly [
  key: string,
  parentKey: string | undefined,
  depth: number,
  label: string,
][] = [
  ["root", undefined, 0, "InspectionDrone"],
  ["airframe", "root", 1, "airframe"],
  ["occ-2", "airframe", 2, "CameraMountBracket"],
  ["occ-3", "airframe", 2, "RadialArm"],
  ["occ-4", "airframe", 2, "Part 4"],
  ["occ-5", "airframe", 2, "Part 5"],
  ["occ-6", "airframe", 2, "Part 6"],
  ["occ-7", "airframe", 2, "Part 7"],
  ["occ-8", "airframe", 2, "Part 8"],
  ["occ-9", "airframe", 2, "Part 9"],
  ["occ-10", "airframe", 2, "Part 10"],
  ["occ-11", "airframe", 2, "Part 11"],
  ["occ-12", "airframe", 2, "Part 12"],
  ["occ-13", "airframe", 2, "Part 13"],
  ["occ-14", "airframe", 2, "Part 14"],
  ["occ-15", "airframe", 2, "Part 15"],
  ["occ-16", "airframe", 2, "Part 16"],
  ["occ-17", "airframe", 2, "Part 17"],
  ["occ-18", "airframe", 2, "Part 18"],
  ["occ-19", "airframe", 2, "Part 19"],
  ["occ-20", "airframe", 2, "Part 20"],
  ["occ-21", "airframe", 2, "Part 21"],
  ["occ-22", "airframe", 2, "Part 22"],
  ["occ-23", "airframe", 2, "Part 23"],
  ["occ-24", "airframe", 2, "Part 24"],
  ["occ-25", "airframe", 2, "Part 25"],
  ["occ-26", "airframe", 2, "Part 26"],
  ["occ-27", "airframe", 2, "Part 27"],
  ["occ-28", "airframe", 2, "Part 28"],
];

function unjoinedOccurrenceHierarchy(
  architectureId: string,
  extras: {
    readonly geometryJoinKey?: string;
    readonly geometryJoinId?: string;
  } = {},
): ThreadViewerHierarchyProjection {
  const nodes = UNJOINED_OCCURRENCE_IDENTITIES.map((
    [id, parentKey, _depth, label],
  ) => ({
    id,
    ...(parentKey ? { parentId: parentKey } : {}),
    label,
    ...(id === "airframe" ? { usageId: "use-airframe", usageLabel: "airframe" } : {}),
    partDefinitionElementId: `def-${id}`,
    ...(extras.geometryJoinKey === id && extras.geometryJoinId
      ? {
        geometryArtifactId: extras.geometryJoinId,
        artifactIds: [extras.geometryJoinId],
        sessionIds: ["cad-current"],
      }
      : { sessionIds: [] as string[] }),
  }));
  return {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    architectureArtifactId: architectureId,
    rootIds: ["root"],
    nodes,
  };
}

function historicalGeometrySession(
  artifactId: string,
  sessionId: string,
): ThreadViewerSession {
  return {
    ...session,
    id: sessionId,
    anchor: { kind: "artifact", id: artifactId },
  };
}

Deno.test("available all-unjoined Geometry keeps the server occurrence tree and pending CAD text", () => {
  const architecture = record(
    "architecture-current",
    "system-model",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const historical = record(
    "geometry-historical",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const historicalStep = record(
    "geometry-historical-step",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const members = [architecture, historical, historicalStep];
  const hierarchy = unjoinedOccurrenceHierarchy("architecture-current");
  const stale = historicalGeometrySession("geometry-historical", "app");
  const before = JSON.stringify({ members, hierarchy });
  const contents = buildOverviewHullContents(members, [stale, modelSession], hierarchy);
  const geometry = contents.get(GEOMETRY_HULL)!;
  const sysml = contents.get(SYSML_HULL)!;

  assertEquals(hierarchy.nodes.length, 29);
  assertEquals(
    hierarchy.nodes.filter((node) => node.parentId !== undefined).length,
    28,
  );
  assertEquals(
    hierarchy.nodes.every((node) => node.geometryArtifactId === undefined),
    true,
  );
  assertEquals(geometry.mode, "tree");
  assertEquals(
    geometry.rows.map((row) => [row.key, row.parentKey, row.depth, row.label]),
    UNJOINED_OCCURRENCE_IDENTITIES.map((
      [key, parentKey, depth, label],
    ) => [key, parentKey, depth, label]),
  );
  assertEquals(
    geometry.rows.map((row) => [
      row.kind,
      row.detail,
      row.availability,
      row.endpoint,
      row.sessionIds,
      row.viewerNodeKey,
      overviewHullRowGraphRefs(row),
      row.role,
      row.selectable,
      overviewHullRowActions(row),
      overviewHullRowPresentation(row).detail,
      overviewHullRowPresentation(row).hasViewer,
    ]),
    UNJOINED_OCCURRENCE_IDENTITIES.map(() => [
      "navigation",
      UNJOINED_GEOMETRY_DETAIL,
      "unresolved",
      false,
      [],
      undefined,
      [],
      "folder",
      false,
      [],
      UNJOINED_GEOMETRY_DETAIL,
      false,
    ]),
  );
  assertEquals(
    geometry.records.map((row) => [row.nodeKey, row.endpoint, row.sessionIds]),
    [
      [historical.key, true, ["app"]],
      [historicalStep.key, true, []],
    ],
  );
  assertEquals(
    geometry.rows.some((row) => row.nodeKey === historical.key),
    false,
  );
  assertEquals(sysml.mode, "tree");
  assertEquals(
    sysml.rows.filter((row) => row.kind === "navigation").map((row) => [
      row.key,
      row.parentKey,
      row.depth,
    ]),
    UNJOINED_OCCURRENCE_IDENTITIES.map(([key, parentKey, depth]) => [
      key,
      parentKey,
      depth,
    ]),
  );
  assertEquals(sysml.rows[0]!.detail, undefined);
  assertEquals(sysml.rows[0]!.availability, undefined);
  assertEquals(overviewHullRowGraphRefs(sysml.rows[0]!), [
    "artifact:architecture-current",
  ]);
  assertEquals(
    sysml.rows.slice(1).every((row) =>
      row.detail !== UNJOINED_GEOMETRY_DETAIL && row.availability === undefined
    ),
    true,
  );
  assertEquals(JSON.stringify({ members, hierarchy }), before);
});

Deno.test("partial Geometry CAD join overlays the exact occurrence and leaves others unjoined", () => {
  const architecture = record(
    "architecture-current",
    "system-model",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const currentCad = record(
    "geometry-current",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const historical = record(
    "geometry-historical",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const members = [architecture, currentCad, historical];
  const hierarchy = unjoinedOccurrenceHierarchy("architecture-current", {
    geometryJoinKey: "airframe",
    geometryJoinId: "geometry-current",
  });
  const currentSession = historicalGeometrySession(
    "geometry-current",
    "cad-current",
  );
  const stale = historicalGeometrySession("geometry-historical", "app");
  const contents = buildOverviewHullContents(
    members,
    [currentSession, stale],
    hierarchy,
  );
  const geometry = contents.get(GEOMETRY_HULL)!;
  const airframe = geometry.rows.find((row) => row.key === "airframe")!;
  const unjoined = geometry.rows.filter((row) => row.key !== "airframe");

  assertEquals(geometry.mode, "tree");
  assertEquals(
    geometry.rows.map((row) => [row.key, row.parentKey, row.depth]),
    UNJOINED_OCCURRENCE_IDENTITIES.map(([key, parentKey, depth]) => [
      key,
      parentKey,
      depth,
    ]),
  );
  assertEquals(airframe, {
    key: "airframe",
    kind: "navigation",
    label: "airframe",
    depth: 1,
    parentKey: "root",
    graphRefs: ["artifact:geometry-current"],
    viewerNodeKey: "artifact:geometry-current",
    sessionIds: ["cad-current"],
    endpoint: false,
    role: "overlay",
    selectable: true,
    focusable: true,
  });
  assertEquals(overviewHullRowActions(airframe), [{
    kind: "open-session",
    sessionId: "cad-current",
    nodeKey: "artifact:geometry-current",
  }]);
  assertEquals(
    unjoined.map((row) => [
      row.key,
      row.detail,
      row.availability,
      row.endpoint,
      row.sessionIds,
      overviewHullRowGraphRefs(row),
      overviewHullRowActions(row),
    ]),
    UNJOINED_OCCURRENCE_IDENTITIES.filter(([key]) => key !== "airframe").map((
      [key],
    ) => [
      key,
      UNJOINED_GEOMETRY_DETAIL,
      "unresolved",
      false,
      [],
      [],
      [],
    ]),
  );
  assertEquals(
    geometry.records.map((row) => [row.nodeKey, row.sessionIds, row.endpoint]),
    [
      [currentCad.key, ["cad-current"], true],
      [historical.key, ["app"], true],
    ],
  );
});

Deno.test("unavailable or absent Geometry hierarchy keeps the factual records fallback", () => {
  const historical = record(
    "geometry-historical",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const historicalStep = record(
    "geometry-historical-step",
    "geometry",
    OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
  );
  const members = [historical, historicalStep];
  const stale = historicalGeometrySession("geometry-historical", "app");
  const absent = buildOverviewHullContents(members, [stale]);
  const unavailable = buildOverviewHullContents(members, [stale], {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "unavailable",
    reason: "The current architecture has no viewer hierarchy.",
    nodes: [],
    rootIds: [],
  });
  const emptyAvailable = buildOverviewHullContents(members, [stale], {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    architectureArtifactId: "architecture-current",
    nodes: [],
    rootIds: [],
  });

  for (const contents of [absent, unavailable, emptyAvailable]) {
    const geometry = contents.get(GEOMETRY_HULL)!;
    assertEquals(geometry.mode, "records");
    assertEquals(
      geometry.rows.map((row) => [
        row.key,
        row.nodeKey,
        row.endpoint,
        row.sessionIds,
        overviewHullRowGraphRefs(row),
      ]),
      [
        [historical.key, historical.key, true, ["app"], [historical.key]],
        [historicalStep.key, historicalStep.key, true, [], [historicalStep.key]],
      ],
    );
    assertEquals(geometry.rows, geometry.records);
  }
});
