import { assertEquals, assertRejects } from "@std/assert";
import type { ElectricalObservationMethodSheetStore } from "../../../ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvidence } from "../../../ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../../../domain/electrical/observation-method-sheet.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import {
  PrepareProjectElectricalObservationMethodSheetSealReview,
  ProjectElectricalObservationMethodSheetSealReviewError,
} from "./prepare-project-electrical-observation-method-sheet-seal-review.ts";

const AT = "2026-08-26T20:00:00.000Z";
const PROJECT_ID = "project.spice-method-preparation";
const SUBJECT_ID = "subject.spice-method-preparation";
const RUN_ID = "run:spice-method-preparation";
const WORK_ID = "work.spice-method-preparation";
const BASE_SNAPSHOT_ID = "thread-spice-method-r1";
const RESULT_SNAPSHOT_ID = "thread-spice-method-r2";
const CAPTURE_DIGEST = "c".repeat(64);
const EVIDENCE_DIGEST = "e".repeat(64);
const RESULT_DIGEST = "a".repeat(64);

Deno.test(
  "electrical method-sheet preparation returns only exact current L3 facts and authoring identities",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute({ projectId: PROJECT_ID });
    assertEquals(result.mode, "preparation");
    if (result.mode !== "preparation") throw new Error("expected preparation");
    assertEquals(result.methodSheet, {
      schemaVersion: "electrical-observation-method-sheet/1.0",
      project: { id: PROJECT_ID, subjectId: SUBJECT_ID },
      subject: { id: SUBJECT_ID },
      basis: {
        snapshotId: RESULT_SNAPSHOT_ID,
        revision: 2,
        fingerprint: await sha256Fingerprint(fixture.snapshot),
      },
      spice: {
        producer: {
          serverId: "digital-thread",
          tool: "simulate.run-admitted-spice@1",
          runId: RUN_ID,
        },
        capture: artifactIdentity("spice-admitted-capture-", CAPTURE_DIGEST),
        evidence: artifactIdentity("spice-admitted-evidence-", EVIDENCE_DIGEST),
        result: artifactIdentity("spice-admitted-result-", RESULT_DIGEST),
      },
    });
    assertEquals(result.l3, {
      observations: fixture.observables,
      limitations: [
        "documentary-operating-point-only",
        "not-a-requirement-verdict",
        "not-l4",
        "not-safety-claim",
      ],
    });
    assertEquals(result.briefItems, [{
      id: "criterion-led-voltage",
      kind: "success-criterion",
    }]);
    const serialized = JSON.stringify(result);
    for (const forbidden of ["provider", "imageReference", "endpoint", "args"]) {
      assertEquals(serialized.includes(forbidden), false);
    }
    for (const invented of ["threshold", "comparator", "verdict", "pass", "fail"]) {
      assertEquals(serialized.includes(`\"${invented}\"`), false);
    }
  },
);

Deno.test(
  "electrical method-sheet preparation fails closed when result bytes diverge from Thread observations",
  async () => {
    const fixture = await harness({
      observables: [{ name: "v(led)", value: 9.5, unit: "V" }],
    });
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectElectricalObservationMethodSheetSealReviewError,
      "diverge",
    );
  },
);

Deno.test(
  "electrical method-sheet review recrosses an unsealed typed sheet against exact L3",
  async () => {
    const fixture = await harness();
    const prepared = await fixture.service.execute({ projectId: PROJECT_ID });
    if (prepared.mode !== "preparation") throw new Error("expected preparation");
    assertEquals(
      fixture.snapshot.artifacts.some((artifact) =>
        artifact.producer.tool ===
          "verify.seal-electrical-observation-method-sheet@1"
      ),
      false,
    );
    const sheet = validateElectricalObservationMethodSheet({
      ...prepared.methodSheet,
      id: "sheet.spice-method-preparation",
      scope: "Review one exact native node-voltage observation.",
      limitations: "This human-authored criterion is bounded to the exact L3 branch.",
      sources: [{
        id: "source.reviewed-brief",
        kind: "human",
        reference: "brief:criterion-led-voltage",
        justification: "The criterion is explicitly reviewed by the responsible human.",
      }],
      criteria: [{
        id: "criterion.led-voltage",
        sourceId: "source.reviewed-brief",
        briefItem: prepared.briefItems[0],
        comparator: "between-inclusive",
        bounds: {
          min: { value: 2, unit: "V" },
          max: { value: 3, unit: "V" },
        },
        expression: { kind: "native-observation", name: "v(led)" },
      }],
      review: {
        authorId: "human:test",
        reviewedAt: AT,
        sealDecisionId: "decision.seal-spice-method",
      },
    });
    const captured = await fixture.sheets.save(sheet);

    const reviewed = await fixture.service.execute({
      projectId: PROJECT_ID,
      sheetFingerprint: captured.fingerprint,
    });

    assertEquals(reviewed.mode, "review");
    if (reviewed.mode !== "review") throw new Error("expected review");
    assertEquals(reviewed.admission.sheetFingerprint, captured.fingerprint);
  },
);

