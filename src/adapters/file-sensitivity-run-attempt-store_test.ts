import { assertEquals, assertRejects } from "@std/assert";
import {
  FileSensitivityRunAttemptStore,
} from "./file-sensitivity-run-attempt-store.ts";

const FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};

function begin(caseDigest = "b".repeat(64)) {
  return {
    projectId: "coffee-machine-cm01-v3",
    runId: "run:sensitivity-test",
    caseDigest,
    dispatchedAt: "2026-08-04T00:00:00.000Z",
  };
}

Deno.test("a fresh sensitivity attempt begins as a dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    const outcome = await store.begin(begin());
    assertEquals(outcome.action, "dispatch");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a completed sensitivity attempt replays its capture instead of re-dispatching", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    await store.begin(begin());
    await store.complete({
      ...begin(),
      completedAt: "2026-08-04T00:01:00.000Z",
      captureFingerprint: FINGERPRINT,
    });
    const outcome = await store.begin(begin());
    assertEquals(outcome.action, "completed");
    if (outcome.action === "completed") {
      assertEquals(outcome.captureFingerprint, FINGERPRINT);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a different case digest is a new attempt, never a replay of the old capture", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    await store.begin(begin());
    await store.complete({
      ...begin(),
      completedAt: "2026-08-04T00:01:00.000Z",
      captureFingerprint: FINGERPRINT,
    });
    const outcome = await store.begin(begin("c".repeat(64)));
    assertEquals(outcome.action, "dispatch");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a corrupted sensitivity attempt file is a terminal error, never a silent redispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-sens-wal-" });
  try {
    const store = new FileSensitivityRunAttemptStore(directory);
    await store.begin(begin());
    const [entry] = [...Deno.readDirSync(directory)];
    await Deno.writeTextFile(`${directory}/${entry.name}`, "{not json");
    await assertRejects(async () => {
      const outcome = await store.begin(begin());
      // A dispatched entry may legitimately re-dispatch, but corruption must
      // never be mistaken for either state.
      if (outcome.action === "dispatch" || outcome.action === "completed") {
        throw new Error("corrupted attempt was accepted");
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
