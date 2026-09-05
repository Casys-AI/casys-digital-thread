import { assertEquals } from "@std/assert";
import type { ProjectPrescribedKinematicsCaseCaptureUseCase } from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import { validateEngineeringProjectSnapshot } from "../../domain/project/engineering-project-validation.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { PrepareProjectPrescribedKinematicsCaseReview } from "./prepare-project-prescribed-kinematics-case-review.ts";

const PROJECT_FIXTURE = new URL(
  "../../testing/generic-engineering-project.fixture.json",
  import.meta.url,
);
const PROJECT_ID = "generic-test-system";
const SUBJECT_ID = "generic-test-system";
const SNAPSHOT_ID = "generic-test-system:r5:generic-baseline";
const ARCHITECTURE_ID = `architecture-${"a".repeat(64)}`;
const ARCHITECTURE_FINGERPRINT = {
  algorithm: "sha256" as const,
  digest: "a".repeat(64),
};

Deno.test("prescribed-kinematics L1 review refuses a source closure that is not declared against the current Thread", async () => {
  const result = await review({
    snapshotId: "thread-historical",
    revision: 4,
    subjectId: SUBJECT_ID,
  }).review(command());

  assertEquals(result.status, "unavailable");
  if (result.status !== "unavailable") return;
  assertEquals(result.diagnostic.code, "basis_not_current");
});

Deno.test("prescribed-kinematics L1 review refuses to invent a root when architecture producer work is absent", async () => {
  const result = await review({
    snapshotId: SNAPSHOT_ID,
    revision: 5,
    subjectId: SUBJECT_ID,
  }).review(command());

  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.diagnostic.code, "architecture_producer_unresolved");
});

Deno.test("prescribed-kinematics L1 review refuses a completed foreign architecture producer work item", async () => {
  const result = await review({
    snapshotId: SNAPSHOT_ID,
    revision: 5,
    subjectId: SUBJECT_ID,
  }, {
    id: "model.write-requirements",
    version: "1",
  }).review(command());

  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.diagnostic.code, "architecture_producer_unresolved");
});

function review(declaredAgainst: {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}, producerOperation?: {
  readonly id: string;
  readonly version: string;
}): PrepareProjectPrescribedKinematicsCaseReview {
  const capture: ProjectPrescribedKinematicsCaseCaptureUseCase = {
    capture: () =>
      Promise.resolve({
        status: "resolved",
        grants: "none",
        sealedCase: {
          sourceClosure: {
            workspace: {
              declaredAgainst: {
                thread: declaredAgainst,
                architecture: {
                  artifactId: ARCHITECTURE_ID,
                  fingerprint: ARCHITECTURE_FINGERPRINT,
                  captureSchema: "architecture-capture/4.0",
                },
              },
            },
          },
          fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
        } as never,
      }),
  };
  const snapshots = currentSnapshots();
  return new PrepareProjectPrescribedKinematicsCaseReview({
    capture,
    projects: {
      get: async (projectId) => {
        if (projectId !== PROJECT_ID) return undefined;
        const project = JSON.parse(await Deno.readTextFile(PROJECT_FIXTURE));
        if (producerOperation) {
          const work = project.workItems.find((candidate: { id: string }) =>
            candidate.id === "establish-product-architecture"
          );
          work.operation = { ...producerOperation, bindings: [] };
          project.agentRuns = [{
            id: "run-architecture",
            workItemId: work.id,
            status: "completed",
            summary: "Completed a foreign producer operation.",
            queuedAt: "2026-08-31T00:00:00.000Z",
            completedAt: "2026-08-31T00:00:01.000Z",
            basis: {
              kind: "thread-snapshot",
              snapshotId: SNAPSHOT_ID,
              revision: 5,
              subjectId: SUBJECT_ID,
            },
            inputFingerprint: {
              algorithm: "sha256",
              digest: "c".repeat(64),
            },
            evidenceRefs: [],
            annotationOnly: true,
          }];
        }
        return validateEngineeringProjectSnapshot(project);
      },
    },
    snapshots: {
      get: (snapshotId) => Promise.resolve(snapshots.get(snapshotId)),
      getFresh: (snapshotId) => Promise.resolve(snapshots.get(snapshotId)),
    },
  });
}

function command() {
  return {
    projectId: PROJECT_ID,
    workspaceRevision: 2,
    attachmentId: "attachment-assembly",
    attachmentRevision: 1,
  };
}

function currentSnapshots() {
  return new Map(
    [1, 2, 3, 4, 5].map((revision) => {
      const id = snapshotId(revision);
      return [id, currentSnapshot(id, revision)] as const;
    }),
  );
}

function snapshotId(revision: number): string {
  return revision === 5
    ? SNAPSHOT_ID
    : `generic-test-system:r${revision}:generic-baseline`;
}

function currentSnapshot(id: string, revision: number) {
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id,
    revision,
    ...(revision > 1
      ? { previous: { snapshotId: snapshotId(revision - 1), revision: revision - 1 } }
      : {}),
    generatedAt: "2026-08-31T00:00:00.000Z",
    subject: {
      id: SUBJECT_ID,
      name: "Generic Test System",
      kind: "system",
      version: "5",
      modelArtifactId: ARCHITECTURE_ID,
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-31T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
    changeSet: {
      id: "change-architecture",
      name: "Architecture",
      status: "applied",
      createdAt: "2026-08-31T00:00:00.000Z",
      appliedAt: "2026-08-31T00:00:00.000Z",
      changes: [],
    },
    artifacts: [{
      id: ARCHITECTURE_ID,
      name: "Architecture",
      kind: "sysml-model",
      version: "1",
      fingerprint: ARCHITECTURE_FINGERPRINT,
      uri: `casys://architecture-capture/sha256/${ARCHITECTURE_FINGERPRINT.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "model.write-architecture@1",
        runId: "run-architecture",
      },
      inputArtifactIds: [],
      freshness: {
        status: "fresh",
        changedAt: "2026-08-31T00:00:00.000Z",
        invalidatedByChangeIds: [],
      },
    }],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  });
}
