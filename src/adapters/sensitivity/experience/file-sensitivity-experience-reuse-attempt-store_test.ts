import { assertEquals, assertRejects } from "@std/assert";
import { FileSensitivityExperienceReuseAttemptStore } from "./file-sensitivity-experience-reuse-attempt-store.ts";

const PLAN = "a".repeat(64);
const SCIENTIFIC_KEY = fingerprint("b");
const REVIEW = fingerprint("c");
const RECEIPT = fingerprint("d");

Deno.test("reuse WAL filenames preserve project and run identity without collisions", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileSensitivityExperienceReuseAttemptStore(directory);
    await store.recordReview({
      projectId: "project/a",
      runId: "run_b",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: REVIEW,
      hit: false,
    });
    await store.recordReview({
      projectId: "project_a",
      runId: "run/b",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: fingerprint("e"),
      hit: true,
    });
    await store.recordReview({
      projectId: "project__with",
      runId: "separator",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: fingerprint("f"),
      hit: false,
    });
    await store.recordReview({
      projectId: "project",
      runId: "with__separator",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: fingerprint("0"),
      hit: true,
    });

    assertEquals((await store.read("project/a", "run_b"))?.status, "reviewed-miss");
    assertEquals((await store.read("project_a", "run/b"))?.status, "reviewed-hit");
    assertEquals(
      (await store.read("project__with", "separator"))?.status,
      "reviewed-miss",
    );
    assertEquals(
      (await store.read("project", "with__separator"))?.status,
      "reviewed-hit",
    );
    assertEquals((await Array.fromAsync(Deno.readDir(directory))).length, 4);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("reuse WAL refuses plan drift and cannot downgrade after receipt", async () => {
  const directory = await Deno.makeTempDir();
  try {
    const store = new FileSensitivityExperienceReuseAttemptStore(directory);
    await store.recordReview({
      projectId: "project",
      runId: "run",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: REVIEW,
      hit: true,
    });
    await assertRejects(
      () =>
        store.readForPlan({
          projectId: "project",
          runId: "run",
          planDigest: "f".repeat(64),
          scientificKey: SCIENTIFIC_KEY,
        }),
      Error,
      "plan is divergent",
    );
    await store.recordReceipt({
      projectId: "project",
      runId: "run",
      receiptFingerprint: RECEIPT,
    });
    await assertRejects(
      () =>
        store.replaceHitWithMiss({
          projectId: "project",
          runId: "run",
          reviewFingerprint: fingerprint("e"),
        }),
      Error,
      "after receipt publication",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("reuse WAL refuses a symlinked private directory", async () => {
  const root = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    const directory = `${root}/reuse-wal`;
    await Deno.symlink(outside, directory, { type: "dir" });
    const store = new FileSensitivityExperienceReuseAttemptStore(directory);

    await assertRejects(
      () =>
        store.recordReview({
          projectId: "project",
          runId: "run",
          planDigest: PLAN,
          scientificKey: SCIENTIFIC_KEY,
          reviewFingerprint: REVIEW,
          hit: true,
        }),
      Error,
      "not a confined directory",
    );
    assertEquals((await Array.fromAsync(Deno.readDir(outside))).length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
