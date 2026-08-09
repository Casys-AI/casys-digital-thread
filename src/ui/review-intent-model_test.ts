import { assertEquals, assertThrows } from "@std/assert";
import type { ProjectReviewIntentRecord } from "../domain/project/project-review-intent.ts";
import {
  buildReviewIntent,
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
    inputFingerprint: FINGERPRINT_A,
    action: "validate",
    comment: "   ",
    submittedAt: "2026-08-09T12:01:00.000Z",
  });
  assertEquals(Object.hasOwn(withoutComment, "comment"), false);
});

Deno.test("revision intent requires a non-blank comment of at most 2000 code points", () => {
  const input = {
    intentId: "intent-1",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
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
    "decision-1",
    FINGERPRINT_A,
  );
  assertEquals(exact.kind, "acknowledged");
  if (exact.kind === "acknowledged") {
    assertEquals(exact.record.intent.intentId, "intent-current");
  }

  const index = indexReviewIntentRecords([older, current, successor]);
  assertEquals(index.size, 2);
  assertEquals(
    index.get(reviewIntentScopeKey("decision-1", FINGERPRINT_B))?.kind,
    "queued",
  );
});

Deno.test("retry can preserve the exact frozen intent identity", () => {
  const intent = buildReviewIntent({
    intentId: "intent-idempotent",
    projectId: "project-1",
    expectedRevision: 12,
    decisionId: "decision-1",
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
    shouldPollReviewIntentReceipts(queued, [decision]),
    true,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, [{
      ...decision,
      status: "approved",
    }]),
    false,
  );
  assertEquals(
    shouldPollReviewIntentReceipts(queued, [{
      ...decision,
      inputFingerprint: FINGERPRINT_B,
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
    shouldPollReviewIntentReceipts(received, [decision]),
    false,
  );
});

function record(
  intentId: string,
  inputFingerprint: typeof FINGERPRINT_A,
  submittedAt: string,
  acknowledged = false,
): ProjectReviewIntentRecord {
  return {
    intent: buildReviewIntent({
      intentId,
      projectId: "project-1",
      expectedRevision: 12,
      decisionId: "decision-1",
      inputFingerprint,
      action: "validate",
      submittedAt,
    }),
    ...(acknowledged
      ? {
        acknowledgement: {
          intentId,
          projectId: "project-1",
          acknowledgedAt: "2026-08-09T12:03:00.000Z",
          acknowledgedBy: "agent-1",
        },
      }
      : {}),
  };
}
