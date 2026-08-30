import { assertEquals, assertRejects } from "@std/assert";
import {
  AssemblyIntegrityObservationAttemptIllegalTransitionError,
  AssemblyIntegrityObservationRunOutcomeUnknownError,
  FileAssemblyIntegrityObservationAttemptStore,
} from "./file-assembly-integrity-observation-attempt-store.ts";

const AT = "2026-08-26T00:00:00.000Z";
const PLAN = "a".repeat(64);
const CAPTURE = { algorithm: "sha256" as const, digest: "b".repeat(64) };

Deno.test("assembly-integrity WAL refuses a completed jump from dispatched", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-wal-" });
  try {
    const store = new FileAssemblyIntegrityObservationAttemptStore(directory);
    assertEquals((await store.begin(basis())).action, "dispatch");
    await assertRejects(
      () =>
        store.complete({ ...identity(), completedAt: AT, captureFingerprint: CAPTURE }),
      AssemblyIntegrityObservationAttemptIllegalTransitionError,
      "dispatched -> completed",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("assembly-integrity WAL inspect stays cold and never writes dispatched", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-wal-" });
  try {
    const store = new FileAssemblyIntegrityObservationAttemptStore(directory);
    assertEquals(await store.inspect(identity()), { action: "absent" });
    assertEquals(
      await store.read("project-assembly-integrity", "run-assembly-integrity"),
      undefined,
    );

    await store.begin(basis());
    assertEquals(await store.inspect(identity()), { action: "dispatched" });
    await store.recordCapture({
      ...identity(),
      recordedAt: AT,
      captureFingerprint: CAPTURE,
      canonicalCaptureText: '{"capture":true}',
    });
    assertEquals(await store.inspect(identity()), {
      action: "capture-recorded",
      recordedAt: AT,
      captureFingerprint: CAPTURE,
      canonicalCaptureText: '{"capture":true}',
    });
    await assertRejects(
      () => store.inspect({ ...identity(), planDigest: "c".repeat(64) }),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("assembly-integrity WAL refuses automatic redispatch after a durable dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-wal-" });
  try {
    const store = new FileAssemblyIntegrityObservationAttemptStore(directory);
    await store.begin(basis());
    await assertRejects(
      () => store.begin(basis()),
      AssemblyIntegrityObservationRunOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("assembly-integrity WAL reopens the exact recorded capture and completion", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-wal-" });
  try {
    const store = new FileAssemblyIntegrityObservationAttemptStore(directory);
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

Deno.test("assembly-integrity WAL refuses path-traversal attempt identities", async () => {
  const directory = await Deno.makeTempDir({ prefix: "assembly-integrity-wal-" });
  try {
    const store = new FileAssemblyIntegrityObservationAttemptStore(directory);
    await assertRejects(
      () => store.begin({ ...basis(), projectId: "../outside" }),
      TypeError,
      "projectId",
    );
    await assertRejects(
      () => store.read("project-assembly-integrity", "../outside"),
      TypeError,
      "runId",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

function basis() {
  return {
    ...identity(),
    dispatchedAt: AT,
  };
}

function identity() {
  return {
    projectId: "project-assembly-integrity",
    runId: "run-assembly-integrity",
    planDigest: PLAN,
  };
}
