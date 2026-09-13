import { assertEquals, assertStrictEquals } from "@std/assert";
import { overviewRequirementSourceViewerAliases } from "./src/project/overview-thread-viewer-discovery.ts";
import { OVERVIEW_DOMAIN_GROUP_KEYS } from "./src/project/overview/hulls/domain-groups.ts";
import {
  buildOverviewVersionHistory,
  overviewHullHistoryLabel,
  type OverviewVersionHistoryRecord,
} from "./src/project/overview/hulls/version-history.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import { buildOverviewThreadHero } from "./src/project/overview-thread-hero-model.ts";
import type {
  ThreadEvidenceFamily,
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "./src/thread/types.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";

const ARCHITECTURE_HULL = groupId(
  "system-model",
  OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
);
const GEOMETRY_HULL = groupId(
  "geometry",
  OVERVIEW_DOMAIN_GROUP_KEYS.geometry,
);
const FEA_HULL = groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea);

Deno.test("current revisions hide history in every declared domain hull", () => {
  const graph = twoDomainGraph();
  const familyGraph = twoDomainFamilies();
  const classified = classify(graph);
  const before = JSON.stringify({ graph, familyGraph, classified });

  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classified,
  );

  assertEquals(nodeIds(projection.displayedGraph), [
    "architecture-current",
    "brief-analysis",
    "fea-current",
    "geometry-current",
    "part-a",
    "part-b",
    "requirement-mass",
    "requirements-current",
  ]);
  assertEquals(
    hullOf(projection, ARCHITECTURE_HULL),
    {
      hullKey: ARCHITECTURE_HULL,
      historicalCount: 4,
      familyIds: ["architecture-family", "requirements-family"],
    },
  );
  assertEquals(
    hullOf(projection, GEOMETRY_HULL),
    {
      hullKey: GEOMETRY_HULL,
      historicalCount: 2,
      familyIds: ["geometry-family"],
    },
  );
  assertEquals(
    hullOf(projection, FEA_HULL),
    { hullKey: FEA_HULL, historicalCount: 1, familyIds: ["fea-family"] },
  );
  assertEquals(
    projection.hiddenMemberKeys.has("artifact:architecture-r1"),
    true,
  );
  assertEquals(
    projection.hiddenMemberKeys.has("artifact:requirements-old"),
    true,
  );
  assertEquals(projection.hiddenMemberKeys.has("artifact:geometry-r1"), true);
  assertEquals(projection.hiddenMemberKeys.has("artifact:fea-old"), true);
  assertEquals(JSON.stringify({ graph, familyGraph, classified }), before);
  assertEquals(overviewHullHistoryLabel(3, false), "History 3");
  assertEquals(overviewHullHistoryLabel(3, true), "Hide history");
});

Deno.test("expanding one hull restores exact historical refs without unfolding the others", () => {
  const graph = twoDomainGraph();
  const familyGraph = twoDomainFamilies();
  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classify(graph),
    new Set([ARCHITECTURE_HULL]),
  );

  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-r1"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-r2"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-r3"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-current"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("requirements-old"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("geometry-r1"),
    false,
  );
  const historical = graph.nodes.find((node) => node.ref.id === "architecture-r1")!;
  assertStrictEquals(
    projection.displayedGraph.nodes.find((node) => node.ref.id === "architecture-r1"),
    historical,
  );
});

Deno.test("expansion keeps the original viewer target on the historical member", () => {
  const graph = twoDomainGraph();
  const familyGraph = twoDomainFamilies();
  const records = classify(graph);
  const collapsed = buildOverviewVersionHistory(graph, familyGraph, records);
  const expanded = buildOverviewVersionHistory(
    graph,
    familyGraph,
    records,
    new Set([ARCHITECTURE_HULL]),
  );
  const sessions: ThreadViewerSession[] = [
    session("requirements-current-app", "requirements-current"),
    session("requirements-old-app", "requirements-old"),
    session("model-app", "architecture-current"),
  ];
  const aliases = overviewRequirementSourceViewerAliases(
    aliasRecords(graph),
    graph.edges,
    sessions,
  );

  assertEquals(
    collapsed.hiddenMemberKeys.has("artifact:requirements-old"),
    true,
  );
  assertEquals(
    expanded.displayedGraph.nodes.some((node) => node.ref.id === "requirements-old"),
    true,
  );
  assertEquals(
    aliases.get("requirement:requirement-mass")?.map((target) => ({
      sessionId: target.sessionId,
      nodeKey: target.nodeKey,
    })),
    [{
      sessionId: "requirements-current-app",
      nodeKey: "artifact:requirements-current",
    }],
  );
  assertEquals(
    sessions.find((item) => item.id === "requirements-old-app")?.anchor,
    { kind: "artifact", id: "requirements-old" },
  );
  assertEquals(
    collapsed.displayedGraph.edges.some((edge) => edge.from.id === "requirements-old"),
    false,
  );
});

