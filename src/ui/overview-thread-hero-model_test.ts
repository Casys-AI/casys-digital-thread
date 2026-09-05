import { assertEquals, assertStringIncludes } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildOverviewThreadHero,
  isRecordedOverviewHeroNode,
  OVERVIEW_SEMANTIC_GROUP_KEYS,
  type OverviewActivityHeroNode,
  overviewGroupCaption,
  overviewGroupKeyFor,
  type OverviewHeroNode,
  overviewLaneFor,
} from "./src/project/overview-thread-hero-model.ts";
import type { ProjectPathActivityView } from "./src/project/model.ts";
import type {
  ThreadArtifact,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "./src/thread/types.ts";

Deno.test("overview hero places recorded nodes in 2a lanes and never invents ids", () => {
  const hero = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const fixtureIds = new Set(
    GENERIC_THREAD_FIXTURE.graph.nodes.map((node) => node.ref.id),
  );

  assertEquals(hero.lanes.map((column) => column.lane.id), [
    "requirements",
    "system-model",
    "geometry",
    "physics",
    "verdicts",
  ]);
  assertEquals(
    hero.nodes.every((item) =>
      item.kind === "recorded" && fixtureIds.has(item.node.ref.id)
    ),
    true,
  );
  assertEquals(
    hero.nodes.some((item) => recordedId(item) === "REQ-M-001"),
    false,
  );
  assertEquals(
    hero.nodes.some((item) => recordedId(item) === "REQ-MECH-014"),
    true,
  );
  assertEquals(
    hero.nodes.find((item) => recordedId(item) === "REQ-MECH-014")?.lane,
    "requirements",
  );
  assertEquals(
    hero.nodes.find((item) => recordedId(item) === "ART-CAD-018")?.lane,
    "geometry",
  );
  assertEquals(
    hero.nodes.find((item) => recordedId(item) === "OBS-STRESS-MAX")?.lane,
    "physics",
  );
  assertEquals(
    hero.edges.reduce((count, edge) => count + edge.pathCount, 0),
    hero.projectedPathCount,
  );
  assertEquals(
    hero.edges.every((edge) => edge.pathKeys.length === edge.pathCount),
    true,
  );
  assertEquals(
    new Set(hero.edges.map((edge) => `${edge.fromKey}>${edge.toKey}`)).size,
    hero.edges.length,
  );
});

Deno.test("assembly-integrity-observation/1.0 stays an observation in the physics lane", () => {
  const node: ThreadGraphNode = {
    id: "graph:observation:assembly-integrity",
    ref: { kind: "observation", id: "assembly-integrity" },
    entityKind: "observation",
    artifactKind: "assembly-integrity-observation/1.0",
    label: "Assembly integrity observation",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Projected integrity observation, not a verdict.",
  };

  assertEquals(overviewLaneFor(node), "physics");
  assertEquals(overviewLaneFor(node) === "verdicts", false);
});

Deno.test("recorded solver results stay addressable in the physics lane", () => {
  const node: ThreadGraphNode = {
    id: "graph:artifact:solver-result",
    ref: { kind: "artifact", id: "solver-result" },
    entityKind: "artifact",
    artifactKind: "solver-result",
    label: "Recorded solver result",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Exact recorded result available to a contextual App.",
  };

  assertEquals(overviewLaneFor(node), "physics");
});

Deno.test("overview hulls use exact producer families rather than recorder labels", () => {
  const node: ThreadGraphNode = {
    id: "graph:artifact:semantic-record",
    ref: { kind: "artifact", id: "semantic-record" },
    entityKind: "artifact",
    artifactKind: "geometry",
    label: "Copy does not classify this record",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Exact producer classification",
  };
  const artifact = (operation: string): ThreadArtifact => ({
    id: "semantic-record",
    label: "Independent copy",
    kind: "geometry",
    system: "digital-thread",
    revision: "1",
    freshness: "fresh",
    producedBy: operation,
    dependsOn: [],
  });

  assertEquals(
    overviewGroupKeyFor(node, artifact("design.write-geometry@1")),
    OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry,
  );
  assertEquals(
    overviewGroupKeyFor(
      node,
      artifact("verify.observe-assembly-integrity@1"),
    ),
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  );
  assertEquals(
    overviewGroupKeyFor(node, artifact("unknown.operation@1")),
    "digital-thread",
  );
  assertEquals(
    overviewGroupKeyFor(node, {
      ...artifact("design.write-geometry@1"),
      producer: {
        serverId: "mcp-modelica",
        tool: "simulate.run-qualified-modelica-kit@1",
        runId: "run:canonical-producer-wins",
      },
    }),
    "digital-thread",
  );
  assertEquals(
    overviewGroupCaption(OVERVIEW_SEMANTIC_GROUP_KEYS.canonicalGeometry),
    "Canonical geometry",
  );
});

Deno.test("overview hulls keep exact containment after a one-to-one SysML usage is folded", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const structuralNode = (
    id: string,
    entityKind: "part-definition" | "part-usage",
  ): ThreadGraphNode => ({
    id: `graph:${entityKind}:${id}`,
    ref: { kind: entityKind, id },
    entityKind,
    label: id,
    system: "syson",
    freshness: "fresh",
    summary: "Recorded SysML structure",
  });
  const assembly = structuralNode("assembly", "part-definition");
  const childUsage = structuralNode("child-usage", "part-usage");
  const childDefinition = structuralNode("child-definition", "part-definition");
  const edge = (
    id: string,
    from: ThreadGraphNode,
    to: ThreadGraphNode,
    relation: ThreadGraphEdge["relation"],
  ): ThreadGraphEdge => ({
    id,
    from: from.ref,
    to: to.ref,
    relation,
    rationale: id,
    origin: "structure",
  });
  thread.graph.nodes.push(assembly, childUsage, childDefinition);
  thread.graph.edges.push(
    edge("contains-child", assembly, childUsage, "contains"),
    edge("types-child", childUsage, childDefinition, "typed_by"),
  );

  const hero = buildOverviewThreadHero(thread);
  const child = hero.nodes.find((item) =>
    item.key === "part-definition:child-definition"
  );

  assertEquals(
    hero.nodes.some((item) => item.key === "part-usage:child-usage"),
    false,
  );
  assertEquals(child?.kind, "recorded");
  assertEquals(
    child?.kind === "recorded" ? child.parentKey : undefined,
    "part-definition:assembly",
  );
});

