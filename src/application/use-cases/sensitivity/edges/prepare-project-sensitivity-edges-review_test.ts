import { assertEquals } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import { MODEL_WRITE_SENSITIVITY_EDGES_OPERATION } from "../../../../domain/sensitivity/study/sensitivity-study-proposal.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  validateSensitivityStudyCapture,
} from "../../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../../domain/sensitivity/study/sensitivity-study.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { PrepareProjectSensitivityEdgesReview } from "./prepare-project-sensitivity-edges-review.ts";

const AT = "2026-09-09T00:00:00.000Z";
const PROJECT_ID = "inspection-drone-id01";
const SUBJECT_ID = "project:inspection-drone-id01";

Deno.test("sensitivity-edges review emits one exact typed append/propose route", async () => {
  const fixture = await createFixture();
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") return;
  assertEquals(result.edges.length, 1);
  assertEquals(result.partDefName, "Id01RadialArmHeightIsolatedEdges");
  assertEquals(
    result.next.append.arguments.workItems[0]?.operation,
    {
      id: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.id,
      version: MODEL_WRITE_SENSITIVITY_EDGES_OPERATION.version,
      bindings: [{
        name: "studyCapture",
        source: {
          kind: "thread-entity",
          reference: {
            snapshotId: fixture.snapshot.id,
            snapshotRevision: fixture.snapshot.revision,
            kind: "artifact",
            id: fixture.artifactId,
          },
        },
      }],
    },
  );
  assertEquals(result.next.append.arguments.expectedRevision, 1);
  assertEquals(result.next.propose.arguments.expectedRevision, 2);
  assertEquals(fixture.snapshots.saves, 0);
});

Deno.test("sensitivity-edges review refuses a basis without generic architecture", async () => {
  const fixture = await createFixture({ hasArchitecture: false });
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "architecture-unavailable");
});

Deno.test("sensitivity-edges review emits no next hop for a historical project basis", async () => {
  const fixture = await createFixture({ historical: true });
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "basis-not-current");
});

