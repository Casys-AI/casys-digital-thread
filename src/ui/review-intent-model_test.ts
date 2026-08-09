import { assertEquals, assertThrows } from "@std/assert";
import type { ProjectReviewIntentRecord } from "../domain/project/project-review-intent.ts";
import {
  activityReviewDisplayStatusLabel,
  buildReviewIntent,
  effectiveActivityReviewStatus,
  indexReviewIntentRecords,
  reattachReviewIntent,
  ReviewIntentCommentError,
  reviewIntentScopeKey,
  shouldPollReviewIntentReceipts,
} from "./src/project/review-intent-model.ts";

const FINGERPRINT_A = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};
const FINGERPRINT_B = {
  algorithm: "sha256" as const,
  digest: "b".repeat(64),
};

Deno.test("validation builds the exact intent body and keeps its optional comment", () => {
  assertEquals(
    buildReviewIntent({
      intentId: "intent-1",
      projectId: "project-1",
      expectedRevision: 12,
      decisionId: "decision-1",
      approvalId: "approval-1",
      inputFingerprint: FINGERPRINT_A,
      action: "validate",
      comment: "  Looks correct.  ",
      submittedAt: "2026-08-09T12:00:00.000Z",
    }),
    {
      intentId: "intent-1",
      projectId: "project-1",
      expectedRevision: 12,
      decisionId: "decision-1",
      approvalId: "approval-1",
      inputFingerprint: FINGERPRINT_A,
      action: "validate",
      comment: "  Looks correct.  ",
      submittedAt: "2026-08-09T12:00:00.000Z",
    },
  );

  const withoutComment = buildReviewIntent({
    intentId: "intent-2",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
    approvalId: "approval-1",
    inputFingerprint: FINGERPRINT_A,
    action: "validate",
    comment: "   ",
    submittedAt: "2026-08-09T12:01:00.000Z",
  });
  assertEquals(Object.hasOwn(withoutComment, "comment"), false);
});

Deno.test("intent construction canonicalizes an uppercase project digest", () => {
  const projectFingerprint = {
    algorithm: "sha256" as const,
    digest: "ABCDEF".repeat(10) + "ABCD",
  };

  const intent = buildReviewIntent({
    intentId: "intent-uppercase",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
    approvalId: "approval-1",
    inputFingerprint: projectFingerprint,
    action: "validate",
    submittedAt: "2026-08-09T12:00:00.000Z",
  });

  assertEquals(projectFingerprint.digest, "ABCDEF".repeat(10) + "ABCD");
  assertEquals(
    intent.inputFingerprint.digest,
    projectFingerprint.digest.toLowerCase(),
  );
});

Deno.test("revision intent requires a non-blank comment of at most 2000 code points", () => {
  const input = {
    intentId: "intent-1",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
    approvalId: "approval-1",
    inputFingerprint: FINGERPRINT_A,
    action: "request-revision" as const,
    submittedAt: "2026-08-09T12:00:00.000Z",
  };
  assertThrows(
    () => buildReviewIntent({ ...input, comment: "  " }),
    ReviewIntentCommentError,
    "Describe what should change",
  );
  assertEquals(
    buildReviewIntent({ ...input, comment: "🙂".repeat(2_000) }).comment,
    "🙂".repeat(2_000),
  );
  assertThrows(
    () => buildReviewIntent({ ...input, comment: "🙂".repeat(2_001) }),
    ReviewIntentCommentError,
    "2000",
  );
});

