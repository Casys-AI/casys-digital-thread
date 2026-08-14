import { assertRejects } from "@std/assert";
import {
  FeaSensitivityOutcomeUnknownError,
  FileFeaSensitivityAttemptStore,
} from "./file-fea-sensitivity-attempt-store.ts";

Deno.test("a dispatched CAD slot cannot be dispatched again", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
    });
    await store.markCadDispatched({
      projectId: "p",
      runId: "r",
      phase: "base",
      executionRunId: "r:cad-base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      sourceSha256: "a".repeat(64),
    });
    await assertRejects(
      () =>
        store.markCadDispatched({
          projectId: "p",
          runId: "r",
          phase: "base",
          executionRunId: "r:cad-base",
          dispatchedAt: "2026-08-14T00:00:01.000Z",
          sourceSha256: "a".repeat(64),
        }),
      FeaSensitivityOutcomeUnknownError,
      "dispatched without a published STEP",
    );
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

Deno.test("WAL parse rejects a published CAD slot with an extra key", async () => {
  const directory = await Deno.makeTempDir({ prefix: "fea-sensitivity-wal-" });
  try {
    const store = new FileFeaSensitivityAttemptStore(directory);
    await store.prepare({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
    });
    const path = `${directory}/p__r.json`;
    const tampered = JSON.parse(await Deno.readTextFile(path));
    tampered.cad.base = {
      status: "published",
      executionRunId: "r:cad-base",
      dispatchedAt: "2026-08-14T00:00:00.000Z",
      sourceSha256: "a".repeat(64),
      stepSha256: "b".repeat(64),
      stepBytes: 4,
      bytes: [1, 2, 3, 4],
    };
    await Deno.writeTextFile(path, `${JSON.stringify(tampered)}\n`);
    await assertRejects(
      () => store.read("p", "r"),
      TypeError,
      "unsupported field bytes",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
