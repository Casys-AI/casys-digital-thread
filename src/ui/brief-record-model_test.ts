import { assertEquals } from "@std/assert";
import type {
  EngineeringProjectFraming,
  ProjectBriefItemKind,
} from "../domain/project/project-brief.ts";
import { buildProjectBriefRecord } from "./src/project/brief-record-model.ts";

Deno.test("project brief record reads the approved canonical brief, not a pending proposal", () => {
  const record = buildProjectBriefRecord(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "pending",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
    },
  }));

  assertEquals(record?.revision, 2);
  assertEquals(record?.status, "discussion");
  assertEquals(record?.statusLabel, "Newer draft in discussion");
  assertEquals(record?.sections.map((section) => section.id), [
    "intent",
    "constraints",
    "limits",
  ]);
  assertEquals(
    record?.questionBranches.map((branch) => ({
      id: branch.successCriterionId,
      state: branch.state,
    })),
    [{
      id: "success-criterion-Retain a traceable path from intent to proof.",
      state: "declared",
    }],
  );
  assertEquals(record?.openQuestions, [
    "Which operating envelope should be verified first?",
  ]);
  assertEquals(record?.sourceLabels, [
    "Paired conversation",
    "Reviewed documents",
  ]);
});

Deno.test("project brief record is absent for a project without the V3 framing contract", () => {
  assertEquals(buildProjectBriefRecord(undefined), undefined);
});

Deno.test("a rejected brief revision is a request, not proof of active agent work", () => {
  const record = buildProjectBriefRecord(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "rejected",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
      decidedAt: "2026-08-03T10:05:00.000Z",
      decidedBy: { id: "human-reviewer", origin: "human" },
      rationale: "Please correct the scope.",
    },
  }));

  assertEquals(record?.revision, 2);
  assertEquals(record?.status, "revision-requested");
  assertEquals(record?.statusLabel, "Revision requested");
  assertEquals(
    record?.statusDetail,
    "The confirmed brief stays in force. A correction was requested; no active agent work is implied.",
  );
});

function framing(
  overrides: Partial<EngineeringProjectFraming> = {},
): EngineeringProjectFraming {
  return {
    intent: {
      statement: "Create a reviewable engineering system concept.",
      source: { kind: "human", reference: "conversation" },
      capturedAt: "2026-08-03T09:00:00.000Z",
      capturedBy: { id: "human-reviewer", origin: "human" },
    },
    questions: [{
      id: "operating-envelope",
      prompt: "Which operating envelope should be verified first?",
      whyItMatters: "It bounds the initial engineering evidence.",
      recommendation: {
        value: "bounded-demonstration",
        rationale: "A practical first proof scope.",
        confidence: "medium",
      },
      options: [{
        value: "bounded-demonstration",
        label: "Bounded demonstration",
        consequences: "Fits a practical first proof scope.",
      }],
      allowUnknown: true,
      risk: "material",
      evidenceNeeded: [],
      proposedAt: "2026-08-03T09:01:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    }],
    answers: [{
      id: "answer-operating-envelope",
      questionId: "operating-envelope",
      kind: "unknown",
      source: { kind: "human", reference: "conversation" },
      recordedAt: "2026-08-03T09:02:00.000Z",
      recordedBy: { id: "human-reviewer", origin: "human" },
    }],
    currentBrief: {
      briefId: "project-review:brief",
      id: "brief-snapshot-2",
      revision: 2,
      items: [
        item(
          "objective",
          "Build a system whose engineering choices are reviewable.",
        ),
        item(
          "mission-scenario",
          "Demonstrate a bounded operating scenario.",
          "document",
        ),
        item(
          "success-criterion",
          "Retain a traceable path from intent to proof.",
        ),
        item(
          "constraint",
          "Keep the first system within documented engineering limits.",
        ),
        item(
          "assumption",
          "A preliminary component set is available for the demonstrator.",
        ),
      ],
      proposedAt: "2026-08-03T09:03:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    },
    currentBriefApproval: {
      briefSnapshotId: "brief-snapshot-2",
      briefRevision: 2,
      status: "approved",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T09:04:00.000Z",
      decidedAt: "2026-08-03T09:05:00.000Z",
      decidedBy: { id: "human-reviewer", origin: "human" },
      rationale: "Agreed in conversation.",
    },
    proposedBrief: {
      briefId: "project-review:brief",
      id: "brief-snapshot-3",
      revision: 3,
      previous: { snapshotId: "brief-snapshot-2", revision: 2 },
      items: [
        item("objective", "This draft must not become visible as canonical."),
      ],
      proposedAt: "2026-08-03T10:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    },
    ...overrides,
  };
}

function item(
  kind: ProjectBriefItemKind,
  statement: string,
  source: "answer" | "document" = "answer",
) {
  return {
    id: `${kind}-${statement}`,
    kind,
    statement,
    sourceRefs: [{ kind: source, reference: source }],
  } as const;
}

function fingerprint() {
  return {
    algorithm: "sha256" as const,
    digest: "a".repeat(64),
  };
}