Deno.test("transport replaces only To review while canonical outcomes always win", () => {
  const sending = {
    kind: "sending" as const,
    intent: buildReviewIntent({
      intentId: "intent-sending",
      projectId: "project-1",
      expectedRevision: 12,
      decisionId: "decision-1",
      approvalId: "approval-1",
      inputFingerprint: FINGERPRINT_A,
      action: "validate",
      submittedAt: "2026-08-09T12:00:00.000Z",
    }),
  };
  const sent = {
    kind: "queued" as const,
    record: record(
      "intent-sent",
      FINGERPRINT_A,
      "2026-08-09T12:01:00.000Z",
    ),
  };
  const received = {
    kind: "acknowledged" as const,
    record: record(
      "intent-received",
      FINGERPRINT_A,
      "2026-08-09T12:02:00.000Z",
      true,
    ),
  };

  assertEquals(effectiveActivityReviewStatus("to-review", sending), "sending");
  assertEquals(effectiveActivityReviewStatus("to-review", sent), "sent");
  assertEquals(
    effectiveActivityReviewStatus("to-review", received),
    "received",
  );
  assertEquals(effectiveActivityReviewStatus("validated", sent), "validated");
  assertEquals(
    effectiveActivityReviewStatus("revision-requested", received),
    "revision-requested",
  );
  assertEquals(activityReviewDisplayStatusLabel("sent"), "Sent");
  assertEquals(activityReviewDisplayStatusLabel("received"), "Received");
});

Deno.test("reload reattaches only the latest exact decision and fingerprint", () => {
  const older = record("intent-old", FINGERPRINT_A, "2026-08-09T12:00:00.000Z");
  const current = record(
    "intent-current",
    FINGERPRINT_A,
    "2026-08-09T12:01:00.000Z",
    true,
  );
  const successor = record(
    "intent-successor",
    FINGERPRINT_B,
    "2026-08-09T12:02:00.000Z",
  );

  const exact = reattachReviewIntent(
    [successor, current, older],
    "project-1",
    "decision-1",
    FINGERPRINT_A,
    "approval-1",
  );
  assertEquals(exact.kind, "acknowledged");
  if (exact.kind === "acknowledged") {
    assertEquals(exact.record.intent.intentId, "intent-current");
  }

  const index = indexReviewIntentRecords([older, current, successor]);
  assertEquals(index.size, 2);
  assertEquals(
    index.get(reviewIntentScopeKey(
      "project-1",
      "decision-1",
      FINGERPRINT_B,
      "approval-1",
    ))?.kind,
    "queued",
  );
});

Deno.test("a replayed approval never reattaches Sent from the same decision and fingerprint", () => {
  const oldSent = record(
    "intent-old-approval",
    FINGERPRINT_A,
    "2026-08-09T12:00:00.000Z",
    false,
    "approval-1",
  );

  assertEquals(
    reattachReviewIntent(
      [oldSent],
      "project-1",
      "decision-1",
      FINGERPRINT_A,
      "approval-2",
    ),
    { kind: "idle" },
  );
  const index = indexReviewIntentRecords([oldSent]);
  assertEquals(
    index.has(reviewIntentScopeKey(
      "project-1",
      "decision-1",
      FINGERPRINT_A,
      "approval-2",
    )),
    false,
  );
});

Deno.test("project focus isolates Sent and retry for an otherwise identical scope", () => {
  const sentA = record(
    "intent-project-a",
    FINGERPRINT_A,
    "2026-08-09T12:00:00.000Z",
    false,
    "approval-1",
    "project-a",
  );
  const sentB = record(
    "intent-project-b",
    FINGERPRINT_A,
    "2026-08-09T12:01:00.000Z",
    false,
    "approval-1",
    "project-b",
  );
  const scopeA = reviewIntentScopeKey(
    "project-a",
    "decision-1",
    FINGERPRINT_A,
    "approval-1",
  );
  const scopeB = reviewIntentScopeKey(
    "project-b",
    "decision-1",
    FINGERPRINT_A,
    "approval-1",
  );
  const failedA = new Map([
    [scopeA, {
      kind: "error" as const,
      message: "Network unavailable.",
      retryIntent: sentA.intent,
    }],
  ]);

  assertEquals(scopeA === scopeB, false);
  assertEquals(failedA.get(scopeA)?.retryIntent.projectId, "project-a");
  assertEquals(failedA.get(scopeB), undefined);
  assertEquals(
    reattachReviewIntent(
      [sentA],
      "project-b",
      "decision-1",
      FINGERPRINT_A,
      "approval-1",
    ),
    { kind: "idle" },
  );
  const index = indexReviewIntentRecords([sentA, sentB]);
  assertEquals(index.size, 2);
  assertEquals(index.get(scopeA)?.kind, "queued");
  assertEquals(index.get(scopeB)?.kind, "queued");
});

