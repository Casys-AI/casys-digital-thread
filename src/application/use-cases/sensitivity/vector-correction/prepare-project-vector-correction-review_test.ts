import { assertEquals, assertRejects } from "@std/assert";
import {
  PrepareProjectVectorCorrectionReview,
  ProjectVectorCorrectionReviewError,
} from "./prepare-project-vector-correction-review.ts";
import {
  assembleSensitivityStudyCaseV3,
  validateSensitivityStudyCaseTemplate,
} from "../../../../domain/sensitivity/study/sensitivity-study-template.ts";
import { computeSensitivities } from "../../../../domain/sensitivity/study/sensitivity-study.ts";
import { parseVectorCorrectionDecisionParameters } from "../../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import { VECTOR_CORRECTION_UNLINKED_LABEL } from "../../../../domain/sensitivity/vector-correction/vector-correction-origin.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  type SensitivityStudyCapture,
} from "../../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  makeSensitivityStudyReuseResult,
  SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
  type SensitivityStudyResult,
} from "../../../../domain/sensitivity/study/sensitivity-study-result.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "desk-lamp-dl04";
const SUBJECT_ID = "lamp-arm";
const METRIC = "assembly_max_displacement";

Deno.test("the review tool does not persist any Thread artefact", async () => {
  const fixture = await harness();
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") return;
  parseVectorCorrectionDecisionParameters(result.decisionParameters);
  assertEquals(fixture.snapshots.saves, 0);
  assertEquals(fixture.captures.saves, 0);
});

Deno.test("vector-correction review signs the exact reused-result artifact id", async () => {
  const fixture = await harness({ reuseResult: true });
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "ready-for-review");
  if (result.status !== "ready-for-review") return;
  const signed = parseVectorCorrectionDecisionParameters(result.decisionParameters);
  assertEquals(
    signed.studyCapture.artifactId,
    `${SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX}${signed.studyCapture.fingerprint.digest}`,
  );
});

Deno.test("une évaluation UNLINKED à la study capture ne produit aucun decisionParameters", async () => {
  const fixture = await harness({ unlinkEvaluation: true });
  const result = await fixture.service.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.decisionParameters, undefined);
  assertEquals(result.error.code, "evaluation-unlinked");
  assertEquals(result.error.context.label, VECTOR_CORRECTION_UNLINKED_LABEL);
});

Deno.test("vector-correction review rejects a missing study capture", async () => {
  const fixture = await harness();
  fixture.captures.missing = true;
  await assertRejects(
    () => fixture.service.execute(fixture.command),
    ProjectVectorCorrectionReviewError,
    "unavailable",
  );
});

async function harness(
  options: {
    readonly unlinkEvaluation?: boolean;
    readonly reuseResult?: boolean;
  } = {},
) {
  const built = await buildStudyWorld(options);
  const snapshots = new MemorySnapshots(built.snapshot);
  const captures = new MemoryStudyCaptures(built.fingerprint, built.captureText);
  const service = new PrepareProjectVectorCorrectionReview({
    snapshots,
    studyCaptures: captures,
  });
  return {
    service,
    snapshots,
    captures,
    command: {
      projectId: PROJECT_ID,
      basis: {
        kind: "thread-snapshot" as const,
        snapshotId: built.snapshot.id,
        revision: built.snapshot.revision,
        subjectId: SUBJECT_ID,
      },
      evaluationId: built.evaluationId,
      studyArtifactId: built.artifactId,
    },
  };
}