Deno.test("overview connects exact project dependency evidence to open activity hulls", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const snapshotRevision = thread.evidenceFamilyGraph.asOf.revision;
  const evidenceRef = {
    snapshotId: thread.id,
    snapshotRevision,
    kind: "artifact" as const,
    id: "project-document-admission",
  };
  thread.graph.nodes.push({
    id: "graph:artifact:project-document-admission",
    ref: { kind: "artifact", id: evidenceRef.id },
    entityKind: "artifact",
    artifactKind: "document",
    label: "Project document admission",
    system: "digital-thread",
    freshness: "fresh",
    summary: "Recorded documentary admission",
  });
  const baseline = {
    ...activityView(
      "activity:brief-baseline",
      "requirements",
      "completed",
      ["brief-baseline"],
    ),
    evidenceRefs: [evidenceRef],
  };
  const active = {
    ...activityView(
      "activity:active-build",
      "system-model",
      "active",
      ["active-build"],
    ),
    dependencyEvidenceRefs: [evidenceRef],
  };

  const hero = buildOverviewThreadHero(thread, [baseline, active]);
  const evidence = hero.nodes.find((item) => item.key === `artifact:${evidenceRef.id}`);
  const dependency = hero.edges.find((edge) => edge.kind === "project-dependency");

  assertEquals(evidence?.lane, "requirements");
  assertEquals(dependency?.fromKey, `artifact:${evidenceRef.id}`);
  assertEquals(
    dependency?.toKey,
    "project-activity:activity:active-build",
  );
  assertEquals(dependency?.pathCount, 1);
});