Deno.test("review-required, missing members and multiple heads stay fully visible", () => {
  const graph = twoDomainGraph();
  const familyGraph = twoDomainFamilies();
  familyGraph.families[0]!.status = "review-required";
  familyGraph.families[0]!.reviewReason = "divergent-successors";
  familyGraph.families[1]!.historicalRefs.push({
    kind: "artifact",
    id: "requirements-missing",
  });
  familyGraph.families[2]!.currentRefs = [
    { kind: "artifact", id: "geometry-current" },
    { kind: "artifact", id: "geometry-r2" },
  ];
  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classify(graph),
  );

  assertEquals(
    nodeIds(projection.displayedGraph).filter((id) =>
      id.startsWith("architecture-") || id.startsWith("requirements-") ||
      id.startsWith("geometry-")
    ),
    [
      "architecture-current",
      "architecture-r1",
      "architecture-r2",
      "architecture-r3",
      "geometry-current",
      "geometry-r1",
      "geometry-r2",
      "requirements-current",
      "requirements-old",
    ],
  );
  assertEquals(hullOf(projection, ARCHITECTURE_HULL), undefined);
  assertEquals(hullOf(projection, GEOMETRY_HULL), undefined);
  assertEquals(hullOf(projection, FEA_HULL)?.historicalCount, 1);
});

Deno.test("equal labels without a declared family stay distinct", () => {
  const graph = twoDomainGraph();
  const familyGraph = emptyFamilies();
  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classify(graph),
  );

  assertEquals(
    projection.displayedGraph.nodes.filter((node) => node.label === "Housing")
      .map((node) => node.ref.id),
    ["part-a", "part-b"],
  );
  assertEquals(projection.hulls, []);
  assertEquals(projection.hiddenMemberKeys.size, 0);
});

Deno.test("a new requirements capture stays visible beside a declared family", () => {
  const graph: ThreadGraph = {
    nodes: [
      artifact(
        "requirements-CameraMountBracket-old",
        "Requirements: CameraMountBracket",
        "sysml-model",
      ),
      artifact(
        "requirements-CameraMountBracket-current",
        "Requirements: CameraMountBracket",
        "sysml-model",
      ),
      artifact(
        "requirements-RadialArm-fdf16c35",
        "Requirements: RadialArm",
        "sysml-model",
      ),
      requirement("REQ-RADIAL-ARM", "RadialArmBenchDisplacementLimit"),
    ],
    edges: [
      supersedes(
        "requirements-CameraMountBracket-old",
        "requirements-CameraMountBracket-current",
      ),
    ],
  };
  const familyGraph: ThreadEvidenceFamilyGraph = {
    ...emptyFamilies(),
    families: [
      family("requirements-family", "sysml-model", [
        "requirements-CameraMountBracket-old",
      ], "requirements-CameraMountBracket-current"),
    ],
  };
  const architectureHull = ARCHITECTURE_HULL;
  const classified = graph.nodes.map((node) => ({
    key: refKey(node.ref),
    hullKey: architectureHull,
  }));
  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classified,
  );

  assertEquals(
    projection.hiddenMemberKeys.has(
      "artifact:requirements-CameraMountBracket-old",
    ),
    true,
  );
  assertEquals(
    projection.displayedGraph.nodes.some((node) =>
      node.ref.id === "requirements-RadialArm-fdf16c35"
    ),
    true,
  );
  assertEquals(
    projection.displayedGraph.nodes.some((node) => node.ref.id === "REQ-RADIAL-ARM"),
    true,
  );
});

