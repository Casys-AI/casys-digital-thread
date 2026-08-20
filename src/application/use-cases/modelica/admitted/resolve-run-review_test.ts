import { assert, assertEquals, assertRejects } from "@std/assert";
import type {
  ProjectAdmittedModelicaRunReviewCommand,
  ProjectAdmittedModelicaRunReviewResult,
} from "../../../ports/in/modelica/admitted-run-review.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadFreshness,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  ResolveProjectAdmittedModelicaRunReview,
  ResolveProjectAdmittedModelicaRunReviewError,
} from "./resolve-run-review.ts";

const PROJECT_ID = "project.modelica-mr02";
const SUBJECT_ID = "subject.modelica-mr02";
const AT = "2026-08-20T05:00:00.000Z";
const RESULT = Object.freeze({
  admission: Object.freeze({ marker: "exact-review" }),
  decisionParameters: Object.freeze([]),
}) as unknown as ProjectAdmittedModelicaRunReviewResult;

class CapturingExactReview {
  readonly calls: ProjectAdmittedModelicaRunReviewCommand[] = [];

  constructor(private readonly failure?: Error) {}

  execute(value: unknown): Promise<ProjectAdmittedModelicaRunReviewResult> {
    this.calls.push(
      structuredClone(value) as ProjectAdmittedModelicaRunReviewCommand,
    );
    return this.failure ? Promise.reject(this.failure) : Promise.resolve(RESULT);
  }
}

Deno.test("admitted Modelica public review resolves current tip and delegates its unique fresh admission", async () => {
  const admission = admissionArtifact("a".repeat(64));
  const snapshot = threadSnapshot([admission]);
  const exactReview = new CapturingExactReview();
  let exactReads = 0;
  let freshReads = 0;
  const service = new ResolveProjectAdmittedModelicaRunReview({
    projects: {
      get: () => Promise.resolve(projectSnapshot(snapshot)),
    },
    snapshots: {
      get: () => {
        exactReads += 1;
        return Promise.resolve(undefined);
      },
      getFresh: (snapshotId) => {
        freshReads += 1;
        return Promise.resolve(snapshotId === snapshot.id ? snapshot : undefined);
      },
    },
    exactReview,
  });

  const result = await service.execute({ projectId: PROJECT_ID });

  assert(result === RESULT);
  assertEquals(freshReads, 1);
  assertEquals(exactReads, 0);
  assertEquals(exactReview.calls, [{
    projectId: PROJECT_ID,
    basis: {
      kind: "thread-snapshot",
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    },
    artifactId: admission.id,
    artifactFingerprint: admission.fingerprint,
  }]);
});

