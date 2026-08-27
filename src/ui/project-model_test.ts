import { assertEquals } from "@std/assert";
import {
  GENERIC_ENGINEERING_WORKBENCH_FIXTURE,
  GENERIC_PROJECT_FIXTURE,
} from "../testing/workbench/generic-engineering-workbench-fixture.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  agentPreparationDecisions,
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  groupProjectPathGatesByLane,
  pendingHumanConfirmationDecisions,
  phaseStatusLabel,
  PROJECT_PATH_PRESENTATION_POLICY,
  projectBriefStatusLabel,
  projectPathLaneStageStatus,
  projectPulseStatus,
  projectStatusLabel,
  selectCurrentProjectFocus,
  verificationChainDetail,
  workOwnerLabel,
} from "./src/project/model.ts";
import { PROJECT_PATH_STAGE_LABELS } from "./src/project/overview-lanes.ts";
import { ENGINEERING_PATH_LANE_IDS } from "../domain/project/engineering-path-lane.ts";
import { isEngineeringProjectSnapshot } from "./src/project/contract.ts";
import { collectEngineeringActivities } from "../domain/project/engineering-activity.ts";
import { SIMULATE_RUN_ADMITTED_SPICE_OPERATION } from "../domain/electrical/spice/admitted/run-proposal.ts";
import type { EngineeringWorkbenchActivity } from "./src/thread/types.ts";

function collectActivityIds(
  project: {
    readonly workItems: readonly {
      readonly id: string;
      readonly activityId: string;
      readonly predecessorRevisionId?: string;
    }[];
  },
): string[] {
  return collectEngineeringActivities(project.workItems).map((item) => item.id);
}

Deno.test("project brief derives factual gates and operator attention", () => {
  const brief = buildProjectBrief(GENERIC_PROJECT_FIXTURE);

  assertEquals(brief.completedPhases, 3);
  assertEquals(brief.phases.length, 6);
  assertEquals(brief.status, "attention-required");
  assertEquals(projectStatusLabel(brief.status), "Decision required");
  assertEquals(projectBriefStatusLabel(brief), "Agent preparing proposal");
  assertEquals(brief.activeRuns[0]?.status, "waiting-for-decision");
  assertEquals(brief.pendingDecisions[0]?.id, "decision-mechanical-inputs");
  assertEquals(brief.openBlockers[0]?.id, "blocker-mechanical-inputs");
});

Deno.test("project brief separates agent preparation from human review", () => {
  const proposed = {
    ...structuredClone(GENERIC_PROJECT_FIXTURE),
    decisions: GENERIC_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "proposed" as const } : decision
    ),
  };

  assertEquals(
    projectBriefStatusLabel(buildProjectBrief(proposed)),
    "Review required",
  );
  assertEquals(workOwnerLabel("shared"), "Agent + human review");
  assertEquals(workOwnerLabel("human"), "Human review");
});

Deno.test("only concrete proposals wait for human confirmation", () => {
  const seed = GENERIC_PROJECT_FIXTURE.decisions[0]!;
  const project = {
    decisions: [
      { ...seed, id: "required", status: "required" as const },
      { ...seed, id: "proposed", status: "proposed" as const },
      { ...seed, id: "rejected", status: "rejected" as const },
      { ...seed, id: "approved", status: "approved" as const },
    ],
  };

  assertEquals(
    pendingHumanConfirmationDecisions(project).map((decision) => decision.id),
    ["proposed"],
  );
  assertEquals(
    agentPreparationDecisions(project).map((decision) => decision.id),
    ["required", "rejected"],
  );
});

Deno.test("overview verification copy counts current criteria before retained history", () => {
  const seed = GENERIC_THREAD_FIXTURE.requirements[0]!;
  const thread = {
    ...GENERIC_THREAD_FIXTURE,
    requirements: [
      { ...seed, id: "REQ-R1", status: "unresolved" as const },
      { ...seed, id: "REQ-R2", status: "pass" as const },
      { ...seed, id: "REQ-R3", status: "pass" as const },
    ],
    violations: [],
    evidenceFamilyGraph: {
      schemaVersion: "thread-evidence-family-graph/1.0" as const,
      asOf: { snapshotId: "thread-r3", revision: 3 },
      families: [{
        id: "requirement-family",
        entityKind: "requirement" as const,
        historicalRefs: [
          { kind: "requirement" as const, id: "REQ-R1" },
          { kind: "requirement" as const, id: "REQ-R2" },
        ],
        currentRefs: [{ kind: "requirement" as const, id: "REQ-R3" }],
        revisionCount: 2,
        status: "current" as const,
        relationship: {
          relation: "supersedes" as const,
          classification: "not-recorded" as const,
          equivalence: "not-recorded" as const,
        },
        transitions: [{
          edgeRef: {
            id: "REQ-R1-to-R3",
            relation: "supersedes" as const,
            origin: "provenance" as const,
          },
          historical: { kind: "requirement" as const, id: "REQ-R1" },
          successor: { kind: "requirement" as const, id: "REQ-R3" },
        }, {
          edgeRef: {
            id: "REQ-R2-to-R3",
            relation: "supersedes" as const,
            origin: "provenance" as const,
          },
          historical: { kind: "requirement" as const, id: "REQ-R2" },
          successor: { kind: "requirement" as const, id: "REQ-R3" },
        }],
      }],
      edges: [],
      omittedSelfLoops: [],
      omittedCycleEdges: [],
    },
  };

  assertEquals(
    verificationChainDetail(thread),
    "1/1 current criteria passing · 0 named violations · 2 historical records.",
  );
});

Deno.test("Project Path groups explicit activity revisions instead of guessing from operations", () => {
  const { project, thread } = correctionPathFixture();
  const path = buildProjectPath(project, thread);

  assertEquals(PROJECT_PATH_PRESENTATION_POLICY.version, "project-path/2.0");
  assertEquals(
    path.activities.map((item) => item.id).toSorted(),
    collectActivityIds(project),
  );
  assertEquals(
    path.activities.every((item) => item.revisions.length >= 1),
    true,
  );
});

Deno.test("Project Path keeps failed and ready revisions visible inside their activity", () => {
  const { project, thread } = correctionPathFixture();
  const mutable = structuredClone(project);
  const retry = mutable.workItems.find((item) => item.id === "mechanical-v3");
  if (!retry) throw new Error("fixture lost its mechanical-v3 retry");
  (retry as unknown as { status: string }).status = "ready";

  const path = buildProjectPath(mutable, thread);
  assertEquals(
    path.activities.some((activity) =>
      activity.revisions.some((revision) => revision.id === "mechanical-v3")
    ),
    true,
  );
});