function harness(
  options: { readonly observables?: AdmittedSpiceObservationEvidence["observables"] } =
    {},
) {
  const snapshot = threadSnapshot();
  const project = projectSnapshot();
  const sheets = new MemorySheetStore();
  const observables = options.observables ?? [{
    name: "v(led)",
    value: 2.184,
    unit: "V" as const,
  }, {
    name: "i(v1)",
    value: -0.02975,
    unit: "A" as const,
  }];
  const service = new PrepareProjectElectricalObservationMethodSheetSealReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      getFresh: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      latest: () => Promise.resolve(snapshot),
      save: () => Promise.reject(new Error("read-only preparation must not write")),
    },
    sheets,
    briefGates: {
      read: () =>
        Promise.resolve({
          projectId: PROJECT_ID,
          gates: [{
            id: "criterion-led-voltage",
            kind: "success-criterion" as const,
          }],
        }),
    },
    evidence: { read: () => Promise.resolve({ observables }) },
  });
  return { service, snapshot, observables, sheets };
}

function projectSnapshot(): EngineeringProjectSnapshot {
  const evidenceRefs = [
    evidenceRef(`spice-admitted-capture-${CAPTURE_DIGEST}`),
    evidenceRef(`spice-admitted-evidence-${EVIDENCE_DIGEST}`),
    evidenceRef(`spice-admitted-result-${RESULT_DIGEST}`),
  ];
  const planFingerprint = fingerprint("f");
  const resolvedOperationPlan = {
    schemaVersion: "resolved-operation-plan-ref/1.0" as const,
    planId: RUN_ID,
    fingerprint: planFingerprint,
    byteCount: 128,
    casUri: `casys://resolved-operation-plan/sha256/${planFingerprint.digest}`,
  };
  return {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "SPICE method preparation",
      subjectId: SUBJECT_ID,
      objective: {
        title: "Prepare an electrical method",
        statement: "Read exact admitted SPICE facts before authoring criteria.",
      },
    },
    framing: {
      intent: {
        statement: "Read exact admitted SPICE facts before authoring criteria.",
        source: { kind: "human", reference: "conversation:spice-method" },
        capturedAt: AT,
        capturedBy: { id: "agent:test", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: BASE_SNAPSHOT_ID,
      revision: 1,
      subjectId: SUBJECT_ID,
    }, {
      snapshotId: RESULT_SNAPSHOT_ID,
      revision: 2,
      subjectId: SUBJECT_ID,
    }],
    phases: [{
      id: "phase.spice",
      name: "SPICE",
      order: 1,
      description: "Run the admitted operating point.",
      workItemIds: [WORK_ID],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [{
      id: WORK_ID,
      activityId: `activity:${WORK_ID}`,
      phaseId: "phase.spice",
      title: "Run admitted SPICE",
      description: "Publish factual operating-point observations.",
      kind: "simulate",
      operation: {
        id: "simulate.run-admitted-spice",
        version: "1",
        bindings: [],
      },
      status: "completed",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs,
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [{
      id: RUN_ID,
      workItemId: WORK_ID,
      status: "completed",
      summary: "Recorded the exact admitted SPICE isolated run.",
      queuedAt: AT,
      startedAt: AT,
      completedAt: AT,
      claimedAt: AT,
      claimedBy: { id: "agent:test", origin: "agent" },
      basis: {
        kind: "thread-snapshot",
        snapshotId: BASE_SNAPSHOT_ID,
        revision: 1,
        subjectId: SUBJECT_ID,
      },
      inputFingerprint: fingerprint("b"),
      resolvedOperationPlan,
      evidenceRefs,
      resultSnapshot: {
        snapshotId: RESULT_SNAPSHOT_ID,
        revision: 2,
        subjectId: SUBJECT_ID,
      },
      statusHistory: [{
        commandId: "queue.spice",
        status: "queued",
        at: AT,
        actor: { id: "agent:test", origin: "agent" },
        summary: "Queue admitted SPICE.",
      }, {
        commandId: "complete.spice",
        status: "completed",
        at: AT,
        actor: { id: "agent:test", origin: "agent" },
        summary: "Recorded the exact admitted SPICE isolated run.",
      }],
    }],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "start.project",
      type: "project.start",
      actor: { id: "agent:test", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: fingerprint("1"),
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "queue.spice",
      type: "agent-run.queue",
      actor: { id: "agent:test", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: fingerprint("2"),
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
      queuedRun: {
        runId: RUN_ID,
        workItemId: WORK_ID,
        resolvedOperationPlan,
      },
    }],
  };
}

function threadSnapshot(): ThreadSnapshot {
  const capture = spiceArtifact(
    "document",
    "spice-admitted-capture-",
    CAPTURE_DIGEST,
  );
  const evidence = spiceArtifact(
    "evidence",
    "spice-admitted-evidence-",
    EVIDENCE_DIGEST,
  );
  const result = spiceArtifact(
    "solver-result",
    "spice-admitted-result-",
    RESULT_DIGEST,
  );
  const observations = [
    observation("v(led)", 2.184, "V", evidence.id, result.id),
    observation("i(v1)", -0.02975, "A", evidence.id, result.id),
  ];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: RESULT_SNAPSHOT_ID,
    revision: 2,
    previous: { snapshotId: BASE_SNAPSHOT_ID, revision: 1 },
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "SPICE method preparation",
      kind: "system",
      version: "r2",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes.spice",
      name: "SPICE evidence",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Created the brief.",
        afterFingerprint: fingerprint("1"),
      }],
    },
    artifacts: [
      {
        id: "artifact.brief",
        name: "Brief",
        kind: "document",
        version: "1",
        fingerprint: fingerprint("1"),
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(),
      },
      capture,
      evidence,
      result,
    ],
    consumptions: [],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "provenance.change.brief",
        relation: "changes",
        from: { kind: "change", id: "change.brief" },
        to: { kind: "artifact", id: "artifact.brief" },
        rationale: "The change created the brief.",
      },
      ...observations.flatMap((item) =>
        item.source.artifactIds.map((artifactId) => ({
          id: `${item.id}.from.${artifactId}`,
          relation: "derived_from" as const,
          from: { kind: "observation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifactId },
          rationale: "The exact admitted result produced this native observation.",
        }))
      ),
    ],
    proposedActions: [],
  });
}

