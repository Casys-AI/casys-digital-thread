import { assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectReviewIntent,
} from "../../domain/project/project-review-intent.ts";
import {
  FileProjectReviewIntentStore,
  ProjectReviewIntentConflictError,
} from "./file-project-review-intent-store.ts";

const BASE_INTENT: ProjectReviewIntent = {
  intentId: "intent-desk-lamp-geometry-v2",
  projectId: "desk-lamp-dl01",
  expectedRevision: 41,
  decisionId: "decision:geometry-v2",
  inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
  action: "validate",
  comment: "Validated after exact preview inspection.",
  submittedAt: "2026-08-09T10:45:00.000Z",
};

Deno.test("FileProjectReviewIntentStore durably lists and acknowledges an exact intent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const writer = new FileProjectReviewIntentStore(directory);
    const reader = new FileProjectReviewIntentStore(directory);

    const appended = await writer.append(BASE_INTENT);
    assertEquals(appended, { intent: BASE_INTENT });
    assertEquals(await reader.list(BASE_INTENT.projectId), [appended]);

    const acknowledgement = {
      intentId: BASE_INTENT.intentId,
      projectId: BASE_INTENT.projectId,
      acknowledgedAt: "2026-08-09T10:46:00.000Z",
      acknowledgedBy: "agent:paired-reviewer",
    };
    const acknowledged = await reader.acknowledge(acknowledgement);
    assertEquals(acknowledged, { intent: BASE_INTENT, acknowledgement });
    assertEquals(await writer.list(BASE_INTENT.projectId), [acknowledged]);
    assertEquals(await writer.acknowledge(acknowledgement), acknowledged);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore makes concurrent retries one idempotent journal event", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = new FileProjectReviewIntentStore(directory);
    const second = new FileProjectReviewIntentStore(directory);

    const results = await Promise.all([
      first.append(BASE_INTENT),
      second.append(structuredClone(BASE_INTENT)),
    ]);

    assertEquals(results[0], results[1]);
    assertEquals(await first.list(BASE_INTENT.projectId), [results[0]]);
    const lines = (await Deno.readTextFile(
      `${directory}/project-review-intents.jsonl`,
    )).trim().split("\n");
    assertEquals(lines.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore serializes competing actions to one intent per exact proposal fingerprint", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = new FileProjectReviewIntentStore(directory);
    const second = new FileProjectReviewIntentStore(directory);
    const validateIntent = {
      ...BASE_INTENT,
      intentId: "intent-validate",
      action: "validate" as const,
      comment: "Validated as reviewed.",
    };
    const revisionIntent = {
      ...BASE_INTENT,
      intentId: "intent-request-revision",
      expectedRevision: BASE_INTENT.expectedRevision + 1,
      action: "request-revision" as const,
      comment: "Increase the shade clearance.",
    };

    const results = await Promise.allSettled([
      first.append(validateIntent),
      second.append(revisionIntent),
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assertEquals(fulfilled.length, 1);
    assertEquals(rejected.length, 1);
    assertEquals(
      rejected[0].status === "rejected" &&
        rejected[0].reason instanceof ProjectReviewIntentConflictError,
      true,
    );
    assertEquals((await first.list(BASE_INTENT.projectId)).length, 1);
    const lines = (await Deno.readTextFile(
      `${directory}/project-review-intents.jsonl`,
    )).trim().split("\n");
    assertEquals(lines.length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore rejects reuse of an intent identity with different bytes", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const first = new FileProjectReviewIntentStore(directory);
    const second = new FileProjectReviewIntentStore(directory);
    await first.append(BASE_INTENT);

    await assertRejects(
      () =>
        second.append({
          ...BASE_INTENT,
          comment: "Different reviewer text.",
        }),
      ProjectReviewIntentConflictError,
      "already used with different content",
    );
    assertEquals((await first.list(BASE_INTENT.projectId)).length, 1);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore never acknowledges an absent or differently acknowledged intent", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileProjectReviewIntentStore(directory);
    const acknowledgement = {
      intentId: BASE_INTENT.intentId,
      projectId: BASE_INTENT.projectId,
      acknowledgedAt: "2026-08-09T10:46:00.000Z",
      acknowledgedBy: "agent:paired-reviewer",
    };
    await assertRejects(
      () => store.acknowledge(acknowledgement),
      ProjectReviewIntentConflictError,
      "does not exist",
    );
    await store.append(BASE_INTENT);
    await store.acknowledge(acknowledgement);
    await assertRejects(
      () =>
        store.acknowledge({
          ...acknowledgement,
          acknowledgedBy: "agent:different",
        }),
      ProjectReviewIntentConflictError,
      "already acknowledged with different content",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
