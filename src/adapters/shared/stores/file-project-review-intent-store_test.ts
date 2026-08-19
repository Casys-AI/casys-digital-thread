import { assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectReviewIntent,
} from "../../../domain/project/project-review-intent.ts";
import {
  FileProjectReviewIntentStore,
  ProjectReviewIntentConflictError,
} from "./file-project-review-intent-store.ts";

const BASE_INTENT: ProjectReviewIntent = {
  intentId: "intent-desk-lamp-geometry-v2",
  projectId: "desk-lamp-dl01",
  expectedRevision: 41,
  decisionId: "decision:geometry-v2",
  approvalId: "approval:decision:geometry-v2:proposal-2",
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
    assertEquals(await reader.listAll(), [appended]);

    const acknowledgement = {
      intentId: BASE_INTENT.intentId,
      projectId: BASE_INTENT.projectId,
      acknowledgedAt: "2026-08-09T10:46:00.000Z",
      acknowledgedBy: "agent:paired-reviewer",
    };
    const acknowledged = await reader.acknowledge(acknowledgement);
    assertEquals(acknowledged, { intent: BASE_INTENT, acknowledgement });
    assertEquals(await writer.list(BASE_INTENT.projectId), [acknowledged]);
    assertEquals(await writer.listAll(), [acknowledged]);
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

Deno.test("FileProjectReviewIntentStore serializes competing actions to one intent per exact approval attempt", async () => {
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

Deno.test("FileProjectReviewIntentStore permits the same proposal fingerprint for a new approval attempt", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileProjectReviewIntentStore(directory);
    await store.append(BASE_INTENT);
    const successor = {
      ...BASE_INTENT,
      intentId: "intent-desk-lamp-geometry-v2-successor",
      approvalId: "approval:decision:geometry-v2:proposal-3",
      expectedRevision: 43,
    };

    await store.append(successor);
    assertEquals(
      (await store.list(BASE_INTENT.projectId)).map((record) => record.intent.intentId),
      [BASE_INTENT.intentId, successor.intentId],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore reads legacy 1.0 intents without making them actionable or blocking an approval-bound successor", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/project-review-intents.jsonl`;
  const { approvalId: _approvalId, ...legacyIntent } = BASE_INTENT;
  const legacy = {
    ...legacyIntent,
    intentId: "intent-desk-lamp-geometry-v1-legacy",
  };
  const legacyAcknowledgement = {
    intentId: legacy.intentId,
    projectId: legacy.projectId,
    acknowledgedAt: "2026-08-09T10:46:00.000Z",
    acknowledgedBy: "agent:historical-reviewer",
  };
  try {
    await Deno.writeTextFile(
      path,
      `${
        JSON.stringify({
          schemaVersion: "project-review-intent-event/1.0",
          kind: "intent",
          intent: legacy,
        })
      }\n${
        JSON.stringify({
          schemaVersion: "project-review-intent-event/1.0",
          kind: "acknowledgement",
          acknowledgement: legacyAcknowledgement,
        })
      }\n`,
    );
    const store = new FileProjectReviewIntentStore(directory);

    assertEquals(await store.list(BASE_INTENT.projectId), [{
      intent: legacy,
      acknowledgement: legacyAcknowledgement,
    }]);
    await assertRejects(
      () =>
        store.acknowledge({
          intentId: legacy.intentId,
          projectId: legacy.projectId,
          acknowledgedAt: "2026-08-09T10:46:00.000Z",
          acknowledgedBy: "agent:paired-reviewer",
        }),
      ProjectReviewIntentConflictError,
      "has no approval binding",
    );

    await store.append(BASE_INTENT);
    assertEquals((await store.list(BASE_INTENT.projectId)).length, 2);
    const schemas = (await Deno.readTextFile(path)).trim().split("\n").map((line) =>
      JSON.parse(line).schemaVersion
    );
    assertEquals(schemas, [
      "project-review-intent-event/1.0",
      "project-review-intent-event/1.0",
      "project-review-intent-event/1.1",
    ]);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("FileProjectReviewIntentStore ignores and truncates only an unterminated torn tail", async () => {
  const directory = await Deno.makeTempDir();
  const path = `${directory}/project-review-intents.jsonl`;
  try {
    const store = new FileProjectReviewIntentStore(directory);
    await store.append(BASE_INTENT);
    await Deno.writeTextFile(path, '{"schemaVersion":"project-review', {
      append: true,
    });

    assertEquals(await store.list(BASE_INTENT.projectId), [{ intent: BASE_INTENT }]);
    const successor = {
      ...BASE_INTENT,
      intentId: "intent-after-torn-tail",
      approvalId: "approval:decision:geometry-v2:proposal-after-torn-tail",
    };
    await store.append(successor);
    assertEquals((await store.list(BASE_INTENT.projectId)).length, 2);

    await Deno.writeTextFile(path, "{not-json}\n", { append: true });
    await assertRejects(
      () => store.list(BASE_INTENT.projectId),
      TypeError,
      "invalid project review intent JSONL",
    );
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