Deno.test("independent FEA results with the same label are not folded without lineage", () => {
  const graph: ThreadGraph = {
    nodes: [
      artifact(
        "calculix-isolated-result-json-r1",
        "Local CalculiX result.json",
        "solver-result",
      ),
      artifact(
        "calculix-isolated-result-json-r3",
        "Local CalculiX result.json",
        "solver-result",
      ),
    ],
    edges: [],
  };
  const projection = buildOverviewVersionHistory(
    graph,
    emptyFamilies(),
    graph.nodes.map((node) => ({
      key: refKey(node.ref),
      hullKey: FEA_HULL,
    })),
  );

  assertEquals(
    projection.displayedGraph.nodes.map((node) => node.ref.id).sort(),
    [
      "calculix-isolated-result-json-r1",
      "calculix-isolated-result-json-r3",
    ],
  );
  assertEquals(projection.hulls, []);
  assertEquals(projection.hiddenMemberKeys.size, 0);
});

Deno.test("members that cannot be placed in one hull stay visible", () => {
  const graph = twoDomainGraph();
  const classified = classify(graph).map((record) =>
    record.key === "artifact:architecture-r1"
      ? { ...record, hullKey: GEOMETRY_HULL }
      : record
  );
  const projection = buildOverviewVersionHistory(
    graph,
    twoDomainFamilies(),
    classified,
  );

  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-r1"),
    true,
  );
  assertEquals(
    nodeIds(projection.displayedGraph).includes("architecture-r2"),
    true,
  );
  assertEquals(
    hullOf(projection, ARCHITECTURE_HULL),
    {
      hullKey: ARCHITECTURE_HULL,
      historicalCount: 1,
      familyIds: ["requirements-family"],
    },
  );
});

Deno.test("Brief analysis nodes stay when history folds, and Overview never uses the Evidence overlay", () => {
  const graph = twoDomainGraph();
  const projection = buildOverviewVersionHistory(
    graph,
    twoDomainFamilies(),
    classify(graph),
  );
  const helper = Deno.readTextFileSync(
    new URL("./src/project/overview/hulls/version-history.ts", import.meta.url),
  );
  const hero = Deno.readTextFileSync(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  assertEquals(
    projection.displayedGraph.nodes.some((node) => node.ref.id === "brief-analysis"),
    true,
  );
  assertEquals(helper.includes("graphWithoutAnalysisOverlay"), false);
  assertEquals(hero.includes("graphWithoutAnalysisOverlay"), false);
  assertEquals(hero.includes("buildOverviewVersionHistory"), true);
});

Deno.test("architecture and geometry Apps stay on their recorded anchors after folding", () => {
  const graph = twoDomainGraph();
  const familyGraph = twoDomainFamilies();
  const projection = buildOverviewVersionHistory(
    graph,
    familyGraph,
    classify(graph),
  );
  const sessions: ThreadViewerSession[] = [
    session("model-app", "architecture-current"),
    session("geometry-app", "geometry-current"),
    session("geometry-old-app", "geometry-r1"),
  ];
  const aliases = overviewRequirementSourceViewerAliases(
    aliasRecords(graph),
    graph.edges,
    sessions,
  );

  assertEquals(
    projection.displayedGraph.nodes.map((node) => node.ref.id).includes(
      "geometry-r1",
    ),
    false,
  );
  assertEquals(aliases.get("requirement:requirement-mass"), undefined);
  assertEquals(
    sessions.map((item) => `${item.id}:${item.anchor.id}`),
    [
      "model-app:architecture-current",
      "geometry-app:geometry-current",
      "geometry-old-app:geometry-r1",
    ],
  );
});

Deno.test("buildOverviewThreadHero still classifies the full raw graph", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const graph = twoDomainGraph();
  thread.graph = graph;
  thread.evidenceFamilyGraph = twoDomainFamilies();
  const before = JSON.stringify(thread);
  const records = buildOverviewThreadHero(thread);
  const recorded = records.nodes.filter((item) => item.kind === "recorded");
  const classified: OverviewVersionHistoryRecord[] = recorded.map((item) => ({
    key: item.key,
    hullKey: groupId(item.lane, item.groupKey),
  }));
  const projection = buildOverviewVersionHistory(
    thread.graph,
    thread.evidenceFamilyGraph,
    classified,
  );

  assertEquals(
    recorded.some((item) => item.key === "artifact:architecture-r1"),
    true,
  );
  assertEquals(
    projection.displayedGraph.nodes.some((node) => node.ref.id === "architecture-r1"),
    false,
  );
  assertEquals(JSON.stringify(thread), before);
});

