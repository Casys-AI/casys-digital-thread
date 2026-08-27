import { assertEquals, assertRejects } from "@std/assert";
import {
  AssemblyIntegrityEvaluationAttemptConflictError,
  AssemblyIntegrityEvaluationAttemptIllegalTransitionError,
  FileAssemblyIntegrityEvaluationAttemptStore,
} from "./file-assembly-integrity-evaluation-attempt-store.ts";

const AT = "2026-08-26T00:00:00.000Z";
const PLAN = "a".repeat(64);
const CAPTURE = { algorithm: "sha256" as const, digest: "b".repeat(64) };

Deno.test("L4 WAL permits deterministic retry only before a capture is recorded", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "assembly-integrity-evaluation-wal-",
  });
  try {
    const store = new FileAssemblyIntegrityEvaluationAttemptStore(directory);
    assertEquals((await store.begin(basis())).action, "evaluate");
    assertEquals((await store.begin(basis())).action, "evaluate");
    await assertRejects(
      () =>
        store.complete({ ...identity(), completedAt: AT, captureFingerprint: CAPTURE }),
      AssemblyIntegrityEvaluationAttemptIllegalTransitionError,
      "started -> completed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("L4 WAL reopens one exact capture and refuses replacing it", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "assembly-integrity-evaluation-wal-",
  });
  try {
    const store = new FileAssemblyIntegrityEvaluationAttemptStore(directory);
    await store.begin(basis());
    await store.recordCapture({
      ...identity(),
      recordedAt: AT,
      captureFingerprint: CAPTURE,
      canonicalCaptureText: '{"capture":true}',
    });
    assertEquals(await store.begin(basis()), {
      action: "capture-recorded",
      recordedAt: AT,
      captureFingerprint: CAPTURE,
      canonicalCaptureText: '{"capture":true}',
    });
    await assertRejects(
      () =>
        store.recordCapture({
          ...identity(),
          recordedAt: AT,
          captureFingerprint: CAPTURE,
          canonicalCaptureText: '{"capture":false}',
        }),
      AssemblyIntegrityEvaluationAttemptConflictError,
      "different canonical capture",
    );
    await store.complete({
      ...identity(),
      completedAt: AT,
      captureFingerprint: CAPTURE,
    });
    assertEquals((await store.begin(basis())).action, "completed");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function basis() {
  return { ...identity(), startedAt: AT };
}

function identity() {
  return {
    projectId: "project-assembly-integrity",
    runId: "run-assembly-integrity",
    planDigest: PLAN,
  };
}
