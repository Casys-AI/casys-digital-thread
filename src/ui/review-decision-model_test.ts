import { assertEquals } from "@std/assert";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  activityReviewStatus,
  activityReviewStatusLabel,
  buildActivityReviewRecords,
  buildProjectReviewRecords,
  currentProjectReview,
} from "./src/project/review-decision-model.ts";
import type { ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);
const HEX_C = "c".repeat(64);

Deno.test("pending brief keeps its exact generic review identity", () => {
  const project = projectSnapshot();
  const records = buildProjectReviewRecords(project);
  const brief = records[0]!;

  assertEquals(brief.id, "brief");
  assertEquals(brief.recordId, "brief:r2");
  assertEquals(brief.state, "needs-review");
  assertEquals(brief.representation, "proposal");
  assertEquals(currentProjectReview(records)?.recordId, "brief:r2");
  assertEquals(project.framing?.currentBrief?.revision, 1);
  assertEquals(Object.hasOwn(brief, "preview"), false);
});

Deno.test("rejected brief revision preserves the approved subject and human outcome", () => {
  const project = projectSnapshot();
  const brief = buildProjectReviewRecords({
    ...project,
    framing: {
      ...project.framing!,
      proposalReview: {
        ...project.framing!.proposalReview!,
        status: "rejected",
        decidedAt: "2026-08-02T01:00:00.000Z",
        decidedBy: { id: "reviewer", origin: "human" },
        rationale: "Correct the scope.",
      },
    },
  })[0]!;

  assertEquals(brief.recordId, "brief:r1");
  assertEquals(brief.state, "revision-requested");
  assertEquals(brief.representation, "record");
  assertEquals(
    brief.title,
    "Approved engineering brief · revision requested",
  );
  assertEquals(
    brief.question,
    "A proposed revision was rejected; the approved brief remains in force.",
  );
  assertEquals(brief.outcome, {
    rationale: "Correct the scope.",
    decidedBy: "reviewer",
    decidedAt: "2026-08-02T01:00:00.000Z",
  });
});

Deno.test("rejected initial brief keeps the proposed subject without inventing approval", () => {
  const project = projectSnapshot();
  const {
    currentBrief: _currentBrief,
    currentBriefApproval: _currentBriefApproval,
    ...framing
  } = project.framing!;
  const brief = buildProjectReviewRecords({
    ...project,
    framing: {
      ...framing,
      proposalReview: {
        ...framing.proposalReview!,
        status: "rejected",
        decidedAt: "2026-08-02T01:00:00.000Z",
        decidedBy: { id: "reviewer", origin: "human" },
        rationale: "Correct the initial scope.",
      },
    },
  })[0]!;

  assertEquals(brief.recordId, "brief:r2");
  assertEquals(brief.state, "revision-requested");
  assertEquals(brief.title, "Engineering brief proposal · revision requested");
  assertEquals(
    brief.summary,
    "A correction was requested. No approved brief or active agent work is implied.",
  );
});

Deno.test("domain proposal parameters remain opaque to generic review records", () => {
  const project = projectSnapshot();
  const architecture = project.decisions.find((decision) =>
    decision.id === "decision-architecture"
  )!;
  const records = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === architecture.id
        ? {
          ...decision,
          proposal: {
            ...decision.proposal!,
            parameters: [{ key: "anything", label: "Opaque", value: true }, {
              key: "anything",
              label: "Still opaque",
              value: false,
            }],
          },
        }
        : decision
    ),
  });

  for (const kind of ["architecture", "requirements", "geometry"] as const) {
    const record = records.find((candidate) => candidate.id === kind)!;
    assertEquals(record.recordId, `decision-${kind}`);
    assertEquals(record.state, "needs-review");
    assertEquals(Object.hasOwn(record, "preview"), false);
  }
});

Deno.test("replayed proposal exposes only its exact current pending approval", () => {
  const project = projectSnapshot();
  const fingerprint = { algorithm: "sha256" as const, digest: HEX_A };
  const decision = project.decisions.find((candidate) =>
    candidate.id === "decision-architecture"
  )!;
  const record = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((candidate) =>
      candidate.id === decision.id
        ? {
          ...candidate,
          inputFingerprint: fingerprint,
          approvalIds: ["approval-old", "approval-current"],
        }
        : candidate
    ),
    approvals: [{
      id: "approval-old",
      decisionId: decision.id,
      status: "rejected",
      requestedAt: "2026-08-03T00:00:00.000Z",
      decidedAt: "2026-08-03T00:30:00.000Z",
      decidedBy: "reviewer-1",
      rationale: "Revise it.",
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }, {
      id: "approval-current",
      decisionId: decision.id,
      status: "pending",
      requestedAt: "2026-08-03T01:00:00.000Z",
      inputFingerprint: fingerprint,
      inputEvidenceRefs: [],
    }],
  }).find((candidate) => candidate.id === "architecture")!;

  assertEquals(record.state, "needs-review");
  assertEquals(record.approvalId, "approval-current");
});

