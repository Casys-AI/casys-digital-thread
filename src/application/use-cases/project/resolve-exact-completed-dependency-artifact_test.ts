import { assertEquals } from "@std/assert";
import {
  resolveExactCompletedDependencyArtifact,
  selectUniqueCompletedOperationLeaf,
} from "./resolve-exact-completed-dependency-artifact.ts";
import { engineeringActivityIdFromRootRevision } from "../../../domain/project/engineering-activity.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const SUBJECT = "subject-dependency";
const CURRENT_RUN = "run-current";
const CURRENT_WORK = "work-current";
const DEP_WORK = "work-dependency";
const DEP_RUN = "run-dependency";
const ARTIFACT = "dependency-document";
const LOOKALIKE = "lookalike-document";
const CURRENT_OPERATION = {
  id: "analyze.evaluate-example",
  version: "1",
  requiresDependsOnOperation: { id: "verify.seal-example", version: "1" },
};
const EXPECTED_DEPENDENCY = {
  id: "verify.seal-example",
  version: "1",
  bindings: [{
    name: "approvedBrief" as const,
    source: { kind: "approved-brief" as const },
  }],
};
const EXPECTED_PRODUCER = {
  serverId: "digital-thread",
  tool: "verify.seal-example@1",
};

Deno.test("named completed dependency is reused on a later descendant retry", async () => {
  const world = fixture("retry");
  const result = await resolveExactCompletedDependencyArtifact(world.input());
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.dependencyWork.id, DEP_WORK);
  assertEquals(result.producerRun.id, DEP_RUN);
  assertEquals(result.artifact.id, ARTIFACT);
  assertEquals(result.resultSnapshot.id, "thread-dependency-r2");
});

Deno.test("a producer-labeled lookalike on the head cannot steal the named evidence", async () => {
  const world = fixture("lookalike-on-head");
  const result = await resolveExactCompletedDependencyArtifact(world.input());
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.artifact.id, ARTIFACT);
});

Deno.test("the exact dependency propagates its required evidence artifact kind", async () => {
  const world = fixture("retry");
  const result = await resolveExactCompletedDependencyArtifact({
    ...world.input(),
    expectedArtifactKind: "evidence",
  });
  assertEquals(result.status, "unavailable");
  if (result.status === "resolved") return;
  assertEquals(result.code, "artifact_unavailable");
});

