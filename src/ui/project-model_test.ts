import { assertEquals } from "@std/assert";
import { COFFEE_MACHINE_PROJECT_FIXTURE } from "./src/project/fixture.ts";
import { COFFEE_MACHINE_THREAD_FIXTURE } from "./src/thread/fixture.ts";
import {
  agentRunRecordedAt,
  agentRunSummary,
  buildAgentNowPresentation,
  buildCurrentProjectWork,
  buildProjectBrief,
  buildProjectPath,
  PROJECT_PATH_PRESENTATION_POLICY,
  projectBriefStatusLabel,
  projectPathStatusLabel,
  projectStatusLabel,
  verificationChainDetail,
  workOwnerLabel,
} from "./src/project/model.ts";
import { isEngineeringProjectSnapshot } from "./src/project/contract.ts";

Deno.test("project brief derives factual gates and operator attention", () => {
  const brief = buildProjectBrief(COFFEE_MACHINE_PROJECT_FIXTURE);

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
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision, index) =>
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

Deno.test("overview verification copy counts current criteria before retained history", () => {
  const seed = COFFEE_MACHINE_THREAD_FIXTURE.requirements[0]!;
  const thread = {
    ...COFFEE_MACHINE_THREAD_FIXTURE,
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

Deno.test("Project Path keeps a component correction and failed retry below its macro evidence stages", () => {
  const { project, thread } = correctionPathFixture();
  const path = buildProjectPath(project, thread);

  assertEquals(PROJECT_PATH_PRESENTATION_POLICY.version, "project-path/1.0");
  assertEquals(
    path.phases.map((item) => item.phase.id),
    ["cad", "verification"],
  );
  assertEquals(path.completedPhases, 2);
  assertEquals(path.status, "completed");
  assertEquals(path.phases[0]?.lifecycle, {
    affectedComponentIds: ["component:drip-tray"],
    correctionCount: 1,
    revisionAttemptCount: 1,
    state: "current",
  });
  assertEquals(path.phases[1]?.status, "completed");
  assertEquals(path.phases[1]?.lifecycle, {
    affectedComponentIds: ["component:drip-tray"],
    correctionCount: 1,
    revisionAttemptCount: 2,
    state: "current",
  });

  // Raw r10-style additions must never become top-level Project Path cards.
  assertEquals(
    path.phases.some((item) =>
      item.phase.id === "cm01-v3-drip-tray-height-correction" ||
      item.phase.id === "cm01-v3-drip-tray-height-30-cad" ||
      item.phase.id === "cm01-v3-drip-tray-height-30-mechanical" ||
      item.phase.id === "cm01-v3-drip-tray-height-30-mechanical-r3-retry"
    ),
    false,
  );
});

Deno.test("Project Path reads an unfinished lifecycle as retained history, never as live recomputation", () => {
  // Gate states are durable readings of the versioned record: the phase's own
  // work counters already say 0/1 and "What the agent is doing" owns the
  // in-flight story, so no gate may promise that evidence is being recomputed.
  const { project, thread } = correctionPathFixture();
  const mutable = structuredClone(project);
  const retry = mutable.workItems.find((item) => item.id === "mechanical-v3");
  if (!retry) throw new Error("fixture lost its mechanical-v3 retry");
  (retry as unknown as { status: string }).status = "ready";

  const path = buildProjectPath(mutable, thread);
  const mechanical = path.phases.find((item) => item.phase.id === "verification");
  assertEquals(mechanical?.lifecycle?.state, "retained");
  for (const item of path.phases) {
    if (!item.lifecycle) continue;
    assertEquals(
      ["current", "attention", "retained"].includes(item.lifecycle.state),
      true,
      `gate ${item.phase.id} leaked a non-durable lifecycle state`,
    );
  }
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
    path.phases.some((item) => item.phase.id === "anchoring"),
    false,
    "the anchoring phase must fold under the model owner, not stay a gate",
  );
  assertEquals(
    path.phases.some((item) => item.phase.id === "measurement"),
    false,
    "a measurement feeding a folded enrichment folds with it — it is " +
      "instrumentation of the model, not an engineering gate",
  );
  const architecture = path.phases.find((item) => item.phase.id === "architecture");
  assertEquals(architecture?.lifecycle, {
    affectedComponentIds: [],
    correctionCount: 0,
    revisionAttemptCount: 0,
    modelEnrichmentCount: 1,
    modelMeasurementCount: 1,
    state: "current",
  });
});

Deno.test("Project Path folds the exact R3 identity repair into Mechanical proof", () => {
  const { project, thread } = correctionPathFixture({
    includeIdentityRepair: true,
  });
  const path = buildProjectPath(project, thread);
  const mechanical = path.phases.find((item) => item.phase.id === "verification");

  assertEquals(
    PROJECT_PATH_PRESENTATION_POLICY.identityRepair.operationId,
    "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
  );
  assertEquals(path.phases.map((item) => item.phase.id), [
    "cad",
    "verification",
  ]);
  assertEquals(path.completedPhases, 2);
  assertEquals(path.status, "completed");
  // The shell and Overview both consume this projection, never the raw r11
  // project status that still contains the immutable failed R2 phase.
  assertEquals(projectPathStatusLabel(path), "Completed");
  assertEquals(mechanical?.lifecycle, {
    affectedComponentIds: ["component:drip-tray"],
    correctionCount: 1,
    revisionAttemptCount: 2,
    identityRepairCount: 1,
    state: "current",
  });
  assertEquals(
    path.phases.some((item) =>
      item.phase.id ===
        "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery"
    ),
    false,
  );
});

Deno.test("current project work prefers an explicit successor reconciliation", () => {
  const { project } = correctionPathFixture({
    includeIdentityRepair: true,
  });
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
              subjectId: "CM-01",
            },
            successorSnapshot: {
              snapshotId: "thread-correction",
              revision: 10,
              subjectId: "CM-01",
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

Deno.test("browser project contract rejects a half-defined input anchor", () => {
  const valid = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
        snapshotId: "thread-cm01",
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
    COFFEE_MACHINE_PROJECT_FIXTURE,
  ) as unknown as Record<string, unknown>;
  const reference = (project.threadSnapshots as Array<Record<string, unknown>>)[0]!;
  project.schemaVersion = "3.0";
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
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "rejected" as const } : decision
    ),
  };

  const brief = buildProjectBrief(rejected);

  assertEquals(brief.pendingDecisions[0]?.id, rejected.decisions[0]!.id);
  assertEquals(brief.pendingDecisions[0]?.status, "rejected");
});

Deno.test("cockpit falls back to a named work item for an accidental run summary", () => {
  const snapshot = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
  const run = { ...snapshot.agentRuns[0]!, summary: "dsadsadas" };

  assertEquals(
    agentRunSummary(snapshot, run),
    "Working on: Prepare mechanical verification inputs",
  );
});

function v3PlanningProjectEnvelope(): Record<string, unknown> {
  const project = structuredClone(
    COFFEE_MACHINE_PROJECT_FIXTURE,
  ) as unknown as Record<string, unknown>;
  project.schemaVersion = "3.0";
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

function correctionPathFixture(
  { includeIdentityRepair = false }: { includeIdentityRepair?: boolean } = {},
) {
  const baseProject = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
      "cm01-v3-drip-tray-height-correction",
      "unrelated label must not matter",
      3,
      "correction",
      "correction-record",
    ),
    phase(
      "cm01-v3-drip-tray-height-30-cad",
      "not a path gate",
      4,
      "cad-v2",
      "cad-r2-step",
    ),
    phase(
      "cm01-v3-drip-tray-height-30-mechanical",
      "not a path gate",
      5,
      "mechanical-v2",
    ),
    phase(
      "cm01-v3-drip-tray-height-30-mechanical-r3-retry",
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
      "cm01-v3-drip-tray-height-correction",
      "completed",
      operation("design.correct", "1"),
      "correction-record",
    ),
    work(
      "cad-v2",
      "cm01-v3-drip-tray-height-30-cad",
      "completed",
      operation("design.cad", "2", true),
      "cad-r2-step",
    ),
    work(
      "mechanical-v2",
      "cm01-v3-drip-tray-height-30-mechanical",
      "ready",
      operation("verify.static", "2", true),
    ),
    work(
      "mechanical-v3",
      "cm01-v3-drip-tray-height-30-mechanical-r3-retry",
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
  if (includeIdentityRepair) {
    phases.push(
      phase(
        "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery",
        "still not a path gate",
        7,
        "mechanical-r3-identity-repair",
        "proof-r3-identified-solve",
      ),
    );
    workItems.push(
      work(
        "mechanical-r3-identity-repair",
        "cm01-v3-drip-tray-height-30-mechanical-r3-identity-recovery",
        "completed",
        {
          id: "repair.coffee-machine-cm01-drip-tray-mechanical-r3-identity",
          version: "1",
          bindings: [{
            name: "historicalMechanicalR3Result",
            source: {
              kind: "thread-entity" as const,
              reference: ref("proof-r3-solve"),
            },
          }],
        },
        "proof-r3-identified-solve",
      ),
    );
    agentRuns.push({
      id: "r3-identity-repair-complete",
      workItemId: "mechanical-r3-identity-repair",
      status: "completed" as const,
      summary: "Correctly identified the preserved R3 evidence.",
      queuedAt: "2026-08-03T12:05:00.000Z",
      completedAt: "2026-08-03T12:06:00.000Z",
      evidenceRefs: [ref("proof-r3-identified-solve")],
    });
  }
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
    ...structuredClone(COFFEE_MACHINE_THREAD_FIXTURE),
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
  if (includeIdentityRepair) {
    thread.graph.nodes.push(graphNode("proof-r3-identified-solve", "artifact"));
    thread.graph.edges.push(
      graphEdge(
        "r3-identity-supersedes",
        "proof-r3-solve",
        "proof-r3-identified-solve",
        "supersedes",
      ),
    );
  }
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
  const base = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
  const base = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
  const base = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
    id: "work-current",
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
  const base = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
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
  const brief = buildProjectBrief(COFFEE_MACHINE_PROJECT_FIXTURE);

  assertEquals(brief.activeRuns[0]?.status, "waiting-for-decision");
  assertEquals(brief.lastSettledRun, undefined);
});