Deno.test("canonical decision outcome exposes its recorded rationale actor and time", () => {
  const project = projectSnapshot();
  const architecture = project.decisions.find((decision) =>
    decision.id === "decision-architecture"
  )!;
  const record = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === architecture.id
        ? {
          ...decision,
          status: "approved" as const,
          approvalIds: ["approval-architecture"],
        }
        : decision
    ),
    approvals: [{
      id: "approval-architecture",
      decisionId: architecture.id,
      status: "approved",
      requestedAt: "2026-08-03T00:00:00.000Z",
      decidedAt: "2026-08-03T01:00:00.000Z",
      decidedBy: "reviewer-1",
      rationale: "The exact architecture matches the intended product.",
      inputEvidenceRefs: [],
    }],
  }).find((candidate) => candidate.id === "architecture")!;

  assertEquals(record.state, "approved-awaiting-result");
  assertEquals(record.outcome, {
    rationale: "The exact architecture matches the intended product.",
    decidedBy: "reviewer-1",
    decidedAt: "2026-08-03T01:00:00.000Z",
  });
});

Deno.test("published state stays separate from exact visible result evidence", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const withoutCapture = buildProjectReviewRecords(project, threadSnapshot())
    .find((record) => record.id === "geometry")!;
  const withCapture = buildProjectReviewRecords(
    project,
    threadWithEvidence("geometry-artifact"),
  ).find((record) => record.id === "geometry")!;

  assertEquals(withoutCapture.state, "published");
  assertEquals(withoutCapture.representation, "published-result");
  assertEquals(withoutCapture.resultEvidence, undefined);
  assertEquals(withCapture.resultEvidence?.id, "geometry-artifact");
  assertEquals(Object.hasOwn(withCapture, "preview"), false);
});

Deno.test("Activity exposes one waiting state and two human review outcomes", () => {
  const proposed = buildProjectReviewRecords(projectSnapshot()).find((record) =>
    record.id === "architecture"
  )!;
  const project = projectSnapshot();
  const rejected = buildProjectReviewRecords({
    ...project,
    decisions: project.decisions.map((decision) =>
      decision.id === "decision-architecture"
        ? { ...decision, status: "rejected" as const }
        : decision
    ),
  }).find((record) => record.id === "architecture")!;
  const published = buildProjectReviewRecords(
    projectSnapshot({ publishedRequirements: true }),
  ).find((record) => record.id === "requirements")!;

  assertEquals(activityReviewStatus(proposed), "to-review");
  assertEquals(activityReviewStatus(rejected), "revision-requested");
  assertEquals(activityReviewStatus(published), "validated");
  assertEquals(activityReviewStatusLabel("to-review"), "To review");
  assertEquals(activityReviewStatusLabel("validated"), "Validated");
  assertEquals(
    activityReviewStatusLabel("revision-requested"),
    "Revision requested",
  );
});

Deno.test("Activity preserves successive reviews with unique stable generic anchors", () => {
  const project = projectSnapshot({ publishedGeometry: true });
  const geometryWork = project.workItems.find((item) => item.id === "geometry")!;
  const geometryDecision = project.decisions.find((decision) =>
    decision.id === "decision-geometry"
  )!;
  const activity = buildActivityReviewRecords({
    ...project,
    workItems: [...project.workItems, {
      ...geometryWork,
      id: "geometry-v2",
      title: "geometry-v2",
      decisionIds: ["decision-geometry-v2"],
      evidenceRefs: [{
        snapshotId: "thread:r6",
        snapshotRevision: 6,
        kind: "artifact",
        id: "geometry-v2-artifact",
      }],
    }],
    decisions: [...project.decisions, {
      ...geometryDecision,
      id: "decision-geometry-v2",
      title: "geometry-v2",
      requestedAt: "2026-08-04T00:00:00.000Z",
      proposal: {
        ...geometryDecision.proposal!,
        proposedAt: "2026-08-04T00:00:00.000Z",
      },
    }],
  }).filter((record) => record.id === "geometry");

  assertEquals(activity.length, 2);
  assertEquals(new Set(activity.map((record) => record.anchorId)).size, 2);
  assertEquals(
    activity.find((record) => record.recordId === "decision-geometry-v2")
      ?.anchorId,
    "review-geometry",
  );
  assertEquals(
    activity.find((record) => record.recordId === "decision-geometry")
      ?.anchorId,
    "review-geometry-history-decision-geometry",
  );
});