Deno.test("Project Path folds a model enrichment under the phase that owns the enriched model", () => {
  // Requirement anchoring writes into the system model rather than opening a
  // new engineering stage: its only evidence is a sysml-model derived from the
  // sysml-model an earlier phase owns, so it folds under that phase.
  const { project, thread } = correctionPathFixture();
  const enriched = structuredClone(project);
  const enrichedThread = structuredClone(thread);
  const ref = (id: string) => ({
    kind: "artifact" as const,
    id,
    snapshotId: "thread-correction",
    snapshotRevision: 10,
  });
  const sysmlWork = (id: string, phaseId: string, evidenceId: string) => ({
    id,
    activityId: `activity:${id}`,
    phaseId,
    title: id,
    description: id,
    kind: "verify" as const,
    operation: {
      id: `model.${id}`,
      version: "1",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [ref(evidenceId)],
    decisionIds: [],
    blockerIds: [],
  });
  (enriched.phases as unknown as unknown[]).push({
    id: "architecture",
    name: "System architecture",
    order: 0,
    description: "The reviewed system model.",
    workItemIds: ["arch-work"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("arch-model")],
  }, {
    id: "measurement",
    name: "Sensitivity measurement",
    order: 6,
    description: "Measure the sensitivities that feed the anchored relations.",
    workItemIds: ["measurement-work"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("sens-capture")],
  }, {
    id: "anchoring",
    name: "Requirement anchoring",
    order: 7,
    description: "Anchor requirements as SysML constraints in the model.",
    workItemIds: ["anchoring-work"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("req-model")],
  });
  (enriched.workItems as unknown as unknown[]).push(
    sysmlWork("arch-work", "architecture", "arch-model"),
    sysmlWork("measurement-work", "measurement", "sens-capture"),
    sysmlWork("anchoring-work", "anchoring", "req-model"),
  );
  const sysmlNode = (id: string) => ({
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact" as const, id },
    entityKind: "artifact" as const,
    artifactKind: "sysml-model",
    label: "intentionally ignored presentation label",
    system: "test",
    freshness: "fresh" as const,
    summary: "test evidence",
    recordedAt: "2026-08-03T12:00:00.000Z",
  });
  (enrichedThread.graph.nodes as unknown as unknown[]).push(
    sysmlNode("arch-model"),
    sysmlNode("req-model"),
    {
      ...sysmlNode("sens-capture"),
      artifactKind: "document",
    },
  );
  (enrichedThread.graph.edges as unknown as unknown[]).push({
    id: "graph:edge:model-enrichment",
    from: { kind: "artifact" as const, id: "arch-model" },
    to: { kind: "artifact" as const, id: "req-model" },
    relation: "derived_from" as const,
    origin: "provenance" as const,
  }, {
    id: "graph:edge:measurement-feeds-enrichment",
    from: { kind: "artifact" as const, id: "sens-capture" },
    to: { kind: "artifact" as const, id: "req-model" },
    relation: "derived_from" as const,
    origin: "provenance" as const,
  });

  const path = buildProjectPath(enriched, enrichedThread);

  assertEquals(
    path.activities.some((item) =>
      item.revisions.some((revision) => revision.id === "anchoring-work")
    ),
    true,
  );
  assertEquals(
    path.activities.some((item) =>
      item.revisions.some((revision) => revision.id === "measurement-work")
    ),
    true,
  );
});

Deno.test("Project Path wraps a later architecture-capture tip under the original architecture gate", () => {
  const { project, thread } = correctionPathFixture();
  const wrapped = structuredClone(project);
  const wrappedThread = structuredClone(thread);
  const ref = (id: string) => ({
    kind: "artifact" as const,
    id,
    snapshotId: "thread-correction",
    snapshotRevision: 10,
  });
  const work = (id: string, phaseId: string, evidenceId: string) => ({
    id,
    activityId: `activity:${id}`,
    phaseId,
    title: id,
    description: id,
    kind: "architect" as const,
    operation: {
      id: "model.write-architecture",
      version: "1",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [ref(evidenceId)],
    decisionIds: [],
    blockerIds: [],
  });
  (wrapped.phases as unknown as unknown[]).push({
    id: "seed",
    name: "SysON model seed",
    order: 0,
    description: "Create the model container.",
    workItemIds: ["seed-work"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("syson-model-seed")],
  }, {
    id: "architecture",
    name: "Reviewed architecture",
    order: 1,
    description: "Author the system architecture.",
    workItemIds: ["arch-v2"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("architecture-v2")],
  }, {
    id: "architecture-v3",
    name: "Parser-backed architecture attestation",
    order: 8,
    description: "Attest the same architecture as 3.0.",
    workItemIds: ["arch-v3"],
    requiredDecisionIds: [],
    evidenceRefs: [ref("architecture-v3")],
  });
  (wrapped.workItems as unknown as unknown[]).push(
    work("seed-work", "seed", "syson-model-seed"),
    work("arch-v2", "architecture", "architecture-v2"),
    work("arch-v3", "architecture-v3", "architecture-v3"),
  );
  const artifact = (
    id: string,
    uri: string,
  ) => ({
    id,
    label: id,
    kind: "sysml-model",
    system: "syson",
    revision: "1",
    freshness: "fresh" as const,
    uri,
    dependsOn: [] as string[],
  });
  (wrappedThread.artifacts as unknown as unknown[]).push(
    artifact("syson-model-seed", "casys://syson-model-seed-capture/sha256/aa"),
    artifact("architecture-v2", "casys://architecture-capture/sha256/bb"),
    artifact("architecture-v3", "casys://architecture-capture/sha256/cc"),
  );
  const sysmlNode = (id: string) => ({
    id: `graph:artifact:${id}`,
    ref: { kind: "artifact" as const, id },
    entityKind: "artifact" as const,
    artifactKind: "sysml-model",
    label: "intentionally ignored presentation label",
    system: "syson",
    freshness: "fresh" as const,
    summary: "test evidence",
    recordedAt: "2026-08-03T12:00:00.000Z",
  });
  (wrappedThread.graph.nodes as unknown as unknown[]).push(
    sysmlNode("syson-model-seed"),
    sysmlNode("architecture-v2"),
    sysmlNode("architecture-v3"),
  );
  (wrappedThread.graph.edges as unknown as unknown[]).push({
    id: "graph:edge:seed-to-v2",
    from: { kind: "artifact" as const, id: "syson-model-seed" },
    to: { kind: "artifact" as const, id: "architecture-v2" },
    relation: "derived_from" as const,
    origin: "provenance" as const,
  }, {
    id: "graph:edge:v2-to-v3",
    from: { kind: "artifact" as const, id: "architecture-v2" },
    to: { kind: "artifact" as const, id: "architecture-v3" },
    relation: "derived_from" as const,
    origin: "provenance" as const,
  });
  wrappedThread.evidenceFamilyGraph = {
    ...wrappedThread.evidenceFamilyGraph,
    families: [{
      id: "architecture-family",
      entityKind: "artifact",
      artifactKind: "sysml-model",
      historicalRefs: [{ kind: "artifact", id: "architecture-v2" }],
      currentRefs: [{ kind: "artifact", id: "architecture-v3" }],
      revisionCount: 1,
      status: "current",
      relationship: {
        relation: "supersedes",
        classification: "not-recorded",
        equivalence: "not-recorded",
      },
      transitions: [{
        edgeRef: {
          id: "graph:edge:v2-to-v3",
          relation: "derived_from",
          origin: "provenance",
        },
        historical: { kind: "artifact", id: "architecture-v2" },
        successor: { kind: "artifact", id: "architecture-v3" },
      }],
    }],
  };

  const path = buildProjectPath(wrapped, wrappedThread);

  assertEquals(
    path.activities.some((item) =>
      item.revisions.some((revision) => revision.id === "arch-v3")
    ),
    true,
  );
  assertEquals(
    path.activities.some((item) =>
      item.revisions.some((revision) => revision.id === "seed-work")
    ),
    true,
  );
});

Deno.test("phase status labels describe activity progress without claiming gate satisfaction", () => {
  assertEquals(phaseStatusLabel("planned"), "Planned");
  assertEquals(phaseStatusLabel("completed"), "Completed");
  assertEquals(phaseStatusLabel("active"), "In progress");
  assertEquals(phaseStatusLabel("blocked"), "Blocked");
});

Deno.test(
  "a cancelled-before-claim seed on phase A with successor on phase B does not appear as a satisfied gate",
  () => {
    const { project, thread } = cancelledSeedSuccessorFixture();
    const path = buildProjectPath(project, thread);
    const brief = buildProjectBrief(project);

    assertEquals(
      brief.phases.find((item) => item.phase.id === "phase-seed")?.status,
      "planned",
    );
    const activity = path.activities.find((item) => item.id === "activity:wi-seed");
    assertEquals(
      activity?.revisions.map((revision) => revision.id),
      ["wi-seed", "wi-seed-2"],
    );
    assertEquals(
      activity?.revisions.some((revision) => revision.status === "cancelled"),
      true,
    );
    assertEquals(
      activity?.revisions.some((revision) => revision.status === "completed"),
      true,
    );
  },
);

Deno.test(
  "Project Path shows Planned when a cancelled seed cannot uniquely fold under one successor",
  () => {
    const { project, thread } = cancelledSeedSuccessorFixture({
      extraSuccessorPhaseId: "phase-seed-3",
    });
    const path = buildProjectPath(project, thread);
    assertEquals(
      path.activities.some((item) =>
        item.revisions.some((revision) => revision.status === "cancelled")
      ),
      true,
    );
  },
);

Deno.test("current project work prefers an explicit successor reconciliation", () => {
  const { project } = correctionPathFixture();
  const reconciled = {
    ...project,
    workItems: project.workItems.map((item) =>
      item.id === "mechanical-v2"
        ? {
          ...item,
          status: "cancelled" as const,
          reconciliation: {
            kind: "superseded-by-successor" as const,
            reconciledAt: "2026-08-03T12:05:00.000Z",
            reconciledBy: { id: "agent:reconciler", origin: "agent" as const },
            failedRunId: "r2-failed",
            successorRunId: "r3-complete",
            successorRunSnapshot: {
              snapshotId: "thread-correction",
              revision: 10,
              subjectId: "GEN-01",
            },
            successorSnapshot: {
              snapshotId: "thread-correction",
              revision: 10,
              subjectId: "GEN-01",
            },
            successorEvidenceRefs: [
              {
                kind: "artifact" as const,
                id: "proof-r3-solve",
                snapshotId: "thread-correction",
                snapshotRevision: 10,
              },
            ],
            rationale: "The recorded R3 successor closed the failed R2 attempt.",
          },
        }
        : item
    ),
  };

  const current = buildCurrentProjectWork(reconciled);

  assertEquals(current.nextWork, []);
  assertEquals(current.historicalWorkItemIds, ["mechanical-v2"]);
  assertEquals(current.closedActionTargetIds, ["artifact:correction-record"]);
});

Deno.test("current project work does not advertise a ready predecessor when a later work item for the same registered operation completed", () => {
  const snapshot = leftoverReadyPredecessorFixture({
    predecessor: {
      id: "wi-geom",
      phaseId: "phase-cad",
      order: 4,
      operationId: "design.write-geometry",
      version: "1",
    },
    successor: {
      id: "wi-geom-2",
      phaseId: "phase-cad-2",
      order: 5,
      operationId: "design.write-geometry",
      version: "1",
      activityId: "activity:wi-geom",
      predecessorRevisionId: "wi-geom",
    },
    remainingReady: {
      id: "wi-industrialize",
      phaseId: "phase-make",
      order: 6,
      operationId: "industrialize.seal-print-estimate-case",
      version: "1",
    },
  });

  const current = buildCurrentProjectWork(snapshot);

  assertEquals(current.nextWork.map((item) => item.id), ["wi-industrialize"]);
  assertEquals(current.historicalWorkItemIds, ["wi-geom"]);
  assertEquals(current.closedActionTargetIds, []);
});

Deno.test("admitted SPICE revisions in the Physics lane wrap as one activity with their attempts and no Engineering Case", () => {
  const { project, thread, activities } = spicePhysicsLinkedRevisionsFixture();
  const path = buildProjectPath(project, thread, activities);

  assertEquals(path.activities.length, 1);
  const activity = path.activities[0]!;
  assertEquals(activity.id, "activity:wi-spice-r18");
  assertEquals(activity.lane, "physics");
  assertEquals(activity.revisions.map((revision) => revision.id), [
    "wi-spice-r18",
    "wi-spice-r18b",
  ]);
  assertEquals(
    activity.revisions[1]?.predecessorRevisionId,
    "wi-spice-r18",
  );
  assertEquals(
    activity.revisions.map((revision) =>
      revision.attempts.map((attempt) => attempt.run.id)
    ),
    [["run-spice-r18"], ["run-spice-r18b"]],
  );
  assertEquals(
    activity.revisions.every((revision) =>
      revision.attempts.every((attempt) => attempt.cases.length === 0)
    ),
    true,
  );
});

Deno.test("linked SPICE revisions count as one Physics gate instead of 1/2 work", () => {
  const { project, thread, activities } = spicePhysicsLinkedRevisionsFixture();
  const path = buildProjectPath(project, thread, activities);
  const groups = groupProjectPathGatesByLane(path.activities, []);

  assertEquals(path.activities.length, 1);
  const activity = path.activities[0]!;
  assertEquals(activity.lane, "physics");
  assertEquals(activity.revisions.map((revision) => revision.id), [
    "wi-spice-r18",
    "wi-spice-r18b",
  ]);
  assertEquals(
    activity.revisions.map((revision) =>
      revision.attempts.map((attempt) => attempt.run.id)
    ),
    [["run-spice-r18"], ["run-spice-r18b"]],
  );
  assertEquals(Object.hasOwn(activity, "completedWorkItems"), false);
  assertEquals(Object.hasOwn(activity, "totalWorkItems"), false);

  assertEquals(
    groups.map((group) => group.id),
    [...ENGINEERING_PATH_LANE_IDS],
  );
  const physics = groups.find((group) => group.id === "physics")!;
  assertEquals(physics.gates, [activity]);
  assertEquals(physics.satisfiedGates, 1);
  assertEquals(physics.totalGates, 1);
  assertEquals(Object.hasOwn(physics, "completedWorkItems"), false);
  assertEquals(Object.hasOwn(physics, "totalWorkItems"), false);
  for (const group of groups) {
    if (group.id === "physics") continue;
    assertEquals(group.gates, []);
    assertEquals(group.satisfiedGates, 0);
    assertEquals(group.totalGates, 0);
  }
});

Deno.test("AL01 leftover SPICE work without an explicit predecessor is not backfilled from labels or timestamps", () => {
  const { project, thread, activities } = al01UnlinkedSpiceFixture();
  const path = buildProjectPath(project, thread, activities);

  assertEquals(project.workItems.map((item) => item.title), [
    "Run admitted SPICE operating point",
    "Run admitted SPICE operating point",
  ]);
  assertEquals(
    project.workItems.every((item) =>
      !("predecessorRevisionId" in item) ||
      item.predecessorRevisionId === undefined
    ),
    true,
  );
  assertEquals(
    path.activities.map((activity) => activity.id).toSorted(),
    [
      "activity:work-al01-admitted-spice-run-r18",
      "activity:work-al01-admitted-spice-run-r18b",
    ],
  );
  assertEquals(
    path.activities.every((activity) => activity.revisions.length === 1),
    true,
  );
  assertEquals(
    path.activities.every((activity) =>
      activity.revisions[0]?.predecessorRevisionId === undefined
    ),
    true,
  );
});

Deno.test("Overview attaches an Engineering Case under the existing activity revision and attempt", () => {
  const activities = GENERIC_ENGINEERING_WORKBENCH_FIXTURE.projectPath.activities;
  const joined = {
    caseKey: `mechanical-proof:${"a".repeat(64)}`,
    caseId: "arm-cantilever",
    caseRevision: 2,
    activityId: "activity:work-simulate",
    workItemId: "work-simulate",
    runId: "agent-run-mechanical-fixture",
  };
  const orphan = {
    caseKey: `mechanical-proof:${"b".repeat(64)}`,
    caseId: "ghost",
    caseRevision: 1,
    activityId: "activity:invented",
    workItemId: "invented-work",
    runId: "invented-run",
  };
  const path = buildProjectPath(
    GENERIC_PROJECT_FIXTURE,
    GENERIC_THREAD_FIXTURE,
    activities,
    [joined, orphan],
  );

  const activity = path.activities.find((item) => item.id === "activity:work-simulate");
  assertEquals(activity?.revisions.map((revision) => revision.id), [
    "work-simulate",
  ]);
  assertEquals(
    activity?.revisions[0]?.attempts.map((attempt) => ({
      runId: attempt.run.id,
      cases: attempt.cases,
    })),
    [{
      runId: "agent-run-mechanical-fixture",
      cases: [{
        caseKey: joined.caseKey,
        caseId: "arm-cantilever",
        caseRevision: 2,
      }],
    }],
  );
  assertEquals(
    path.activities.some((item) => item.id === "activity:invented"),
    false,
  );
  assertEquals(
    path.activities.flatMap((item) =>
      item.revisions.flatMap((revision) =>
        revision.attempts.flatMap((attempt) =>
          attempt.cases.map((engineeringCase) => engineeringCase.caseId)
        )
      )
    ),
    ["arm-cantilever"],
  );
});

Deno.test("project path omits a historical ready predecessor while Activity retains it", () => {
  const snapshot = leftoverReadyPredecessorFixture({
    predecessor: {
      id: "wi-geom",
      phaseId: "phase-cad",
      order: 40,
      operationId: "design.write-geometry",
      version: "1",
    },
    successor: {
      id: "wi-geom-2",
      phaseId: "phase-cad-2",
      order: 41,
      operationId: "design.write-geometry",
      version: "1",
      activityId: "activity:wi-geom",
      predecessorRevisionId: "wi-geom",
    },
  });

  const path = buildProjectPath(snapshot, GENERIC_THREAD_FIXTURE);
  const current = buildCurrentProjectWork(snapshot);

  assertEquals(snapshot.workItems.some((item) => item.id === "wi-geom"), true);
  assertEquals(current.historicalWorkItemIds, ["wi-geom"]);
  assertEquals(
    path.activities.some((item) =>
      item.revisions.some((revision) => revision.id === "wi-geom-2")
    ),
    true,
  );
});

Deno.test("same activity r1 completed then explicit r2 ready stays planned", () => {
  const first = leftoverOperationWork({
    id: "wi-r1",
    phaseId: "phase-r1",
    order: 1,
    operationId: "design.write-geometry",
    version: "1",
    status: "completed",
    activityId: "activity:wi-r1",
  }, "completed");
  const second = leftoverOperationWork({
    id: "wi-r2",
    phaseId: "phase-r2",
    order: 2,
    operationId: "design.write-geometry",
    version: "1",
    status: "ready",
    activityId: "activity:wi-r1",
    predecessorRevisionId: "wi-r1",
  }, "ready");
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const snapshot = {
    ...base,
    phases: [{
      id: "phase-r1",
      name: "phase-r1",
      order: 1,
      description: "phase-r1",
      workItemIds: [first.id],
      requiredDecisionIds: [],
      evidenceRefs: first.evidenceRefs,
    }, {
      id: "phase-r2",
      name: "phase-r2",
      order: 2,
      description: "phase-r2",
      workItemIds: [second.id],
      requiredDecisionIds: [],
      evidenceRefs: second.evidenceRefs,
    }],
    workItems: [first, second],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };

  const path = buildProjectPath(snapshot, GENERIC_THREAD_FIXTURE);
  assertEquals(path.activities.length, 1);
  const activity = path.activities[0]!;
  assertEquals(activity.id, "activity:wi-r1");
  assertEquals(activity.revisions.map((revision) => revision.id), [
    "wi-r1",
    "wi-r2",
  ]);
  assertEquals(activity.revisions[1]?.predecessorRevisionId, "wi-r1");
  assertEquals(activity.revisions.map((revision) => revision.status), [
    "completed",
    "ready",
  ]);
  assertEquals(activity.status, "planned");
  assertEquals(path.status, "planned");
});

Deno.test("an OPEN blocker targeting a leaf revision blocks that activity before active", () => {
  const first = leftoverOperationWork({
    id: "wi-r1",
    phaseId: "phase-r1",
    order: 1,
    operationId: "design.write-geometry",
    version: "1",
    status: "completed",
    activityId: "activity:wi-r1",
  }, "completed");
  const second = leftoverOperationWork({
    id: "wi-r2",
    phaseId: "phase-r2",
    order: 2,
    operationId: "design.write-geometry",
    version: "1",
    status: "ready",
    activityId: "activity:wi-r1",
    predecessorRevisionId: "wi-r1",
  }, "ready");
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const snapshotFor = (
    workItems: typeof GENERIC_PROJECT_FIXTURE.workItems,
    blockers: typeof GENERIC_PROJECT_FIXTURE.blockers,
  ) => ({
    ...base,
    phases: [{
      id: "phase-r1",
      name: "phase-r1",
      order: 1,
      description: "phase-r1",
      workItemIds: [first.id],
      requiredDecisionIds: [],
      evidenceRefs: first.evidenceRefs,
    }, {
      id: "phase-r2",
      name: "phase-r2",
      order: 2,
      description: "phase-r2",
      workItemIds: [second.id],
      requiredDecisionIds: [],
      evidenceRefs: second.evidenceRefs,
    }],
    workItems,
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers,
  });
  const leafBlocker = {
    id: "blocker-leaf",
    phaseId: second.phaseId,
    title: "Open blocker on the current leaf",
    description: "Names the current leaf revision of the stable activity.",
    kind: "dependency" as const,
    status: "open" as const,
    openedAt: "2026-08-01T08:40:04.000Z",
    workItemIds: [second.id],
    decisionIds: [] as string[],
  };
  const leafWork = {
    ...second,
    status: "in-progress" as const,
    blockerIds: [leafBlocker.id],
  };
  const leafSnapshot = snapshotFor(
    [first, leafWork] as typeof GENERIC_PROJECT_FIXTURE.workItems,
    [leafBlocker] as typeof GENERIC_PROJECT_FIXTURE.blockers,
  );
  assertEquals(leafBlocker.phaseId, leafWork.phaseId);
  assertEquals(leafWork.blockerIds, [leafBlocker.id]);
  assertEquals(leafBlocker.workItemIds, [leafWork.id]);

  const leafPath = buildProjectPath(leafSnapshot, GENERIC_THREAD_FIXTURE);
  assertEquals(leafPath.activities.length, 1);
  assertEquals(leafPath.activities[0]?.status, "blocked");
  assertEquals(
    leafPath.activities[0]?.revisions.map((revision) => revision.id),
    ["wi-r1", "wi-r2"],
  );
  assertEquals(leafPath.activities[0]?.revisions[1]?.predecessorRevisionId, "wi-r1");

  const resolved = {
    ...leafSnapshot,
    blockers: leafSnapshot.blockers.map((blocker) => ({
      ...blocker,
      status: "resolved" as const,
      resolvedAt: "2026-08-01T09:00:00.000Z",
      resolution: "Cleared.",
    })),
  };
  assertEquals(
    buildProjectPath(resolved, GENERIC_THREAD_FIXTURE).activities[0]?.status,
    "active",
  );

  const supersededBlocker = {
    id: "blocker-r1",
    phaseId: first.phaseId,
    title: "Open blocker on a superseded revision",
    description: "Names the predecessor, not the current leaf.",
    kind: "dependency" as const,
    status: "open" as const,
    openedAt: "2026-08-01T08:40:04.000Z",
    workItemIds: [first.id],
    decisionIds: [] as string[],
  };
  const supersededFirst = { ...first, blockerIds: [supersededBlocker.id] };
  const supersededLeaf = {
    ...second,
    status: "in-progress" as const,
    blockerIds: [] as string[],
  };
  assertEquals(supersededBlocker.phaseId, supersededFirst.phaseId);
  assertEquals(supersededFirst.blockerIds, [supersededBlocker.id]);
  assertEquals(supersededBlocker.workItemIds, [supersededFirst.id]);
  assertEquals(
    buildProjectPath(
      snapshotFor(
        [supersededFirst, supersededLeaf] as typeof GENERIC_PROJECT_FIXTURE.workItems,
        [supersededBlocker] as typeof GENERIC_PROJECT_FIXTURE.blockers,
      ),
      GENERIC_THREAD_FIXTURE,
    ).activities[0]?.status,
    "active",
  );
});

Deno.test("current project work applies the same later-completed operation rule to a leftover FEA @2 predecessor", () => {
  const snapshot = leftoverReadyPredecessorFixture({
    predecessor: {
      id: "wi-fea-2",
      phaseId: "phase-fea",
      order: 7,
      operationId: "verify.run-fea-static-proof",
      version: "2",
      geometryId: "geometry-assembly",
    },
    successor: {
      id: "wi-fea-3",
      phaseId: "phase-fea-3",
      order: 8,
      operationId: "verify.run-fea-static-proof",
      version: "2",
      geometryId: "geometry-arm-step",
      activityId: "activity:wi-fea-2",
      predecessorRevisionId: "wi-fea-2",
    },
  });

  const current = buildCurrentProjectWork(snapshot);

  assertEquals(current.nextWork, []);
  assertEquals(current.historicalWorkItemIds, ["wi-fea-2"]);
});

Deno.test("current project work does not treat a later completed @3 as closing a ready @2 of the same operation id", () => {
  const snapshot = leftoverReadyPredecessorFixture({
    predecessor: {
      id: "wi-fea-2",
      phaseId: "phase-fea",
      order: 7,
      operationId: "verify.run-fea-static-proof",
      version: "2",
    },
    successor: {
      id: "wi-fea-3",
      phaseId: "phase-fea-3",
      order: 8,
      operationId: "verify.run-fea-static-proof",
      version: "3",
    },
  });

  const current = buildCurrentProjectWork(snapshot);

  assertEquals(current.nextWork.map((item) => item.id), ["wi-fea-2"]);
  assertEquals(current.historicalWorkItemIds, []);
});

Deno.test("current project work still offers a later ready revision after an earlier completion of the same registered operation", () => {
  const snapshot = leftoverReadyPredecessorFixture({
    predecessor: {
      id: "wi-geom",
      phaseId: "phase-cad",
      order: 4,
      operationId: "design.write-geometry",
      version: "1",
      status: "completed",
    },
    successor: {
      id: "wi-geom-2",
      phaseId: "phase-cad-2",
      order: 5,
      operationId: "design.write-geometry",
      version: "1",
      status: "ready",
    },
  });

  const current = buildCurrentProjectWork(snapshot);

  assertEquals(current.nextWork.map((item) => item.id), ["wi-geom-2"]);
  assertEquals(current.historicalWorkItemIds, []);
});

Deno.test("browser project contract rejects a half-defined input anchor", () => {
  const valid = structuredClone(GENERIC_PROJECT_FIXTURE);
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const invalid = JSON.parse(JSON.stringify(valid)) as {
    decisions: Array<Record<string, unknown>>;
  };
  invalid.decisions[0]!.baseSnapshot = valid.threadSnapshots[0];
  assertEquals(isEngineeringProjectSnapshot(invalid), false);
});

Deno.test("browser project contract accepts a V3 planning envelope and rejects malformed operation provenance", () => {
  const valid = v3PlanningProjectEnvelope();
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const forgedV1Plan = structuredClone(valid) as Record<string, unknown>;
  forgedV1Plan.schemaVersion = "1.0";
  assertEquals(isEngineeringProjectSnapshot(forgedV1Plan), false);

  const malformedBasis = structuredClone(valid) as Record<string, unknown>;
  (
    (malformedBasis.plan as Record<string, unknown>).basis as Record<
      string,
      unknown
    >
  ).approvedBriefFingerprint = {
    algorithm: "sha256",
    digest: "not-a-content-fingerprint",
  };
  assertEquals(isEngineeringProjectSnapshot(malformedBasis), false);

  const malformedPublisher = structuredClone(valid) as Record<string, unknown>;
  (malformedPublisher.plan as Record<string, unknown>).publishedBy = {
    id: "engineering-agent",
    origin: "human",
  };
  assertEquals(isEngineeringProjectSnapshot(malformedPublisher), false);

  const rawProviderEscape = structuredClone(valid) as Record<string, unknown>;
  const rawOperation = (
    rawProviderEscape.workItems as Array<Record<string, unknown>>
  )[0]!.operation as Record<string, unknown>;
  (rawOperation.bindings as Array<Record<string, unknown>>)[0]!.source = {
    kind: "approved-brief",
    provider: "untrusted-direct-call",
  };
  assertEquals(isEngineeringProjectSnapshot(rawProviderEscape), false);

  const malformedThreadBinding = structuredClone(valid) as Record<
    string,
    unknown
  >;
  const threadOperation = (
    malformedThreadBinding.workItems as Array<Record<string, unknown>>
  )[0]!.operation as Record<string, unknown>;
  threadOperation.bindings = [{
    name: "existingPart",
    source: {
      kind: "thread-entity",
      reference: {
        snapshotId: "thread-generic",
        snapshotRevision: 0,
        kind: "artifact",
        id: "ART-CAD-018",
      },
    },
  }];
  assertEquals(isEngineeringProjectSnapshot(malformedThreadBinding), false);
});

Deno.test("browser project contract accepts an approved-brief baseline and rejects malformed anchors", () => {
  const valid = v3DocumentaryProjectEnvelope();
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const forgedBasis = structuredClone(valid) as Record<string, unknown>;
  const forgedRun = (forgedBasis.agentRuns as Array<Record<string, unknown>>)[0]!;
  (forgedRun.basis as Record<string, unknown>).briefId = "other-approved-brief";
  assertEquals(isEngineeringProjectSnapshot(forgedBasis), false);

  const v1Fallback = structuredClone(valid) as Record<string, unknown>;
  const fallbackRun = (v1Fallback.agentRuns as Array<Record<string, unknown>>)[0]!;
  delete fallbackRun.basis;
  fallbackRun.baseSnapshot = (v1Fallback.threadSnapshots as unknown[])[0];
  assertEquals(isEngineeringProjectSnapshot(v1Fallback), false);

  const missingFingerprint = structuredClone(valid) as Record<string, unknown>;
  delete (missingFingerprint.agentRuns as Array<Record<string, unknown>>)[0]!
    .inputFingerprint;
  assertEquals(isEngineeringProjectSnapshot(missingFingerprint), false);
});

Deno.test("browser project contract accepts a V3 run anchored to its declared thread snapshot", () => {
  const project = structuredClone(
    GENERIC_PROJECT_FIXTURE,
  ) as unknown as Record<string, unknown>;
  const reference = (project.threadSnapshots as Array<Record<string, unknown>>)[0]!;
  project.schemaVersion = "4.0";
  project.agentRuns = [{
    id: "run-v3-thread-snapshot",
    workItemId: "work-architect",
    status: "completed",
    summary: "Recorded the bounded V3 technical run.",
    queuedAt: "2026-08-03T12:00:00.000Z",
    startedAt: "2026-08-03T12:00:01.000Z",
    completedAt: "2026-08-03T12:00:02.000Z",
    basis: { kind: "thread-snapshot", ...reference },
    inputFingerprint: {
      algorithm: "sha256",
      digest: "d".repeat(64),
    },
    evidenceRefs: [],
    resultSnapshot: reference,
  }];
  project.framing = canonicalBriefFraming(project);

  assertEquals(isEngineeringProjectSnapshot(project), true);

  const forged = structuredClone(project) as Record<string, unknown>;
  (((forged.agentRuns as Array<Record<string, unknown>>)[0]!.basis) as Record<
    string,
    unknown
  >).snapshotId = "other-thread-snapshot";
  assertEquals(isEngineeringProjectSnapshot(forged), false);
});

Deno.test("browser project contract accepts only exact human queued-run cancellations", () => {
  const valid = v3CancelledQueuedRunEnvelope();
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const forgedRunSummary = structuredClone(valid) as Record<string, unknown>;
  (forgedRunSummary.agentRuns as Array<Record<string, unknown>>)[0]!.summary =
    "Forged cancellation summary.";
  assertEquals(isEngineeringProjectSnapshot(forgedRunSummary), false);

  const forgedTransitionSummary = structuredClone(valid) as Record<
    string,
    unknown
  >;
  ((forgedTransitionSummary.agentRuns as Array<Record<string, unknown>>)[0]!
    .statusHistory as Array<Record<string, unknown>>)[1]!.summary =
      "Forged cancellation transition summary.";
  assertEquals(isEngineeringProjectSnapshot(forgedTransitionSummary), false);

  const missingCancellation = structuredClone(valid) as Record<string, unknown>;
  delete (missingCancellation.agentRuns as Array<Record<string, unknown>>)[0]!
    .cancellation;
  assertEquals(isEngineeringProjectSnapshot(missingCancellation), false);

  const agentCancellation = structuredClone(valid) as Record<string, unknown>;
  (((agentCancellation.agentRuns as Array<Record<string, unknown>>)[0]!
    .cancellation as Record<string, unknown>).cancelledBy as Record<
      string,
      unknown
    >)
    .origin = "agent";
  assertEquals(isEngineeringProjectSnapshot(agentCancellation), false);

  const extraCancellationField = structuredClone(valid) as Record<
    string,
    unknown
  >;
  (extraCancellationField.agentRuns as Array<Record<string, unknown>>)[0]!
    .cancellation = {
      ...((extraCancellationField.agentRuns as Array<Record<string, unknown>>)[
        0
      ]!
        .cancellation as Record<string, unknown>),
      synthetic: true,
    };
  assertEquals(isEngineeringProjectSnapshot(extraCancellationField), false);

  const extraTransition = structuredClone(valid) as Record<string, unknown>;
  (extraTransition.agentRuns as Array<Record<string, unknown>>)[0]!
    .statusHistory = [
      ...(extraTransition.agentRuns as Array<Record<string, unknown>>)[0]!
        .statusHistory as unknown[],
      {
        commandId: "forged-running-after-cancellation",
        status: "running",
        at: "2026-08-02T12:00:02.000Z",
        actor: { id: "engineering-agent", origin: "agent" },
        summary: "Forged execution after cancellation.",
      },
    ];
  assertEquals(isEngineeringProjectSnapshot(extraTransition), false);

  const cancellationOnQueuedRun = structuredClone(valid) as Record<
    string,
    unknown
  >;
  (cancellationOnQueuedRun.agentRuns as Array<Record<string, unknown>>)[0]!
    .status = "queued";
  assertEquals(isEngineeringProjectSnapshot(cancellationOnQueuedRun), false);
});

Deno.test("project brief keeps a rejected decision actionable", () => {
  const rejected = {
    ...structuredClone(GENERIC_PROJECT_FIXTURE),
    decisions: GENERIC_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "rejected" as const } : decision
    ),
  };

  const brief = buildProjectBrief(rejected);

  assertEquals(brief.pendingDecisions[0]?.id, rejected.decisions[0]!.id);
  assertEquals(brief.pendingDecisions[0]?.status, "rejected");
});