async function createFixture(options: {
  readonly hasArchitecture?: boolean;
  readonly historical?: boolean;
} = {}) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/id01-radial-arm-height-isolated.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: "a".repeat(64),
  });
  const base = studyCase.metrics.map((metric) => ({
    metric: metric.id,
    value: 0.148,
    unit: metric.unit,
  }));
  const stepped = studyCase.metrics.map((metric) => ({
    metric: metric.id,
    value: 0.086,
    unit: metric.unit,
  }));
  const capture = await validateSensitivityStudyCapture({
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run:id01-sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run:cad-stepped",
        sourceSha256: "3".repeat(64),
        stepSha256: "4".repeat(64),
        stepBytes: 4,
      },
    },
    measurements: { base, stepped },
    derivatives: computeSensitivities(
      studyCase,
      new Map(base.map((item) => [item.metric, item])),
      new Map(stepped.map((item) => [item.metric, item])),
    ),
    capturedAt: AT,
  });
  const fingerprint = await sha256Fingerprint(capture);
  const artifactId = `sensitivity-study-${fingerprint.digest}`;
  const briefFingerprint = { algorithm: "sha256" as const, digest: "b".repeat(64) };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "project:inspection-drone-id01:r95:sensitivity",
    revision: 95,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "ID01",
      kind: "system",
      version: "1",
      modelArtifactId: "brief",
    },
    freshness: fresh(),
    changeSet: {
      id: "change.sensitivity",
      name: "Sensitivity",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.study",
        kind: "created",
        target: { kind: "artifact", id: artifactId },
        summary: "Published sensitivity study.",
        afterFingerprint: fingerprint,
      }],
    },
    artifacts: [{
      id: "brief",
      name: "Brief",
      kind: "document",
      version: "1",
      fingerprint: briefFingerprint,
      producer: {
        serverId: "digital-thread",
        tool: "baseline.from-approved-brief@1",
        runId: "run:brief",
      },
      inputArtifactIds: [],
      freshness: fresh(),
    }, {
      id: artifactId,
      name: "Sensitivity study",
      kind: "evidence",
      version: fingerprint.digest,
      fingerprint,
      uri: `casys://sensitivity-study-capture/sha256/${fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run:id01-sensitivity",
      },
      inputArtifactIds: ["brief"],
      freshness: fresh(),
    }],
    consumptions: [{
      id: "consume-brief-by-study",
      artifactId: "brief",
      consumer: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run:id01-sensitivity",
      },
      observedFingerprint: briefFingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.study",
      relation: "changes",
      from: { kind: "change", id: "change.study" },
      to: { kind: "artifact", id: artifactId },
      rationale: "The applied change published the sensitivity study.",
    }, {
      id: "provenance.study.from.brief",
      relation: "derived_from",
      from: { kind: "artifact", id: artifactId },
      to: { kind: "artifact", id: "brief" },
      rationale: "The study consumes the reviewed brief basis.",
    }, {
      id: "provenance.study.uses.brief",
      relation: "uses",
      from: { kind: "consumption", id: "consume-brief-by-study" },
      to: { kind: "artifact", id: "brief" },
      rationale: "The study verified the brief fingerprint.",
    }],
    proposedActions: [],
  });
  const project = projectFor(snapshot, artifactId, options.historical === true);
  const snapshots = new MemorySnapshots(snapshot);
  const review = new PrepareProjectSensitivityEdgesReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots,
    studyCaptures: {
      read: (candidate) =>
        Promise.resolve(
          candidate.digest === fingerprint.digest
            ? deterministicJson(capture)
            : undefined,
        ),
    },
    hasArchitecture: () => options.hasArchitecture !== false,
  });
  return {
    review,
    snapshots,
    snapshot,
    artifactId,
    command: {
      projectId: PROJECT_ID,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        subjectId: SUBJECT_ID,
      },
      studyArtifactId: artifactId,
    },
  };
}

function projectFor(
  snapshot: ReturnType<typeof validateThreadSnapshot>,
  artifactId: string,
  historical: boolean,
): EngineeringProjectSnapshot {
  const basis = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: SUBJECT_ID,
  };
  const current = historical
    ? {
      snapshotId: "project:inspection-drone-id01:r96:newer",
      revision: 96,
      subjectId: SUBJECT_ID,
    }
    : basis;
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:project:r1`,
    revision: 1,
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "ID01",
      subjectId: SUBJECT_ID,
      objective: { title: "Review", statement: "Review sensitivity." },
    },
    threadSnapshots: historical ? [basis, current] : [basis],
    phases: [{
      id: "phase.source",
      name: "Source",
      order: 1,
      description: "Run study.",
      workItemIds: ["work.source"],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: "work.source",
      activityId: "activity:work.source",
      phaseId: "phase.source",
      title: "Run study",
      description: "Run study.",
      kind: "simulate",
      operation: {
        id: "analyze.run-fea-sensitivity",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: "run:id01-sensitivity",
      workItemId: "work.source",
      status: "completed",
      summary: "Published sensitivity.",
      queuedAt: AT,
      startedAt: AT,
      claimedAt: AT,
      completedAt: AT,
      basis: { kind: "thread-snapshot", ...basis },
      inputFingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
      resultSnapshot: basis,
      evidenceRefs: [{
        snapshotId: snapshot.id,
        snapshotRevision: snapshot.revision,
        kind: "artifact",
        id: artifactId,
      }],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  };
}

class MemorySnapshots {
  saves = 0;
  constructor(private readonly snapshot: ReturnType<typeof validateThreadSnapshot>) {}
  get(snapshotId: string) {
    return Promise.resolve(snapshotId === this.snapshot.id ? this.snapshot : undefined);
  }
  latest() {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist"));
  }
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
