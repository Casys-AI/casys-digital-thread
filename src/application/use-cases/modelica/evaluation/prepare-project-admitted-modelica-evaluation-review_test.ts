import { assertEquals, assertRejects } from "@std/assert";
import type { ThermalMethodSheetCompilationJoin } from "../../../ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type {
  AdmittedObservationEvidence,
  AdmittedObservationEvidenceReader,
} from "../../../ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import { parseAdmittedObservationEvaluationParameters } from "../../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { validateModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  PrepareProjectAdmittedModelicaEvaluationReview,
  ProjectAdmittedModelicaEvaluationReviewError,
} from "./prepare-project-admitted-modelica-evaluation-review.ts";

const AT = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const EVIDENCE_DIGEST = "c".repeat(64);

Deno.test(
  "admitted Modelica evaluation review derives MRTR from projectId only",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute({ projectId: PROJECT_ID });
    const replay = parseAdmittedObservationEvaluationParameters(
      result.decisionParameters,
    );
    assertEquals(result.admission, replay);
    assertEquals(result.admission.projectId, PROJECT_ID);
    assertEquals(result.method.selections[0]?.outputSymbolId, "placeholder-output");
    assertEquals(result.method.selections[0]?.role, "final");
    assertEquals(
      result.decisionParameters.some((parameter) =>
        parameter.key.includes("feature") || parameter.key.includes("provider")
      ),
      false,
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review rejects caller-selected identities",
  async () => {
    const fixture = await harness();
    await assertRejects(
      () =>
        fixture.service.execute({
          projectId: PROJECT_ID,
          feature: "temperature",
          limit: 80,
          unit: "K",
          provider: "syson",
          tool: "syson_constraint_evaluate",
          args: { solver: "dassl" },
        }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "exact validation",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses an unavailable method sheet",
  async () => {
    const fixture = await harness();
    fixture.sheets.missing = true;
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "unavailable",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses missing admitted evidence",
  async () => {
    const fixture = await harness({ includeEvidence: false });
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "evidence",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review leaves a unit mismatch unresolved",
  async () => {
    const fixture = await harness();
    fixture.evidence.payload = {
      modelName: "placeholder-module",
      outputs: [{ name: "placeholder-output", unit: "K" }],
      metrics: [{
        outputName: "placeholder-output",
        statistic: "final",
        unit: "K",
        value: 0,
      }],
    };
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "unresolved",
    );
  },
);

async function harness(options: { includeEvidence?: boolean } = {}) {
  const includeEvidence = options.includeEvidence !== false;
  const sheet = validateModelicaThermalMethodSheet(
    validThermalMethodSheetPlaceholder(),
  );
  await fingerprintModelicaThermalMethodSheet(sheet);
  const evidenceFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: EVIDENCE_DIGEST,
  };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Thermal evaluation fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Recorded the documentary brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts: [
      {
        id: "artifact.brief",
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
        freshness: fresh(AT),
      },
      ...(includeEvidence
        ? [{
          id: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
          name: "Admitted Modelica normalized evidence",
          kind: "evidence" as const,
          version: EVIDENCE_DIGEST,
          fingerprint: evidenceFingerprint,
          uri: `casys://isolated-output/sha256/${EVIDENCE_DIGEST}`,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "simulate.run-admitted-modelica@1",
            runId: "run.admitted-modelica",
          },
          inputArtifactIds: [],
          freshness: fresh(AT),
        }]
        : []),
    ],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes",
      from: { kind: "change", id: "change.brief" },
      to: { kind: "artifact", id: "artifact.brief" },
      rationale: "The applied change introduced the brief document.",
    }],
    proposedActions: [],
  });
  const objective = "Evaluate admitted Modelica observations.";
  const project = {
    schemaVersion: "3.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:thermal" },
        capturedAt: AT,
        capturedBy: { id: "agent:guide", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: SUBJECT_ID,
    }],
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
  } as unknown as EngineeringProjectSnapshot;
  const sheets = new MemorySheetJoin(sheet);
  const evidence = new MemoryEvidenceReader({
    modelName: "placeholder-module",
    outputs: [{ name: "placeholder-output", unit: "unit-pending-source" }],
    metrics: [{
      outputName: "placeholder-output",
      statistic: "final",
      unit: "unit-pending-source",
      value: 0,
    }],
  });
  const service = new PrepareProjectAdmittedModelicaEvaluationReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      latest: () => Promise.resolve(snapshot),
      save: () => Promise.reject(new Error("review must not write snapshots")),
    },
    methodSheets: sheets,
    evidence,
  });
  return { service, sheets, evidence, snapshot };
}

class MemorySheetJoin implements ThermalMethodSheetCompilationJoin {
  missing = false;
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
  ) {}
  read() {
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve(this.sheet);
  }
}

class MemoryEvidenceReader implements AdmittedObservationEvidenceReader {
  payload: AdmittedObservationEvidence;
  constructor(payload: AdmittedObservationEvidence) {
    this.payload = payload;
  }
  read() {
    return Promise.resolve(this.payload);
  }
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}