Deno.test("current project focus follows phase order and linked proposals despite reversed history arrays", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const v1Work = {
    ...base.workItems.find((item) => item.id === "work-simulate")!,
    title: "V1 seal retained in history",
    decisionIds: ["decision-v1"],
  };
  const v2Work = {
    ...v1Work,
    id: "work-modelica-v2",
    phaseId: "modelica-v2",
    title: "V2 recorded Modelica run",
    decisionIds: ["decision-v2"],
  };
  const v1Decision = {
    ...base.decisions[0]!,
    id: "decision-v1",
    title: "V1 proposal",
    status: "proposed" as const,
  };
  const v2Decision = {
    ...v1Decision,
    id: "decision-v2",
    phaseId: "modelica-v2",
    title: "V2 proposal",
  };
  const snapshot = {
    ...base,
    phases: [
      ...base.phases,
      {
        ...base.phases.find((phase) => phase.id === "simulate")!,
        id: "modelica-v2",
        name: "Modelica V2",
        order: 7,
        workItemIds: [v2Work.id],
        requiredDecisionIds: [v2Decision.id],
      },
    ],
    // Append-only physical history must not decide the live cockpit focus.
    workItems: [
      v2Work,
      v1Work,
      ...base.workItems.filter((item) => item.id !== "work-simulate"),
    ].toReversed(),
    decisions: [v2Decision, v1Decision].toReversed(),
    agentRuns: [],
  };

  const focus = selectCurrentProjectFocus(snapshot);
  const brief = buildProjectBrief(snapshot);

  assertEquals(focus.activeRun, undefined);
  assertEquals(focus.work?.id, "work-modelica-v2");
  assertEquals(focus.proposedDecision?.id, "decision-v2");
  assertEquals(brief.currentWork.map((item) => item.id), [
    "work-modelica-v2",
    "work-simulate",
  ]);
});

