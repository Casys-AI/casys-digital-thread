import { assertEquals, assertRejects } from "@std/assert";
import {
  FilePrintEstimateAttemptStore,
  PrintEstimateRunIllegalTransitionError,
  PrintEstimateRunOutcomeUnknownError,
} from "./file-print-estimate-attempt-store.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PLAN = "a".repeat(64);
const CAPTURE = { algorithm: "sha256" as const, digest: "b".repeat(64) };

Deno.test("print-estimate WAL refuses a completed jump from dispatched", async () => {
  const directory = await Deno.makeTempDir({ prefix: "print-estimate-wal-" });
  try {
    const store = new FilePrintEstimateAttemptStore(directory);
    const begun = await store.begin({
      projectId: "proj",
      runId: "run-1",
      planDigest: PLAN,
      dispatchedAt: AT,
    });
    assertEquals(begun.action, "dispatch");
    await assertRejects(
      () =>
        store.complete({
          projectId: "proj",
          runId: "run-1",
          planDigest: PLAN,
          completedAt: AT,
          captureFingerprint: CAPTURE,
        }),
      PrintEstimateRunIllegalTransitionError,
      "dispatched -> completed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("print-estimate WAL treats a dispatched-only restart as unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "print-estimate-wal-" });
  try {
    const store = new FilePrintEstimateAttemptStore(directory);
    await store.begin({
      projectId: "proj",
      runId: "run-1",
      planDigest: PLAN,
      dispatchedAt: AT,
    });
    await assertRejects(
      () =>
        store.begin({
          projectId: "proj",
          runId: "run-1",
          planDigest: PLAN,
          dispatchedAt: AT,
        }),
      PrintEstimateRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
