import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../domain/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/engineering-project-validation.ts";
import type { ProjectDiscoverySnapshot } from "../../domain/project-discovery.ts";
import { validateProjectDiscoverySnapshot } from "../../domain/project-discovery-validation.ts";
import {
  ApprovedDiscoveryBaselineMaterializationError,
  materializeApprovedDiscoveryBaseline,
} from "./approved-discovery-baseline.ts";

const FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
const HUMAN = { id: "human:owner", origin: "human" as const };
const AGENT = { id: "agent:guide", origin: "agent" as const };

Deno.test("approved discovery baseline is canonical documentary r1, not technical evidence", async () => {
  const { discovery, project } = approvedProjectPlan();

  const result = await materializeApprovedDiscoveryBaseline({
    project,
    discovery,
    runId: "run:approved-discovery-baseline-1",
    capturedAt: "2026-08-02T12:03:00.000Z",
    captureUri: "casys://captures/approved-discovery-baseline-1.json",
  });

  assertEquals(result.capture.projectDefinition.identity, project.project);
  assertEquals(
    result.capture.projectDefinition.discoveryHandoff,
    project.discoveryHandoff,
  );
  assertEquals(result.capture.projectDefinition.plan, project.plan);
  assertEquals(
    result.capture.projectDefinition.workItem.operation,
    project.workItems[0].operation,
  );
  assertEquals(Object.hasOwn(result.capture.projectDefinition, "agentRuns"), false);
  assertEquals(
    Object.hasOwn(result.capture.projectDefinition, "commandReceipts"),
    false,
  );
  assertEquals(result.capture.discoverySnapshot, discovery);
  assertEquals(result.text, deterministicJson(result.capture));
  assertEquals(new TextDecoder().decode(result.bytes), result.text);
  assertEquals(result.sha256, await sha256Fingerprint(result.capture));

  assertEquals(result.snapshot.revision, 1);
  assertEquals(result.snapshot.artifacts.length, 1);
  assertEquals(result.snapshot.artifacts[0].kind, "document");
  assertEquals(result.snapshot.artifacts[0].fingerprint, result.sha256);
  assertEquals(
    result.snapshot.artifacts[0].uri,
    "casys://captures/approved-discovery-baseline-1.json",
  );
  assertEquals(result.snapshot.consumptions, []);
  assertEquals(result.snapshot.observations, []);
  assertEquals(result.snapshot.requirements, []);
  assertEquals(result.snapshot.evaluations, []);
  assertEquals(result.snapshot.violations, []);
  assertEquals(result.snapshot.provenance.length, 1);
  assertEquals(result.snapshot.provenance[0].relation, "changes");
  assertStringIncludes(result.capture.statement, "not provider evidence");
  assertStringIncludes(result.snapshot.changeSet.changes[0].summary, "pre-technical");
});

Deno.test("approved discovery baseline ignores run transitions in its documentary content", async () => {
  const { discovery, project } = approvedProjectPlan();
  const runningProject = projectWithRunningBaselineRun(project);
  const input = {
    discovery,
    runId: "run:approved-discovery-baseline-stable",
    capturedAt: "2026-08-02T12:03:00.000Z",
  };

  const beforeRun = await materializeApprovedDiscoveryBaseline({
    ...input,
    project,
    captureUri: "casys://captures/before-run.json",
  });
  const duringRun = await materializeApprovedDiscoveryBaseline({
    ...input,
    project: runningProject,
    captureUri: "casys://captures/during-run.json",
  });

  assertEquals(beforeRun.text, duringRun.text);
  assertEquals(beforeRun.sha256, duringRun.sha256);
  assertEquals(beforeRun.snapshot.artifacts[0].uri, "casys://captures/before-run.json");
  assertEquals(duringRun.snapshot.artifacts[0].uri, "casys://captures/during-run.json");
});

Deno.test("approved discovery baseline rejects another valid approved discovery revision", async () => {
  const { discovery, project } = approvedProjectPlan();
  const otherDiscovery = approvedDiscovery("another-drone-discovery");

  const error = await assertRejects(
    () =>
      materializeApprovedDiscoveryBaseline({
        project,
        discovery: otherDiscovery,
        runId: "run:handoff-mismatch",
        capturedAt: "2026-08-02T12:03:00.000Z",
      }),
    ApprovedDiscoveryBaselineMaterializationError,
  );

  assertEquals(error.code, "invalid_handoff");
  assertEquals(discovery.status, "approved");
});