Deno.test("the exact dependency accepts its required evidence artifact kind", async () => {
  const world = fixture("retry", "evidence");
  const result = await resolveExactCompletedDependencyArtifact({
    ...world.input(),
    expectedArtifactKind: "evidence",
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.artifact.kind, "evidence");
});

Deno.test("an archived named artifact fails closed", async () => {
  const world = fixture("archived");
  const result = await resolveExactCompletedDependencyArtifact(world.input());
  assertEquals(result.status, "unresolved");
  if (result.status === "resolved") return;
  assertEquals(result.code, "artifact_archived");
});

Deno.test("a stale or forked activity leaf fails closed without sibling inference", async () => {
  const stale = fixture("stale");
  const staleResult = await resolveExactCompletedDependencyArtifact(stale.input());
  assertEquals(staleResult.status, "unavailable");
  if (staleResult.status !== "unavailable") return;
  assertEquals(staleResult.code, "dependency_unavailable");

  const forked = fixture("forked");
  const forkedResult = await resolveExactCompletedDependencyArtifact(forked.input());
  assertEquals(forkedResult.status, "unavailable");
  if (forkedResult.status !== "unavailable") return;
  assertEquals(forkedResult.code, "dependency_ambiguous");
});

Deno.test("a lookalike attachment without exact unique evidence fails closed", async () => {
  const world = fixture("lookalike-attachment");
  const result = await resolveExactCompletedDependencyArtifact(world.input());
  assertEquals(result.status, "unavailable");
  if (result.status === "resolved") return;
  assertEquals(result.code, "evidence_mismatch");
});

Deno.test("a sibling lineage that does not descend from the named result fails closed", async () => {
  const world = fixture("sibling");
  const result = await resolveExactCompletedDependencyArtifact(world.input());
  assertEquals(result.status, "unavailable");
  if (result.status === "resolved") return;
  assertEquals(result.code, "ancestry_unavailable");
});

Deno.test("unique completed operation leaf fails closed on missing, forked, or incomplete activity", () => {
  const operation = { id: "analyze.evaluate-example", version: "1" };
  assertEquals(
    selectUniqueCompletedOperationLeaf([], operation).status,
    "unavailable",
  );
  const root = {
    id: "work-a",
    activityId: "activity:work-a",
    status: "completed" as const,
    operation,
  };
  const other = {
    id: "work-b",
    activityId: "activity:work-b",
    status: "completed" as const,
    operation,
  };
  const ambiguous = selectUniqueCompletedOperationLeaf([root, other], operation);
  assertEquals(ambiguous.status, "unavailable");
  if (ambiguous.status !== "unavailable") return;
  assertEquals(ambiguous.code, "dependency_ambiguous");

  const forkA = {
    id: "work-a-fork-1",
    activityId: root.activityId,
    predecessorRevisionId: root.id,
    status: "completed" as const,
    operation,
  };
  const forkB = {
    id: "work-a-fork-2",
    activityId: root.activityId,
    predecessorRevisionId: root.id,
    status: "completed" as const,
    operation,
  };
  const forked = selectUniqueCompletedOperationLeaf([root, forkA, forkB], operation);
  assertEquals(forked.status, "unavailable");
  if (forked.status !== "unavailable") return;
  assertEquals(forked.code, "dependency_ambiguous");

  const incomplete = {
    id: "work-a-v2",
    activityId: root.activityId,
    predecessorRevisionId: root.id,
    status: "in-progress" as const,
    operation,
  };
  const notCompleted = selectUniqueCompletedOperationLeaf(
    [root, incomplete],
    operation,
  );
  assertEquals(notCompleted.status, "unavailable");
  if (notCompleted.status !== "unavailable") return;
  assertEquals(notCompleted.code, "producer_unavailable");

  const leaf = {
    id: "work-a-v2",
    activityId: root.activityId,
    predecessorRevisionId: root.id,
    status: "completed" as const,
    operation,
  };
  const selected = selectUniqueCompletedOperationLeaf([root, leaf], operation);
  assertEquals(selected.status, "resolved");
  if (selected.status !== "resolved") return;
  assertEquals(selected.work.id, leaf.id);
});

Deno.test("a trusted current run on a different Thread head fails closed", async () => {
  const world = fixture("retry");
  const input = world.input();
  const project = {
    ...input.project,
    agentRuns: input.project.agentRuns.map((run) =>
      run.id === CURRENT_RUN
        ? {
          ...run,
          basis: {
            kind: "thread-snapshot" as const,
            snapshotId: "thread-dependency-r1",
            revision: 1,
            subjectId: SUBJECT,
          },
        }
        : run
    ),
  };
  const result = await resolveExactCompletedDependencyArtifact({
    ...input,
    project,
  });
  assertEquals(result.status, "unavailable");
  if (result.status === "resolved") return;
  assertEquals(result.code, "current_work_mismatch");
});

type Kind =
  | "retry"
  | "lookalike-on-head"
  | "archived"
  | "stale"
  | "forked"
  | "lookalike-attachment"
  | "sibling";

function fixture(kind: Kind, artifactKind: ThreadArtifact["kind"] = "document") {
  const r1 = snapshot(1);
  const artifact = document(ARTIFACT, DEP_RUN, artifactKind);
  const r2 = snapshot(2, r1, [artifact]);
  const evalArtifact = document("premature-evaluation", "run-premature");
  const r3 = snapshot(3, r2, [artifact, evalArtifact], [evalArtifact.id]);
  const lookalike = document(LOOKALIKE, "run-lookalike");
  const retryHead = snapshot(4, r3, [
    artifact,
    evalArtifact,
    ...(kind === "lookalike-on-head" ? [lookalike] : []),
  ], [evalArtifact.id]);
  const archivedHead = snapshot(3, r2, [artifact], [ARTIFACT]);
  const siblingR2 = snapshot(
    2,
    r1,
    [document("sibling-document", "run-sibling")],
    [],
    "thread-dependency-r2-sibling",
  );
  const siblingHead = snapshot(
    3,
    siblingR2,
    [artifact, document("sibling-document", "run-sibling")],
    [],
    "thread-dependency-r3-sibling",
  );

  const head = kind === "retry" || kind === "lookalike-on-head"
    ? retryHead
    : kind === "archived"
    ? archivedHead
    : kind === "sibling"
    ? siblingHead
    : r2;

  const snapshots = new Map<string, ThreadSnapshot>([
    [r1.id, r1],
    [r2.id, r2],
    [r3.id, r3],
    [retryHead.id, retryHead],
    [archivedHead.id, archivedHead],
    [siblingR2.id, siblingR2],
    [siblingHead.id, siblingHead],
  ]);

  const leaf = work(DEP_WORK, EXPECTED_DEPENDENCY, "completed", [], {
    snapshotId: r2.id,
    snapshotRevision: r2.revision,
    kind: "artifact",
    id: kind === "lookalike-attachment" ? LOOKALIKE : ARTIFACT,
  });
  const successor = work("work-dependency-r2", EXPECTED_DEPENDENCY, "completed", [], {
    snapshotId: r2.id,
    snapshotRevision: r2.revision,
    kind: "artifact",
    id: ARTIFACT,
  }, { activityId: leaf.activityId, predecessorRevisionId: leaf.id });
  const fork = work("work-dependency-fork", EXPECTED_DEPENDENCY, "completed", [], {
    snapshotId: r2.id,
    snapshotRevision: r2.revision,
    kind: "artifact",
    id: ARTIFACT,
  }, { activityId: leaf.activityId, predecessorRevisionId: leaf.id });

  const extraDependencies = kind === "stale"
    ? [successor]
    : kind === "forked"
    ? [successor, fork]
    : [];
  const currentDependsOn = kind === "forked"
    ? successor.id
    : kind === "stale"
    ? leaf.id
    : DEP_WORK;

  const current = work(
    CURRENT_WORK,
    {
      id: CURRENT_OPERATION.id,
      version: CURRENT_OPERATION.version,
      bindings: EXPECTED_DEPENDENCY.bindings,
    },
    "in-progress",
    [currentDependsOn],
  );

  const evidence = {
    snapshotId: r2.id,
    snapshotRevision: r2.revision,
    kind: "artifact" as const,
    id: kind === "lookalike-attachment" ? LOOKALIKE : ARTIFACT,
  };
  const producerRun = {
    id: DEP_RUN,
    workItemId: DEP_WORK,
    status: "completed" as const,
    summary: "Seal",
    queuedAt: AT,
    startedAt: AT,
    completedAt: AT,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: r1.id,
      revision: r1.revision,
      subjectId: SUBJECT,
    },
    resultSnapshot: {
      snapshotId: r2.id,
      revision: r2.revision,
      subjectId: SUBJECT,
    },
    evidenceRefs: kind === "lookalike-attachment" ? [] : [evidence],
  };
  const currentRun = {
    id: CURRENT_RUN,
    workItemId: CURRENT_WORK,
    status: "running" as const,
    summary: "Evaluate",
    queuedAt: AT,
    startedAt: AT,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: head.id,
      revision: head.revision,
      subjectId: SUBJECT,
    },
    evidenceRefs: [],
  };

  const declared = [r1, r2, r3, retryHead, archivedHead, siblingR2, siblingHead]
    .filter((item, index, all) =>
      all.findIndex((other) => other.id === item.id) === index
    )
    .filter((item) => item.id === r1.id || item.id === r2.id || item.id === head.id)
    .map((item) => ({
      snapshotId: item.id,
      revision: item.revision,
      subjectId: SUBJECT,
    }));

  const project = {
    project: { id: "project-dependency", subjectId: SUBJECT },
    threadSnapshots: declared,
    workItems: [leaf, current, ...extraDependencies],
    agentRuns: [producerRun, currentRun],
  } as unknown as EngineeringProjectSnapshot;

  return {
    input: () => ({
      project,
      trustedRunId: CURRENT_RUN,
      head,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: head.id,
        revision: head.revision,
        subjectId: SUBJECT,
      },
      currentOperation: CURRENT_OPERATION,
      expectedDependencyOperation: EXPECTED_DEPENDENCY,
      expectedProducer: EXPECTED_PRODUCER,
      snapshots: {
        get(id: string) {
          return Promise.resolve(snapshots.get(id));
        },
      },
    }),
  };
}