async function buildStudyWorld(
  options: {
    readonly unlinkEvaluation?: boolean;
    readonly reuseResult?: boolean;
  } = {},
) {
  const template = validateSensitivityStudyCaseTemplate(
    JSON.parse(
      await Deno.readTextFile(
        "config/sensitivity-study-cases/dl04-size-z-sensitivity.json",
      ),
    ),
  );
  const studyCase = assembleSensitivityStudyCaseV3(template, {
    artifactUri: `thread-artifact://${PROJECT_ID}/admission`,
    sha256: "a".repeat(64),
  });
  const base = [
    { metric: "assembly_max_displacement", value: 1.004, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 10, unit: "MPa" },
  ];
  const stepped = [
    { metric: "assembly_max_displacement", value: 0.996, unit: "mm" },
    { metric: "assembly_max_von_mises", value: 8, unit: "MPa" },
  ];
  const freshCapture: SensitivityStudyCapture = {
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
  const capture: SensitivityStudyResult = options.reuseResult
    ? await makeSensitivityStudyReuseResult({
      trustedRunId: "run.sensitivity",
      studyCase,
      record: {
        result: {
          measurements: { base, stepped },
          derivatives: freshCapture.derivatives,
        },
      } as never,
      reuseReceiptFingerprint: {
        algorithm: "sha256",
        digest: "6".repeat(64),
      },
      capturedAt: AT,
    })
    : freshCapture;
  const fingerprint = await sha256Fingerprint(capture);
  const artifactId = options.reuseResult
    ? `${SENSITIVITY_STUDY_REUSE_ARTIFACT_ID_PREFIX}${fingerprint.digest}`
    : `sensitivity-study-${fingerprint.digest}`;
  const observationId = `sensitivity-base-${METRIC}-${fingerprint.digest}`;
  const citedObservationId = options.unlinkEvaluation ? "obs:proof" : observationId;
  const evaluationId = "eval:disp";
  const requirementId = "req:disp";
  const briefId = "artifact.brief";
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snapshot.vector.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Lamp arm",
      kind: "part",
      version: "r1",
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
        change("change.brief", briefId, {
          algorithm: "sha256",
          digest: "1".repeat(64),
        }),
        change("change.study", artifactId, fingerprint),
      ],
    },
    artifacts: [
      {
        id: briefId,
        name: "Brief",
        kind: "document",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(),
      },
      {
        id: artifactId,
        name: "Sensitivity study",
        kind: options.reuseResult ? "document" : "evidence",
        version: fingerprint.digest,
        fingerprint,
        uri: options.reuseResult
          ? `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${fingerprint.digest}`
          : `casys://sensitivity-study-capture/sha256/${fingerprint.digest}`,
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
      observedFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [
      {
        id: observationId,
        name: `${METRIC} at base`,
        metric: METRIC,
        quantity: { value: 1.004, unit: "mm" },
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
      },
      ...(options.unlinkEvaluation
        ? [{
          id: "obs:proof",
          name: "Proof displacement",
          metric: METRIC,
          quantity: { value: 1.2, unit: "mm" },
          source: {
            operation: {
              serverId: "digital-thread",
              tool: "verify.run-fea-static-proof@3",
              runId: "run.proof",
            },
            artifactIds: [briefId],
            capturedAt: AT,
          },
          freshness: fresh(),
        }]
        : []),
    ],
    requirements: [{
      id: requirementId,
      name: "Displacement limit",
      statement: "Stay under 1 mm",
      version: "1",
      criterion: { metric: METRIC, operator: "<=", limit: { value: 1, unit: "mm" } },
      trace: {
        sourceArtifactId: briefId,
        elementId: "el.disp",
        targetArtifactIds: [briefId],
      },
      freshness: fresh(),
    }],
    evaluations: [{
      id: evaluationId,
      name: "Failing displacement",
      requirementId,
      observationIds: [citedObservationId],
      status: "fail",
      evaluatedAt: AT,
      evaluator: { serverId: "test", tool: "test", runId: "run.eval" },
      comparison: {
        observationId: citedObservationId,
        actual: { value: options.unlinkEvaluation ? 1.2 : 1.004, unit: "mm" },
        operator: "<=",
        limit: { value: 1, unit: "mm" },
        normalizedUnit: "mm",
      },
      evidenceArtifactIds: [],
      message: "Fails",
      freshness: fresh(),
    }],
    violations: [{
      id: "violation:disp",
      name: "Displacement exceeds limit",
      requirementId,
      evaluationId,
      severity: "error",
      status: "open",
      detectedAt: AT,
      observationIds: [citedObservationId],
      evidenceArtifactIds: [],
      summary: "The study-base displacement exceeds 1 mm.",
      freshness: fresh(),
    }],
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
      link("derived_from", "observation", observationId, "artifact", artifactId),
      ...(options.unlinkEvaluation
        ? [link("derived_from", "observation", "obs:proof", "artifact", briefId)]
        : []),
      link("traces_to", "requirement", requirementId, "artifact", briefId),
      link("evaluates", "evaluation", evaluationId, "requirement", requirementId),
      link("uses", "evaluation", evaluationId, "observation", citedObservationId),
      link("caused_by", "violation", "violation:disp", "evaluation", evaluationId),
      link("addresses", "action", "action:review-disp", "violation", "violation:disp"),
    ],
    proposedActions: [{
      id: "action:review-disp",
      name: "Review the displacement failure",
      kind: "review",
      readiness: "ready",
      rationale: "Review the failing evaluation.",
      targets: [{ kind: "evaluation", id: evaluationId }],
      addressesViolationIds: ["violation:disp"],
      dependsOnActionIds: [],
    }],
  });
  return {
    snapshot,
    captureText: JSON.stringify(capture),
    fingerprint,
    artifactId,
    evaluationId,
  };
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
  relation:
    | "changes"
    | "uses"
    | "derived_from"
    | "traces_to"
    | "evaluates"
    | "caused_by"
    | "addresses",
  fromKind:
    | "change"
    | "consumption"
    | "artifact"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "action",
  fromId: string,
  toKind: "artifact" | "requirement" | "observation" | "evaluation" | "violation",
  toId: string,
) {
  return {
    id: `${relation}:${fromKind}:${fromId}->${toKind}:${toId}`,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale: `${relation} link`,
  };
}

class MemorySnapshots {
  saves = 0;
  constructor(private readonly snapshot: ThreadSnapshot) {}
  get(snapshotId: string) {
    return Promise.resolve(
      snapshotId === this.snapshot.id ? this.snapshot : undefined,
    );
  }
  getFresh(snapshotId: string) {
    return this.get(snapshotId);
  }
  latest(_subjectId: string) {
    return Promise.resolve(this.snapshot);
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a Thread snapshot"));
  }
}

class MemoryStudyCaptures {
  saves = 0;
  missing = false;
  constructor(
    private readonly fingerprint: ContentFingerprint,
    private readonly text: string,
  ) {}
  read(fingerprint: ContentFingerprint) {
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve(
      fingerprint.digest === this.fingerprint.digest ? this.text : undefined,
    );
  }
  save() {
    this.saves += 1;
    return Promise.reject(new Error("review must not persist a capture"));
  }
}
