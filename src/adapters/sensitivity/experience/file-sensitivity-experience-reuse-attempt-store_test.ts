import { assertEquals, assertRejects } from "@std/assert";
import { FileSensitivityExperienceReuseAttemptStore } from "./file-sensitivity-experience-reuse-attempt-store.ts";

const PLAN = "a".repeat(64);
const SCIENTIFIC_KEY = fingerprint("b");
const REVIEW = fingerprint("c");
const RECEIPT = fingerprint("d");

Deno.test("reuse WAL filenames preserve project and run identity without collisions", async () => {
  const directory = await canonicalTempDir();
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
  const directory = await canonicalTempDir();
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
  const root = await canonicalTempDir();
  const outside = await canonicalTempDir();
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
      "symlinked or non-directory ancestor",
    );
    assertEquals((await Array.fromAsync(Deno.readDir(outside))).length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("reuse WAL refuses a private directory below a symlinked ancestor", async () => {
  const root = await canonicalTempDir();
  const outside = await canonicalTempDir();
  try {
    const ancestor = `${root}/ancestor`;
    await Deno.symlink(outside, ancestor, { type: "dir" });
    const store = new FileSensitivityExperienceReuseAttemptStore(
      `${ancestor}/reuse-wal`,
    );

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
      "symlinked or non-directory ancestor",
    );
    assertEquals((await Array.fromAsync(Deno.readDir(outside))).length, 0);
  } finally {
    await Deno.remove(root, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("reuse WAL refuses an attempt transplanted between project-run tuples", async () => {
  const directory = await canonicalTempDir();
  try {
    const store = new FileSensitivityExperienceReuseAttemptStore(directory);
    await store.recordReview({
      projectId: "project-a",
      runId: "run-a",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: REVIEW,
      hit: true,
    });
    await store.recordReview({
      projectId: "project-b",
      runId: "run-b",
      planDigest: PLAN,
      scientificKey: SCIENTIFIC_KEY,
      reviewFingerprint: fingerprint("e"),
      hit: true,
    });
    const sourcePath = await attemptPath(directory, "project-a", "run-a");
    const destinationPath = await attemptPath(directory, "project-b", "run-b");
    const sourceBefore = await Deno.readTextFile(sourcePath);
    await Deno.writeTextFile(destinationPath, sourceBefore);

    await assertRejects(
      () => store.read("project-b", "run-b"),
      Error,
      "identity is divergent",
    );
    await assertRejects(
      () =>
        store.recordReceipt({
          projectId: "project-b",
          runId: "run-b",
          receiptFingerprint: RECEIPT,
        }),
      Error,
      "identity is divergent",
    );
    assertEquals(await Deno.readTextFile(sourcePath), sourceBefore);
    assertEquals((await store.read("project-a", "run-a"))?.status, "reviewed-hit");
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function canonicalTempDir(): Promise<string> {
  return await Deno.realPath(await Deno.makeTempDir());
}

async function attemptPath(
  directory: string,
  projectId: string,
  runId: string,
): Promise<string> {
  for await (const entry of Deno.readDir(directory)) {
    if (!entry.isFile) continue;
    const path = `${directory}/${entry.name}`;
    const value = JSON.parse(await Deno.readTextFile(path));
    if (value.projectId === projectId && value.runId === runId) return path;
  }
  throw new Error(`Attempt ${projectId}/${runId} was not found.`);
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