function classify(graph: ThreadGraph): OverviewVersionHistoryRecord[] {
  return graph.nodes.flatMap((node) => {
    const hullKey = hullKeyFor(node);
    return hullKey ? [{ key: refKey(node.ref), hullKey }] : [];
  });
}

function hullKeyFor(node: ThreadGraphNode): string | undefined {
  if (node.entityKind === "analysis-node") return undefined;
  if (node.entityKind === "part-definition") return ARCHITECTURE_HULL;
  if (node.ref.id.startsWith("architecture-")) return ARCHITECTURE_HULL;
  if (
    node.ref.id.startsWith("requirements-") || node.entityKind === "requirement"
  ) {
    return ARCHITECTURE_HULL;
  }
  if (node.ref.id.startsWith("geometry-")) return GEOMETRY_HULL;
  if (node.ref.id.startsWith("fea-")) return FEA_HULL;
  return undefined;
}

function hullOf(
  projection: ReturnType<typeof buildOverviewVersionHistory>,
  hullKey: string,
) {
  return projection.hulls.find((hull) => hull.hullKey === hullKey);
}

function nodeIds(graph: ThreadGraph): string[] {
  return graph.nodes.map((node) => node.ref.id).toSorted();
}

function aliasRecords(graph: ThreadGraph) {
  return graph.nodes.flatMap((node) => {
    const hullKey = hullKeyFor(node);
    if (!hullKey) return [];
    return [{
      key: refKey(node.ref),
      groupKey: hullKey === ARCHITECTURE_HULL
        ? OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel
        : hullKey === GEOMETRY_HULL
        ? OVERVIEW_DOMAIN_GROUP_KEYS.geometry
        : OVERVIEW_DOMAIN_GROUP_KEYS.fea,
      ref: node.ref,
      ...(node.ref.id.startsWith("requirements-")
        ? { isRequirementsCapture: true }
        : {}),
    }];
  });
}

function twoDomainGraph(): ThreadGraph {
  return {
    nodes: [
      artifact("architecture-r1", "Architecture", "sysml-model"),
      artifact("architecture-r2", "Architecture", "sysml-model"),
      artifact("architecture-r3", "Architecture", "sysml-model"),
      artifact("architecture-current", "Architecture", "sysml-model"),
      artifact("requirements-old", "Requirements", "sysml-model"),
      artifact("requirements-current", "Requirements", "sysml-model"),
      artifact("geometry-r1", "Solid", "geometry"),
      artifact("geometry-r2", "Solid", "geometry"),
      artifact("geometry-current", "Solid", "geometry"),
      artifact("fea-old", "Proof", "solver-result"),
      artifact("fea-current", "Proof", "solver-result"),
      requirement("requirement-mass", "Mass"),
      part("part-a", "Housing"),
      part("part-b", "Housing"),
      analysis("brief-analysis", "Brief clause"),
    ],
    edges: [
      supersedes("architecture-r1", "architecture-r2"),
      supersedes("architecture-r2", "architecture-r3"),
      supersedes("architecture-r3", "architecture-current"),
      supersedes("requirements-old", "requirements-current"),
      supersedes("geometry-r1", "geometry-r2"),
      supersedes("geometry-r2", "geometry-current"),
      supersedes("fea-old", "fea-current"),
      traces("requirements-current", "requirement-mass"),
      traces("architecture-current", "requirement-mass"),
    ],
  };
}

function twoDomainFamilies(): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-overview-history", revision: 19 },
    families: [
      family("architecture-family", "sysml-model", [
        "architecture-r1",
        "architecture-r2",
        "architecture-r3",
      ], "architecture-current"),
      family("requirements-family", "sysml-model", [
        "requirements-old",
      ], "requirements-current"),
      family("geometry-family", "geometry", [
        "geometry-r1",
        "geometry-r2",
      ], "geometry-current"),
      family("fea-family", "solver-result", ["fea-old"], "fea-current"),
    ],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