Deno.test("current project focus gives an active run and its linked proposal priority over a later phase", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const v1Work = {
    ...base.workItems.find((item) => item.id === "work-simulate")!,
    decisionIds: ["decision-v1"],
  };
  const v2Work = {
    ...v1Work,
    id: "work-modelica-v2",
    phaseId: "modelica-v2",
    title: "V2 recorded Modelica run",
    decisionIds: ["decision-v2"],
  };
  const v1Decision = {
    ...base.decisions[0]!,
    id: "decision-v1",
    title: "V1 proposal",
    status: "proposed" as const,
  };
  const v2Decision = {
    ...v1Decision,
    id: "decision-v2",
    phaseId: "modelica-v2",
    title: "V2 proposal",
  };
  const snapshot = {
    ...base,
    phases: [
      ...base.phases,
      {
        ...base.phases.find((phase) => phase.id === "simulate")!,
        id: "modelica-v2",
        name: "Modelica V2",
        order: 7,
        workItemIds: [v2Work.id],
        requiredDecisionIds: [v2Decision.id],
      },
    ],
    workItems: [
      v1Work,
      v2Work,
      ...base.workItems.filter((item) => item.id !== "work-simulate"),
    ],
    decisions: [v1Decision, v2Decision],
    agentRuns: [{
      ...base.agentRuns[0]!,
      id: "run-v1-active",
      workItemId: v1Work.id,
      status: "running" as const,
      queuedAt: "2026-08-02T12:00:00.000Z",
    }],
  };

  const focus = selectCurrentProjectFocus(snapshot);

  assertEquals(focus.activeRun?.id, "run-v1-active");
  assertEquals(focus.work?.id, "work-simulate");
  assertEquals(focus.proposedDecision?.id, "decision-v1");
});

