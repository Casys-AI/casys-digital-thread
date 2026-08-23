import { assertEquals } from "@std/assert";
import {
  engineeringProjectPlanReplacementLock,
  isEngineeringProjectPlanReplaceable,
} from "./engineering-project-plan-replaceability.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";

Deno.test("an approved brief without execution is plan-replaceable", () => {
  const project = approvedBriefProject();
  assertEquals(isEngineeringProjectPlanReplaceable(project), true);
  assertEquals(engineeringProjectPlanReplacementLock(project), undefined);
});

Deno.test("a queued run locks plan replacement", () => {
  const project = approvedBriefProject();
  const locked = validateEngineeringProjectSnapshot({
    ...project,
    workItems: project.workItems.map((item) => ({
      ...item,
      status: "in-progress",
    })),
    agentRuns: [{
      id: "run:lock",
      workItemId: "record-approved-brief",
      status: "queued",
      summary: "Queued baseline.",
      queuedAt: project.generatedAt,
      evidenceRefs: [],
      basis: project.plan!.basis,
      inputFingerprint: {
        algorithm: "sha256",
        digest: "b".repeat(64),
      },
    }],
  });
  assertEquals(isEngineeringProjectPlanReplaceable(locked), false);
  assertEquals(
    engineeringProjectPlanReplacementLock(locked),
    "run_approval_or_blocker_exists",
  );
});

function approvedBriefProject() {
  const generatedAt = "2026-08-03T09:00:03.000Z";
  const fingerprint = { algorithm: "sha256" as const, digest: "e".repeat(64) };
  const basis = {
    kind: "approved-brief" as const,
    projectId: "replaceable-plan",
    projectSnapshotId: "replaceable-plan:r2",
    projectRevision: 2,
    briefId: "replaceable-plan:brief",
    briefSnapshotId: "replaceable-plan:brief:r1",
    briefRevision: 1,
    approvedBriefFingerprint: fingerprint,
  };
  return validateEngineeringProjectSnapshot({
    schemaVersion: "4.0",
    id: "replaceable-plan:r3",
    revision: 3,
    generatedAt,
    previous: { snapshotId: "replaceable-plan:r2", revision: 2 },
    project: {
      id: "replaceable-plan",
      name: "Replaceable plan",
      subjectId: "project:replaceable-plan",
      objective: {
        title: "Demonstrate a reviewable system safely.",
        statement: "Demonstrate a reviewable system safely.",
      },
    },
    framing: {
      intent: {
        statement: "Build a reviewable engineering system.",
        source: { kind: "human", reference: "conversation:turn-1" },
        capturedAt: generatedAt,
        capturedBy: { id: "human:owner", origin: "human" },
      },
      questions: [],
      answers: [],
      currentBrief: {
        briefId: "replaceable-plan:brief",
        id: "replaceable-plan:brief:r1",
        revision: 1,
        items: [{
          id: "objective",
          kind: "objective",
          statement: "Demonstrate a reviewable system safely.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "mission",
          kind: "mission-scenario",
          statement: "Demonstrate a bounded operating scenario.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }, {
          id: "success",
          kind: "success-criterion",
          statement: "Complete the reviewed scenario.",
          sourceRefs: [{ kind: "intent", reference: "conversation:turn-1" }],
        }],
        proposedAt: generatedAt,
        proposedBy: { id: "agent:planner", origin: "agent" },
      },
      currentBriefApproval: {
        briefSnapshotId: "replaceable-plan:brief:r1",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: fingerprint,
        requestedAt: generatedAt,
        decidedAt: generatedAt,
        decidedBy: { id: "human:owner", origin: "human" },
        rationale: "Approved for planning.",
      },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis,
      publishedAt: generatedAt,
      publishedBy: { id: "agent:planner", origin: "agent" },
    },
    threadSnapshots: [],
    phases: [{
      id: "phase-baseline",
      name: "Engineering baseline",
      order: 1,
      description: "Unexecuted plan.",
      workItemIds: ["record-approved-brief"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "record-approved-brief",
      activityId: "activity:record-approved-brief",
      phaseId: "phase-baseline",
      title: "Establish the engineering baseline",
      description: "Record the reviewed intent.",
      kind: "define",
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
      status: "ready",
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
    commandReceipts: [{
      commandId: "start",
      type: "project.start",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
      resultingSnapshot: { snapshotId: "replaceable-plan:r1", revision: 1 },
    }, {
      commandId: "approve",
      type: "project.brief-approve",
      actor: { id: "human:owner", origin: "human" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: "replaceable-plan:r2", revision: 2 },
      approvedBriefBasis: basis,
    }, {
      commandId: "publish",
      type: "project.plan-publish",
      actor: { id: "agent:planner", origin: "agent" },
      issuedAt: generatedAt,
      appliedAt: generatedAt,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: "replaceable-plan:r3", revision: 3 },
    }],
  });
}
