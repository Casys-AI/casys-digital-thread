import { assertEquals, assertRejects } from "@std/assert";
import {
  AdmittedObservationEvaluationOutcomeUnknownError,
  FileAdmittedObservationEvaluationAttemptStore,
} from "./file-admitted-observation-evaluation-attempt-store.ts";

const AT = "2026-08-21T12:00:00.000Z";
const IDENTITY = {
  projectId: "articulated-led-desk-lamp",
  runId: "run.evaluate",
};

Deno.test("evaluation WAL dispatches once then refuses an unknown replay", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "admitted-observation-eval-wal-",
  });
  try {
    const store = new FileAdmittedObservationEvaluationAttemptStore(directory);
    assertEquals(
      await store.begin({ ...IDENTITY, dispatchedAt: AT }),
      { action: "dispatch" },
    );
    await assertRejects(
      () => store.begin({ ...IDENTITY, dispatchedAt: AT }),
      AdmittedObservationEvaluationOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("evaluation WAL replays a completed capture digest without a new dispatch", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "admitted-observation-eval-wal-complete-",
  });
  try {
    const store = new FileAdmittedObservationEvaluationAttemptStore(directory);
    await store.begin({ ...IDENTITY, dispatchedAt: AT });
    await store.complete({
      ...IDENTITY,
      completedAt: AT,
      captureDigest: "a".repeat(64),
    });
    assertEquals(
      await store.begin({ ...IDENTITY, dispatchedAt: AT }),
      { action: "completed", captureDigest: "a".repeat(64) },
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