function approvedProjectPlan(): {
  readonly discovery: ProjectDiscoverySnapshot;
  readonly project: EngineeringProjectSnapshot;
} {
  const discovery = approvedDiscovery("drone-discovery");
  const projectId = "drone-concept";
  const projectSnapshotId = `${projectId}:project:r2:plan`;
  const handoffSnapshotId = `${projectId}:project:r1:handoff`;
  const planBasis = {
    kind: "approved-discovery" as const,
    discoveryId: discovery.discoveryId,
    snapshotId: discovery.id,
    revision: discovery.revision,
    briefId: discovery.brief!.id,
    approvedBriefFingerprint: FINGERPRINT,
  };

  return {
    discovery,
    project: validateEngineeringProjectSnapshot({
      schemaVersion: "2.0",
      id: projectSnapshotId,
      revision: 2,
      previous: { snapshotId: handoffSnapshotId, revision: 1 },
      generatedAt: "2026-08-02T12:02:00.000Z",
      project: {
        id: projectId,
        name: "Build a reviewable drone demonstrator",
        subjectId: `project:${projectId}`,
        objective: {
          title: "Build a reviewable drone demonstrator",
          statement: "Build a reviewable drone demonstrator",
        },
      },
      discoveryHandoff: {
        discoveryId: discovery.discoveryId,
        snapshotId: discovery.id,
        revision: discovery.revision,
        briefId: discovery.brief!.id,
        approvedBriefFingerprint: FINGERPRINT,
        approvedAt: discovery.review!.decidedAt,
        approvedBy: HUMAN,
      },
      plan: {
        startingPoint: "idea-or-spec",
        basis: planBasis,
        publishedAt: "2026-08-02T12:02:00.000Z",
        publishedBy: AGENT,
      },
      threadSnapshots: [],
      phases: [{
        id: "baseline",
        name: "Engineering baseline",
        order: 1,
        description: "Turn the approved discovery into a first reviewable definition.",
        workItemIds: ["establish-baseline"],
        requiredDecisionIds: [],
        evidenceRefs: [],
      }],
      workItems: [{
        id: "establish-baseline",
        phaseId: "baseline",
        title: "Create the engineering baseline",
        description:
          "Create the first reviewable engineering baseline from the approved discovery brief.",
        kind: "define",
        operation: {
          id: "baseline.from-approved-discovery",
          version: "1",
          bindings: [{
            name: "approvedDiscovery",
            source: { kind: "approved-discovery" },
          }],
        },
        status: "planned",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
      }],
      agentRuns: [],
      decisions: [],
      approvals: [],
      blockers: [],
      commandReceipts: [
        receipt(
          "create-drone-project",
          "project.create-from-discovery",
          HUMAN,
          "2026-08-02T12:00:30.000Z",
          "2026-08-02T12:01:00.000Z",
          handoffSnapshotId,
          1,
        ),
        receipt(
          "publish-drone-plan",
          "project.plan-publish",
          AGENT,
          "2026-08-02T12:01:30.000Z",
          "2026-08-02T12:02:00.000Z",
          projectSnapshotId,
          2,
        ),
      ],
    }),
  };
}

function projectWithRunningBaselineRun(
  project: EngineeringProjectSnapshot,
): EngineeringProjectSnapshot {
  const runtimeSnapshotId = "drone-concept:project:r5:baseline-running";
  return validateEngineeringProjectSnapshot({
    ...structuredClone(project),
    id: runtimeSnapshotId,
    revision: 5,
    previous: {
      snapshotId: "drone-concept:project:r4:baseline-claimed",
      revision: 4,
    },
    generatedAt: "2026-08-02T12:05:00.000Z",
    workItems: project.workItems.map((item) => ({
      ...item,
      status: item.id === "establish-baseline" ? "in-progress" : item.status,
    })),
    agentRuns: [{
      id: "run:approved-discovery-baseline-stable",
      workItemId: "establish-baseline",
      status: "running",
      summary: "Recording the approved discovery documentary baseline.",
      queuedAt: "2026-08-02T12:03:00.000Z",
      startedAt: "2026-08-02T12:04:00.000Z",
      claimedAt: "2026-08-02T12:04:00.000Z",
      claimedBy: AGENT,
      basis: project.plan!.basis,
      inputFingerprint: FINGERPRINT,
      evidenceRefs: [],
      statusHistory: [
        {
          commandId: "queue-baseline-run",
          status: "queued",
          at: "2026-08-02T12:03:00.000Z",
          actor: AGENT,
          summary: "Queued documentary baseline capture.",
        },
        {
          commandId: "claim-baseline-run",
          status: "running",
          at: "2026-08-02T12:04:00.000Z",
          actor: AGENT,
          summary: "Claimed documentary baseline capture.",
        },
      ],
    }],
    commandReceipts: [
      ...project.commandReceipts!,
      receipt(
        "queue-baseline-run",
        "agent-run.queue",
        AGENT,
        "2026-08-02T12:02:30.000Z",
        "2026-08-02T12:03:00.000Z",
        "drone-concept:project:r3:baseline-queued",
        3,
      ),
      receipt(
        "claim-baseline-run",
        "agent-run.claim",
        AGENT,
        "2026-08-02T12:03:30.000Z",
        "2026-08-02T12:04:00.000Z",
        "drone-concept:project:r4:baseline-claimed",
        4,
      ),
      receipt(
        "progress-baseline-run",
        "agent-run.progress",
        AGENT,
        "2026-08-02T12:04:30.000Z",
        "2026-08-02T12:05:00.000Z",
        runtimeSnapshotId,
        5,
      ),
    ],
  });
}