Deno.test("admitted Modelica public review refuses ambiguous fresh admissions", async () => {
  const snapshot = threadSnapshot([
    admissionArtifact("a".repeat(64)),
    admissionArtifact("b".repeat(64)),
  ]);
  const fixture = reviewFixture(snapshot);

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_ambiguous",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses a stale admission", async () => {
  const artifact = admissionArtifact("a".repeat(64), {
    status: "stale",
    changedAt: AT,
    reason: "Superseded on the current Thread tip.",
    invalidatedByChangeIds: [
      `change.technical-compilation-admission-${"a".repeat(64)}`,
    ],
  });
  const fixture = reviewFixture(threadSnapshot([artifact]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses an admission from the wrong producer", async () => {
  const artifact = {
    ...admissionArtifact("a".repeat(64)),
    producer: {
      serverId: "digital-thread",
      tool: "compile.capture-corrected-source@1",
      runId: "run.compile",
    },
  } satisfies ThreadArtifact;
  const fixture = reviewFixture(threadSnapshot([artifact]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses an archived-only admission", async () => {
  const artifact = admissionArtifact("a".repeat(64));
  const fixture = reviewFixture(threadSnapshot([artifact], [artifact.id]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted Modelica public review ignores an archived admission and selects the sole live canonical one", async () => {
  const archived = admissionArtifact("a".repeat(64));
  const current = admissionArtifact("b".repeat(64));
  const fixture = reviewFixture(
    threadSnapshot([archived, current], [archived.id]),
  );

  await fixture.service.execute({ projectId: PROJECT_ID });

  assertEquals(fixture.exactReview.calls.length, 1);
  assertEquals(fixture.exactReview.calls[0]?.artifactId, current.id);
  assertEquals(
    fixture.exactReview.calls[0]?.artifactFingerprint,
    current.fingerprint,
  );
});

Deno.test("admitted Modelica public review excludes a corrupt canonical lookalike", async () => {
  const artifact = {
    ...admissionArtifact("a".repeat(64)),
    uri: "casys://technical-compilation-admission-capture/sha256/corrupt",
  } satisfies ThreadArtifact;
  const fixture = reviewFixture(threadSnapshot([artifact]));

  await assertResolutionError(
    () => fixture.service.execute({ projectId: PROJECT_ID }),
    "admission_not_found",
  );
  assertEquals(fixture.exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses ambiguous current Thread tips at the V3 boundary", async () => {
  const snapshot = threadSnapshot([admissionArtifact("a".repeat(64))]);
  const project = projectSnapshot(snapshot, [{
    snapshotId: "snapshot.modelica-mr02-conflict",
    revision: snapshot.revision,
    subjectId: SUBJECT_ID,
  }]);
  const exactReview = new CapturingExactReview();
  const service = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });

  await assertResolutionError(
    () => service.execute({ projectId: PROJECT_ID }),
    "project_integrity_failed",
  );
  assertEquals(exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses a legacy V1 project", async () => {
  const snapshot = threadSnapshot([admissionArtifact("a".repeat(64))]);
  const exactReview = new CapturingExactReview();
  const service = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(legacyProjectSnapshot(snapshot)) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });

  await assertResolutionError(
    () => service.execute({ projectId: PROJECT_ID }),
    "project_integrity_failed",
  );
  assertEquals(exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses missing, foreign, and corrupt projects", async () => {
  const snapshot = threadSnapshot([admissionArtifact("a".repeat(64))]);
  const exactReview = new CapturingExactReview();
  const missing = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(undefined) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });
  await assertResolutionError(
    () => missing.execute({ projectId: PROJECT_ID }),
    "project_not_found",
  );

  const foreignProject = {
    ...projectSnapshot(snapshot),
    project: { ...projectSnapshot(snapshot).project, id: "project.foreign" },
  } satisfies EngineeringProjectSnapshot;
  const foreign = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(foreignProject) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });
  await assertResolutionError(
    () => foreign.execute({ projectId: PROJECT_ID }),
    "project_integrity_failed",
  );

  const corruptProject = {
    ...projectSnapshot(snapshot),
    unsupported: true,
  } as unknown as EngineeringProjectSnapshot;
  const corrupt = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(corruptProject) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });
  await assertResolutionError(
    () => corrupt.execute({ projectId: PROJECT_ID }),
    "project_integrity_failed",
  );
  assertEquals(exactReview.calls, []);
});

Deno.test("admitted Modelica public review refuses missing, foreign, and corrupt current snapshots", async () => {
  const snapshot = threadSnapshot([admissionArtifact("a".repeat(64))]);
  const project = projectSnapshot(snapshot);
  const exactReview = new CapturingExactReview();
  const missing = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: { get: () => Promise.resolve(undefined) },
    exactReview,
  });
  await assertResolutionError(
    () => missing.execute({ projectId: PROJECT_ID }),
    "snapshot_not_found",
  );

  const foreignSnapshot = {
    ...snapshot,
    id: "snapshot.modelica-foreign-r5",
  } satisfies ThreadSnapshot;
  const foreign = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: { get: () => Promise.resolve(foreignSnapshot) },
    exactReview,
  });
  await assertResolutionError(
    () => foreign.execute({ projectId: PROJECT_ID }),
    "snapshot_integrity_failed",
  );

  const corruptSnapshot = {
    ...snapshot,
    unsupported: true,
  } as unknown as ThreadSnapshot;
  const corrupt = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: { get: () => Promise.resolve(corruptSnapshot) },
    exactReview,
  });
  await assertResolutionError(
    () => corrupt.execute({ projectId: PROJECT_ID }),
    "snapshot_integrity_failed",
  );
  assertEquals(exactReview.calls, []);
});

Deno.test("admitted Modelica public review propagates exact-review lineage failure", async () => {
  const admission = admissionArtifact("a".repeat(64));
  const snapshot = threadSnapshot([admission]);
  const exactReview = new CapturingExactReview(
    new Error("The exact Thread lineage is not intact."),
  );
  const service = new ResolveProjectAdmittedModelicaRunReview({
    projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
    snapshots: { get: () => Promise.resolve(snapshot) },
    exactReview,
  });

  await assertRejects(
    () => service.execute({ projectId: PROJECT_ID }),
    Error,
    "Thread lineage is not intact",
  );
  assertEquals(exactReview.calls.length, 1);
});