function spiceArtifact(
  kind: "document" | "evidence" | "solver-result",
  prefix: string,
  digest: string,
) {
  return {
    id: `${prefix}${digest}`,
    name: prefix,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256" as const, digest },
    producer: {
      serverId: "digital-thread" as const,
      tool: "simulate.run-admitted-spice@1",
      runId: RUN_ID,
    },
    inputArtifactIds: [] as const,
    freshness: fresh(),
  };
}

function observation(
  name: string,
  value: number,
  unit: "V" | "A",
  evidenceId: string,
  resultId: string,
) {
  return {
    id: `observation.${name}`,
    name: `Admitted SPICE ${name}`,
    metric: name,
    quantity: { value, unit },
    source: {
      operation: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-spice@1",
        runId: RUN_ID,
      },
      artifactIds: [evidenceId, resultId],
      capturedAt: AT,
    },
    freshness: fresh(),
  };
}

function evidenceRef(id: string) {
  return {
    snapshotId: RESULT_SNAPSHOT_ID,
    snapshotRevision: 2,
    kind: "artifact" as const,
    id,
  };
}

function artifactIdentity(prefix: string, digest: string) {
  return {
    id: `${prefix}${digest}`,
    fingerprint: { algorithm: "sha256" as const, digest },
  };
}

function fingerprint(char: string): ContentFingerprint {
  return { algorithm: "sha256", digest: char.repeat(64) };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

class MemorySheetStore implements ElectricalObservationMethodSheetStore {
  #sheet: ElectricalObservationMethodSheet | undefined;

  async save(sheet: ElectricalObservationMethodSheet) {
    this.#sheet = sheet;
    const fingerprint = await fingerprintElectricalObservationMethodSheet(sheet);
    return {
      fingerprint,
      uri: `casys://electrical-observation-method-sheet/sha256/${fingerprint.digest}`,
    };
  }

  async read(fingerprint: ContentFingerprint) {
    if (!this.#sheet) return undefined;
    const actual = await fingerprintElectricalObservationMethodSheet(this.#sheet);
    return fingerprintsEqual(actual, fingerprint) ? this.#sheet : undefined;
  }
}
