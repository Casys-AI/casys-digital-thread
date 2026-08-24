import { assertEquals, assertRejects } from "@std/assert";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  electricalObservationMethodSheetUri,
  validateElectricalObservationMethodSheetSealCapture,
} from "../../../../../domain/electrical/observation-method-sheet-seal-capture.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../../ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvidence } from "../../../../ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import { ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA } from "../../../../../domain/electrical/observation-method-sheet-proposal.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  methodSheetNativeObservationNames,
  validateElectricalObservationMethodSheet,
} from "../../../../../domain/electrical/observation-method-sheet.ts";
import {
  evaluateAdmittedSpiceObservations,
  fingerprintSpiceAdmittedObservationEvaluationMethod,
} from "../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import { parseSpiceAdmittedObservationEvaluationParameters } from "../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import type { ElectricalObservationNativeBinding } from "../../../../../domain/electrical/spice/evaluation/expression.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../../../domain/project/engineering-project.ts";
import { validateThreadSnapshot } from "../../../../../domain/thread/thread-snapshot-validation.ts";
import { validElectricalObservationMethodSheet } from "../../../../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  PrepareProjectAdmittedSpiceEvaluationReview,
  ProjectAdmittedSpiceEvaluationReviewError,
} from "./prepare-project-admitted-spice-evaluation-review.ts";

const AT = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = "project.electrical-method";
const SUBJECT_ID = "subject.electrical-method";

const UNIQUE_NATIVES: readonly ElectricalObservationNativeBinding[] = [
  { name: "v(n1)", value: 3, unit: "V" },
  { name: "i(vsrc)", value: -2, unit: "A" },
];

Deno.test(
  "admitted SPICE evaluation review admits unitAlgebra by id and fingerprint only",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute({ projectId: PROJECT_ID });
    const replay = parseSpiceAdmittedObservationEvaluationParameters(
      result.decisionParameters,
    );
    assertEquals(result.admission, replay);
    assertEquals("version" in result.admission.unitAlgebra, false);
    assertEquals(result.admission.unitAlgebra, {
      id: result.method.unitAlgebra.id,
      fingerprint: result.method.unitAlgebra.fingerprint,
    });
    assertEquals(result.method.unitAlgebra.version, "1.0.0");
    assertEquals(
      await fingerprintSpiceAdmittedObservationEvaluationMethod(result.method),
      result.admission.methodFingerprint,
    );
    assertEquals(
      result.decisionParameters.some((parameter) =>
        parameter.key.includes("unitAlgebra.version")
      ),
      false,
    );
  },
);

Deno.test(
  "admitted SPICE evaluation review stays available when a native is missing or not unique",
  async () => {
    const missingNatives: readonly ElectricalObservationNativeBinding[] = [
      { name: "i(vsrc)", value: -2, unit: "A" },
    ];
    const missing = await harness({ observables: missingNatives });
    const missingReview = await missing.service.execute({
      projectId: PROJECT_ID,
    });
    assertEquals(missingReview.admission.projectId, PROJECT_ID);
    assertEquals(
      (await evaluateAdmittedSpiceObservations(missing.sheet, missingNatives))
        .overall,
      "unresolved",
    );

    const duplicateNatives: readonly ElectricalObservationNativeBinding[] = [
      { name: "v(n1)", value: 3, unit: "V" },
      { name: "v(n1)", value: 1, unit: "V" },
      { name: "i(vsrc)", value: -2, unit: "A" },
    ];
    const duplicate = await harness({ observables: duplicateNatives });
    const duplicateReview = await duplicate.service.execute({
      projectId: PROJECT_ID,
    });
    assertEquals(duplicateReview.admission.projectId, PROJECT_ID);
    assertEquals(
      (await evaluateAdmittedSpiceObservations(duplicate.sheet, duplicateNatives))
        .overall,
      "unresolved",
    );
  },
);

Deno.test(
  "admitted SPICE evaluation review refuses wrong CAS or provenance",
  async () => {
    const cas = await harness({ corruptSealBytes: true });
    await assertRejects(
      () => cas.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedSpiceEvaluationReviewError,
      "fingerprint",
    );
    const provenance = await harness({ foreignProducerRun: true });
    await assertRejects(
      () => provenance.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedSpiceEvaluationReviewError,
      "method sheet names no fresh",
    );
  },
);

