import { assertEquals } from "@std/assert";
import type {
  EngineeringProjectFraming,
  ProjectBriefItemKind,
} from "../domain/project/project-brief.ts";
import {
  BRIEF_ELICITATION_CONFIRMATION_LABEL,
  buildProjectBriefElicitation,
} from "./src/project/brief-elicitation-model.ts";

Deno.test("pending proposal uses the assembling brief, not the canonical record", () => {
  const view = buildProjectBriefElicitation(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "pending",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
    },
  }));

  assertEquals(view?.status, "awaiting-review");
  assertEquals(view?.assemblingAuthority, "proposed");
  assertEquals(view?.revision, 3);
  assertEquals(view?.statusLabel, "Unconfirmed");
  assertEquals(view?.footerStatus, "Awaiting confirmation");
  assertEquals(view?.confirmationLabel, BRIEF_ELICITATION_CONFIRMATION_LABEL);
  assertEquals(view?.sections.map((section) => section.id), ["intent"]);
  assertEquals(view?.sections[0]?.items.map((item) => item.statement), [
    "This draft must not become visible as canonical.",
  ]);
  assertEquals(
    view?.sections.some((section) =>
      section.items.some((item) =>
        item.statement ===
          "Build a system whose engineering choices are reviewable."
      )
    ),
    false,
  );
});

Deno.test("an unknown answer stays an open framing question", () => {
  const view = buildProjectBriefElicitation(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "pending",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
    },
  }));
  const question = view?.questions.find((item) => item.id === "operating-envelope");

  assertEquals(question?.state, "open");
  assertEquals(question?.recordedValue, undefined);
  assertEquals(question?.recordedOpenCopy, undefined);
  assertEquals(view?.openCount, 1);
  assertEquals(view?.openCallouts, [
    "Which operating envelope should be verified first?",
  ]);
});

Deno.test("a provided answer appears on the left with its recorded value", () => {
  const view = buildProjectBriefElicitation(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "pending",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
    },
    questions: [
      {
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
      },
      {
        id: "first-proof-scope",
        prompt: "Which proof scope should be recorded first?",
        whyItMatters: "It sets the first reviewable verification bound.",
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
      },
    ],
    answers: [
      {
        id: "answer-operating-envelope",
        questionId: "operating-envelope",
        kind: "unknown",
        source: { kind: "human", reference: "conversation" },
        recordedAt: "2026-08-03T09:02:00.000Z",
        recordedBy: { id: "human-reviewer", origin: "human" },
      },
      {
        id: "answer-first-proof-scope",
        questionId: "first-proof-scope",
        kind: "provided",
        value: "Bounded demonstration",
        explanation: "A practical first proof scope.",
        source: { kind: "human", reference: "conversation" },
        recordedAt: "2026-08-03T09:02:30.000Z",
        recordedBy: { id: "human-reviewer", origin: "human" },
      },
    ],
  }));
  const answered = view?.questions.find((item) => item.id === "first-proof-scope");
  const open = view?.questions.find((item) => item.id === "operating-envelope");

  assertEquals(view?.questions.length, 2);
  assertEquals(answered?.state, "answered");
  assertEquals(answered?.recordedValue, "Bounded demonstration");
  assertEquals(answered?.recordedExplanation, "A practical first proof scope.");
  assertEquals(open?.state, "open");
  assertEquals(view?.answeredCount, 1);
  assertEquals(view?.openCount, 1);
});

Deno.test("a rejected proposal stays proposed, never the approved record", () => {
  const view = buildProjectBriefElicitation(framing({
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

  assertEquals(view?.status, "revision-requested");
  assertEquals(view?.assemblingAuthority, "proposed");
  assertEquals(view?.revision, 3);
  assertEquals(view?.statusLabel, "Revision requested");
});

Deno.test("assembling items keep recorded source labels and open-question statements", () => {
  const view = buildProjectBriefElicitation(framing({
    proposalReview: {
      briefSnapshotId: "brief-snapshot-3",
      briefRevision: 3,
      status: "pending",
      inputFingerprint: fingerprint(),
      requestedAt: "2026-08-03T10:00:00.000Z",
    },
    proposedBrief: {
      briefId: "project-review:brief",
      id: "brief-snapshot-3",
      revision: 3,
      previous: { snapshotId: "brief-snapshot-2", revision: 2 },
      items: [
        item(
          "objective",
          "This draft must not become visible as canonical.",
        ),
        item(
          "constraint",
          "Keep the first system within documented engineering limits.",
          "document",
        ),
        item(
          "open-question",
          "Which operating envelope should be verified first?",
        ),
      ],
      proposedAt: "2026-08-03T10:00:00.000Z",
      proposedBy: { id: "agent", origin: "agent" },
    },
  }));
  const constraint = view?.sections
    .flatMap((section) => section.items)
    .find((item) => item.statement.startsWith("Keep the first system"));

  assertEquals(view?.sections.map((section) => section.id), [
    "intent",
    "constraints",
  ]);
  assertEquals(constraint?.sourceLabels, ["Document"]);
  assertEquals(view?.openCallouts, [
    "Which operating envelope should be verified first?",
  ]);
});

Deno.test("an approved brief has no elicitation projection", () => {
  assertEquals(buildProjectBriefElicitation(framing()), undefined);
  assertEquals(buildProjectBriefElicitation(undefined), undefined);
});

Deno.test("framing without a brief keeps the empty assembling column", () => {
  const view = buildProjectBriefElicitation({
    intent: {
      statement: "Create a reviewable engineering system concept.",
      source: { kind: "human", reference: "conversation" },
      capturedAt: "2026-08-03T09:00:00.000Z",
      capturedBy: { id: "human-reviewer", origin: "human" },
    },
    questions: framing().questions,
    answers: framing().answers,
  });

  assertEquals(view?.status, "framing");
  assertEquals(view?.assemblingAuthority, "empty");
  assertEquals(view?.revision, undefined);
  assertEquals(view?.sections, []);
  assertEquals(view?.openCallouts, []);
  assertEquals(view?.questions[0]?.state, "open");
});

Deno.test("brief elicitation sources never copy the mockup AV strings", async () => {
  const files = [
    new URL("./src/project/brief-elicitation-model.ts", import.meta.url),
    new URL("./src/project/brief-elicitation.tsx", import.meta.url),
  ];
  for (const file of files) {
    const source = await Deno.readTextFile(file);
    for (const forbidden of ["AV-114", "9 g", "REQ-M-001"]) {
      assertEquals(
        source.includes(forbidden),
        false,
        `${file.pathname} ${forbidden}`,
      );
    }
  }
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
