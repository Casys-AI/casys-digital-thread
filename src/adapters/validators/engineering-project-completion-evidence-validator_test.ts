import { assertEquals, assertRejects } from "@std/assert";
import type { EngineeringThreadSnapshotRef } from "../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  ExactThreadCompletionEvidenceValidator,
  ExactThreadReconciliationSnapshotValidator,
} from "./engineering-project-completion-evidence-validator.ts";

Deno.test("completion evidence must be new or changed since the exact run base", async () => {
  const base = baseSnapshot();
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
  const skippedRevision = {
    ...nextSnapshot(base, "skipped-revision", {
      artifacts: base.artifacts.map((artifact, index) =>
        index === 0 ? { ...artifact, version: `${artifact.version}-skipped` } : artifact
      ),
    }),
    revision: base.revision + 2,
  };
  const snapshots = new Map(
    [
      base,
      changed,
      added,
      unchanged,
      parallelBase,
      parallelResult,
      skippedRevision,
    ].map(
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
      validator.validate(baseReference, snapshotReference(skippedRevision), [{
        snapshotId: skippedRevision.id,
        snapshotRevision: skippedRevision.revision,
        kind: "artifact",
        id: skippedRevision.artifacts[0].id,
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

Deno.test("reconciliation validator proves a persisted current head descends from the exact successor result", async () => {
  const base = baseSnapshot();
  const currentHead = nextSnapshot(base, "current-head");
  const unrelated = {
    ...structuredClone(base),
    id: `${base.id}:unrelated`,
  };
  const snapshots = new Map(
    [base, currentHead, unrelated].map((snapshot) => [snapshot.id, snapshot]),
  );
  const validator = new ExactThreadReconciliationSnapshotValidator({
    get: (id) => Promise.resolve(snapshots.get(id)),
  });

  assertEquals(
    await validator.validateCurrentHeadDescendsFrom(
      snapshotReference(currentHead),
      snapshotReference(base),
    ),
    undefined,
  );
  await assertRejects(
    () =>
      validator.validateCurrentHeadDescendsFrom(
        snapshotReference(unrelated),
        snapshotReference(base),
      ),
    Error,
    "does not descend from successor result",
  );
});

function baseSnapshot(): ThreadSnapshot {
  const at = "2026-08-01T03:03:48.000Z";
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "generic-bracket:r1:baseline",
    revision: 1,
    generatedAt: at,
    subject: {
      id: "generic-bracket",
      name: "Generic bracket",
      kind: "part",
      version: "1",
      modelArtifactId: "generic-bracket-step",
    },
    freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    changeSet: {
      id: "generic-baseline",
      name: "Capture the generic bracket baseline",
      status: "applied",
      createdAt: at,
      appliedAt: at,
      changes: [{
        id: "capture-generic-step",
        kind: "created",
        target: { kind: "artifact", id: "generic-bracket-step" },
        summary: "Capture the exact generic STEP artifact.",
        afterFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      }],
    },
    artifacts: [{
      id: "generic-bracket-step",
      name: "Generic bracket STEP",
      kind: "step",
      version: "1",
      fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
      producer: { serverId: "build123d", tool: "export", runId: "generic-cad" },
      inputArtifactIds: [],
      freshness: { status: "fresh", changedAt: at, invalidatedByChangeIds: [] },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "generic-baseline-created-step",
      relation: "changes",
      from: { kind: "change", id: "capture-generic-step" },
      to: { kind: "artifact", id: "generic-bracket-step" },
      rationale: "The baseline change created the exact STEP artifact.",
    }],
    proposedActions: [],
  });
}

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
