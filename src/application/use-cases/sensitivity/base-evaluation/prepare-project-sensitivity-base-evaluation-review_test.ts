import { assertEquals, assertRejects } from "@std/assert";
import {
  PrepareProjectSensitivityBaseEvaluationReview,
  ProjectSensitivityBaseEvaluationReviewError,
} from "./prepare-project-sensitivity-base-evaluation-review.ts";
import {
  assembleSensitivityStudyCaseV2,
  validateSensitivityStudyCaseTemplate,
} from "../../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../../domain/sensitivity/study/sensitivity-study.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityStudyCapture,
} from "../../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl05";
const SUBJECT_ID = "project:desk-lamp-dl05";

Deno.test("sensitivity-base evaluation review fails closed when the Thread basis is absent", async () => {
  const review = new PrepareProjectSensitivityBaseEvaluationReview({
    snapshots: emptySnapshots(),
    studyCaptures: { read: () => Promise.resolve(undefined) },
  });
  await assertRejects(
    () =>
      review.execute({
        projectId: PROJECT_ID,
        basis: {
          kind: "thread-snapshot",
          snapshotId: "missing",
          revision: 16,
          subjectId: SUBJECT_ID,
        },
        studyArtifactId: "sensitivity-study-x",
      }),
    ProjectSensitivityBaseEvaluationReviewError,
    "exact Thread basis",
  );
});

Deno.test("sensitivity-base evaluation review is unresolved when the study artifact is absent", async () => {
  const fixture = await harness({ includeStudy: false });
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "capture_not_found");
});

Deno.test("sensitivity-base evaluation review stays UNLINKED when study metrics do not name Thread requirements", async () => {
  const fixture = await harness({
    templatePath: "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
    requirementMetrics: ["maxDisplacement", "maxVonMises"],
  });
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.error.code, "study-metric-unlinked");
});

Deno.test("sensitivity-base evaluation review is ready when each study metric joins one requirement", async () => {
  const fixture = await harness({
    templatePath: "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
    requirementMetrics: ["maxDisplacement", "maxVonMises"],
  });
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") return;
  assertEquals(result.metrics, ["maxDisplacement", "maxVonMises"]);
  assertEquals(fixture.snapshots.saves, 0);
});

async function harness(options: {
  readonly includeStudy?: boolean;
  readonly templatePath?: string;
  readonly requirementMetrics?: readonly string[];
} = {}) {
  const includeStudy = options.includeStudy ?? true;
  const built = includeStudy
    ? await buildStudyWorld(options)
    : await buildBriefOnlyWorld();
  const snapshots = new MemorySnapshots(built.snapshot);
  const captures = new MemoryStudyCaptures(
    built.fingerprint,
    built.captureText,
  );
  const service = new PrepareProjectSensitivityBaseEvaluationReview({
    snapshots,
    studyCaptures: captures,
  });
  return {
    service,
    snapshots,
    command: {
      projectId: PROJECT_ID,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: built.snapshot.id,
        revision: built.snapshot.revision,
        subjectId: SUBJECT_ID,
      },
      studyArtifactId: built.artifactId,
    },
  };
}

function buildBriefOnlyWorld() {
  const briefId = "artifact.brief";
  const briefFp = { algorithm: "sha256" as const, digest: "1".repeat(64) };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.join.brief-only",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "dl05",
      kind: "system",
      version: "1",
      modelArtifactId: briefId,
    },
    freshness: fresh(),
    changeSet: {
      id: "cs-brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [change("change.brief", briefId, briefFp)],
    },
    artifacts: [briefArtifact(briefId, briefFp)],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      link("changes", "change", "change.brief", "artifact", briefId),
    ],
    proposedActions: [],
  });
  return {
    snapshot,
    captureText: undefined as string | undefined,
    fingerprint: briefFp,
    artifactId: "sensitivity-study-absent",
  };
}