async function harness(
  options: {
    readonly observables?: readonly ElectricalObservationNativeBinding[];
    readonly corruptSealBytes?: boolean;
    readonly foreignProducerRun?: boolean;
  } = {},
) {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(
    sheet,
  );
  const canonicalSheetText = deterministicJson(sheet);
  const sheetCaptures = new MemoryTextCaptures();
  const seal = await persistMethodSheetSeal(
    sheetCaptures,
    sheet,
    sheetFingerprint,
    canonicalSheetText,
  );
  if (options.corruptSealBytes === true) {
    sheetCaptures.seed(seal.fingerprint, `${seal.text} `);
  }
  const producerRunId = options.foreignProducerRun === true
    ? "foreign-admitted-spice-run"
    : sheet.spice.producer.runId;
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: sheet.basis.snapshotId,
    revision: sheet.basis.revision,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Electrical evaluation fixture",
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
      {
        id: `electrical-observation-method-sheet-seal-${seal.fingerprint.digest}`,
        name: "Electrical observation method sheet",
        kind: "document",
        version: seal.fingerprint.digest,
        fingerprint: seal.fingerprint,
        uri:
          `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${seal.fingerprint.digest}`,
        mediaType: "application/json",
        producer: {
          serverId: "digital-thread",
          tool: "verify.seal-electrical-observation-method-sheet@1",
          runId: "run.seal-sheet",
        },
        inputArtifactIds: [],
        freshness: fresh(AT),
      },
      spiceArtifact(
        "document",
        "Admitted SPICE execution capture",
        sheet.spice.capture,
        producerRunId,
      ),
      spiceArtifact(
        "evidence",
        "Admitted SPICE evidence",
        sheet.spice.evidence,
        producerRunId,
      ),
      spiceArtifact(
        "solver-result",
        "Admitted SPICE result",
        sheet.spice.result,
        producerRunId,
      ),
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
  const objective = "Evaluate admitted SPICE observations.";
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Electrical method",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:electrical" },
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
  const observables = options.observables ?? UNIQUE_NATIVES;
  const evidence = new MemoryEvidenceReader({ observables });
  const service = new PrepareProjectAdmittedSpiceEvaluationReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      latest: () => Promise.resolve(snapshot),
      save: () => Promise.reject(new Error("review must not write snapshots")),
    },
    sheets: new MemorySheetStore(canonicalSheetText, sheetFingerprint),
    sheetCaptures,
    evidence,
  });
  return { service, sheet, observables, snapshot };
}

async function persistMethodSheetSeal(
  captures: MemoryTextCaptures,
  sheet: ReturnType<typeof validateElectricalObservationMethodSheet>,
  sheetFingerprint: ContentFingerprint,
  canonicalSheetText: string,
) {
  if (canonicalSheetText !== deterministicJson(sheet)) {
    throw new TypeError(
      "Seal capture signed sheet fingerprint is not the canonical sheet bytes.",
    );
  }
  const capture = validateElectricalObservationMethodSheetSealCapture({
    schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "electrical-observation-method-sheet-seal",
    operation: {
      id: "verify.seal-electrical-observation-method-sheet",
      version: "1",
    },
    trustedRunId: "run.seal-sheet",
    decisionId: sheet.review.sealDecisionId,
    sealedAt: AT,
    admission: {
      schemaVersion: ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
      sheetSchemaVersion: sheet.schemaVersion,
      sheetId: sheet.id,
      sheetFingerprint,
      projectId: sheet.project.id,
      subjectId: sheet.subject.id,
      basis: sheet.basis,
      sealDecisionId: sheet.review.sealDecisionId,
    },
    sheet: {
      id: sheet.id,
      fingerprint: sheetFingerprint,
      uri: electricalObservationMethodSheetUri(sheetFingerprint),
    },
    recross: {
      briefGates: "matched",
      briefItemIds: sheet.criteria.map((item) => item.briefItem.id),
      nativeObservationNames: [...methodSheetNativeObservationNames(sheet)],
    },
  });
  const text = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(JSON.parse(text));
  if (
    !fingerprintsEqual(capture.admission.sheetFingerprint, sheetFingerprint) ||
    !fingerprintsEqual(capture.sheet.fingerprint, sheetFingerprint) ||
    capture.sheet.id !== sheet.id
  ) {
    throw new TypeError(
      "Seal capture signed sheet identity is not the stored sheet fingerprint.",
    );
  }
  captures.seed(fingerprint, text);
  return { capture, fingerprint, text };
}

function spiceArtifact(
  kind: "document" | "evidence" | "solver-result",
  name: string,
  declared: { readonly id: string; readonly fingerprint: ContentFingerprint },
  runId: string,
) {
  return {
    id: declared.id,
    name,
    kind,
    version: declared.fingerprint.digest,
    fingerprint: declared.fingerprint,
    producer: {
      serverId: "digital-thread" as const,
      tool: "simulate.run-admitted-spice@1",
      runId,
    },
    inputArtifactIds: [] as const,
    freshness: fresh(AT),
  };
}

class MemoryTextCaptures {
  readonly #items = new Map<string, string>();
  seed(fingerprint: ContentFingerprint, text: string) {
    this.#items.set(fingerprint.digest, text);
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.#items.get(fingerprint.digest));
  }
}

class MemorySheetStore implements ElectricalObservationMethodSheetStore {
  constructor(
    readonly text: string,
    readonly fingerprint: ContentFingerprint,
  ) {}
  save() {
    return Promise.reject(new Error("review must not write sheets"));
  }
  async read(fingerprint: ContentFingerprint) {
    if (fingerprint.digest !== this.fingerprint.digest) return undefined;
    const sheet = validateElectricalObservationMethodSheet(JSON.parse(this.text));
    const actual = await fingerprintElectricalObservationMethodSheet(sheet);
    if (!fingerprintsEqual(actual, fingerprint)) {
      throw new TypeError(
        "Reopened electrical observation method sheet fingerprint does not match the requested digest.",
      );
    }
    return sheet;
  }
}

class MemoryEvidenceReader {
  constructor(readonly payload: AdmittedSpiceObservationEvidence) {}
  read() {
    return Promise.resolve(this.payload);
  }
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}
