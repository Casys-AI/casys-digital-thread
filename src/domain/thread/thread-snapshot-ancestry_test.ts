import { assertEquals } from "@std/assert";
import { threadSnapshotDescendsFrom } from "./thread-snapshot-ancestry.ts";
import type { ThreadSnapshot } from "./thread-snapshot.ts";
import { validateThreadSnapshot } from "./thread-snapshot-validation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const SUBJECT = "subject-ancestry";

Deno.test("a ThreadSnapshot is an exact descendant of itself", async () => {
  const snapshot = revision(1);
  assertEquals(
    await threadSnapshotDescendsFrom(snapshot, snapshot, memory([snapshot])),
    true,
  );
});

Deno.test("contiguous previous-chain ancestry is exact and not numeric", async () => {
  const r1 = revision(1);
  const r2 = revision(2, r1);
  const r3 = revision(3, r2);
  const store = memory([r1, r2, r3]);
  assertEquals(await threadSnapshotDescendsFrom(r3, r2, store), true);
  assertEquals(await threadSnapshotDescendsFrom(r3, r1, store), true);
  assertEquals(await threadSnapshotDescendsFrom(r2, r3, store), false);
});

Deno.test("a sibling lookalike at the same revision is not an ancestor", async () => {
  const r1 = revision(1);
  const seal = revision(2, r1, "thread-ancestry-seal-r2");
  const sibling = revision(2, r1, "thread-ancestry-sibling-r2");
  const head = revision(3, sibling);
  const store = memory([r1, seal, sibling, head]);
  assertEquals(await threadSnapshotDescendsFrom(head, seal, store), false);
  assertEquals(await threadSnapshotDescendsFrom(head, sibling, store), true);
});

Deno.test("a missing intermediate snapshot fails closed", async () => {
  const r1 = revision(1);
  const r2 = revision(2, r1);
  const r3 = revision(3, r2);
  const store = memory([r1, r3]);
  assertEquals(await threadSnapshotDescendsFrom(r3, r1, store), false);
});

Deno.test("a previous pointer that skips a revision is not ancestry", async () => {
  const r1 = revision(1);
  const r2 = revision(2, r1);
  const skipped = revision(3, r1);
  const store = memory([r1, r2, skipped]);
  assertEquals(await threadSnapshotDescendsFrom(skipped, r2, store), false);
  assertEquals(await threadSnapshotDescendsFrom(skipped, r1, store), false);
});

Deno.test("same id and revision with different bytes is not the ancestor", async () => {
  const r1 = revision(1);
  const r2 = revision(2, r1);
  const mutated = validateThreadSnapshot({
    ...JSON.parse(JSON.stringify(r2)),
    generatedAt: "2026-08-22T09:00:01.000Z",
  });
  const store = memory([r1, r2]);
  assertEquals(await threadSnapshotDescendsFrom(r2, mutated, store), false);
});

function revision(
  n: number,
  previous?: ThreadSnapshot,
  id = `thread-ancestry-r${n}`,
): ThreadSnapshot {
  const fingerprint = { algorithm: "sha256" as const, digest: `${n}`.repeat(64) };
  const artifactId = `artifact-ancestry-r${n}`;
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision: n,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Ancestry subject",
      kind: "system",
      version: `r${n}`,
      modelArtifactId: artifactId,
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: `changes-ancestry-${id}`,
      name: "Ancestry",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: `change-${artifactId}`,
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Ancestry artifact.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: artifactId,
      name: "Ancestry artifact",
      kind: "document",
      version: "1",
      fingerprint,
      producer: {
        serverId: "digital-thread",
        tool: "recorded-test@1",
        runId: `run-${id}`,
      },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: `provenance-change-${artifactId}`,
      relation: "changes",
      from: { kind: "change", id: `change-${artifactId}` },
      to: { kind: "artifact", id: artifactId },
      rationale: "Ancestry artifact.",
    }],
    proposedActions: [],
  });
}

function memory(snapshots: readonly ThreadSnapshot[]) {
  const items = new Map(snapshots.map((item) => [item.id, item]));
  return {
    get(id: string) {
      return Promise.resolve(items.get(id));
    },
  };
}
