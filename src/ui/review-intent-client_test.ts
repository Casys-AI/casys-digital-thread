import { assertEquals, assertRejects } from "@std/assert";
import {
  HttpProjectReviewIntentClient,
  ReviewIntentConflictError,
  ReviewIntentStaleError,
} from "./src/project/review-intent-client.ts";
import { buildReviewIntent } from "./src/project/review-intent-model.ts";

const INTENT = buildReviewIntent({
  intentId: "intent-1",
  projectId: "project-1",
  expectedRevision: 12,
  decisionId: "decision-1",
  inputFingerprint: {
    algorithm: "sha256",
    digest: "a".repeat(64),
  },
  action: "request-revision",
  comment: "Move the switch 4 mm upward.",
  submittedAt: "2026-08-09T12:00:00.000Z",
});

Deno.test("review intent client POSTs the exact bounded body and accepts only 202", async () => {
  let captured: { input: string; init?: RequestInit } | undefined;
  const client = new HttpProjectReviewIntentClient(
    "/api/review-intents",
    (input, init) => {
      captured = { input: String(input), init };
      return Promise.resolve(Response.json({
        status: "accepted",
        projectId: "project-1",
        projectRevision: 12,
        record: { intent: INTENT },
      }, { status: 202 }));
    },
  );

  const record = await client.submit(INTENT);

  assertEquals(record.intent, INTENT);
  assertEquals(captured?.input, "/api/review-intents");
  assertEquals(captured?.init?.method, "POST");
  assertEquals(captured?.init?.headers, {
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  assertEquals(JSON.parse(String(captured?.init?.body)), INTENT);
});

Deno.test("review intent client reloads acknowledged records with an uncached GET", async () => {
  let captured: RequestInit | undefined;
  const acknowledgement = {
    intentId: INTENT.intentId,
    projectId: INTENT.projectId,
    acknowledgedAt: "2026-08-09T12:05:00.000Z",
    acknowledgedBy: "agent-1",
  };
  const client = new HttpProjectReviewIntentClient(
    "/api/review-intents",
    (_input, init) => {
      captured = init;
      return Promise.resolve(Response.json({
        projectId: "project-1",
        projectRevision: 12,
        intents: [{ intent: INTENT, acknowledgement }],
      }));
    },
  );

  const response = await client.list();

  assertEquals(response.intents[0]?.acknowledgement, acknowledgement);
  assertEquals(captured?.method, "GET");
  assertEquals(captured?.cache, "no-store");
});

Deno.test("review intent client exposes an explicit 409 without calling it validation", async () => {
  const client = new HttpProjectReviewIntentClient(
    "/api/review-intents",
    () =>
      Promise.resolve(Response.json({
        error: "review_intent_fingerprint_mismatch",
        projectId: "project-1",
        currentRevision: 13,
      }, { status: 409 })),
  );

  const error = await assertRejects(
    () => client.submit(INTENT),
    ReviewIntentStaleError,
  );
  assertEquals(error.code, "review_intent_fingerprint_mismatch");
  assertEquals(error.currentRevision, 13);
});

Deno.test("revision drift and duplicate intent conflicts are not mislabeled as changed proposals", async () => {
  for (
    const code of [
      "review_intent_stale_revision",
      "review_intent_id_conflict",
      "review_intent_conflict",
    ]
  ) {
    const client = new HttpProjectReviewIntentClient(
      "/api/review-intents",
      () =>
        Promise.resolve(Response.json({
          error: code,
          projectId: "project-1",
          currentRevision: 13,
        }, { status: 409 })),
    );

    const error = await assertRejects(
      () => client.submit(INTENT),
      ReviewIntentConflictError,
    );
    assertEquals(error instanceof ReviewIntentStaleError, false);
    assertEquals(error.code, code);
  }
});

Deno.test("review intent client rejects a malformed acknowledgement binding", async () => {
  const client = new HttpProjectReviewIntentClient(
    "/api/review-intents",
    () =>
      Promise.resolve(Response.json({
        projectId: "project-1",
        projectRevision: 12,
        intents: [{
          intent: INTENT,
          acknowledgement: {
            intentId: "another-intent",
            projectId: "project-1",
            acknowledgedAt: "2026-08-09T12:05:00.000Z",
            acknowledgedBy: "agent-1",
          },
        }],
      })),
  );

  await assertRejects(
    () => client.list(),
    TypeError,
    "acknowledgement does not match",
  );
});