function work(
  id: string,
  operation: {
    readonly id: string;
    readonly version: string;
    readonly bindings: typeof EXPECTED_DEPENDENCY.bindings;
  },
  status: "completed" | "in-progress",
  dependsOnWorkItemIds: readonly string[],
  evidence?: {
    snapshotId: string;
    snapshotRevision: number;
    kind: "artifact";
    id: string;
  },
  lineage: { activityId?: string; predecessorRevisionId?: string } = {},
) {
  return {
    id,
    activityId: lineage.activityId ?? engineeringActivityIdFromRootRevision(id),
    ...(lineage.predecessorRevisionId
      ? { predecessorRevisionId: lineage.predecessorRevisionId }
      : {}),
    phaseId: "phase-dependency",
    title: id,
    description: id,
    kind: "review" as const,
    operation,
    status,
    owner: "agent" as const,
    dependsOnWorkItemIds,
    evidenceRefs: evidence ? [evidence] : [],
    decisionIds: [],
    blockerIds: [],
  };
}

function snapshot(
  revision: number,
  previous?: ThreadSnapshot,
  artifacts: readonly ThreadArtifact[] = [],
  archived: readonly string[] = [],
  id = `thread-dependency-r${revision}`,
): ThreadSnapshot {
  const changes = [
    ...artifacts.map((artifact) => ({
      id: `change-${artifact.id}`,
      kind: "created" as const,
      target: { kind: "artifact" as const, id: artifact.id },
      summary: artifact.id,
      afterFingerprint: artifact.fingerprint,
    })),
    ...archived.map((artifactId) => ({
      id: `change-archive-${artifactId}`,
      kind: "archived" as const,
      target: { kind: "artifact" as const, id: artifactId },
      summary: `Retired ${artifactId}.`,
    })),
  ];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision,
    ...(previous
      ? { previous: { snapshotId: previous.id, revision: previous.revision } }
      : {}),
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Dependency subject",
      kind: "system",
      version: `r${revision}`,
      modelArtifactId: artifacts[0]?.id ?? "artifact-root",
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: `changes-${id}`,
      name: "Dependency",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: changes.length === 0
        ? [{
          id: "change-root",
          kind: "created",
          target: { kind: "artifact", id: "artifact-root" },
          summary: "Root.",
          afterFingerprint: digest("artifact-root"),
        }]
        : changes,
    },
    artifacts: artifacts.length === 0
      ? [document("artifact-root", "run-root")]
      : artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: (changes.length === 0
      ? [{
        id: "change-root",
        kind: "created" as const,
        target: { kind: "artifact" as const, id: "artifact-root" },
        summary: "Root.",
        afterFingerprint: digest("artifact-root"),
      }]
      : changes).map((change) => ({
        id: `provenance-${change.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: change.id },
        to: change.target,
        rationale: change.summary,
      })),
    proposedActions: [],
  });
}

function document(
  id: string,
  runId: string,
  kind: ThreadArtifact["kind"] = "document",
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: "1",
    fingerprint: digest(id),
    producer: {
      serverId: "digital-thread",
      tool: EXPECTED_PRODUCER.tool,
      runId,
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function digest(seed: string) {
  const hex = seed.replace(/[^0-9a-f]/g, "a").padEnd(64, "a").slice(0, 64);
  return { algorithm: "sha256" as const, digest: hex };
}
