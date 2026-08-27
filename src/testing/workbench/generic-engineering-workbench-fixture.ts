import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import {
  type EngineeringEvidenceWorkbenchSnapshot,
} from "../../presentation/workbench/engineering/evidence.ts";
import { LIVE_THREAD_OVERLAY_SCHEMA } from "../../presentation/workbench/engineering/schema.ts";
import { GENERIC_THREAD_FIXTURE } from "./generic-thread-workbench-fixture.ts";

/** Labelled UI fallback. It demonstrates project control, never production truth. */
export const GENERIC_PROJECT_FIXTURE: EngineeringProjectSnapshot = {
  schemaVersion: "4.0",
  id: "project-snapshot-generic-fixture",
  revision: 1,
  generatedAt: GENERIC_THREAD_FIXTURE.generatedAt,
  project: {
    id: "project-generic-fixture",
    name: "Generic Product GEN-01",
    subjectId: GENERIC_THREAD_FIXTURE.subject.id,
    objective: {
      title: "Build a verifiable generic-product demonstrator",
      statement:
        "Connect system intent, product geometry, simulation evidence and industrial records so every engineering decision can be reviewed against exact inputs.",
    },
  },
  framing: {
    intent: {
      statement:
        "Connect system intent, product geometry, simulation evidence and industrial records so every engineering decision can be reviewed against exact inputs.",
      source: { kind: "human", reference: "paired-conversation" },
      capturedAt: GENERIC_THREAD_FIXTURE.generatedAt,
      capturedBy: { id: "human:owner", origin: "human" },
    },
    questions: [],
    answers: [],
    currentBrief: {
      briefId: "project-generic-fixture:brief",
      id: "project-generic-fixture:brief:r1:fixture",
      revision: 1,
      items: [{
        id: "objective",
        kind: "objective",
        statement:
          "Connect system intent, product geometry, simulation evidence and industrial records so every engineering decision can be reviewed against exact inputs.",
        sourceRefs: [{ kind: "intent", reference: "paired-conversation" }],
      }],
      proposedAt: GENERIC_THREAD_FIXTURE.generatedAt,
      proposedBy: { id: "agent:planner", origin: "agent" },
    },
    currentBriefApproval: {
      briefSnapshotId: "project-generic-fixture:brief:r1:fixture",
      briefRevision: 1,
      status: "approved",
      inputFingerprint: { algorithm: "sha256", digest: "e".repeat(64) },
      requestedAt: GENERIC_THREAD_FIXTURE.generatedAt,
      decidedAt: GENERIC_THREAD_FIXTURE.generatedAt,
      decidedBy: { id: "human:owner", origin: "human" },
      rationale: "Confirmed in the paired conversation.",
    },
  },
  threadSnapshots: [{
    snapshotId: GENERIC_THREAD_FIXTURE.id,
    revision: 1,
    subjectId: GENERIC_THREAD_FIXTURE.subject.id,
  }],
  phases: [
    phase("define", "Define", 1, ["work-define"], [], "change", "CHG-184"),
    phase(
      "architect",
      "Architect",
      2,
      ["work-architect"],
      [],
      "artifact",
      "ART-SYSML-018",
    ),
    phase(
      "design",
      "Design",
      3,
      ["work-design"],
      [],
      "artifact",
      "ART-CAD-018",
    ),
    phase("simulate", "Simulate", 4, ["work-simulate"], [
      "decision-mechanical-inputs",
    ]),
    phase("verify", "Verify", 5, ["work-verify"]),
    phase("industrialize", "Industrialize", 6, ["work-industrialize"]),
  ],
  workItems: [
    work(
      "work-define",
      "define",
      "Frame the system objective",
      "completed",
      "shared",
    ),
    work(
      "work-architect",
      "architect",
      "Establish the SysML structure",
      "completed",
      "agent",
    ),
    work(
      "work-design",
      "design",
      "Produce linked product geometry",
      "completed",
      "agent",
    ),
    {
      ...work(
        "work-simulate",
        "simulate",
        "Prepare mechanical verification inputs",
        "waiting-for-decision",
        "shared",
      ),
      dependsOnWorkItemIds: ["work-design"],
      decisionIds: ["decision-mechanical-inputs"],
      blockerIds: ["blocker-mechanical-inputs"],
    },
    {
      ...work(
        "work-verify",
        "verify",
        "Evaluate model requirements",
        "planned",
        "agent",
      ),
      dependsOnWorkItemIds: ["work-simulate"],
      blockerIds: ["blocker-mechanical-inputs"],
    },
    {
      ...work(
        "work-industrialize",
        "industrialize",
        "Reconcile the manufacturing record",
        "planned",
        "shared",
      ),
      dependsOnWorkItemIds: ["work-verify"],
    },
  ],
  agentRuns: [{
    id: "agent-run-mechanical-fixture",
    workItemId: "work-simulate",
    status: "waiting-for-decision",
    summary: "Mechanical verification is waiting for reviewed analysis inputs.",
    queuedAt: "2026-08-01T08:40:00.000Z",
    startedAt: "2026-08-01T08:40:03.000Z",
    basis: {
      kind: "thread-snapshot",
      snapshotId: GENERIC_THREAD_FIXTURE.id,
      revision: 1,
      subjectId: GENERIC_THREAD_FIXTURE.subject.id,
    },
    inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
    evidenceRefs: [],
  }],
  decisions: [{
    id: "decision-mechanical-inputs",
    phaseId: "simulate",
    title: "Mechanical reference case",
    question:
      "Which material, supports, loads and model-owned acceptance criterion should govern the reference calculation?",
    status: "required",
    requestedAt: "2026-08-01T08:40:04.000Z",
    inputEvidenceRefs: [],
    approvalIds: ["approval-mechanical-inputs"],
  }],
  approvals: [{
    id: "approval-mechanical-inputs",
    decisionId: "decision-mechanical-inputs",
    status: "pending",
    requestedAt: "2026-08-01T08:40:04.000Z",
    inputEvidenceRefs: [],
  }],
  blockers: [{
    id: "blocker-mechanical-inputs",
    phaseId: "simulate",
    title: "Reference case is not reviewed",
    description:
      "The solver must not run until material, supports, loads and the acceptance criterion are explicit.",
    kind: "decision-required",
    status: "open",
    openedAt: "2026-08-01T08:40:04.000Z",
    workItemIds: ["work-simulate", "work-verify"],
    decisionIds: ["decision-mechanical-inputs"],
  }],
};

