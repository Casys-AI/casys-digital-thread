import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildOverviewThreadHero,
  isRecordedOverviewHeroNode,
  OVERVIEW_DOMAIN_GROUP_KEYS,
  OVERVIEW_SEMANTIC_GROUP_KEYS,
  overviewGroupCaption,
} from "./src/project/overview-thread-hero-model.ts";
import { buildOverviewHullContents } from "./src/project/overview-thread-hull-content.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import type { ProjectPathActivityView } from "./src/project/model.ts";
import type {
  ThreadArtifact,
  ThreadGraphNode,
  ThreadObservation,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";
import type { ThreadViewerHierarchyProjection } from "../presentation/workbench/thread/viewer-hierarchy.ts";
import type { ThreadViewerSession } from "./src/thread/viewer-sessions-client.ts";

const CANONICAL_COUNT = 33;
const EXPORT_COUNT = 24;
const HIERARCHY_ROWS = 29;
const CAD_SESSION_COUNT = 19;

Deno.test("Requirements captures share the SYSML hull and blue without moving Brief", () => {
  const thread = domainCoverageThread();
  const captures = ["syson_element_insert_sysml", "syson_constraint_extract"]
    .map((tool, index) => ({
      ...workbenchArtifact({
        id: `capture-${index}`,
        label: "Not a classification hint",
        kind: "sysml-model",
        system: "syson",
        fingerprint: `sha256:${"a".repeat(64)}`,
        producer: { serverId: "syson", tool, runId: `run:capture-${index}` },
      }),
      uri: `casys://requirements-capture/Housing/sha256/${"a".repeat(64)}`,
    }));
  thread.artifacts.push(...captures);
  thread.graph.nodes.push(
    ...captures.map((a) => graphArtifact(a.id, a.label, a.system, a.kind)),
  );
  const before = JSON.stringify(thread);
  const nodes = buildOverviewThreadHero(thread).nodes.filter(
    isRecordedOverviewHeroNode,
  );
  const byId = (id: string) => nodes.find((n) => n.key === `artifact:${id}`)!;
  const requirement = nodes.find((n) => n.key === "requirement:REQ-MASS")!;
  const model = byId("sysml-current");
  const brief = byId("brief-baseline");
  for (const capture of captures) {
    const node = byId(capture.id);
    assertEquals(node.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel);
    assertEquals(node.lane, "system-model");
    assertEquals(node.color, model.color);
    assertEquals(node.isRequirementsCapture, true);
  }
  assertEquals(requirement.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel);
  assertEquals(requirement.lane, "system-model");
  assertEquals(requirement.isRequirementsCapture, undefined);
  assertEquals(requirement.color, model.color);
  assertEquals(requirement.color === brief.color, false);
  assertEquals(brief.groupKey, "brief");
  assertEquals(brief.lane, "requirements");
  assertEquals(overviewGroupCaption(model.groupKey), "SYSML");
  const contents = buildOverviewHullContents(nodes, [], undefined);
  const sysml = contents.get(
    groupId("system-model", OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel),
  )!;
  const briefHull = contents.get(groupId("requirements", "brief"))!;
  assertEquals(
    [...contents.keys()].filter((key) => key.includes("sysml-model")).length,
    1,
  );
  assertEquals(
    sysml.records.some((row) => row.nodeKey === requirement.key),
    true,
  );
  assertEquals(
    sysml.records.some((row) => row.nodeKey === model.key),
    true,
  );
  for (const capture of captures) {
    assertEquals(
      sysml.records.some((row) => row.nodeKey === `artifact:${capture.id}`),
      true,
    );
    assertEquals(
      sysml.rows.some((row) => row.nodeKey === `artifact:${capture.id}`),
      false,
    );
  }
  assertEquals(
    briefHull.records.some((row) => row.nodeKey === brief.key),
    true,
  );
  assertEquals(JSON.stringify(thread), before);

  // An architecture, misleading title, unknown producer or different namespace
  // must not become a requirements capture.
  for (
    const patch of [
      { uri: `casys://architecture-capture/Housing/sha256/${"a".repeat(64)}` },
      {
        producer: {
          serverId: "syson",
          tool: "unrecognized",
          runId: "run:unknown",
        },
      },
      {
        producer: {
          serverId: "other",
          tool: "syson_constraint_extract",
          runId: "run:foreign",
        },
      },
    ]
  ) {
    const changed = structuredClone(thread);
    Object.assign(changed.artifacts.find((a) => a.id === "capture-0")!, patch, {
      label: "Requirements",
    });
    const capture = buildOverviewThreadHero(changed).nodes.find((n) =>
      n.key === "artifact:capture-0"
    )!;
    assertEquals(capture.kind, "recorded");
    assertEquals(capture.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel);
    assertEquals(capture.lane, "system-model");
    assertEquals(
      capture.kind === "recorded" ? capture.isRequirementsCapture : true,
      undefined,
    );
  }
});

const canonicalIds = Array.from(
  { length: CANONICAL_COUNT },
  (_, index) => `geometry-part-${index + 1}`,
);
const exportIds = Array.from(
  { length: EXPORT_COUNT },
  (_, index) =>
    index % 2 === 0
      ? `geometry-part-${index / 2 + 1}.step`
      : `geometry-part-${(index + 1) / 2}.glb`,
);

Deno.test("canonical geometry and exported STEP/GLB share one Geometry hull and one occurrence tree", () => {
  const thread = cadUnificationThread();
  const graphBefore = JSON.stringify(thread.graph);
  const artifactsBefore = JSON.stringify(thread.artifacts);
  const stagesBefore = JSON.stringify(thread.flow);
  const sessions = cadSessions();
  const hierarchy = cadHierarchy(sessions.map((session) => session.id));

  const hero = buildOverviewThreadHero(thread);
  const contents = buildOverviewHullContents(hero.nodes, sessions, hierarchy);

  const cadNodes = hero.nodes.filter((item) =>
    item.kind === "recorded" && cadRecordIds.has(item.node.ref.id)
  );
  const geometryGroups = unique(
    cadNodes.map((item) => item.groupKey),
  );
  const hullKey = groupId("geometry", OVERVIEW_DOMAIN_GROUP_KEYS.geometry);
  const hull = contents.get(hullKey)!;
  const geometryStructureHulls = [...contents.values()].filter((content) =>
    content.groupKey === hullKey && content.mode === "tree"
  );

  assertEquals(cadNodes.length, CANONICAL_COUNT + EXPORT_COUNT);
  assertEquals(geometryGroups, [OVERVIEW_DOMAIN_GROUP_KEYS.geometry]);
  assertEquals(
    overviewGroupCaption(OVERVIEW_DOMAIN_GROUP_KEYS.geometry),
    "Geometry",
  );
  assertEquals(geometryStructureHulls.length, 1);
  assertEquals(hull.mode, "tree");
  assertEquals(hull.rows.length, HIERARCHY_ROWS);
  assertEquals(hull.records.length, CANONICAL_COUNT + EXPORT_COUNT);
  assertEquals(
    unique(hull.records.map((row) => row.nodeKey ?? row.key)).length,
    CANONICAL_COUNT + EXPORT_COUNT,
  );
  assertEquals(
    hull.rows.map((row) => [row.key, row.label, row.depth, row.sessionIds]),
    hierarchy.nodes.map((node, index) => [
      node.id,
      node.usageLabel ?? node.label,
      index === 0 ? 0 : 1,
      index === 0 ? sessions.map((session) => session.id) : [],
    ]),
  );
  for (const id of canonicalIds.slice(0, CAD_SESSION_COUNT)) {
    const record = hull.records.find((row) => row.nodeKey === `artifact:${id}`)!;
    assertEquals(record.sessionIds, [`cad-session:${id}`]);
    assertEquals(record.label, `Housing ${id}`);
  }
  for (const id of exportIds) {
    const record = hull.records.find((row) => row.nodeKey === `artifact:${id}`)!;
    assertEquals(record.sessionIds, []);
  }
  assertEquals(
    hero.nodes.filter(isRecordedOverviewHeroNode).map((item) => item.key)
      .every((key) =>
        thread.graph.nodes.some((node) =>
          `${node.ref.kind}:${node.ref.id}` ===
            key
        )
      ),
    true,
  );
  assertEquals(JSON.stringify(thread.graph), graphBefore);
  assertEquals(JSON.stringify(thread.artifacts), artifactsBefore);
  assertEquals(JSON.stringify(thread.flow), stagesBefore);

  const relabeled = cadUnificationThread();
  for (const artifact of relabeled.artifacts) {
    artifact.label = `Renamed ${artifact.label}`;
    artifact.system = "renamed-provider";
    if (artifact.producer) {
      artifact.producer = {
        ...artifact.producer,
        serverId: "renamed-provider",
      };
    }
  }
  for (const node of relabeled.graph.nodes) {
    node.label = `Copy ${node.label}`;
    node.system = "renamed-provider";
  }
  const relabeledHero = buildOverviewThreadHero(relabeled);
  assertEquals(
    unique(
      relabeledHero.nodes.filter((item) =>
        item.kind === "recorded" && cadRecordIds.has(item.node.ref.id)
      ).map((item) => item.groupKey),
    ),
    [OVERVIEW_DOMAIN_GROUP_KEYS.geometry],
  );
  const relabeledContents = buildOverviewHullContents(
    relabeledHero.nodes,
    sessions,
    hierarchy,
  );
  assertEquals(relabeledContents.get(hullKey)?.rows.length, HIERARCHY_ROWS);
  assertEquals(
    relabeledContents.get(hullKey)?.records.length,
    CANONICAL_COUNT + EXPORT_COUNT,
  );
});

Deno.test("typed SysML, Requirements, Brief, FEA, and Simulation stay fail-closed domain hulls", () => {
  const thread = domainCoverageThread();
  const graphBefore = JSON.stringify(thread.graph);
  const fingerprints = Object.fromEntries(
    thread.artifacts.map((artifact) => [artifact.id, artifact.fingerprint]),
  );
  const stageLabels = thread.flow.map((stage) => [
    stage.id,
    stage.label,
    stage.summary,
  ]);
  const activities: readonly ProjectPathActivityView[] = [{
    id: "activity:next-geometry",
    lane: "geometry",
    title: "Next geometry",
    status: "planned",
    revisions: [{
      id: "wi-g1",
      title: "wi-g1",
      status: "ready",
      attempts: [],
    }],
    approvedDecisions: 0,
    requiredDecisions: 0,
    evidenceCount: 0,
    evidenceRefs: [],
    dependencyEvidenceRefs: [],
  }];

  const hero = buildOverviewThreadHero(thread, activities);
  const contents = buildOverviewHullContents(hero.nodes, [], undefined);

  const recorded = hero.nodes.filter(isRecordedOverviewHeroNode);
  const byId = (id: string) => recorded.find((item) => item.node.ref.id === id)!;

  assertEquals(
    byId("sysml-current").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  assertEquals(
    byId("housing-def").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  assertEquals(
    byId("housing-use").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  assertEquals(
    byId("wall-attr").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  assertEquals(
    overviewGroupCaption(byId("sysml-current").groupKey),
    "SYSML",
  );
  assertEquals(
    byId("REQ-MASS").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  assertEquals(
    overviewGroupCaption(byId("REQ-MASS").groupKey),
    "SYSML",
  );
  assertEquals(
    byId("brief-baseline").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.brief,
  );
  assertEquals(byId("brief-item").groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.brief);
  assertEquals(overviewGroupCaption(byId("brief-baseline").groupKey), "Brief");
  assertEquals(byId("fea-static").groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.fea);
  assertEquals(byId("OBS-FEA").groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.fea);
  assertEquals(overviewGroupCaption(byId("OBS-FEA").groupKey), "FEA");
  assertEquals(
    byId("OBS-MISSING").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.unassigned,
  );
  assertEquals(
    byId("arbitrary-solver").groupKey,
    "CalculiX",
  );
  assertEquals(
    byId("OBS-ARBITRARY").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.unassigned,
  );
  assertEquals(
    byId("assembly-integrity").groupKey,
    OVERVIEW_SEMANTIC_GROUP_KEYS.assemblyIntegrity,
  );
  assertEquals(
    byId("kinematics-case").groupKey,
    OVERVIEW_SEMANTIC_GROUP_KEYS.prescribedKinematics,
  );
  assertEquals(
    byId("admitted-modelica").groupKey,
    OVERVIEW_DOMAIN_GROUP_KEYS.simulation,
  );
  assertEquals(
    overviewGroupCaption(byId("admitted-modelica").groupKey),
    "Simulation",
  );

  const activity = hero.nodes.find((item) => item.kind === "activity")!;
  assertEquals(activity.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.projectActivity);
  assertEquals(
    overviewGroupCaption(activity.groupKey),
    "Project activities",
  );
  const sysml = contents.get(
    groupId("system-model", OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel),
  )!;
  const briefHull = contents.get(groupId("requirements", "brief"))!;
  assertEquals(sysml.mode, "tree");
  assertEquals(
    sysml.rows.some((row) =>
      row.kind === "navigation" && row.label === "Requirements" &&
      row.endpoint === false && row.nodeKey === undefined
    ),
    true,
  );
  assertEquals(
    sysml.rows.filter((row) => row.nodeKey === "requirement:REQ-MASS").length,
    1,
  );
  assertEquals(
    briefHull.records.map((row) => row.nodeKey).sort(),
    ["analysis-node:brief-item", "artifact:brief-baseline"].sort(),
  );
  assertEquals(
    new Set(
      contents.get(groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea))
        ?.records
        .map((row) => row.nodeKey),
    ),
    new Set(["artifact:fea-static", "observation:OBS-FEA"]),
  );
  assertEquals(
    recorded.every((item) =>
      thread.graph.nodes.some((node) => `${node.ref.kind}:${node.ref.id}` === item.key)
    ),
    true,
  );
  assertEquals(JSON.stringify(thread.graph), graphBefore);
  assertEquals(
    Object.fromEntries(
      thread.artifacts.map((artifact) => [artifact.id, artifact.fingerprint]),
    ),
    fingerprints,
  );
  assertEquals(
    thread.flow.map((stage) => [stage.id, stage.label, stage.summary]),
    stageLabels,
  );
  assertEquals(byId("fea-static").label, "Static structural proof");
  assertEquals(byId("OBS-FEA").label, "Maximum von Mises stress");
  assertEquals(byId("arbitrary-solver").label, "Legacy CalculiX bundle");
});

const cadRecordIds = new Set([...canonicalIds, ...exportIds]);

function cadUnificationThread(): ThreadWorkbenchSnapshot {
  const artifacts: ThreadArtifact[] = [
    ...canonicalIds.map((id, index) =>
      workbenchArtifact({
        id,
        label: `Housing ${id}`,
        kind: index % 2 === 0 ? "cad-model" : "other",
        system: "casys-digital-thread",
        fingerprint: `sha256:canonical-${id}`,
        producer: {
          serverId: "casys-digital-thread",
          tool: index === 1
            ? "geometry.module.immediate-compound@1.0"
            : "design.write-geometry@1",
          runId: `run:${id}`,
        },
      })
    ),
    ...exportIds.map((id, index) =>
      workbenchArtifact({
        id,
        label: `Housing ${id}`,
        kind: id.endsWith(".step") ? "step" : "cad-model",
        system: "build123d-sandbox",
        fingerprint: `sha256:export-${id}`,
        producer: {
          serverId: "build123d-sandbox",
          tool: "build123d_export",
          runId: `export:${id}:${index}`,
        },
      })
    ),
  ];
  const nodes: ThreadGraphNode[] = artifacts.map((artifact) =>
    graphArtifact(
      artifact.id,
      artifact.label,
      artifact.system,
      artifact.kind === "other" ? "geometry" : artifact.kind,
    )
  );
  return threadWith(nodes, artifacts);
}

function domainCoverageThread(): ThreadWorkbenchSnapshot {
  const artifacts: ThreadArtifact[] = [
    workbenchArtifact({
      id: "sysml-current",
      label: "Product structure",
      kind: "sysml-model",
      system: "syson",
      fingerprint: "sha256:sysml-current",
      producer: {
        serverId: "syson",
        tool: "model.write-architecture@1",
        runId: "run:sysml",
      },
    }),
    workbenchArtifact({
      id: "brief-baseline",
      label: "Approved brief",
      kind: "document",
      system: "casys-digital-thread",
      fingerprint: "sha256:brief-baseline",
      producer: {
        serverId: "casys-digital-thread",
        tool: "baseline_from_approved_brief",
        runId: "run:brief",
      },
    }),
    workbenchArtifact({
      id: "fea-static",
      label: "Static structural proof",
      kind: "solver-result",
      system: "calculix-worker",
      fingerprint: "sha256:fea-static",
      producer: {
        serverId: "calculix-worker",
        tool: "verify.run-fea-static-proof@3",
        runId: "run:fea",
      },
    }),
    workbenchArtifact({
      id: "arbitrary-solver",
      label: "Legacy CalculiX bundle",
      kind: "solver-result",
      system: "CalculiX",
      fingerprint: "sha256:arbitrary-solver",
      producer: {
        serverId: "CalculiX",
        tool: "calculix_solve_static",
        runId: "run:legacy-fea",
      },
    }),
    workbenchArtifact({
      id: "assembly-integrity",
      label: "Assembly integrity observation",
      kind: "solver-result",
      system: "digital-thread",
      fingerprint: "sha256:assembly-integrity",
      producedBy: "verify.observe-assembly-integrity@1",
    }),
    workbenchArtifact({
      id: "kinematics-case",
      label: "Prescribed kinematics case",
      kind: "solver-result",
      system: "digital-thread",
      fingerprint: "sha256:kinematics-case",
      producedBy: "verify.seal-prescribed-kinematics-case@1",
    }),
    workbenchArtifact({
      id: "admitted-modelica",
      label: "Admitted Modelica run",
      kind: "solver-result",
      system: "modelica-worker",
      fingerprint: "sha256:admitted-modelica",
      producer: {
        serverId: "modelica-worker",
        tool: "simulate.run-admitted-modelica@1",
        runId: "run:modelica",
      },
    }),
  ];
  const observations: ThreadObservation[] = [
    {
      id: "OBS-FEA",
      label: "Maximum von Mises stress",
      value: 132,
      unit: "MPa",
      display: "132 MPa",
      sourceArtifactId: "fea-static",
      requirementIds: ["REQ-MASS"],
      freshness: "fresh",
    },
    {
      id: "OBS-MISSING",
      label: "Orphan stress reading",
      value: 1,
      unit: "MPa",
      display: "1 MPa",
      sourceArtifactId: "missing-source",
      requirementIds: [],
      freshness: "fresh",
    },
    {
      id: "OBS-ARBITRARY",
      label: "Maximum von Mises stress",
      value: 90,
      unit: "MPa",
      display: "90 MPa",
      sourceArtifactId: "arbitrary-solver",
      requirementIds: [],
      freshness: "fresh",
    },
  ];
  const nodes: ThreadGraphNode[] = [
    graphArtifact("sysml-current", "Product structure", "syson", "sysml-model"),
    {
      id: "graph:part-definition:housing-def",
      ref: { kind: "part-definition", id: "housing-def" },
      entityKind: "part-definition",
      label: "Housing",
      system: "syson",
      freshness: "fresh",
      summary: "Recorded SysML structure",
    },
    {
      id: "graph:part-usage:housing-use",
      ref: { kind: "part-usage", id: "housing-use" },
      entityKind: "part-usage",
      label: "housing",
      system: "syson",
      freshness: "fresh",
      summary: "Recorded SysML usage",
    },
    {
      id: "graph:attribute-usage:wall-attr",
      ref: { kind: "attribute-usage", id: "wall-attr" },
      entityKind: "attribute-usage",
      label: "wall_thickness",
      system: "syson",
      freshness: "fresh",
      summary: "Recorded SysML attribute",
    },
    {
      id: "graph:requirement:REQ-MASS",
      ref: { kind: "requirement", id: "REQ-MASS" },
      entityKind: "requirement",
      label: "Mass budget",
      system: "syson",
      freshness: "fresh",
      summary: "mass ≤ 450 g",
    },
    graphArtifact(
      "brief-baseline",
      "Approved brief",
      "casys-digital-thread",
      "document",
    ),
    {
      id: "graph:analysis-node:brief-item",
      ref: { kind: "analysis-node", id: "brief-item" },
      entityKind: "analysis-node",
      label: "Bench criterion",
      system: "brief",
      freshness: "fresh",
      summary: "Brief source item",
      analysis: {
        semanticRef: {
          domain: "brief",
          kind: "brief-item",
          id: "bench-criterion",
        },
      },
    },
    graphArtifact(
      "fea-static",
      "Static structural proof",
      "calculix-worker",
      "solver-result",
    ),
    {
      id: "graph:observation:OBS-FEA",
      ref: { kind: "observation", id: "OBS-FEA" },
      entityKind: "observation",
      label: "Maximum von Mises stress",
      system: "CalculiX",
      freshness: "fresh",
      summary: "132 MPa",
    },
    {
      id: "graph:observation:OBS-MISSING",
      ref: { kind: "observation", id: "OBS-MISSING" },
      entityKind: "observation",
      label: "Orphan stress reading",
      system: "CalculiX",
      freshness: "fresh",
      summary: "1 MPa",
    },
    graphArtifact(
      "arbitrary-solver",
      "Legacy CalculiX bundle",
      "CalculiX",
      "solver-result",
    ),
    {
      id: "graph:observation:OBS-ARBITRARY",
      ref: { kind: "observation", id: "OBS-ARBITRARY" },
      entityKind: "observation",
      label: "Maximum von Mises stress",
      system: "CalculiX",
      freshness: "fresh",
      summary: "90 MPa",
    },
    graphArtifact(
      "assembly-integrity",
      "Assembly integrity observation",
      "digital-thread",
      "solver-result",
    ),
    graphArtifact(
      "kinematics-case",
      "Prescribed kinematics case",
      "digital-thread",
      "solver-result",
    ),
    graphArtifact(
      "admitted-modelica",
      "Admitted Modelica run",
      "modelica-worker",
      "solver-result",
    ),
  ];
  return threadWith(nodes, artifacts, observations);
}

function cadSessions(): ThreadViewerSession[] {
  return canonicalIds.slice(0, CAD_SESSION_COUNT).map((id) => ({
    id: `cad-session:${id}`,
    kind: "mcp-app",
    anchor: { kind: "artifact", id },
    app: { id: "example.cad", version: "1.0.0" },
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
  }));
}

function cadHierarchy(
  sessionIds: readonly string[],
): ThreadViewerHierarchyProjection {
  const nodes = Array.from({ length: HIERARCHY_ROWS }, (_, index) => ({
    id: index === 0 ? "root" : `occ-${index}`,
    ...(index === 0 ? {} : { parentId: "root" }),
    label: index === 0 ? "Assembly" : `Part ${index}`,
    partDefinitionElementId: `def-${index}`,
    ...(index === 0
      ? {
        geometryArtifactId: canonicalIds[0],
        artifactIds: [...canonicalIds, ...exportIds],
        sessionIds: [...sessionIds],
      }
      : { sessionIds: [] as string[] }),
  }));
  return {
    schemaVersion: "thread-viewer-hierarchy/1.0",
    status: "available",
    rootIds: ["root"],
    nodes,
  };
}

function threadWith(
  nodes: ThreadGraphNode[],
  artifacts: ThreadArtifact[],
  observations: ThreadObservation[] = [],
): ThreadWorkbenchSnapshot {
  const base = structuredClone(GENERIC_THREAD_FIXTURE);
  return {
    ...base,
    graph: { ...base.graph, nodes, edges: [] },
    artifacts,
    observations,
  };
}

function graphArtifact(
  id: string,
  label: string,
  system: string,
  artifactKind: string,
): ThreadGraphNode {
  return {
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact", id },
    entityKind: "artifact",
    artifactKind,
    label,
    system,
    freshness: "fresh",
    summary: `${artifactKind} · ${id}`,
    recordedAt: "2026-09-07T00:00:00Z",
  };
}

function workbenchArtifact(spec: {
  id: string;
  label: string;
  kind: string;
  system: string;
  fingerprint: string;
  producer?: ThreadArtifact["producer"];
  producedBy?: string;
}): ThreadArtifact {
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    system: spec.system,
    revision: "1",
    freshness: "fresh",
    fingerprint: spec.fingerprint,
    ...(spec.producer ? { producer: spec.producer } : {}),
    producedBy: spec.producedBy ?? spec.producer?.tool,
    dependsOn: [],
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