Deno.test("current project focus uses the recorded phase work order as its stable tie-breaker", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const first = {
    ...base.workItems.find((item) => item.id === "work-simulate")!,
    title: "First recorded Modelica action",
  };
  const second = {
    ...first,
    id: "work-simulate-second",
    title: "Second recorded Modelica action",
  };
  const snapshot = {
    ...base,
    phases: base.phases.map((phase) =>
      phase.id === "simulate" ? { ...phase, workItemIds: [first.id, second.id] } : phase
    ),
    // The append-only storage order is intentionally the opposite of the plan.
    workItems: [
      second,
      first,
      ...base.workItems.filter((item) => item.id !== "work-simulate"),
    ].toReversed(),
    agentRuns: [],
  };

  assertEquals(selectCurrentProjectFocus(snapshot).work?.id, first.id);
});

Deno.test("cockpit falls back to a named work item for an accidental run summary", () => {
  const snapshot = structuredClone(GENERIC_PROJECT_FIXTURE);
  const run = { ...snapshot.agentRuns[0]!, summary: "dsadsadas" };

  assertEquals(
    agentRunSummary(snapshot, run),
    "Working on: Prepare mechanical verification inputs",
  );
});

function v3PlanningProjectEnvelope(): Record<string, unknown> {
  const project = structuredClone(
    GENERIC_PROJECT_FIXTURE,
  ) as unknown as Record<string, unknown>;
  project.schemaVersion = "4.0";
  project.threadSnapshots = [];
  project.agentRuns = [];
  project.decisions = [];
  project.approvals = [];
  project.blockers = [];
  project.framing = canonicalBriefFraming(project);
  const identity = project.project as Record<string, unknown>;
  const framing = project.framing as Record<string, unknown>;
  const brief = framing.currentBrief as Record<string, unknown>;
  const approval = framing.currentBriefApproval as Record<string, unknown>;
  project.plan = {
    startingPoint: "idea-or-spec",
    basis: {
      kind: "approved-brief",
      projectId: identity.id,
      projectSnapshotId: project.id,
      projectRevision: project.revision,
      briefId: brief.briefId,
      briefSnapshotId: brief.id,
      briefRevision: brief.revision,
      approvedBriefFingerprint: approval.inputFingerprint,
    },
    publishedAt: "2026-08-02T12:00:00.000Z",
    publishedBy: { id: "engineering-agent", origin: "agent" },
  };
  const firstWorkItem = (
    project.workItems as Array<Record<string, unknown>>
  )[0]!;
  firstWorkItem.operation = {
    id: "baseline.from-approved-brief",
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" },
    }],
  };
  return project;
}

