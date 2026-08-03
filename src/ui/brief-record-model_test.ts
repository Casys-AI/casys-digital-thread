import { assertEquals } from "@std/assert";
import type {
  EngineeringProjectFraming,
  ProjectBriefItemKind,
} from "../domain/project-brief.ts";
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
    "success",
    "constraints",
    "limits",
  ]);
  assertEquals(record?.openQuestions, [
    "Which flight endurance should be verified first?",
  ]);
  assertEquals(record?.sourceLabels, [
    "Paired conversation",
    "Reviewed documents",
  ]);
});

Deno.test("project brief record is absent for a project without the V3 framing contract", () => {
  assertEquals(buildProjectBriefRecord(undefined), undefined);
});

function framing(
  overrides: Partial<EngineeringProjectFraming> = {},
): EngineeringProjectFraming {
  return {
    intent: {
      statement: "Create a reviewable inspection drone concept.",
      source: { kind: "human", reference: "conversation" },
      capturedAt: "2026-08-03T09:00:00.000Z",
      capturedBy: { id: "erwan", origin: "human" },
    },
    questions: [{
      id: "endurance",
      prompt: "Which flight endurance should be verified first?",
      whyItMatters: "It drives the energy and mass budget.",
      recommendation: {
        value: "20-minutes",
        rationale: "A practical first demonstrator target.",
        confidence: "medium",
      },
      options: [{
        value: "20-minutes",
        label: "20 minutes",
        consequences: "Fits a practical first demonstrator.",
      }],
      allowUnknown: true,
      risk: "material",
      evidenceNeeded: [],
      proposedAt: "2026-08-03T09:01:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    }],
    answers: [{
      id: "answer-endurance",
      questionId: "endurance",
      kind: "unknown",
      source: { kind: "human", reference: "conversation" },
      recordedAt: "2026-08-03T09:02:00.000Z",
      recordedBy: { id: "erwan", origin: "human" },
    }],
    currentBrief: {
      briefId: "inspection-drone:brief",
      id: "brief-snapshot-2",
      revision: 2,
      items: [
        item(
          "objective",
          "Build a drone whose engineering choices are reviewable.",
        ),
        item(
          "mission-scenario",
          "Inspect a bounded industrial site.",
          "document",
        ),
        item(
          "success-criterion",
          "Retain a traceable path from intent to proof.",
        ),
        item(
          "constraint",
          "Keep the first airframe within a documented mass budget.",
        ),
        item(
          "assumption",
          "A preliminary battery pack is available for the demonstrator.",
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
      decidedBy: { id: "erwan", origin: "human" },
      rationale: "Agreed in conversation.",
    },
    proposedBrief: {
      briefId: "inspection-drone:brief",
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