function reviewFixture(snapshot: ThreadSnapshot): {
  readonly service: ResolveProjectAdmittedModelicaRunReview;
  readonly exactReview: CapturingExactReview;
} {
  const exactReview = new CapturingExactReview();
  return {
    service: new ResolveProjectAdmittedModelicaRunReview({
      projects: { get: () => Promise.resolve(projectSnapshot(snapshot)) },
      snapshots: {
        get: (snapshotId) =>
          Promise.resolve(snapshotId === snapshot.id ? snapshot : undefined),
      },
      exactReview,
    }),
    exactReview,
  };
}

function projectSnapshot(
  snapshot: ThreadSnapshot,
  extraThreadSnapshots: readonly EngineeringThreadSnapshotRef[] = [],
): EngineeringProjectSnapshot {
  const objective = "Review the exact sealed Modelica source before execution.";
  return {
    schemaVersion: "3.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Modelica MR02",
      subjectId: SUBJECT_ID,
      objective: {
        title: objective,
        statement: objective,
      },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:mr02" },
        capturedAt: AT,
        capturedBy: { id: "agent:guide", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }, ...extraThreadSnapshots],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
    }],
  };
}

function legacyProjectSnapshot(
  snapshot: ThreadSnapshot,
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "1.0",
    id: `${PROJECT_ID}:legacy-r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Legacy Modelica project",
      subjectId: SUBJECT_ID,
      objective: {
        title: "Legacy Modelica project",
        statement: "This valid legacy project must not authorize a V3 run review.",
      },
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: snapshot.subject.id,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
  };
}

function threadSnapshot(
  artifacts: readonly ThreadArtifact[],
  archivedArtifactIds: readonly string[] = [],
): ThreadSnapshot {
  const createdChanges = artifacts.map((artifact) => ({
    id: `change.${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `Created ${artifact.id}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  const archivedChanges = archivedArtifactIds.map((artifactId) => ({
    id: `archive.${artifactId}`,
    kind: "archived" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Archived ${artifactId}.`,
  }));
  const changes = [...createdChanges, ...archivedChanges];
  const staleChangeIds = artifacts.flatMap((artifact) =>
    artifact.freshness.status === "stale"
      ? artifact.freshness.invalidatedByChangeIds
      : []
  );
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.modelica-mr02-r5",
    revision: 5,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Modelica MR02",
      kind: "system",
      version: "r5",
      modelArtifactId: artifacts[0]!.id,
    },
    freshness: staleChangeIds.length === 0 ? fresh() : {
      status: "stale",
      changedAt: AT,
      reason: "The admission on this Thread tip is stale.",
      invalidatedByChangeIds: staleChangeIds,
    },
    changeSet: {
      id: "change-set.modelica-mr02-r5",
      name: "Modelica admission basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes,
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...artifacts.map((artifact) => ({
        id: `provenance.${artifact.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `change.${artifact.id}` },
        to: { kind: "artifact" as const, id: artifact.id },
        rationale: `Created ${artifact.id}.`,
      })),
      ...archivedArtifactIds.map((artifactId) => ({
        id: `provenance.archive.${artifactId}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `archive.${artifactId}` },
        to: { kind: "artifact" as const, id: artifactId },
        rationale: `Archived ${artifactId}.`,
      })),
    ],
    proposedActions: [],
  });
}

function admissionArtifact(
  digest: string,
  freshness: ThreadFreshness = fresh(),
): ThreadArtifact {
  const id = `technical-compilation-admission-${digest}`;
  return {
    id,
    name: "Technical compilation admission",
    kind: "document",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://technical-compilation-admission-capture/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "compile.seal-admission@1",
      runId: "run.compile",
    },
    inputArtifactIds: [],
    freshness,
  };
}

function fresh(): ThreadFreshness {
  return { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] };
}

async function assertResolutionError(
  operation: () => Promise<unknown>,
  code: ResolveProjectAdmittedModelicaRunReviewError["code"],
): Promise<void> {
  const error = await assertRejects(
    operation,
    ResolveProjectAdmittedModelicaRunReviewError,
  );
  assertEquals(error.code, code);
}