function approvedDiscovery(discoveryId: string): ProjectDiscoverySnapshot {
  const startSnapshotId = `${discoveryId}:r1:started`;
  const briefSnapshotId = `${discoveryId}:r2:brief`;
  const approvedSnapshotId = `${discoveryId}:r3:approved`;
  return validateProjectDiscoverySnapshot({
    schemaVersion: "1.0",
    id: approvedSnapshotId,
    discoveryId,
    revision: 3,
    previous: { snapshotId: briefSnapshotId, revision: 2 },
    generatedAt: "2026-08-02T11:00:03.000Z",
    status: "approved",
    intent: {
      statement: "Build a reviewable drone demonstrator.",
      capturedAt: "2026-08-02T10:59:00.000Z",
      capturedBy: HUMAN,
    },
    questions: [],
    answers: [],
    brief: {
      id: "drone-brief-v1",
      objective: "Build a reviewable drone demonstrator",
      missionScenarios: ["Demonstrate controlled flight"],
      successCriteria: ["Produce reviewable engineering evidence"],
      constraints: ["No autonomous provider execution"],
      intendedMarkets: ["Initial market to be confirmed"],
      manufacturingJurisdictions: ["Manufacturing location to be confirmed"],
      operatingJurisdictions: ["Operating jurisdiction to be confirmed"],
      complianceTargets: ["Identify applicable obligations"],
      verificationPlan: ["Plan bounded analysis"],
      exclusions: ["No certification claim"],
      assumptions: ["Controlled demonstrator"],
      openQuestions: ["First payload to be determined"],
      proposedAt: "2026-08-02T11:00:02.000Z",
      proposedBy: AGENT,
    },
    review: {
      briefId: "drone-brief-v1",
      status: "approved",
      inputFingerprint: FINGERPRINT,
      requestedAt: "2026-08-02T11:00:02.000Z",
      decidedAt: "2026-08-02T11:00:03.000Z",
      decidedBy: HUMAN,
      rationale: "The discovery brief is approved as the project planning basis.",
    },
    commandReceipts: [
      discoveryReceipt(
        `${discoveryId}:start`,
        "discovery.start",
        HUMAN,
        "2026-08-02T10:59:00.000Z",
        "2026-08-02T11:00:01.000Z",
        startSnapshotId,
        1,
      ),
      discoveryReceipt(
        `${discoveryId}:brief`,
        "brief.propose",
        AGENT,
        "2026-08-02T10:59:10.000Z",
        "2026-08-02T11:00:02.000Z",
        briefSnapshotId,
        2,
      ),
      discoveryReceipt(
        `${discoveryId}:approve`,
        "brief.approve",
        HUMAN,
        "2026-08-02T10:59:20.000Z",
        "2026-08-02T11:00:03.000Z",
        approvedSnapshotId,
        3,
      ),
    ],
  });
}

function receipt(
  commandId: string,
  type: string,
  actor: { readonly id: string; readonly origin: "human" | "agent" },
  issuedAt: string,
  appliedAt: string,
  snapshotId: string,
  revision: number,
) {
  return {
    commandId,
    type,
    actor,
    issuedAt,
    appliedAt,
    requestFingerprint: FINGERPRINT,
    resultingSnapshot: { snapshotId, revision },
  };
}

function discoveryReceipt(
  commandId: string,
  type: string,
  actor: { readonly id: string; readonly origin: "human" | "agent" },
  issuedAt: string,
  appliedAt: string,
  snapshotId: string,
  revision: number,
) {
  return {
    commandId,
    type,
    actor,
    issuedAt,
    appliedAt,
    requestFingerprint: FINGERPRINT,
    resultingSnapshot: { snapshotId, revision },
  };
}