Deno.test("Activity keeps approved brief chronology beside a pending revision", () => {
  const briefs = buildActivityReviewRecords(projectSnapshot()).filter((
    record,
  ) => record.id === "brief");

  assertEquals(briefs.map((record) => record.recordId), [
    "brief:r1",
    "brief:r2",
  ]);
  assertEquals(briefs.map((record) => record.state), [
    "published",
    "needs-review",
  ]);
  assertEquals(new Set(briefs.map((record) => record.anchorId)).size, 2);
  assertEquals(
    briefs.find((record) => record.state === "needs-review")?.anchorId,
    "review-brief",
  );
});

function projectSnapshot(
  options: {
    publishedGeometry?: boolean;
    publishedRequirements?: boolean;
  } = {},
): EngineeringProjectSnapshot {
  const brief = (revision: number) => ({
    briefId: "brief",
    id: `brief:r${revision}`,
    revision,
    items: [{
      id: `objective-${revision}`,
      kind: "objective" as const,
      statement: `Objective ${revision}`,
      sourceRefs: [{ kind: "intent" as const, reference: "conversation" }],
    }],
    proposedAt: `2026-08-0${revision}T00:00:00.000Z`,
    proposedBy: { id: "agent", origin: "agent" as const },
  });
  const work = (
    id: string,
    operationId: string,
    decisionIds: string[],
    published = false,
  ) => ({
    id,
    activityId: `activity:${id}`,
    phaseId: id,
    title: id,
    description: id,
    kind: "architect" as const,
    operation: { id: operationId, version: "1", bindings: [] },
    status: published ? "completed" as const : "waiting-for-decision" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: published
      ? [{
        snapshotId: "thread:r5",
        snapshotRevision: 5,
        kind: "artifact" as const,
        id: `${id}-artifact`,
      }]
      : [],
    decisionIds,
    blockerIds: [],
  });
  const proposal = (id: string, value: string) => ({
    id,
    phaseId: id,
    title: id,
    question: `${id}?`,
    status: (options.publishedGeometry && id === "decision-geometry") ||
        (options.publishedRequirements && id === "decision-requirements")
      ? "approved" as const
      : "proposed" as const,
    requestedAt: "2026-08-03T00:00:00.000Z",
    inputEvidenceRefs: [],
    approvalIds: [],
    proposal: {
      summary: id,
      parameters: [{ key: "opaque", label: "Opaque", value }],
      proposedAt: "2026-08-03T00:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" as const },
    },
  });
  return {
    schemaVersion: "4.0",
    id: "project:r1",
    revision: 1,
    generatedAt: "2026-08-03T00:00:00.000Z",
    project: {
      id: "project",
      name: "Project",
      subjectId: "subject",
      objective: { title: "Project", statement: "Project" },
    },
    framing: {
      intent: {
        statement: "Intent",
        source: { kind: "human", reference: "conversation" },
        capturedAt: "2026-08-01T00:00:00.000Z",
        capturedBy: { id: "agent", origin: "agent" },
      },
      questions: [],
      answers: [],
      currentBrief: brief(1),
      currentBriefApproval: {
        briefSnapshotId: "brief:r1",
        briefRevision: 1,
        status: "approved",
        inputFingerprint: { algorithm: "sha256", digest: HEX_C },
        requestedAt: "2026-08-01T00:00:00.000Z",
      },
      proposedBrief: brief(2),
      proposalReview: {
        briefSnapshotId: "brief:r2",
        briefRevision: 2,
        status: "pending",
        inputFingerprint: { algorithm: "sha256", digest: HEX_B },
        requestedAt: "2026-08-02T00:00:00.000Z",
      },
    },
    threadSnapshots: [],
    phases: [],
    workItems: [
      work("baseline", "baseline.from-approved-brief", [], true),
      work("architecture", "model.write-architecture", [
        "decision-architecture",
      ]),
      work(
        "requirements",
        "model.write-requirements",
        ["decision-requirements"],
        options.publishedRequirements,
      ),
      work(
        "geometry",
        "design.write-geometry",
        ["decision-geometry"],
        options.publishedGeometry,
      ),
    ],
    agentRuns: [],
    decisions: [
      proposal("decision-architecture", "architecture-owned-by-app"),
      proposal("decision-requirements", "requirements-owned-by-app"),
      proposal("decision-geometry", "geometry-owned-by-app"),
    ],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as EngineeringProjectSnapshot;
}

function threadSnapshot(): ThreadWorkbenchSnapshot {
  return {
    graph: { nodes: [], edges: [] },
  } as unknown as ThreadWorkbenchSnapshot;
}

function threadWithEvidence(id: string): ThreadWorkbenchSnapshot {
  return {
    graph: {
      nodes: [{
        id: `graph:artifact:${id}`,
        ref: { kind: "artifact", id },
        entityKind: "artifact",
        artifactKind: "document",
        label: "Published capture",
        system: "digital-thread",
        freshness: "fresh",
        summary: "Exact published capture",
        recordedAt: "2026-08-05T00:00:00.000Z",
      }],
      edges: [],
    },
  } as unknown as ThreadWorkbenchSnapshot;
}