function emptyFamilies(): ThreadEvidenceFamilyGraph {
  return {
    schemaVersion: "thread-evidence-family-graph/1.0",
    asOf: { snapshotId: "thread-overview-history", revision: 19 },
    families: [],
    edges: [],
    omittedSelfLoops: [],
    omittedCycleEdges: [],
  };
}

function family(
  id: string,
  artifactKind: string,
  historicalIds: readonly string[],
  currentId: string,
): ThreadEvidenceFamily {
  const historicalRefs = historicalIds.map((item) => ref(item));
  const current = ref(currentId);
  const chain = [...historicalIds, currentId];
  return {
    id,
    entityKind: "artifact",
    artifactKind,
    historicalRefs,
    currentRefs: [current],
    revisionCount: historicalIds.length,
    status: "current",
    relationship: {
      relation: "supersedes",
      classification: "not-recorded",
      equivalence: "not-recorded",
    },
    transitions: chain.slice(0, -1).map((historicalId, index) => ({
      edgeRef: {
        id: `supersedes:${historicalId}:${chain[index + 1]}`,
        relation: "supersedes" as const,
        origin: "provenance" as const,
      },
      historical: ref(historicalId),
      successor: ref(chain[index + 1]!),
    })),
  };
}

function artifact(
  id: string,
  label: string,
  artifactKind: string,
): ThreadGraphNode {
  return {
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    artifactKind,
    label,
    system: "digital-thread",
    freshness: "fresh",
    summary: label,
    recordedAt: "2026-09-07T00:00:00Z",
  };
}

function requirement(id: string, label: string): ThreadGraphNode {
  return {
    id: `graph:requirement:${id}`,
    ref: { kind: "requirement", id },
    entityKind: "requirement",
    label,
    system: "syson",
    freshness: "fresh",
    summary: label,
    recordedAt: "2026-09-07T00:00:00Z",
  };
}

function part(id: string, label: string): ThreadGraphNode {
  return {
    id: `graph:part-definition:${id}`,
    ref: { kind: "part-definition", id },
    entityKind: "part-definition",
    label,
    system: "syson",
    freshness: "fresh",
    summary: label,
    recordedAt: "2026-09-07T00:00:00Z",
  };
}

function analysis(id: string, label: string): ThreadGraphNode {
  return {
    id: `graph:analysis-node:${id}`,
    ref: { kind: "analysis-node", id },
    entityKind: "analysis-node",
    label,
    system: "digital-thread",
    freshness: "fresh",
    summary: label,
    analysis: {
      semanticRef: {
        domain: "brief",
        kind: "source-item",
        id,
        basisFingerprint: "sha256:" + "a".repeat(64),
      },
    },
  };
}

function supersedes(fromId: string, toId: string): ThreadGraphEdge {
  return {
    id: `supersedes:${fromId}:${toId}`,
    from: ref(fromId),
    to: ref(toId),
    relation: "supersedes",
    rationale: `${fromId} superseded by ${toId}`,
    origin: "provenance",
  };
}

function traces(fromId: string, toId: string): ThreadGraphEdge {
  return {
    id: `traces:${fromId}:${toId}`,
    from: ref(fromId),
    to: { kind: "requirement", id: toId },
    relation: "traces_to",
    rationale: `${fromId} traces to ${toId}`,
    origin: "provenance",
  };
}

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}

function session(id: string, record: string): ThreadViewerSession {
  return {
    id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: record },
    app: { id: "io.casys.mcp-syson", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-syson/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: record.startsWith("geometry")
        ? "ui://mcp-build123d/geometry-viewer"
        : record.startsWith("architecture")
        ? "ui://mcp-syson/model-explorer-viewer"
        : "ui://mcp-syson/requirements-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: record.startsWith("geometry")
        ? "io.casys.mcp-build123d.recorded-geometry-session/1.0"
        : record.startsWith("architecture")
        ? "io.casys.mcp-syson.recorded-model-children-session/1.0"
        : "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };
}