Deno.test("legacy intents stay readable but never enter the actionable scope index", () => {
  const current = record(
    "intent-legacy",
    FINGERPRINT_A,
    "2026-08-09T12:00:00.000Z",
  );
  const { approvalId: _approvalId, ...legacyIntent } = current.intent;
  const legacy: ProjectReviewIntentRecord = { intent: legacyIntent };

  assertEquals(indexReviewIntentRecords([legacy]).size, 0);
  assertEquals(
    reattachReviewIntent(
      [legacy],
      "project-1",
      "decision-1",
      FINGERPRINT_A,
      "approval-1",
    ),
    { kind: "idle" },
  );
});

Deno.test("retry can preserve the exact frozen intent identity", () => {
  const intent = buildReviewIntent({
    intentId: "intent-idempotent",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
    approvalId: "approval-1",
    inputFingerprint: FINGERPRINT_A,
    action: "validate",
    submittedAt: "2026-08-09T12:00:00.000Z",
  });
  const failed = {
    kind: "error" as const,
    message: "Network unavailable.",
    retryIntent: intent,
  };
  assertEquals(failed.retryIntent, intent);
  assertEquals(JSON.stringify(failed.retryIntent), JSON.stringify(intent));
});

Deno.test("receipt polling stops after acknowledgement, canonical outcome, or scope change", () => {
  const queued = indexReviewIntentRecords([
    record("intent-queued", FINGERPRINT_A, "2026-08-09T12:00:00.000Z"),
  ]);
  const decision = {
    id: "decision-1",
    status: "proposed" as const,
    inputFingerprint: FINGERPRINT_A,
  };
  assertEquals(
    shouldPollReviewIntentReceipts(queued, "project-1", [{
      approvalId: "approval-1",
      decision,
    }]),
    true,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, "project-1", [{
      approvalId: "approval-1",
      decision: { ...decision, status: "approved" },
    }]),
    false,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, "project-1", [{
      approvalId: "approval-1",
      decision: { ...decision, inputFingerprint: FINGERPRINT_B },
    }]),
    false,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, "project-1", [{
      approvalId: "approval-2",
      decision,
    }]),
    false,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, "project-2", [{
      approvalId: "approval-1",
      decision,
    }]),
    false,
  );

  const received = indexReviewIntentRecords([
    record(
      "intent-received",
      FINGERPRINT_A,
      "2026-08-09T12:01:00.000Z",
      true,
    ),
  ]);
  assertEquals(
    shouldPollReviewIntentReceipts(received, "project-1", [{
      approvalId: "approval-1",
      decision,
    }]),
    false,
  );
});

function record(
  intentId: string,
  inputFingerprint: typeof FINGERPRINT_A,
  submittedAt: string,
  acknowledged = false,
  approvalId = "approval-1",
  projectId = "project-1",
): ProjectReviewIntentRecord {
  return {
    intent: buildReviewIntent({
      intentId,
      projectId,
      expectedRevision: 12,
      decisionId: "decision-1",
      approvalId,
      inputFingerprint,
      action: "validate",
      submittedAt,
    }),
    ...(acknowledged
      ? {
        acknowledgement: {
          intentId,
          projectId,
          acknowledgedAt: "2026-08-09T12:03:00.000Z",
          acknowledgedBy: "agent-1",
        },
      }
      : {}),
  };
}