export const GENERIC_ENGINEERING_WORKBENCH_FIXTURE:
  EngineeringEvidenceWorkbenchSnapshot = {
    schemaVersion: "engineering-workbench/0.6",
    surface: "evidence",
    project: GENERIC_PROJECT_FIXTURE,
    thread: {
      ...GENERIC_THREAD_FIXTURE,
      live: {
        schemaVersion: LIVE_THREAD_OVERLAY_SCHEMA,
        version: 0,
        active: [],
      },
    },
    projectPath: {
      phaseLanes: [
        { phaseId: "define", lane: "requirements" },
        { phaseId: "architect", lane: "system-model" },
        { phaseId: "design", lane: "geometry" },
        { phaseId: "simulate", lane: "physics" },
        { phaseId: "verify", lane: "verdicts" },
        { phaseId: "industrialize", lane: "physics" },
      ],
      activities: [
        {
          id: "activity:work-define",
          lane: "requirements",
          rootRevisionId: "work-define",
          revisionIds: ["work-define"],
        },
        {
          id: "activity:work-architect",
          lane: "system-model",
          rootRevisionId: "work-architect",
          revisionIds: ["work-architect"],
        },
        {
          id: "activity:work-design",
          lane: "geometry",
          rootRevisionId: "work-design",
          revisionIds: ["work-design"],
        },
        {
          id: "activity:work-simulate",
          lane: "physics",
          rootRevisionId: "work-simulate",
          revisionIds: ["work-simulate"],
        },
        {
          id: "activity:work-verify",
          lane: "verdicts",
          rootRevisionId: "work-verify",
          revisionIds: ["work-verify"],
        },
        {
          id: "activity:work-industrialize",
          lane: "physics",
          rootRevisionId: "work-industrialize",
          revisionIds: ["work-industrialize"],
        },
      ],
    },
    alignment: {
      status: "aligned",
      projectThreadRevision: 1,
      currentThreadRevision: 1,
    },
    caseActivityJoins: [],
    unresolvedEvidenceReferences: [],
  };

function phase(
  id: EngineeringProjectSnapshot["phases"][number]["id"],
  name: string,
  order: number,
  workItemIds: string[],
  requiredDecisionIds: string[] = [],
  evidenceKind?: EngineeringProjectSnapshot["phases"][number]["evidenceRefs"][number][
    "kind"
  ],
  evidenceId?: string,
): EngineeringProjectSnapshot["phases"][number] {
  return {
    id,
    name,
    order,
    description: `${name} the linked engineering subject.`,
    workItemIds,
    requiredDecisionIds,
    evidenceRefs: evidenceKind && evidenceId
      ? [{
        snapshotId: GENERIC_THREAD_FIXTURE.id,
        snapshotRevision: 1,
        kind: evidenceKind,
        id: evidenceId,
      }]
      : [],
  };
}

function work(
  id: string,
  phaseId: string,
  title: string,
  status: EngineeringProjectSnapshot["workItems"][number]["status"],
  owner: EngineeringProjectSnapshot["workItems"][number]["owner"],
): EngineeringProjectSnapshot["workItems"][number] {
  return {
    id,
    activityId: `activity:${id}`,
    phaseId,
    title,
    description: title,
    kind: phaseId as EngineeringProjectSnapshot["workItems"][number]["kind"],
    status,
    owner,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
  };
}