function v3DocumentaryProjectEnvelope(): Record<string, unknown> {
  const project = v3PlanningProjectEnvelope();
  const snapshot = {
    snapshotId: "thread-project:r1",
    revision: 1,
    subjectId: (project.project as Record<string, unknown>).subjectId,
  };
  project.threadSnapshots = [snapshot];
  project.agentRuns = [{
    id: "run-approved-brief-baseline",
    workItemId: "work-define",
    status: "completed",
    summary: "Recorded the approved project brief documentary baseline.",
    queuedAt: "2026-08-02T12:00:00.000Z",
    completedAt: "2026-08-02T12:01:00.000Z",
    basis: (project.plan as Record<string, unknown>).basis,
    inputFingerprint: {
      algorithm: "sha256",
      digest: "b".repeat(64),
    },
    evidenceRefs: [],
    resultSnapshot: snapshot,
  }];
  return project;
}

function v3CancelledQueuedRunEnvelope(): Record<string, unknown> {
  const project = v3PlanningProjectEnvelope();
  const queuedAt = "2026-08-02T12:00:00.000Z";
  const cancelledAt = "2026-08-02T12:00:01.000Z";
  project.agentRuns = [{
    id: "run-approved-brief-cancelled-before-start",
    workItemId: "work-define",
    status: "cancelled",
    summary:
      "Cancelled before agent claim: The reviewed queue entry was retired before any worker claim.",
    queuedAt,
    basis: (project.plan as Record<string, unknown>).basis,
    inputFingerprint: {
      algorithm: "sha256",
      digest: "c".repeat(64),
    },
    evidenceRefs: [],
    cancellation: {
      rationale: "The reviewed queue entry was retired before any worker claim.",
      cancelledAt,
      cancelledBy: { id: "human:owner", origin: "human" },
    },
    statusHistory: [{
      commandId: "queue-approved-brief-before-cancellation",
      status: "queued",
      at: queuedAt,
      actor: { id: "engineering-agent", origin: "agent" },
      summary: "Queue the approved brief baseline.",
    }, {
      commandId: "human-cancel-approved-brief-queue",
      status: "cancelled",
      at: cancelledAt,
      actor: { id: "human:owner", origin: "human" },
      summary:
        "Cancelled before agent claim: The reviewed queue entry was retired before any worker claim.",
    }],
  }];
  return project;
}

function canonicalBriefFraming(
  project: Record<string, unknown>,
): Record<string, unknown> {
  const projectId = (project.project as Record<string, unknown>).id as string;
  const briefId = `${projectId}:brief`;
  const snapshotId = `${briefId}:r1:fixture`;
  return {
    intent: {
      statement: "Record one reviewable V3 engineering thread.",
      source: { kind: "human", reference: "paired-conversation" },
      capturedAt: "2026-08-03T11:59:00.000Z",
      capturedBy: { id: "human:owner", origin: "human" },
    },
    questions: [],
    answers: [],
    currentBrief: {
      briefId,
      id: snapshotId,
      revision: 1,
      items: [{
        id: "objective",
        kind: "objective",
        statement: "Keep a reviewable engineering record.",
        sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
      }],
      proposedAt: "2026-08-03T11:59:01.000Z",
      proposedBy: { id: "agent:planner", origin: "agent" },
    },
    currentBriefApproval: {
      briefSnapshotId: snapshotId,
      briefRevision: 1,
      status: "approved",
      inputFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      requestedAt: "2026-08-03T11:59:01.000Z",
      decidedAt: "2026-08-03T11:59:02.000Z",
      decidedBy: { id: "human:owner", origin: "human" },
      rationale: "Confirmed in the paired conversation.",
    },
  };
}

interface LeftoverOperationWorkSpec {
  readonly id: string;
  readonly phaseId: string;
  readonly order: number;
  readonly operationId: string;
  readonly version: string;
  readonly status?: "ready" | "completed";
  readonly geometryId?: string;
  readonly activityId?: string;
  readonly predecessorRevisionId?: string;
}