Deno.test("Overview opens registered whole Apps without a native CAD fallback", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const capabilities = await Deno.readTextFile(
    new URL("./src/project/overview-thread-viewer-model.ts", import.meta.url),
  );
  const appFrame = await Deno.readTextFile(
    new URL("./src/thread/mcp-app-frame.tsx", import.meta.url),
  );

  assertStringIncludes(overview, "<OverviewThreadHero");
  assertEquals(overview.includes("ThreadAssetOpenLinks"), false);
  assertEquals(overview.includes("thread-asset-open-links"), false);
  assertEquals(overview.includes("<GltfAssetCanvas"), false);

  assertEquals(
    hero.includes("resolveOverviewThreadViewerCapabilities("),
    false,
  );
  assertStringIncludes(hero, "function overviewNodeContextActions(");
  assertStringIncludes(hero, "viewerSessionsByNodeKey.get(item.key) ?? []");
  assertStringIncludes(hero, 'kind: "open-session"');
  assertStringIncludes(
    hero,
    "for (const session of anchoredSessions)",
  );
  assertStringIncludes(hero, "sessionId: session.id");
  assertStringIncludes(
    hero,
    "label: `Open App · ${session.app.id}@${session.app.version}`",
  );
  assertEquals(hero.includes('kind: "open-cad"'), false);
  assertEquals(hero.includes("capabilities.cadAssets"), false);
  assertEquals(hero.includes("requestExactApp"), false);
  assertStringIncludes(hero, "<OverviewThreadContextMenu");
  assertStringIncludes(hero, "<DropdownMenuContextTrigger");
  assertStringIncludes(hero, "Open hull monitor");
  assertStringIncludes(hero, "memberViewerEntries");
  assertEquals(hero.includes("<OverviewNodeSelectionCard"), false);
  assertEquals(hero.includes("<GltfAssetCanvas"), false);
  assertStringIncludes(hero, "session={viewerSession}");
  assertStringIncludes(appFrame, "loadVerifiedMcpAppDocument");
  assertStringIncludes(appFrame, "frameNode.src = document.url");
  assertEquals(appFrame.includes("frameNode.src = session.launchUri"), false);
  assertEquals(appFrame.includes("src={session.launchUri}"), false);
  assertStringIncludes(
    appFrame,
    'setAttribute("sandbox", "allow-scripts")',
  );
  assertEquals(appFrame.includes("allow-same-origin"), false);
  assertStringIncludes(hero, 'className="overview-thread-viewer-layer"');
  assertEquals(hero.includes("Open STEP"), false);

  assertStringIncludes(capabilities, "Zero is unavailable");
  assertEquals(capabilities.includes("inspectRecord"), false);
  assertEquals(capabilities.includes("GLB"), false);
  assertEquals(capabilities.includes("cadAssets"), false);
  assertEquals(overview.includes('method="POST"'), false);
  assertEquals(overview.includes('method: "POST"'), false);
  assertEquals(overview.includes("download="), false);
  assertEquals(overview.includes("fetch("), false);
  assertEquals(hero.includes("fetch("), false);
});

Deno.test("overview lane assignment skips change and action nodes", () => {
  const change = GENERIC_THREAD_FIXTURE.graph.nodes.find((node) =>
    node.entityKind === "change"
  )!;
  const action = GENERIC_THREAD_FIXTURE.graph.nodes.find((node) =>
    node.entityKind === "action"
  )!;
  assertEquals(overviewLaneFor(change), undefined);
  assertEquals(overviewLaneFor(action), undefined);
});

Deno.test("overview lane assignment projects reviewed SysML structure into the system-model lane", () => {
  const requirement = GENERIC_THREAD_FIXTURE.graph.nodes.find((node) =>
    node.entityKind === "requirement"
  )!;
  for (
    const entityKind of [
      "part-definition",
      "part-usage",
      "attribute-usage",
    ] as const
  ) {
    assertEquals(
      overviewLaneFor({
        ...requirement,
        ref: { kind: entityKind, id: `structure:${entityKind}` },
        entityKind,
      }),
      "system-model",
    );
  }
});

