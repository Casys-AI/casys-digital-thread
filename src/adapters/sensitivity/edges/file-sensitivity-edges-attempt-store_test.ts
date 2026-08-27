import { assertEquals, assertRejects } from "@std/assert";
import { FileSensitivityEdgesAttemptStore } from "./file-sensitivity-edges-attempt-store.ts";

Deno.test("edges WAL parse rejects a completed attempt missing snapshotId", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-edges-wal-" });
  try {
    const store = new FileSensitivityEdgesAttemptStore(directory);
    await store.begin({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      dispatchedAt: "2026-08-14T00:00:00.000Z",
    });
    const path = `${directory}/p__r.json`;
    const tampered = JSON.parse(await Deno.readTextFile(path));
    tampered.status = "completed";
    await Deno.writeTextFile(path, `${JSON.stringify(tampered)}\n`);
    await assertRejects(
      () => store.read("p", "r"),
      TypeError,
      "snapshotId is required",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("edges WAL begin returns completed only for a well-formed completed attempt", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-edges-wal-" });
  try {
    const store = new FileSensitivityEdgesAttemptStore(directory);
    await store.begin({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      dispatchedAt: "2026-08-14T00:00:00.000Z",
    });
    await store.complete({ projectId: "p", runId: "r", snapshotId: "snap-1" });
    const again = await store.begin({
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      dispatchedAt: "2026-08-14T00:00:00.000Z",
    });
    assertEquals(again, "completed");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("edges WAL resumes a dispatched same-plan attempt as verify, never as a second insert", async () => {
  const directory = await Deno.makeTempDir({ prefix: "sensitivity-edges-wal-" });
  try {
    const store = new FileSensitivityEdgesAttemptStore(directory);
    const input = {
      projectId: "p",
      runId: "r",
      planDigest: "d".repeat(64),
      dispatchedAt: "2026-08-14T00:00:00.000Z",
    };
    assertEquals(await store.begin(input), "dispatch");
    assertEquals(await store.begin(input), "verify");
    await assertRejects(() => store.begin({ ...input, planDigest: "e".repeat(64) }));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
