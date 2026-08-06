import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringThreadSnapshotRef } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import { ExactThreadCompletionEvidenceValidator } from "./engineering-project-completion-evidence-validator.ts";

Deno.test("completion evidence must be new or changed since the exact run base", async () => {
  const base = validateThreadSnapshot(
    JSON.parse(
      await Deno.readTextFile(
        "config/projects/baselines/coffee-machine-cm01.r5.thread-snapshot.json",
      ),
    ),
  );
  const changed = nextSnapshot(base, "changed", {
    artifacts: base.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, version: `${artifact.version}-changed` } : artifact
    ),
  });
  const addedArtifact = {
    ...base.artifacts[0],
    id: "new-completion-artifact",
    name: "New completion artifact",
  };
  const added = nextSnapshot(base, "added", {
    artifacts: [...base.artifacts, addedArtifact],
  });
  const unchanged = nextSnapshot(base, "unchanged");
  const parallelBase: ThreadSnapshot = {
    ...structuredClone(base),
    id: `${base.id}:parallel-base`,
  };
  const parallelResult = nextSnapshot(parallelBase, "parallel-result", {
    artifacts: base.artifacts.map((artifact, index) =>
      index === 0 ? { ...artifact, version: `${artifact.version}-parallel` } : artifact
    ),
  });
  const snapshots = new Map(
    [base, changed, added, unchanged, parallelBase, parallelResult].map(
      (snapshot) => [snapshot.id, snapshot],
    ),
  );
  const validator = new ExactThreadCompletionEvidenceValidator({
    get: (id) => Promise.resolve(snapshots.get(id)),
  });
  const baseReference = snapshotReference(base);

  assertEquals(
    await validator.validate(baseReference, snapshotReference(changed), [{
      snapshotId: changed.id,
      snapshotRevision: changed.revision,
      kind: "artifact",
      id: changed.artifacts[0].id,
    }]),
    undefined,
  );
  assertEquals(
    await validator.validate(baseReference, snapshotReference(added), [{
      snapshotId: added.id,
      snapshotRevision: added.revision,
      kind: "artifact",
      id: addedArtifact.id,
    }]),
    undefined,
  );
  await assertRejects(
    () =>
      validator.validate(baseReference, snapshotReference(unchanged), [{
        snapshotId: unchanged.id,
        snapshotRevision: unchanged.revision,
        kind: "artifact",
        id: unchanged.artifacts[0].id,
      }]),
    Error,
    "is unchanged from run base",
  );
  await assertRejects(
    () =>
      validator.validate(baseReference, snapshotReference(parallelResult), [{
        snapshotId: parallelResult.id,
        snapshotRevision: parallelResult.revision,
        kind: "artifact",
        id: parallelResult.artifacts[0].id,
      }]),
    Error,
    "does not descend from exact run base",
  );
  await assertRejects(
    () =>
      validator.validate(baseReference, snapshotReference(changed), [{
        snapshotId: changed.id,
        snapshotRevision: changed.revision,
        kind: "artifact",
        id: "invented",
      }]),
    Error,
    "does not exist in exact ThreadSnapshot",
  );
  await assertRejects(
    () =>
      validator.validate(
        baseReference,
        { ...snapshotReference(changed), revision: 999 },
        [],
      ),
    Error,
    "does not match revision 999",
  );
});

function nextSnapshot(
  base: ThreadSnapshot,
  suffix: string,
  overrides: Partial<ThreadSnapshot> = {},
): ThreadSnapshot {
  return {
    ...structuredClone(base),
    ...overrides,
    id: `${base.id}:${suffix}`,
    revision: base.revision + 1,
    previous: { snapshotId: base.id, revision: base.revision },
  };
}

function snapshotReference(
  snapshot: ThreadSnapshot,
): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}