Deno.test("overview hero retains every recorded semantic point instead of truncating a lane", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const requirement = thread.graph.nodes.find((node) =>
    node.entityKind === "requirement"
  )!;
  for (let index = 0; index < 6; index++) {
    thread.graph.nodes.push({
      ...requirement,
      id: `graph:requirement:wrap-requirement-${index}`,
      ref: { kind: "requirement", id: `wrap-requirement-${index}` },
      entityKind: "requirement",
      label: `Wrapped requirement ${index}`,
    });
    thread.graph.nodes.push({
      ...requirement,
      id: `graph:evaluation:wrap-${index}`,
      ref: { kind: "evaluation", id: `wrap-${index}` },
      entityKind: "evaluation",
      label: `Wrapped verdict ${index}`,
    });
  }

  const hero = buildOverviewThreadHero(thread);
  assertEquals(
    hero.nodes.filter((item) =>
      item.kind === "recorded" &&
      item.lane === "requirements" &&
      item.node.ref.id.startsWith("wrap-requirement-")
    ).length,
    6,
  );
  const verdicts = hero.nodes.filter((item) =>
    item.kind === "recorded" &&
    item.lane === "verdicts" &&
    item.node.ref.id.startsWith("wrap-")
  );
  assertEquals(verdicts.length, 6);
  assertEquals(new Set(verdicts.map((item) => item.key)).size, 6);
  assertEquals(
    verdicts.every((item) => item.label.startsWith("Wrapped verdict")),
    true,
  );
});

Deno.test("overview hero appends one non-completed activity marker per stable activity in its exact lane", () => {
  const activities: readonly ProjectPathActivityView[] = [
    activityView("activity:geometry-next", "geometry", "planned", [
      "wi-g1",
      "wi-g2",
    ]),
    activityView("activity:physics-run", "physics", "active", [
      "wi-p1",
    ]),
    activityView("activity:requirements-done", "requirements", "completed", [
      "wi-r1",
    ]),
  ];

  const hero = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE, activities);
  const markers = hero.nodes.filter(isActivityHeroNode);

  assertEquals(markers.map((item) => item.activity.id), [
    "activity:geometry-next",
    "activity:physics-run",
  ]);
  assertEquals(
    markers.find((item) => item.activity.id === "activity:geometry-next")
      ?.lane,
    "geometry",
  );
  assertEquals(
    markers.find((item) => item.activity.id === "activity:physics-run")
      ?.lane,
    "physics",
  );
  assertEquals(
    markers.filter((item) => item.activity.id === "activity:geometry-next")
      .length,
    1,
  );
  assertEquals(
    hero.nodes.some((item) =>
      item.kind === "activity" &&
      item.activity.id === "activity:requirements-done"
    ),
    false,
  );
});

Deno.test("adding overview activity markers leaves recorded nodes and edges unchanged", () => {
  const recordedOnly = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE);
  const withActivities = buildOverviewThreadHero(GENERIC_THREAD_FIXTURE, [
    activityView("activity:geometry-next", "geometry", "planned", ["wi-g1"]),
    activityView("activity:physics-run", "physics", "blocked", ["wi-p1"]),
  ]);

  assertEquals(
    withActivities.nodes.filter(isRecordedOverviewHeroNode),
    recordedOnly.nodes.filter(isRecordedOverviewHeroNode),
  );
  assertEquals(withActivities.edges, recordedOnly.edges);
  assertEquals(
    withActivities.lanes.map((column) => column.systems),
    recordedOnly.lanes.map((column) => column.systems),
  );
});

function recordedId(item: OverviewHeroNode): string | undefined {
  return item.kind === "recorded" ? item.node.ref.id : undefined;
}

function isActivityHeroNode(
  item: OverviewHeroNode,
): item is OverviewActivityHeroNode {
  return item.kind === "activity";
}

function activityView(
  id: string,
  lane: ProjectPathActivityView["lane"],
  status: ProjectPathActivityView["status"],
  revisionIds: readonly string[],
): ProjectPathActivityView {
  return {
    id,
    lane,
    title: id,
    status,
    revisions: revisionIds.map((revisionId) => ({
      id: revisionId,
      title: revisionId,
      status: "ready",
      attempts: [],
    })),
    approvedDecisions: 0,
    requiredDecisions: 0,
    evidenceCount: 0,
    evidenceRefs: [],
    dependencyEvidenceRefs: [],
  };
}