function cancelledSeedSuccessorFixture(spec?: {
  readonly extraSuccessorPhaseId?: string;
}) {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const ref = (id: string) => ({
    kind: "artifact" as const,
    id,
    snapshotId: "thread-seed",
    snapshotRevision: 2,
  });
  const seedEvidence = ref("syson-model-seed");
  const extraEvidence = ref("syson-model-seed-alt");
  const operation = {
    id: "architecture.seed-syson-model",
    version: "2",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const reconciliation = (
    failedRunId: string,
    successorRunId: string,
    evidence: typeof seedEvidence,
  ) => ({
    kind: "superseded-by-successor" as const,
    reconciledAt: "2026-08-18T06:58:30.000Z",
    reconciledBy: { id: "agent:reconciler", origin: "agent" as const },
    failedRunId,
    successorRunId,
    successorRunSnapshot: {
      snapshotId: "thread-seed",
      revision: 2,
      subjectId: "GEN-01",
    },
    successorEvidenceRefs: [evidence],
    rationale: "The pre-claim cancelled seed was closed by the completed successor.",
  });
  const seedWork = {
    id: "wi-seed",
    activityId: "activity:wi-seed",
    phaseId: "phase-seed",
    title: "wi-seed",
    description: "wi-seed",
    kind: "architect" as const,
    operation,
    status: "cancelled" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
    reconciliation: reconciliation(
      "run:ca01-queue-seed",
      "run:ca01-seed-2",
      seedEvidence,
    ),
  };
  const successorWork = {
    id: "wi-seed-2",
    activityId: "activity:wi-seed",
    predecessorRevisionId: "wi-seed",
    phaseId: "phase-seed-2",
    title: "wi-seed-2",
    description: "wi-seed-2",
    kind: "architect" as const,
    operation,
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [seedEvidence],
    decisionIds: [],
    blockerIds: [],
  };
  const extraSuccessorId = spec?.extraSuccessorPhaseId;
  const extraCancelled = extraSuccessorId
    ? {
      ...seedWork,
      id: "wi-seed-alt",
      activityId: "activity:wi-seed-alt",
      reconciliation: reconciliation(
        "run:ca01-queue-seed-alt",
        "run:ca01-seed-3",
        extraEvidence,
      ),
    }
    : undefined;
  const extraSuccessor = extraSuccessorId
    ? {
      ...successorWork,
      id: "wi-seed-3",
      activityId: "activity:wi-seed-3",
      phaseId: extraSuccessorId,
      evidenceRefs: [extraEvidence],
    }
    : undefined;
  const phases = [
    {
      id: "phase-seed",
      name: "SysON model seed",
      order: 2,
      description: "Create the model container.",
      workItemIds: extraCancelled ? [seedWork.id, extraCancelled.id] : [seedWork.id],
      requiredDecisionIds: [],
      evidenceRefs: [],
    },
    {
      id: "phase-seed-2",
      name: "SysON model seed (sequenced)",
      order: 3,
      description: "Create the model container after the lineage append.",
      workItemIds: [successorWork.id],
      requiredDecisionIds: [],
      evidenceRefs: [seedEvidence],
    },
    ...(extraSuccessorId && extraSuccessor
      ? [{
        id: extraSuccessorId,
        name: extraSuccessorId,
        order: 4,
        description: extraSuccessorId,
        workItemIds: [extraSuccessor.id],
        requiredDecisionIds: [],
        evidenceRefs: extraSuccessor.evidenceRefs,
      }]
      : []),
  ];
  const project = {
    ...base,
    phases,
    workItems: [
      seedWork,
      successorWork,
      ...(extraCancelled ? [extraCancelled] : []),
      ...(extraSuccessor ? [extraSuccessor] : []),
    ],
    agentRuns: [
      {
        id: "run:ca01-queue-seed",
        workItemId: seedWork.id,
        status: "cancelled" as const,
        summary: "Cancelled before agent claim.",
        queuedAt: "2026-08-18T06:56:00.000Z",
        evidenceRefs: [],
        cancellation: {
          rationale: "Executor rejected the empty planning lineage.",
          cancelledAt: "2026-08-18T06:56:01.000Z",
          cancelledBy: { id: "human:owner", origin: "human" as const },
        },
      },
      {
        id: "run:ca01-seed-2",
        workItemId: successorWork.id,
        status: "completed" as const,
        summary: "Seeded the SysON model container.",
        queuedAt: "2026-08-18T06:58:00.000Z",
        completedAt: "2026-08-18T06:58:29.000Z",
        evidenceRefs: [seedEvidence],
      },
      ...(extraCancelled && extraSuccessor
        ? [{
          id: "run:ca01-queue-seed-alt",
          workItemId: extraCancelled.id,
          status: "cancelled" as const,
          summary: "Cancelled before agent claim.",
          queuedAt: "2026-08-18T06:56:02.000Z",
          evidenceRefs: [],
          cancellation: {
            rationale: "Executor rejected the empty planning lineage.",
            cancelledAt: "2026-08-18T06:56:03.000Z",
            cancelledBy: { id: "human:owner", origin: "human" as const },
          },
        }, {
          id: "run:ca01-seed-3",
          workItemId: extraSuccessor.id,
          status: "completed" as const,
          summary: "Second sequenced seed.",
          queuedAt: "2026-08-18T06:58:30.000Z",
          completedAt: "2026-08-18T06:58:40.000Z",
          evidenceRefs: [extraEvidence],
        }]
        : []),
    ],
    decisions: [],
    approvals: [],
    blockers: [],
  };
  return { project, thread: structuredClone(GENERIC_THREAD_FIXTURE) };
}

function spicePhysicsLinkedRevisionsFixture() {
  const { project, thread } = spiceProjectFixture({
    firstId: "wi-spice-r18",
    secondId: "wi-spice-r18b",
    linked: true,
  });
  return {
    project,
    thread,
    activities: physicsActivities(project.workItems),
  };
}

function al01UnlinkedSpiceFixture() {
  const { project, thread } = spiceProjectFixture({
    firstId: "work-al01-admitted-spice-run-r18",
    secondId: "work-al01-admitted-spice-run-r18b",
    linked: false,
    title: "Run admitted SPICE operating point",
  });
  return {
    project,
    thread,
    activities: physicsActivities(project.workItems),
  };
}

function physicsActivities(
  workItems: typeof GENERIC_PROJECT_FIXTURE["workItems"],
): readonly EngineeringWorkbenchActivity[] {
  return collectEngineeringActivities(workItems).map((activity) => ({
    id: activity.id,
    lane: "physics",
    rootRevisionId: activity.rootRevisionId,
    revisionIds: activity.revisionIds,
  }));
}

function spiceProjectFixture(spec: {
  readonly firstId: string;
  readonly secondId: string;
  readonly linked: boolean;
  readonly title?: string;
}) {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const title = spec.title ?? spec.firstId;
  const operation = {
    id: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.id,
    version: SIMULATE_RUN_ADMITTED_SPICE_OPERATION.version,
    bindings: [{
      name: "compilationAdmission",
      source: { kind: "approved-brief" as const },
    }],
  };
  const first = {
    id: spec.firstId,
    activityId: `activity:${spec.firstId}`,
    phaseId: "phase-spice",
    title,
    description: title,
    kind: "simulate" as const,
    operation,
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
  const second = {
    ...first,
    id: spec.secondId,
    activityId: spec.linked ? `activity:${spec.firstId}` : `activity:${spec.secondId}`,
    ...(spec.linked ? { predecessorRevisionId: spec.firstId } : {}),
    title,
    description: title,
  };
  const project = {
    ...base,
    phases: [{
      id: "phase-spice",
      name: "Admitted SPICE",
      order: 1,
      description: "Circuit-only admitted SPICE execution.",
      workItemIds: [first.id, second.id],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [first, second],
    agentRuns: [
      spiceRun("run-spice-r18", first.id, "2026-08-23T12:00:00.000Z"),
      spiceRun("run-spice-r18b", second.id, "2026-08-23T12:00:01.000Z"),
    ],
    decisions: [],
    approvals: [],
    blockers: [],
  };
  return { project, thread: structuredClone(GENERIC_THREAD_FIXTURE) };
}

function spiceRun(id: string, workItemId: string, queuedAt: string) {
  return {
    id,
    workItemId,
    status: "completed" as const,
    summary: "Recorded the admitted SPICE operating point.",
    queuedAt,
    completedAt: queuedAt,
    evidenceRefs: [],
  };
}

function leftoverReadyPredecessorFixture(spec: {
  readonly predecessor: LeftoverOperationWorkSpec;
  readonly successor: LeftoverOperationWorkSpec;
  readonly remainingReady?: LeftoverOperationWorkSpec;
}) {
  const items = [
    { spec: spec.predecessor, defaultStatus: "ready" as const },
    { spec: spec.successor, defaultStatus: "completed" as const },
    ...(spec.remainingReady
      ? [{ spec: spec.remainingReady, defaultStatus: "ready" as const }]
      : []),
  ];
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  return {
    ...base,
    phases: [
      ...base.phases,
      ...items.map(({ spec: item }) => ({
        id: item.phaseId,
        name: item.phaseId,
        order: item.order,
        description: item.phaseId,
        workItemIds: [item.id],
        requiredDecisionIds: [],
        evidenceRefs: [],
      })),
    ],
    workItems: [
      ...base.workItems,
      ...items.map(({ spec: item, defaultStatus }) =>
        leftoverOperationWork(item, defaultStatus)
      ),
    ],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function leftoverOperationWork(
  spec: LeftoverOperationWorkSpec,
  defaultStatus: "ready" | "completed",
) {
  const status = spec.status ?? defaultStatus;
  return {
    id: spec.id,
    activityId: spec.activityId ?? `activity:${spec.id}`,
    ...(spec.predecessorRevisionId
      ? { predecessorRevisionId: spec.predecessorRevisionId }
      : {}),
    phaseId: spec.phaseId,
    title: spec.id,
    description: spec.id,
    kind: "verify" as const,
    operation: {
      id: spec.operationId,
      version: spec.version,
      bindings: spec.geometryId
        ? [{
          name: "geometry",
          source: {
            kind: "thread-entity" as const,
            reference: {
              kind: "artifact" as const,
              id: spec.geometryId,
              snapshotId: "thread-leftover",
              snapshotRevision: 6,
            },
          },
        }]
        : [{
          name: "approvedBrief",
          source: { kind: "approved-brief" as const },
        }],
    },
    status,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: status === "completed"
      ? [{
        kind: "artifact" as const,
        id: `${spec.id}-evidence`,
        snapshotId: "thread-leftover",
        snapshotRevision: 6,
      }]
      : [],
    decisionIds: [],
    blockerIds: [],
  };
}

function correctionPathFixture() {
  const baseProject = structuredClone(GENERIC_PROJECT_FIXTURE);
  const ref = (id: string) => ({
    kind: "artifact" as const,
    id,
    snapshotId: "thread-correction",
    snapshotRevision: 10,
  });
  const phase = (
    id: string,
    name: string,
    order: number,
    workItemId: string,
    evidenceId?: string,
  ) => ({
    id,
    name,
    order,
    description: `${name} through its recorded evidence.`,
    workItemIds: [workItemId],
    requiredDecisionIds: [],
    evidenceRefs: evidenceId ? [ref(evidenceId)] : [],
  });
  const operation = (id: string, version: string, correction = false) => ({
    id,
    version,
    bindings: correction
      ? [{
        name: "recordedCorrection",
        source: {
          kind: "thread-entity" as const,
          reference: ref("correction-record"),
        },
      }]
      : [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
  });
  const work = (
    id: string,
    phaseId: string,
    status: "completed" | "ready",
    operationRef: ReturnType<typeof operation>,
    evidenceId?: string,
  ) => ({
    id,
    activityId: `activity:${id}`,
    phaseId,
    title: id,
    description: id,
    kind: "verify" as const,
    operation: operationRef,
    status,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: evidenceId ? [ref(evidenceId)] : [],
    decisionIds: [],
    blockerIds: [],
  });

  const phases = [
    phase("cad", "CAD evidence", 1, "cad-v1", "cad-r1-step"),
    phase(
      "verification",
      "Mechanical proof",
      2,
      "mechanical-v1",
      "proof-r1-solve",
    ),
    phase(
      "generic-v3-drip-tray-height-correction",
      "unrelated label must not matter",
      3,
      "correction",
      "correction-record",
    ),
    phase(
      "generic-v3-drip-tray-height-30-cad",
      "not a path gate",
      4,
      "cad-v2",
      "cad-r2-step",
    ),
    phase(
      "generic-v3-drip-tray-height-30-mechanical",
      "not a path gate",
      5,
      "mechanical-v2",
    ),
    phase(
      "generic-v3-drip-tray-height-30-mechanical-r3-retry",
      "not a path gate",
      6,
      "mechanical-v3",
      "proof-r3-solve",
    ),
  ];
  const workItems = [
    work(
      "cad-v1",
      "cad",
      "completed",
      operation("design.cad", "1"),
      "cad-r1-step",
    ),
    work(
      "mechanical-v1",
      "verification",
      "completed",
      operation("verify.static", "1"),
      "proof-r1-solve",
    ),
    work(
      "correction",
      "generic-v3-drip-tray-height-correction",
      "completed",
      operation("design.correct", "1"),
      "correction-record",
    ),
    work(
      "cad-v2",
      "generic-v3-drip-tray-height-30-cad",
      "completed",
      operation("design.cad", "2", true),
      "cad-r2-step",
    ),
    work(
      "mechanical-v2",
      "generic-v3-drip-tray-height-30-mechanical",
      "ready",
      operation("verify.static", "2", true),
    ),
    work(
      "mechanical-v3",
      "generic-v3-drip-tray-height-30-mechanical-r3-retry",
      "completed",
      operation("verify.static", "3", true),
      "proof-r3-solve",
    ),
  ];
  const agentRuns = [
    {
      id: "r2-failed",
      workItemId: "mechanical-v2",
      status: "failed" as const,
      summary: "Provider attempt failed before evidence was published.",
      queuedAt: "2026-08-03T12:01:00.000Z",
      completedAt: "2026-08-03T12:02:00.000Z",
      evidenceRefs: [],
    },
    {
      id: "r3-complete",
      workItemId: "mechanical-v3",
      status: "completed" as const,
      summary: "Replacement mechanical proof was recorded.",
      queuedAt: "2026-08-03T12:03:00.000Z",
      completedAt: "2026-08-03T12:04:00.000Z",
      evidenceRefs: [ref("proof-r3-solve")],
    },
  ];
  const project = {
    ...baseProject,
    phases,
    workItems,
    agentRuns,
    decisions: [],
    approvals: [],
    blockers: [],
  };

  const thread = {
    ...structuredClone(GENERIC_THREAD_FIXTURE),
    graph: {
      nodes: [
        graphNode("cad-r1-plan", "artifact"),
        graphNode("cad-r1-step", "artifact"),
        graphNode("proof-r1-proof", "artifact"),
        graphNode("proof-r1-solve", "artifact"),
        graphNode("correction-record", "artifact"),
        graphNode("cad-r2-step", "artifact"),
        graphNode("proof-r3-solve", "artifact"),
        {
          ...graphNode("drip-tray-correction", "change"),
          affectedComponentId: "component:drip-tray",
        },
      ],
      edges: [
        graphEdge("cad-lineage", "cad-r1-plan", "cad-r1-step", "derived_from"),
        graphEdge(
          "proof-lineage",
          "proof-r1-proof",
          "proof-r1-solve",
          "derived_from",
        ),
        graphEdge(
          "recorded-change",
          "drip-tray-correction",
          "correction-record",
          "changes",
          "change",
        ),
        graphEdge(
          "cad-corrected",
          "cad-r1-plan",
          "correction-record",
          "supersedes",
        ),
        graphEdge(
          "proof-corrected",
          "proof-r1-proof",
          "correction-record",
          "supersedes",
        ),
      ],
    },
  };
  return { project, thread };
}

function graphNode(
  id: string,
  kind: "artifact" | "change",
) {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    label: "intentionally ignored presentation label",
    system: "test",
    freshness: "fresh" as const,
    summary: "test evidence",
    recordedAt: "2026-08-03T12:00:00.000Z",
  };
}

function graphEdge(
  id: string,
  from: string,
  to: string,
  relation: "changes" | "derived_from" | "supersedes",
  fromKind: "artifact" | "change" = "artifact",
) {
  return {
    id,
    from: { kind: fromKind, id: from },
    to: { kind: "artifact" as const, id: to },
    relation,
    rationale: "explicit test provenance",
    origin: "provenance" as const,
  };
}

Deno.test("the agent panel keeps the most recent settled run when nothing is in flight", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const settled = (
    id: string,
    completedAt: string,
    status: "completed" | "failed" | "cancelled" = "completed",
  ) => ({
    ...base.agentRuns[0]!,
    id,
    status,
    completedAt,
  });
  const snapshot = {
    ...base,
    agentRuns: [
      settled("run-older", "2026-08-01T09:00:00.000Z"),
      settled("run-newest", "2026-08-02T10:00:00.000Z"),
      settled(
        "run-failed-later",
        "2026-08-01T12:00:00.000Z",
        "failed" as const,
      ),
    ],
  };

  const brief = buildProjectBrief(snapshot);

  assertEquals(brief.activeRuns.length, 0);
  assertEquals(brief.lastSettledRun?.id, "run-newest");
});

Deno.test("the agent panel dates a queued cancellation by its terminal human record", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const template = base.agentRuns[0]!;
  const completed = {
    ...template,
    id: "run-completed-earlier",
    status: "completed" as const,
    queuedAt: "2026-08-02T08:00:00.000Z",
    startedAt: "2026-08-02T08:01:00.000Z",
    completedAt: "2026-08-02T09:00:00.000Z",
  };
  const cancelled = {
    ...template,
    id: "run-cancelled-later",
    status: "cancelled" as const,
    queuedAt: "2026-08-02T07:00:00.000Z",
    startedAt: undefined,
    completedAt: undefined,
    cancellation: {
      rationale: "The reviewed queue entry was retired before agent claim.",
      cancelledAt: "2026-08-02T10:00:00.000Z",
      cancelledBy: { id: "human:owner", origin: "human" as const },
    },
  };

  const brief = buildProjectBrief({
    ...base,
    agentRuns: [completed, cancelled],
  });

  assertEquals(brief.lastSettledRun?.id, "run-cancelled-later");
  assertEquals(agentRunRecordedAt(cancelled), "2026-08-02T10:00:00.000Z");
});

Deno.test("agent-now presentation prioritises active work, then current work, then settled history", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const active = {
    ...base.agentRuns[0]!,
    id: "run-active",
    status: "running" as const,
  };
  const settled = {
    ...base.agentRuns[0]!,
    id: "run-settled",
    status: "completed" as const,
    completedAt: "2026-08-02T09:00:00.000Z",
  };
  const current = {
    ...base.workItems[0]!,
    status: "in-progress" as const,
  };

  assertEquals(
    buildAgentNowPresentation({
      ...base,
      agentRuns: [settled, active],
      workItems: [current],
    }),
    { kind: "active-run", run: active },
  );
  assertEquals(
    buildAgentNowPresentation({
      ...base,
      agentRuns: [settled],
      workItems: [current],
    }),
    { kind: "current-work", work: current },
  );
  assertEquals(
    buildAgentNowPresentation({ ...base, agentRuns: [settled], workItems: [] }),
    { kind: "last-settled-run", run: settled },
  );
});

Deno.test("agent-now presentation retains a cancelled run as dated history", () => {
  const base = structuredClone(GENERIC_PROJECT_FIXTURE);
  const cancelled = {
    ...base.agentRuns[0]!,
    id: "run-cancelled",
    status: "cancelled" as const,
    completedAt: undefined,
    cancellation: {
      rationale: "The reviewed queue entry was retired before agent claim.",
      cancelledAt: "2026-08-02T10:00:00.000Z",
      cancelledBy: { id: "human:owner", origin: "human" as const },
    },
  };

  const presentation = buildAgentNowPresentation({
    ...base,
    agentRuns: [cancelled],
    workItems: [],
  });

  assertEquals(presentation.kind, "last-settled-run");
  if (presentation.kind === "last-settled-run") {
    assertEquals(
      agentRunRecordedAt(presentation.run),
      "2026-08-02T10:00:00.000Z",
    );
  }
});

Deno.test("an in-flight run never counts as the last settled run", () => {
  const brief = buildProjectBrief(GENERIC_PROJECT_FIXTURE);

  assertEquals(brief.activeRuns[0]?.status, "waiting-for-decision");
  assertEquals(brief.lastSettledRun, undefined);
});

Deno.test("project pulse status labels keep planned cancelled and completed literal", () => {
  assertEquals(
    projectPulseStatus({
      kind: "current-work",
      work: { status: "planned" },
    }),
    { status: "planned", label: "Planned" },
  );
  assertEquals(
    projectPulseStatus({
      kind: "last-settled-run",
      run: { status: "cancelled" },
    }),
    { status: "cancelled", label: "Cancelled" },
  );
  assertEquals(
    projectPulseStatus({
      kind: "last-settled-run",
      run: { status: "completed" },
    }),
    { status: "completed", label: "Completed" },
  );
});

Deno.test("path band status follows group gates and leaves empty lanes planned", () => {
  const group = (
    statuses: readonly ("completed" | "active" | "planned" | "blocked")[],
  ) => ({
    gates: statuses.map((status, index) => ({
      id: `g-${index}`,
      lane: "physics" as const,
      title: "gate",
      status,
      revisions: [],
      approvedDecisions: 0,
      requiredDecisions: 0,
      evidenceCount: 0,
    })),
    satisfiedGates: statuses.filter((status) => status === "completed").length,
    totalGates: statuses.length,
  });

  assertEquals(projectPathLaneStageStatus(group([])), "planned");
  assertEquals(
    projectPathLaneStageStatus(group(["completed", "completed"])),
    "completed",
  );
  assertEquals(
    projectPathLaneStageStatus(group(["completed", "blocked"])),
    "blocked",
  );
  assertEquals(
    projectPathLaneStageStatus(group(["active", "blocked"])),
    "blocked",
  );
  assertEquals(
    projectPathLaneStageStatus(group(["completed", "active"])),
    "active",
  );
  assertEquals(
    projectPathLaneStageStatus(group(["completed", "planned"])),
    "planned",
  );
});

Deno.test("grouping with no activities still returns five empty 0/0 lanes", () => {
  const groups = groupProjectPathGatesByLane([], []);
  assertEquals(groups.map((group) => group.id), [...ENGINEERING_PATH_LANE_IDS]);
  for (const group of groups) {
    assertEquals(group.gates, []);
    assertEquals(group.satisfiedGates, 0);
    assertEquals(group.totalGates, 0);
    assertEquals(projectPathLaneStageStatus(group), "planned");
  }
});

Deno.test("project path gates always occupy the five projected thread lanes without reading phase labels", () => {
  const gate = (
    id: string,
    lane: "requirements" | "system-model" | "geometry",
    evidenceCount: number,
  ) => ({
    id,
    lane,
    title: "Same deliberately uninformative label",
    status: "completed" as const,
    revisions: [],
    approvedDecisions: 1,
    requiredDecisions: 1,
    evidenceCount,
  });
  const groups = groupProjectPathGatesByLane(
    [
      gate("f1", "system-model", 1),
      gate("f2", "system-model", 3),
      gate("c1", "geometry", 2),
      gate("x1", "requirements", 0),
    ],
    [],
  );

  assertEquals(groups.map((group) => group.id), [
    "requirements",
    "system-model",
    "geometry",
    "physics",
    "verdicts",
  ]);
  assertEquals(groups[1], {
    id: "system-model",
    gates: groups[1]!.gates,
    satisfiedGates: 2,
    totalGates: 2,
  });
  assertEquals(groups[1]!.gates.map((item) => item.id), ["f1", "f2"]);
  assertEquals(groups[3], {
    id: "physics",
    gates: [],
    satisfiedGates: 0,
    totalGates: 0,
  });
  assertEquals(groups[4], {
    id: "verdicts",
    gates: [],
    satisfiedGates: 0,
    totalGates: 0,
  });
  assertEquals(PROJECT_PATH_STAGE_LABELS.requirements, "FRAME");
  assertEquals(PROJECT_PATH_STAGE_LABELS["system-model"], "SYSTEM MODEL");
  assertEquals(PROJECT_PATH_STAGE_LABELS.geometry, "GEOMETRY");
  assertEquals(PROJECT_PATH_STAGE_LABELS.physics, "PHYSICS");
  assertEquals(PROJECT_PATH_STAGE_LABELS.verdicts, "VERIFICATION");
});
