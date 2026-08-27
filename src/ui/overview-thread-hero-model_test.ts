import { assertEquals, assertStringIncludes } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  buildOverviewThreadHero,
  isRecordedOverviewHeroNode,
  type OverviewActivityHeroNode,
  type OverviewHeroNode,
  overviewLaneFor,
} from "./src/project/overview-thread-hero-model.ts";
import type { ProjectPathActivityView } from "./src/project/model.ts";
import type {
  ThreadArtifact,
  ThreadAssemblyIntegrityArtifactRef,
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

Deno.test("overview promotes exact assembly-integrity L3 and L4 records without promoting L5", () => {
  const thread = structuredClone(GENERIC_THREAD_FIXTURE);
  const geometry = assemblyIntegrityRef("assembly-module", "a", []);
  const step = assemblyIntegrityRef("assembly-step", "b", [geometry.id]);
  const observation = assemblyIntegrityRef("assembly-observation", "c", [
    geometry.id,
    step.id,
  ]);
  const evaluation = assemblyIntegrityRef("assembly-evaluation", "d", [
    geometry.id,
    step.id,
    observation.id,
  ]);
  const closeout = assemblyIntegrityRef("assembly-closeout", "e", [
    evaluation.id,
  ]);
  thread.artifacts.push(
    integrityArtifact(geometry, "Assembly module", "geometry"),
    integrityArtifact(step, "Assembly STEP", "step"),
    integrityArtifact(
      observation,
      "Assembly integrity observation",
      "evidence",
    ),
    integrityArtifact(evaluation, "Assembly integrity evaluation", "evidence"),
    integrityArtifact(closeout, "Assembly integrity closeout", "document"),
  );
  thread.graph.nodes.push(
    integrityGraphNode(
      observation,
      "Assembly integrity observation",
      "evidence",
    ),
    integrityGraphNode(evaluation, "Assembly integrity evaluation", "evidence"),
    integrityGraphNode(closeout, "Assembly integrity closeout", "document"),
  );
  thread.assemblyIntegrity = {
    schemaVersion: "thread-assembly-integrity/1.0",
    family: "assembly-integrity",
    status: "current",
    chains: [{
      id: "assembly-chain-current",
      status: "current",
      observation: {
        record: observation,
        basis: {
          snapshotId: "thread-assembly-basis",
          revision: 1,
          subjectId: thread.subject.id,
        },
        inputBundle: {
          fingerprint: `sha256:${"f".repeat(64)}`,
          byteCount: 42,
        },
        evidence: { geometryModule: geometry, assemblyStep: step },
        facts: {
          importability: { status: "observed", value: "imported" },
          importFacts: {
            unitSystem: { status: "observed", value: "mm" },
            solidCount: { status: "observed", value: 1 },
          },
          topology: {
            brepValidity: { status: "observed", value: "valid" },
            degenerateEdgeCount: { status: "observed", value: 0 },
            freeEdgeCount: { status: "observed", value: 0 },
            shellCount: { status: "observed", value: 1 },
          },
          occurrences: [{
            usageElementId: "usage:part",
            target: {
              status: "observed",
              value: { partDefinitionElementId: "part:definition" },
            },
            transformStatus: "observed",
          }],
          pairs: [],
        },
        limitations: {
          verdict: "none",
          fitness: "none",
          safety: "none",
          motion: "none",
          strength: "none",
        },
      },
      evaluation: {
        record: evaluation,
        basis: {
          snapshotId: "thread-observation-basis",
          revision: 2,
          subjectId: thread.subject.id,
        },
        evidence: {
          geometryModule: geometry,
          assemblyStep: step,
          observation,
        },
        method: {
          id: "assembly-integrity-evaluation",
          version: "1.0",
          fingerprint: `sha256:${"1".repeat(64)}`,
        },
        criteria: [
          { id: "assembly-import", verdict: "pass" },
          { id: "occurrence-coverage", verdict: "pass" },
          { id: "placement-recross", verdict: "pass" },
          { id: "brep-validity", verdict: "pass" },
          { id: "pairwise-intersection", verdict: "pass" },
        ],
        aggregateVerdict: "pass",
        limitations: {
          providerCalls: "none",
          genericSysmlRequirementEvaluation: "none",
          safety: "not-evaluated",
          physicalJoints: "not-evaluated",
          clearance: "not-evaluated",
          motion: "not-evaluated",
          load: "not-evaluated",
          fabricability: "not-evaluated",
        },
      },
    }],
  };

  const hero = buildOverviewThreadHero(thread);
  const l3 = hero.nodes.find((item) => recordedId(item) === observation.id);
  const l4 = hero.nodes.find((item) => recordedId(item) === evaluation.id);

  assertEquals(l3?.lane, "physics");
  assertEquals(l3?.kind === "recorded" ? l3.node.ref : undefined, {
    kind: "artifact",
    id: observation.id,
  });
  assertEquals(
    l3?.kind === "recorded" ? l3.node.summary : undefined,
    "Recorded L3 observation · current",
  );
  assertEquals(l4?.lane, "verdicts");
  assertEquals(l4?.kind === "recorded" ? l4.node.ref : undefined, {
    kind: "artifact",
    id: evaluation.id,
  });
  assertEquals(
    l4?.kind === "recorded" ? l4.node.summary : undefined,
    "Recorded L4 pass · current",
  );
  assertEquals(
    hero.lanes.find((column) => column.lane.id === "verdicts")?.systems
      .includes("digital-thread"),
    true,
  );
  assertEquals(
    hero.nodes.some((item) => recordedId(item) === closeout.id),
    false,
  );
});

Deno.test("Overview sealed preview opens exact STEP and GLB as accessible GET links", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const links = await Deno.readTextFile(
    new URL("./src/cad/thread-asset-open-links.tsx", import.meta.url),
  );
  assertStringIncludes(source, 'from "../cad/thread-asset-open-links.tsx"');
  assertStringIncludes(source, "<ThreadAssetOpenLinks");
  assertStringIncludes(links, "{`Open ${format}`}");
  assertStringIncludes(links, 'target="_blank"');
  assertStringIncludes(links, 'rel="noreferrer"');
  assertStringIncludes(links, "aria-label={`Open ${format} for ${subject}`}");
  assertStringIncludes(links, "Open CAD assets for ${subject}");
  assertEquals(source.includes('method="POST"'), false);
  assertEquals(source.includes('method: "POST"'), false);
  assertEquals(source.includes("download="), false);
  assertEquals(source.includes("fetch("), false);
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

Deno.test("overview hero wraps every recorded semantic point instead of truncating a lane", () => {
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
  assertEquals(new Set(verdicts.map((item) => item.x)).size, 2);
  assertEquals(new Set(verdicts.map((item) => item.y)).size >= 3, true);
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
  };
}

function assemblyIntegrityRef(
  id: string,
  digestCharacter: string,
  dependsOn: string[],
): ThreadAssemblyIntegrityArtifactRef {
  const digest = digestCharacter.repeat(64);
  return {
    id,
    uri: `casys://test/${id}/sha256/${digest}`,
    fingerprint: `sha256:${digest}`,
    producerRunId: `run:${id}`,
    dependsOn,
    freshness: "fresh",
  };
}

function integrityArtifact(
  reference: ThreadAssemblyIntegrityArtifactRef,
  label: string,
  kind: string,
): ThreadArtifact {
  return {
    id: reference.id,
    label,
    kind,
    system: "digital-thread",
    revision: reference.fingerprint.slice("sha256:".length),
    freshness: "fresh",
    fingerprint: reference.fingerprint,
    uri: reference.uri,
    producerRunId: reference.producerRunId,
    dependsOn: reference.dependsOn,
  };
}

function integrityGraphNode(
  reference: ThreadAssemblyIntegrityArtifactRef,
  label: string,
  artifactKind: string,
): ThreadGraphNode {
  return {
    id: `graph:artifact:${reference.id}`,
    ref: { kind: "artifact", id: reference.id },
    entityKind: "artifact",
    artifactKind,
    label,
    system: "digital-thread",
    freshness: "fresh",
    summary: `${artifactKind} · ${reference.fingerprint}`,
    selection: { kind: "artifact", id: reference.id },
  };
}