async function buildStudyWorld(options: {
  readonly templatePath?: string;
  readonly requirementMetrics?: readonly string[];
}) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        options.templatePath ??
          "config/sensitivity-study-cases/dl05-arm-thickness-isolated.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV2(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: "a".repeat(64),
  });
  const metricIds = studyCase.metrics.map((item) => item.id);
  const base = metricIds.map((metric, index) => ({
    metric,
    value: index === 0 ? 0.307 : 6.34,
    unit: studyCase.metrics[index]!.unit,
  }));
  const stepped = metricIds.map((metric, index) => ({
    metric,
    value: index === 0 ? 0.29 : 6.0,
    unit: studyCase.metrics[index]!.unit,
  }));
  const capture: SensitivityStudyCapture = {
    schemaVersion: SENSITIVITY_STUDY_CAPTURE_SCHEMA,
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    trustedRunId: "run.sensitivity",
    caseDigest: (await sha256Fingerprint(studyCase)).digest,
    studyCase,
    cad: {
      base: {
        executionRunId: "run.sensitivity:cad-base",
        sourceSha256: "1".repeat(64),
        stepSha256: "2".repeat(64),
        stepBytes: 4,
      },
      stepped: {
        executionRunId: "run.sensitivity:cad-stepped",
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
  };
  const fingerprint = await sha256Fingerprint(capture);
  const artifactId = `sensitivity-study-${fingerprint.digest}`;
  const briefId = "artifact.brief";
  const briefFp = { algorithm: "sha256" as const, digest: "1".repeat(64) };
  const requirementMetrics = options.requirementMetrics ?? metricIds;
  const observations = metricIds.map((metric, index) => ({
    id: `sensitivity-base-${metric}-${fingerprint.digest}`,
    name: `${metric} at base`,
    metric,
    quantity: { value: base[index]!.value, unit: base[index]!.unit },
    source: {
      operation: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run.sensitivity",
      },
      artifactIds: [artifactId],
      capturedAt: AT,
    },
    freshness: fresh(),
  }));
  const requirements = requirementMetrics.map((metric) => ({
    id: `requirement-${metric}`,
    name: metric,
    statement: metric,
    version: "1",
    criterion: {
      metric,
      operator: "<=" as const,
      limit: {
        value: metric.toLowerCase().includes("von") ? 60_000_000 : 1,
        unit: metric.toLowerCase().includes("von") ? "Pa" : "mm",
      },
    },
    trace: {
      sourceArtifactId: briefId,
      elementId: `el.${metric}`,
      targetArtifactIds: [briefId],
    },
    freshness: fresh(),
  }));
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.join.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "dl05",
      kind: "system",
      version: "1",
      modelArtifactId: briefId,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.study",
      name: "Study",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [
        change("change.brief", briefId, briefFp),
        change("change.study", artifactId, fingerprint),
      ],
    },
    artifacts: [
      briefArtifact(briefId, briefFp),
      {
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
          runId: "run.sensitivity",
        },
        inputArtifactIds: [briefId],
        freshness: fresh(),
      },
    ],
    consumptions: [{
      id: `consume-${briefId}-by-${artifactId}`,
      artifactId: briefId,
      consumer: {
        serverId: "digital-thread",
        tool: "analyze.run-fea-sensitivity@1",
        runId: "run.sensitivity",
      },
      observedFingerprint: briefFp,
      verifiedAt: AT,
      status: "verified",
    }],
    observations,
    requirements,
    evaluations: [],
    violations: [],
    provenance: [
      link("changes", "change", "change.brief", "artifact", briefId),
      link("changes", "change", "change.study", "artifact", artifactId),
      link(
        "uses",
        "consumption",
        `consume-${briefId}-by-${artifactId}`,
        "artifact",
        briefId,
      ),
      link("derived_from", "artifact", artifactId, "artifact", briefId),
      ...observations.map((item) =>
        link("derived_from", "observation", item.id, "artifact", artifactId)
      ),
      ...requirements.map((item) =>
        link("traces_to", "requirement", item.id, "artifact", briefId)
      ),
    ],
    proposedActions: [],
  });
  return {
    snapshot,
    captureText: JSON.stringify(capture),
    fingerprint,
    artifactId,
  };
}

function briefArtifact(id: string, fingerprint: ContentFingerprint) {
  return {
    id,
    name: "Brief",
    kind: "document" as const,
    version: "1",
    fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: "baseline.from-approved-brief@1",
      runId: "run.brief",
    },
    inputArtifactIds: [] as string[],
    freshness: fresh(),
  };
}

class MemorySnapshots {
  saves = 0;
  constructor(
    private readonly snapshot?: ReturnType<typeof validateThreadSnapshot>,
  ) {}
  get(snapshotId: string) {
    return Promise.resolve(
      this.snapshot && snapshotId === this.snapshot.id ? this.snapshot : undefined,
    );
  }
  latest() {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a Thread snapshot"));
  }
}

function emptySnapshots() {
  return new MemorySnapshots();
}

class MemoryStudyCaptures {
  constructor(
    private readonly fingerprint: ContentFingerprint | undefined,
    private readonly text: string | undefined,
  ) {}
  read(fingerprint: ContentFingerprint) {
    if (
      !this.fingerprint || !this.text ||
      fingerprint.digest !== this.fingerprint.digest
    ) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve(this.text);
  }
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function change(
  id: string,
  artifactId: string,
  fingerprint: ContentFingerprint,
) {
  return {
    id,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifactId },
    summary: `Created ${artifactId}.`,
    afterFingerprint: fingerprint,
  };
}

function link(
  relation: "changes" | "uses" | "derived_from" | "traces_to",
  fromKind: "change" | "consumption" | "artifact" | "observation" | "requirement",
  fromId: string,
  toKind: "artifact",
  toId: string,
) {
  return {
    id: `${relation}:${fromKind}:${fromId}->${toKind}:${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: relation,
  };
}
