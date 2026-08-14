import { assertEquals, assertRejects } from "@std/assert";
import {
  FeaSensitivityOutcomeUnknownError,
  FileFeaSensitivityAttemptStore,
} from "./file-fea-sensitivity-attempt-store.ts";

Deno.test("CalculiX is not dispatched before the WAL records dispatched", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
    });
    const before = await store.read("p", "r");
    assertEquals(before?.solves.base.status, "idle");
    const dispatched = await store.markSolveDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      stepSha256: "a".repeat(64),
    });
    assertEquals(dispatched.solves.base.status, "dispatched");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("a dispatched solve without solver-recorded cannot be dispatched again", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
    });
    await store.markSolveDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      stepSha256: "a".repeat(64),
    });
    await assertRejects(
      () =>
        store.markSolveDispatched({
          projectId: "p",
          runId: "r",
          phase: "base",
          dispatchedAt: "2026-08-14T00:00:01.000Z",
          stepSha256: "a".repeat(64),
        }),
      FeaSensitivityOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
