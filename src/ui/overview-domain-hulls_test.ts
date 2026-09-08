import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  overviewDisambiguatedRecordLabel,
  overviewRecordProvenanceQualifier,
} from "./src/project/overview/hulls/domain-groups.ts";
import {
  buildOverviewThreadHero,
  isRecordedOverviewHeroNode,
  OVERVIEW_DOMAIN_GROUP_KEYS,
  OVERVIEW_SEMANTIC_GROUP_KEYS,
  overviewGroupCaption,
} from "./src/project/overview-thread-hero-model.ts";
import { overviewRequirementSourceViewerAliases } from "./src/project/overview-thread-viewer-discovery.ts";
import { buildOverviewHullContents } from "./src/project/overview-thread-hull-content.ts";
import { overviewThreadD3FlowGroupIdentity as groupId } from "./src/project/overview-thread-d3-flow-layout.ts";
import type { ProjectPathActivityView } from "./src/project/model.ts";
import type {
  ThreadArtifact,
  ThreadGraphEdge,
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
  const captures = [
    "syson_element_insert_sysml",
    "syson_constraint_extract",
    "model.write-requirements@2",
    "model.recapture-requirements@2",
  ]
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

Deno.test("a new RadialArm write-requirements@2 capture stays in SYSML, not the activity lane", () => {
  const thread = domainCoverageThread();
  const captureId = "requirements-RadialArm-fdf16c35";
  const requirementId = "REQ-RADIAL-ARM";
  const capture = {
    ...workbenchArtifact({
      id: captureId,
      label: "Requirements: RadialArm",
      kind: "sysml-model",
      system: "syson",
      fingerprint: `sha256:${"c".repeat(64)}`,
      producer: {
        serverId: "syson",
        tool: "model.write-requirements@2",
        runId: "run:id01-queue-radial-arm-bench-requirements-r1-20260908",
      },
    }),
    uri: `casys://requirements-capture/RadialArm/sha256/${"c".repeat(64)}`,
  };
  thread.artifacts.push(capture);
  thread.graph.nodes.push(
    graphArtifact(capture.id, capture.label, capture.system, capture.kind),
    {
      id: `graph:requirement:${requirementId}`,
      ref: { kind: "requirement", id: requirementId },
      entityKind: "requirement",
      label: "RadialArmBenchDisplacementLimit",
      system: "syson",
      freshness: "fresh",
      summary: "radial_arm_bench_max_displacement_mm",
    },
  );
  thread.graph.edges.push({
    id: `traces:${captureId}:${requirementId}`,
    from: { kind: "artifact", id: captureId },
    to: { kind: "requirement", id: requirementId },
    relation: "traces_to",
    rationale: "Requirements: RadialArm is the explicit source artifact.",
    origin: "structure",
  });
  const snapshotRevision = thread.evidenceFamilyGraph.asOf.revision;
  const activities: readonly ProjectPathActivityView[] = [
    {
      ...pathActivity({
        id: "activity:author-radial-arm-bench-requirements-r1",
        lane: "requirements",
        title: "Author traced reviewed requirements in the system model",
        status: "completed",
      }),
      evidenceRefs: [{
        snapshotId: thread.id,
        snapshotRevision,
        kind: "artifact",
        id: captureId,
      }],
    },
    {
      ...pathActivity({
        id: "activity:physics-names-requirement",
        lane: "physics",
        title: "Run does not reclassify a typed requirement",
        status: "completed",
      }),
      evidenceRefs: [{
        snapshotId: thread.id,
        snapshotRevision,
        kind: "requirement",
        id: requirementId,
      }],
    },
  ];
  const session: ThreadViewerSession = {
    id: "radial-arm-requirements-app",
    kind: "mcp-app",
    anchor: { kind: "artifact", id: captureId },
    app: { id: "io.casys.mcp-syson", version: "1.0.0" },
    manifest: {
      uri: "ui://mcp-syson/manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-syson/requirements-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 1,
    },
    launchUri: "/api/viewer/app",
    readResources: [],
    session: {
      action: "viewer.session.apply",
      schema: "io.casys.mcp-syson.recorded-authored-requirements-session/1.0",
      payload: {},
      fingerprint: `sha256:${"c".repeat(64)}`,
    },
  };

  const hero = buildOverviewThreadHero(thread, activities);
  const recorded = hero.nodes.filter(isRecordedOverviewHeroNode);
  const captureNode = recorded.find((item) =>
    item.key === `artifact:${captureId}`
  )!;
  const requirement = recorded.find((item) =>
    item.key === `requirement:${requirementId}`
  )!;
  const architecture = recorded.find((item) =>
    item.key === "artifact:sysml-current"
  )!;
  const contents = buildOverviewHullContents(recorded, [session], undefined);
  const sysmlKey = groupId(
    "system-model",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const activitySysmlKey = groupId(
    "requirements",
    OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel,
  );
  const aliases = overviewRequirementSourceViewerAliases(
    recorded.map((item) => ({
      key: item.key,
      groupKey: item.groupKey,
      ref: item.node.ref,
      ...(item.isRequirementsCapture === true
        ? { isRequirementsCapture: true }
        : {}),
    })),
    thread.graph.edges,
    [session],
  );

  assertEquals(captureNode.lane, "system-model");
  assertEquals(captureNode.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel);
  assertEquals(captureNode.isRequirementsCapture, true);
  assertEquals(requirement.lane, "system-model");
  assertEquals(requirement.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.sysmlModel);
  assertEquals(requirement.label, "RadialArmBenchDisplacementLimit");
  assertEquals(architecture.lane, "system-model");
  assertEquals(
    [...contents.keys()].filter((key) => key.includes("sysml-model")),
    [sysmlKey],
  );
  assertEquals(contents.has(activitySysmlKey), false);
  assertEquals(
    contents.get(sysmlKey)?.records.some((row) =>
      row.nodeKey === captureNode.key
    ),
    true,
  );
  assertEquals(
    contents.get(sysmlKey)?.records.some((row) =>
      row.nodeKey === requirement.key
    ),
    true,
  );
  assertEquals(
    contents.get(sysmlKey)?.records.find((row) =>
      row.nodeKey === requirement.key
    )?.graphRefs,
    [requirement.key],
  );
  assertEquals(
    aliases.get(`requirement:${requirementId}`)?.map((target) => ({
      sessionId: target.sessionId,
      nodeKey: target.nodeKey,
    })),
    [{
      sessionId: "radial-arm-requirements-app",
      nodeKey: `artifact:${captureId}`,
    }],
  );
  assertEquals(session.anchor, { kind: "artifact", id: captureId });
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
    const record = hull.records.find((row) =>
      row.nodeKey === `artifact:${id}`
    )!;
    assertEquals(record.sessionIds, [`cad-session:${id}`]);
    assertEquals(record.label, `Housing ${id}`);
  }
  for (const id of exportIds) {
    const record = hull.records.find((row) =>
      row.nodeKey === `artifact:${id}`
    )!;
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
  const activities: readonly ProjectPathActivityView[] = [
    pathActivity({
      id: "activity:seal-fea-proof",
      lane: "physics",
      title: "Seal the reviewed FEA proof case into the evidence thread",
      status: "planned",
    }),
    pathActivity({
      id: "activity:next-geometry",
      lane: "geometry",
      title: "Next geometry",
      status: "active",
    }),
  ];

  const hero = buildOverviewThreadHero(thread, activities);
  const contents = buildOverviewHullContents(hero.nodes, [], undefined);

  const recorded = hero.nodes.filter(isRecordedOverviewHeroNode);
  const byId = (id: string) =>
    recorded.find((item) => item.node.ref.id === id)!;

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

  assertEquals(
    hero.nodes.some((item) => item.kind === "activity"),
    false,
  );
  assertEquals(
    hero.nodes.some((item) =>
      item.kind === "recorded" &&
      item.groupKey === OVERVIEW_DOMAIN_GROUP_KEYS.projectActivity
    ),
    false,
  );
  assertEquals(
    [...contents.keys()].some((key) => key.includes("project-activity")),
    false,
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
      thread.graph.nodes.some((node) =>
        `${node.ref.kind}:${node.ref.id}` === item.key
      )
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

Deno.test("camera-bracket FEA evaluation uses the evidencing operation, not syson", () => {
  const thread = cameraBracketFeaThread();
  const before = JSON.stringify(thread);
  const hero = buildOverviewThreadHero(thread);
  const recorded = hero.nodes.filter(isRecordedOverviewHeroNode);
  const evaluation = recorded.find((item) =>
    item.key === `evaluation:${CAMERA_BRACKET_EVALUATION_ID}`
  )!;
  const orphan = recorded.find((item) =>
    item.key === "evaluation:orphan-syson-evaluation"
  )!;
  const ambiguous = recorded.find((item) =>
    item.key === "evaluation:ambiguous-syson-evaluation"
  )!;

  assertEquals(evaluation.lane, "verdicts");
  assertEquals(evaluation.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.fea);
  assertEquals(
    overviewGroupCaption(evaluation.groupKey, evaluation.lane),
    "FEA verdict",
  );
  assertEquals(evaluation.label, "CameraBracketBenchStressLimit evaluation");
  assertEquals(evaluation.node.system, "syson");
  assertEquals(orphan.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.unassigned);
  assertEquals(ambiguous.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.unassigned);
  assertEquals(overviewGroupCaption(orphan.groupKey), "Recorded items");
  assertEquals(overviewGroupCaption(ambiguous.groupKey), "Recorded items");
  assertEquals(orphan.groupKey === "syson", false);
  assertEquals(ambiguous.groupKey === "syson", false);
  assertEquals(JSON.stringify(thread), before);
});

Deno.test("an exact active evidence relation overlays that hull; planned work does not", () => {
  const thread = domainCoverageThread();
  const snapshotRevision = thread.evidenceFamilyGraph.asOf.revision;
  const evidenceRef = {
    snapshotId: thread.id,
    snapshotRevision,
    kind: "artifact" as const,
    id: "fea-static",
  };
  const hero = buildOverviewThreadHero(thread, [
    {
      ...pathActivity({
        id: "activity:run-fea",
        lane: "physics",
        title: "Run the FEA proof",
        status: "active",
      }),
      evidenceRefs: [evidenceRef],
    },
    pathActivity({
      id: "activity:planned-geometry",
      lane: "geometry",
      title: "Later geometry",
      status: "planned",
    }),
  ]);
  const fea = hero.nodes.filter(isRecordedOverviewHeroNode).find((item) =>
    item.key === "artifact:fea-static"
  )!;
  const contents = buildOverviewHullContents(hero.nodes, []);
  const feaHull = contents.get(
    groupId("physics", OVERVIEW_DOMAIN_GROUP_KEYS.fea),
  )!;
  const geometryHull = contents.get(
    groupId("geometry", OVERVIEW_DOMAIN_GROUP_KEYS.geometry),
  );
  assertEquals(fea.activityStatus, "active");
  assertEquals(feaHull.status, "active");
  assertEquals(geometryHull?.status, undefined);
  assertEquals(hero.nodes.some((item) => item.kind === "activity"), false);
});

Deno.test("a Season evaluation without exact evidence never becomes a Season hull", () => {
  const thread = cameraBracketFeaThread();
  thread.graph.nodes.push({
    id: "graph:evaluation:season-orphan",
    ref: { kind: "evaluation", id: "season-orphan" },
    entityKind: "evaluation",
    label: "Season evaluation without evidence",
    system: "Season",
    freshness: "fresh",
    summary: "unresolved",
  });
  const hero = buildOverviewThreadHero(thread);
  const orphan = hero.nodes.filter(isRecordedOverviewHeroNode).find((item) =>
    item.key === "evaluation:season-orphan"
  )!;
  assertEquals(orphan.groupKey, OVERVIEW_DOMAIN_GROUP_KEYS.unassigned);
  assertEquals(overviewGroupCaption(orphan.groupKey), "Recorded items");
  assertEquals(orphan.groupKey === "Season", false);
  assertEquals(orphan.node.system, "Season");
});

Deno.test("independent FEA results with the same label stay visible and use recorded run ids", () => {
  const thread = cameraBracketFeaThread();
  const hero = buildOverviewThreadHero(thread);
  const recorded = hero.nodes.filter(isRecordedOverviewHeroNode);
  const results = recorded.filter((item) =>
    item.node.ref.id.startsWith("calculix-isolated-result-json-")
  );
  const observations = recorded.filter((item) =>
    item.node.entityKind === "observation"
  );
  const unlabeled = recorded.filter((item) =>
    item.node.ref.id.startsWith("calculix-unlabeled-")
  );

  assertEquals(
    results.map((item) => item.node.ref.id).sort(),
    [
      "calculix-isolated-result-json-r1",
      "calculix-isolated-result-json-r3",
    ],
  );
  assertEquals(
    new Set(results.map((item) => item.groupKey)),
    new Set([OVERVIEW_DOMAIN_GROUP_KEYS.fea]),
  );
  assertEquals(
    results.map((item) => item.label).sort(),
    [
      "Local CalculiX result.json · run:id01-queue-bench-fea-run-20260907",
      "Local CalculiX result.json · run:id01-queue-bench-r3-fea-20260907",
    ],
  );
  assertEquals(
    observations.map((item) => item.label).sort(),
    [
      "CameraBracketBenchStressLimit measured by local CalculiX · run:id01-queue-bench-fea-run-20260907",
      "CameraBracketBenchStressLimit measured by local CalculiX · run:id01-queue-bench-r3-fea-20260907",
    ],
  );
  assertEquals(
    unlabeled.map((item) => item.label),
    ["Local CalculiX result.json", "Local CalculiX result.json"],
  );
  assertEquals(
    overviewDisambiguatedRecordLabel(
      "Local CalculiX result.json",
      "run:r3",
      2,
      true,
    ),
    "Local CalculiX result.json · run:r3",
  );
  assertEquals(
    overviewDisambiguatedRecordLabel(
      "Local CalculiX result.json",
      "run:r3",
      1,
      true,
    ),
    "Local CalculiX result.json",
  );
  assertEquals(
    overviewRecordProvenanceQualifier({
      artifact: workbenchArtifact({
        id: "calculix-isolated-result-json-r3",
        label: "Local CalculiX result.json",
        kind: "solver-result",
        system: "digital-thread",
        fingerprint: "sha256:r3",
        producer: {
          serverId: "digital-thread",
          tool: "verify.run-fea-static-proof@3",
          runId: "run:id01-queue-bench-r3-fea-20260907",
        },
      }),
    }),
    "run:id01-queue-bench-r3-fea-20260907",
  );
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

const CAMERA_BRACKET_EVALUATION_ID =
  "requirement-camera-bracket-bench-evaluation-r3";

function pathActivity(spec: {
  id: string;
  lane: ProjectPathActivityView["lane"];
  title: string;
  status: ProjectPathActivityView["status"];
}): ProjectPathActivityView {
  return {
    id: spec.id,
    lane: spec.lane,
    title: spec.title,
    status: spec.status,
    revisions: [{
      id: spec.id,
      title: spec.title,
      status: spec.status === "completed" ? "completed" : "ready",
      attempts: [],
    }],
    approvedDecisions: 0,
    requiredDecisions: 0,
    evidenceCount: 0,
    evidenceRefs: [],
    dependencyEvidenceRefs: [],
  };
}

function cameraBracketFeaThread(): ThreadWorkbenchSnapshot {
  const r1Result = workbenchArtifact({
    id: "calculix-isolated-result-json-r1",
    label: "Local CalculiX result.json",
    kind: "solver-result",
    system: "digital-thread",
    fingerprint: "sha256:result-r1",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:id01-queue-bench-fea-run-20260907",
    },
  });
  const r3Result = workbenchArtifact({
    id: "calculix-isolated-result-json-r3",
    label: "Local CalculiX result.json",
    kind: "solver-result",
    system: "digital-thread",
    fingerprint: "sha256:result-r3",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:id01-queue-bench-r3-fea-20260907",
    },
  });
  const unlabeledA = workbenchArtifact({
    id: "calculix-unlabeled-a",
    label: "Local CalculiX result.json",
    kind: "solver-result",
    system: "digital-thread",
    fingerprint: "sha256:unlabeled-a",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:shared-unlabeled",
    },
  });
  const unlabeledB = workbenchArtifact({
    id: "calculix-unlabeled-b",
    label: "Local CalculiX result.json",
    kind: "solver-result",
    system: "digital-thread",
    fingerprint: "sha256:unlabeled-b",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:shared-unlabeled",
    },
  });
  const evidencing = workbenchArtifact({
    id: "calculix-isolated-syson-evaluation-r3",
    label: "SysON evaluation of isolated CalculiX evidence",
    kind: "evidence",
    system: "digital-thread",
    fingerprint: "sha256:syson-eval-r3",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:id01-queue-bench-r3-fea-20260907",
    },
  });
  const leftover = workbenchArtifact({
    id: "calculix-isolated-syson-evaluation-extra",
    label: "SysON evaluation of isolated CalculiX evidence",
    kind: "evidence",
    system: "digital-thread",
    fingerprint: "sha256:syson-eval-extra",
    producer: {
      serverId: "digital-thread",
      tool: "verify.run-fea-static-proof@3",
      runId: "run:id01-queue-bench-r3-fea-20260907",
    },
  });
  const observations: ThreadObservation[] = [
    {
      id: "OBS-FEA-R1",
      label: "CameraBracketBenchStressLimit measured by local CalculiX",
      value: 0.007638156,
      unit: "MPa",
      display: "0.007638156 MPa",
      sourceArtifactId: r1Result.id,
      requirementIds: ["REQ-BRACKET"],
      freshness: "fresh",
    },
    {
      id: "OBS-FEA-R3",
      label: "CameraBracketBenchStressLimit measured by local CalculiX",
      value: 0.007638156,
      unit: "MPa",
      display: "0.007638156 MPa",
      sourceArtifactId: r3Result.id,
      requirementIds: ["REQ-BRACKET"],
      freshness: "fresh",
    },
  ];
  const nodes: ThreadGraphNode[] = [
    graphArtifact(r1Result.id, r1Result.label, r1Result.system, r1Result.kind),
    graphArtifact(r3Result.id, r3Result.label, r3Result.system, r3Result.kind),
    graphArtifact(
      unlabeledA.id,
      unlabeledA.label,
      unlabeledA.system,
      unlabeledA.kind,
    ),
    graphArtifact(
      unlabeledB.id,
      unlabeledB.label,
      unlabeledB.system,
      unlabeledB.kind,
    ),
    graphArtifact(
      evidencing.id,
      evidencing.label,
      evidencing.system,
      evidencing.kind,
    ),
    {
      id: `graph:observation:${observations[0]!.id}`,
      ref: { kind: "observation", id: observations[0]!.id },
      entityKind: "observation",
      label: observations[0]!.label,
      system: "digital-thread",
      freshness: "fresh",
      summary: observations[0]!.display,
      engineeringCaseRefs: [
        "verification-case:mechanical-proof:ba1598b7c21bc117",
      ],
    },
    {
      id: `graph:observation:${observations[1]!.id}`,
      ref: { kind: "observation", id: observations[1]!.id },
      entityKind: "observation",
      label: observations[1]!.label,
      system: "digital-thread",
      freshness: "fresh",
      summary: observations[1]!.display,
      engineeringCaseRefs: [
        "verification-case:mechanical-proof:cc0c0f83875bd4b8",
      ],
    },
    evaluationNode(
      CAMERA_BRACKET_EVALUATION_ID,
      "CameraBracketBenchStressLimit evaluation",
    ),
    evaluationNode(
      "orphan-syson-evaluation",
      "Orphan CameraBracketBenchStressLimit evaluation",
    ),
    evaluationNode(
      "ambiguous-syson-evaluation",
      "Ambiguous CameraBracketBenchStressLimit evaluation",
    ),
  ];
  const thread = threadWith(nodes, [
    r1Result,
    r3Result,
    unlabeledA,
    unlabeledB,
    evidencing,
    leftover,
  ], observations);
  thread.graph = {
    ...thread.graph,
    edges: [
      evidencesEdge(evidencing.id, CAMERA_BRACKET_EVALUATION_ID),
      evidencesEdge(evidencing.id, "ambiguous-syson-evaluation"),
      evidencesEdge(leftover.id, "ambiguous-syson-evaluation"),
    ],
  };
  return thread;
}

function evaluationNode(id: string, label: string): ThreadGraphNode {
  return {
    id: `graph:evaluation:${id}`,
    ref: { kind: "evaluation", id },
    entityKind: "evaluation",
    label,
    system: "syson",
    freshness: "fresh",
    summary: "pass",
    recordedAt: "2026-09-07T13:33:40.248Z",
    selection: { kind: "requirement", id: "REQ-BRACKET" },
    engineeringCaseRefs: [
      "verification-case:mechanical-proof:cc0c0f83875bd4b8",
    ],
  };
}

function evidencesEdge(
  fromArtifactId: string,
  evaluationId: string,
): ThreadGraphEdge {
  return {
    id: `evidences:${fromArtifactId}:${evaluationId}`,
    from: { kind: "artifact", id: fromArtifactId },
    to: { kind: "evaluation", id: evaluationId },
    relation: "evidences",
    rationale: "The immutable SysON envelope is the evaluation evidence.",
    origin: "provenance",
  };
}
