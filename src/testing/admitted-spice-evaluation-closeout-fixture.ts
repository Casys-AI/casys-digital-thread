/**
 * Generic L4 publication topology for admitted SPICE L5 closeout tests.
 *
 * Placeholder identities only. Not product circuit evidence.
 */

import type { ElectricalObservationMethodSheetStore } from "../application/ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvaluationCaptureStore } from "../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evaluation-capture-store.ts";
import type { AdmittedSpiceObservationEvidenceReader } from "../application/ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import {
  canonicalSpiceAdmittedObservationEvaluationCaptureText,
  validateSpiceAdmittedObservationEvaluationCapture,
} from "../adapters/electrical/spice/evaluation/admitted-spice-observation-evaluation-capture.ts";
import { SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "../adapters/shared/cas/file-capture-store.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  electricalObservationMethodSheetUri,
  validateElectricalObservationMethodSheetSealCapture,
} from "../domain/electrical/observation-method-sheet-seal-capture.ts";
import { ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_ADMISSION_SCHEMA } from "../domain/electrical/observation-method-sheet-proposal.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../domain/electrical/observation-method-sheet.ts";
import {
  SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
} from "../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import { spiceDocumentaryRequirementBindings } from "../domain/electrical/spice/evaluation/spice-documentary-requirement-binding.ts";
import { requirementEvaluationIdentity } from "../domain/thread/requirement-evaluation-identity.ts";
import { spiceObservableSlug } from "../domain/electrical/spice/admitted/documentary-thread-evidence.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type {
  RequirementEvaluationStatus,
  ThreadArtifact,
} from "../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../domain/thread/thread-snapshot-validation.ts";
import { validElectricalObservationMethodSheet } from "./electrical-observation-method-sheet-fixtures.ts";

export const SPICE_CLOSEOUT_REVIEW_AT = "2026-08-21T12:00:00.000Z";
export const SPICE_CLOSEOUT_REVIEW_PROJECT_ID = "project.spice-closeout-review";
export const SPICE_CLOSEOUT_REVIEW_SUBJECT_ID = "subject.spice-closeout-review";
export const SPICE_CLOSEOUT_REVIEW_SNAPSHOT_ID = "placeholder-thread-snapshot";
export const SPICE_CLOSEOUT_REVIEW_PREVIOUS_SNAPSHOT_ID =
  "placeholder-thread-snapshot-pre-l4";
export const SPICE_CLOSEOUT_L4_RUN_ID = "run.evaluate-spice-observations";
export const SPICE_CLOSEOUT_L4_WORK_ID = "work.evaluate-spice-observations";
export const SPICE_CLOSEOUT_L3_RUN_ID = "run.admitted-spice";
export const SPICE_CLOSEOUT_L3_WORK_ID = "work.admitted-spice";

export interface AdmittedSpiceCloseoutEvidenceFixtureOptions {
  readonly projectId?: string;
  readonly subjectId?: string;
  readonly evaluationStatus?: RequirementEvaluationStatus;
  readonly l4Count?: 1 | 2;
  readonly includeL4Artifact?: boolean;
  readonly includeSheet?: boolean;
  readonly attachProducerRun?: boolean;
  readonly attachL3Run?: boolean;
  readonly producerTool?: string;
  readonly producerServerId?: string;
  readonly producerRunId?: string;
  readonly producerResultRevision?: number;
  readonly archived?: boolean;
  readonly stale?: boolean;
  readonly l4Body?: unknown;
  readonly captureUri?: string | null;
  readonly sheetForeignProject?: boolean;
  readonly extraSnapshot?: boolean;
  readonly missingResult?: boolean;
}

export interface MemoryTextCaptureStore {
  reads: number;
  saves: number;
  seed(fingerprint: ContentFingerprint, text: string): void;
  save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ fingerprint: ContentFingerprint; uri: string }>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export async function createAdmittedSpiceCloseoutEvidenceFixture(
  options: AdmittedSpiceCloseoutEvidenceFixtureOptions = {},
) {
  const projectId = options.projectId ?? SPICE_CLOSEOUT_REVIEW_PROJECT_ID;
  const subjectId = options.subjectId ?? SPICE_CLOSEOUT_REVIEW_SUBJECT_ID;
  const evaluationStatus = options.evaluationStatus ?? "unresolved";
  const includeL4Artifact = options.includeL4Artifact !== false;
  const includeSheet = options.includeSheet !== false;
  const attachProducerRun = options.attachProducerRun ?? includeL4Artifact;
  const attachL3Run = options.attachL3Run ?? true;
  const l4Count = options.l4Count ?? 1;
  const producerTool = options.producerTool ??
    "verify.evaluate-admitted-spice-observations@1";
  const producerServerId = options.producerServerId ?? "digital-thread";
  const producerRunId = options.producerRunId ?? SPICE_CLOSEOUT_L4_RUN_ID;
  const l3CaptureBody = { kind: "placeholder-spice-admitted-capture", marker: "c" };
  const l3EvidenceBody = { kind: "placeholder-spice-admitted-evidence", marker: "e" };
  const l3ResultBody = { kind: "placeholder-spice-admitted-result", marker: "r" };
  const l3CaptureFingerprint = await sha256Fingerprint(l3CaptureBody);
  const l3EvidenceFingerprint = await sha256Fingerprint(l3EvidenceBody);
  const l3ResultFingerprint = await sha256Fingerprint(l3ResultBody);
  const sheetRecord = validateElectricalObservationMethodSheet(
    closeoutSheet({
      projectId: options.sheetForeignProject === true
        ? "project.foreign-sheet"
        : projectId,
      subjectId: options.sheetForeignProject === true
        ? "subject.foreign-sheet"
        : subjectId,
      captureFingerprint: l3CaptureFingerprint,
      evidenceFingerprint: l3EvidenceFingerprint,
      resultFingerprint: l3ResultFingerprint,
    }),
  );
  const canonicalSheetText = deterministicJson(sheetRecord);
  const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(
    validateElectricalObservationMethodSheet(JSON.parse(canonicalSheetText)),
  );
  if (
    sheetFingerprint.digest !==
      (await sha256Fingerprint(JSON.parse(canonicalSheetText))).digest
  ) {
    throw new TypeError(
      "Canonical electrical observation method-sheet bytes do not rehash to the stored sheet fingerprint.",
    );
  }
  const sheetCaptures = new MemoryTextCaptures();
  const spiceCaptures = new MemoryTextCaptures();
  spiceCaptures.seed(l3CaptureFingerprint, deterministicJson(l3CaptureBody));
  const sheetSeal = includeSheet
    ? await persistMethodSheetSeal(
      sheetCaptures,
      sheetRecord,
      sheetFingerprint,
      canonicalSheetText,
    )
    : undefined;
  const criterion = sheetRecord.criteria[0]!;
  const l4Capture = validateSpiceAdmittedObservationEvaluationCapture({
    schemaVersion: "spice-admitted-observation-evaluation-capture/1.0",
    kind: "spice-admitted-observation-evaluation",
    operation: {
      id: "verify.evaluate-admitted-spice-observations",
      version: "1",
    },
    overall: evaluationStatus,
    evaluations: [{
      criterionId: criterion.id,
      status: evaluationStatus,
      message: evaluationMessage(evaluationStatus),
      comparator: criterion.comparator,
      natives: ["v(n1)"],
      ...(evaluationStatus === "pass" || evaluationStatus === "fail"
        ? { actual: { value: evaluationStatus === "pass" ? 1 : 9, unit: "V" } }
        : {}),
    }],
    limitations: SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
  });
  const storedBody = options.l4Body ?? l4Capture;
  const l4Text = options.l4Body === undefined
    ? canonicalSpiceAdmittedObservationEvaluationCaptureText(l4Capture)
    : deterministicJson(options.l4Body);
  const storedFingerprint = options.l4Body === undefined
    ? await sha256Fingerprint(l4Capture)
    : await sha256Fingerprint(options.l4Body);
  const evaluationCaptures = new MemoryTextCaptures();
  evaluationCaptures.seed(storedFingerprint, l4Text);
  const secondCapture = validateSpiceAdmittedObservationEvaluationCapture({
    ...l4Capture,
    evaluations: l4Capture.evaluations.map((item) => ({
      ...item,
      message: `${item.message} duplicate`,
    })),
  });
  const secondFingerprint = await sha256Fingerprint(secondCapture);
  if (l4Count === 2) {
    evaluationCaptures.seed(
      secondFingerprint,
      canonicalSpiceAdmittedObservationEvaluationCaptureText(secondCapture),
    );
  }
  const brief: ThreadArtifact = {
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
    freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
  };
  const sourceArtifacts: ThreadArtifact[] = [];
  if (sheetSeal) {
    sourceArtifacts.push({
      id: `electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`,
      name: "Electrical observation method sheet",
      kind: "document",
      version: sheetSeal.fingerprint.digest,
      fingerprint: sheetSeal.fingerprint,
      uri:
        `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${sheetSeal.fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-electrical-observation-method-sheet@1",
        runId: "run.seal-sheet",
      },
      inputArtifactIds: [],
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    });
  }
  sourceArtifacts.push(
    {
      id: `spice-admitted-capture-${l3CaptureFingerprint.digest}`,
      name: "Admitted SPICE execution capture",
      kind: "document",
      version: l3CaptureFingerprint.digest,
      fingerprint: l3CaptureFingerprint,
      uri:
        `casys://spice-admitted-execution-capture/sha256/${l3CaptureFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-spice@1",
        runId: SPICE_CLOSEOUT_L3_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    },
    {
      id: `spice-admitted-evidence-${l3EvidenceFingerprint.digest}`,
      name: "Admitted SPICE evidence",
      kind: "evidence",
      version: l3EvidenceFingerprint.digest,
      fingerprint: l3EvidenceFingerprint,
      uri: `casys://isolated-output/sha256/${l3EvidenceFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-spice@1",
        runId: SPICE_CLOSEOUT_L3_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    },
    {
      id: `spice-admitted-result-${l3ResultFingerprint.digest}`,
      name: "Admitted SPICE result",
      kind: "solver-result",
      version: l3ResultFingerprint.digest,
      fingerprint: l3ResultFingerprint,
      uri: `casys://isolated-output/sha256/${l3ResultFingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-spice@1",
        runId: SPICE_CLOSEOUT_L3_RUN_ID,
      },
      inputArtifactIds: [],
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    },
  );
  const l4Fingerprints = [storedFingerprint];
  if (l4Count === 2) l4Fingerprints.push(secondFingerprint);
  const l4Artifacts: ThreadArtifact[] = includeL4Artifact
    ? l4Fingerprints.map((fingerprint, index) => {
      const digest = fingerprint.digest;
      const uri = options.captureUri === null ? undefined : options.captureUri ??
        `${SPICE_ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${digest}`;
      return {
        id: `spice-admitted-observation-evaluation-${digest}`,
        name: "Admitted SPICE observation evaluation",
        kind: "document" as const,
        version: digest,
        fingerprint,
        ...(uri === undefined ? {} : { uri }),
        mediaType: "application/json",
        producer: {
          serverId: producerServerId,
          tool: producerTool,
          runId: producerRunId,
        },
        inputArtifactIds: sourceArtifacts.map((item) => item.id),
        freshness: options.stale === true && index === 0
          ? {
            status: "stale" as const,
            changedAt: SPICE_CLOSEOUT_REVIEW_AT,
            reason: "Superseded by a later evaluation.",
            invalidatedByChangeIds: [
              `change.${`spice-admitted-observation-evaluation-${digest}`}`,
            ],
          }
          : fresh(SPICE_CLOSEOUT_REVIEW_AT),
      };
    })
    : [];
  const observationNeeded = evaluationStatus === "pass" ||
    evaluationStatus === "fail";
  const observationId = `spice-derived-${
    spiceObservableSlug(criterion.id)
  }-${producerRunId}`;
  const primaryL4 = l4Artifacts[0];
  const requirementId = spiceDocumentaryRequirementBindings({
    criterion,
    methodSheetFingerprint: sheetFingerprint,
  })[0]!.requirementId;
  const evaluationId = primaryL4 === undefined
    ? `${requirementId}-evaluation-absent`
    : requirementEvaluationIdentity({
      requirementId,
      evidenceFingerprint: primaryL4.fingerprint,
    }).id;
  const artifacts = [brief, ...sourceArtifacts, ...l4Artifacts];
  const consumptions = l4Artifacts.flatMap((artifact) =>
    sourceArtifacts.map((source) => ({
      id: `consume-${source.id}-by-${artifact.id}`,
      artifactId: source.id,
      consumer: artifact.producer,
      observedFingerprint: source.fingerprint,
      verifiedAt: SPICE_CLOSEOUT_REVIEW_AT,
      status: "verified" as const,
    }))
  );
  const actual = evaluationStatus === "pass"
    ? { value: 1, unit: "V" }
    : evaluationStatus === "fail"
    ? { value: 9, unit: "V" }
    : undefined;
  const evaluations = primaryL4
    ? [{
      id: evaluationId,
      name: `Evaluate ${criterion.id}`,
      requirementId,
      observationIds: observationNeeded ? [observationId] : [],
      status: evaluationStatus,
      evaluatedAt: SPICE_CLOSEOUT_REVIEW_AT,
      evaluator: {
        serverId: producerServerId,
        tool: producerTool,
        runId: producerRunId,
      },
      ...(observationNeeded && actual
        ? {
          comparison: {
            observationId,
            actual,
            operator: "<=" as const,
            limit: { value: 3, unit: "V" },
            normalizedUnit: "V",
          },
        }
        : {}),
      evidenceArtifactIds: [primaryL4.id],
      message: evaluationMessage(evaluationStatus),
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    }]
    : [];
  const violations = evaluationStatus === "fail" && primaryL4
    ? [{
      id: `${evaluationId}-violation`,
      name: `${criterion.id} violation`,
      requirementId,
      evaluationId,
      severity: "error" as const,
      status: "open" as const,
      detectedAt: SPICE_CLOSEOUT_REVIEW_AT,
      observationIds: [observationId],
      evidenceArtifactIds: [primaryL4.id],
      summary: evaluationMessage(evaluationStatus),
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    }]
    : [];
  const proposedActions = evaluationStatus === "fail"
    ? [{
      id: `${evaluationId}-violation-review`,
      name:
        `Review admitted SPICE observation evaluation violation: ${criterion.id} violation`,
      kind: "review" as const,
      readiness: "ready" as const,
      rationale:
        "A human review is required for a failed electrical observation criterion.",
      targets: [{ kind: "artifact" as const, id: primaryL4!.id }],
      addressesViolationIds: [`${evaluationId}-violation`],
      dependsOnActionIds: [] as const,
    }]
    : [];
  const provenance = [
    {
      id: "provenance.change.brief",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "change.brief" },
      to: { kind: "artifact" as const, id: brief.id },
      rationale: "The applied change introduced the brief document.",
    },
    {
      id: "trace-requirement-to-brief",
      relation: "traces_to" as const,
      from: { kind: "requirement" as const, id: requirementId },
      to: { kind: "artifact" as const, id: brief.id },
      rationale: "The placeholder requirement constrains the brief artifact.",
    },
    ...(sheetSeal
      ? [{
        id: `trace-${requirementId}-to-${sheetSeal.fingerprint.digest}`,
        relation: "traces_to" as const,
        from: { kind: "requirement" as const, id: requirementId },
        to: {
          kind: "artifact" as const,
          id:
            `electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`,
        },
        rationale:
          "The documentary electrical requirement is defined by the sealed observation method sheet.",
      }]
      : []),
    ...(primaryL4
      ? [{
        id: `trace-${requirementId}-to-${primaryL4.id}`,
        relation: "traces_to" as const,
        from: { kind: "requirement" as const, id: requirementId },
        to: { kind: "artifact" as const, id: primaryL4.id },
        rationale:
          "The electrical observation requirement traces to the exact L4 evaluation capture.",
      }]
      : []),
    ...l4Artifacts.flatMap((artifact) => [
      {
        id: `change-${artifact.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `change.${artifact.id}` },
        to: { kind: "artifact" as const, id: artifact.id },
        rationale: "The L4 evaluation capture was published.",
      },
      ...sourceArtifacts.map((source) => ({
        id: `derived-from-${source.id}-by-${artifact.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: source.id },
        rationale:
          "The admitted SPICE observation evaluation reopened this exact fingerprint-attested source artifact.",
      })),
      ...sourceArtifacts.map((source) => ({
        id: `uses-consume-${source.id}-by-${artifact.id}`,
        relation: "uses" as const,
        from: {
          kind: "consumption" as const,
          id: `consume-${source.id}-by-${artifact.id}`,
        },
        to: { kind: "artifact" as const, id: source.id },
        rationale: "Exact bytes were reread and fingerprint-attested.",
      })),
    ]),
    ...evaluations.flatMap((item) => [
      {
        id: `evaluates-${item.id}`,
        relation: "evaluates" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "requirement" as const, id: item.requirementId },
        rationale:
          "The admitted SPICE observation evaluation evaluates the documentary method-sheet requirement.",
      },
      {
        id: `evidences-${item.id}`,
        relation: "evidences" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "artifact" as const, id: item.evidenceArtifactIds[0]! },
        rationale: "The evaluation is evidenced by the reread closed-method capture.",
      },
      ...item.observationIds.map((observation) => ({
        id: `${item.id}-uses-${observation}`,
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "observation" as const, id: observation },
        rationale: "The evaluation uses this exact derived quantity.",
      })),
    ]),
    ...(observationNeeded && primaryL4
      ? [{
        id: `${observationId}-from-${primaryL4.id}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observationId },
        to: { kind: "artifact" as const, id: primaryL4.id },
        rationale:
          "The derived observation is computed by the closed electrical comparator from exact native L3 evidence.",
      }, {
        id: `${observationId}-from-spice-admitted-result-${l3ResultFingerprint.digest}`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observationId },
        to: {
          kind: "artifact" as const,
          id: `spice-admitted-result-${l3ResultFingerprint.digest}`,
        },
        rationale:
          "The derived observation is computed by the closed electrical comparator from exact native L3 evidence.",
      }]
      : []),
    ...violations.flatMap((item) => [
      {
        id: `caused-by-${item.id}`,
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "evaluation" as const, id: item.evaluationId },
        rationale:
          "The named violation is caused by the failing admitted SPICE observation evaluation.",
      },
      ...item.evidenceArtifactIds.map((evidenceArtifactId) => ({
        id: `evidences-${item.id}-${evidenceArtifactId}`,
        relation: "evidences" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "artifact" as const, id: evidenceArtifactId },
        rationale:
          "The named violation is evidenced by the exact closed-method capture.",
      })),
    ]),
    ...proposedActions.flatMap((item) =>
      item.addressesViolationIds.map((violation) => ({
        id: `addresses-${item.id}`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: item.id },
        to: { kind: "violation" as const, id: violation },
        rationale: "The proposed review addresses the named violation.",
      }))
    ),
    ...(options.archived === true && primaryL4
      ? [{
        id: "provenance.archive-l4",
        relation: "changes" as const,
        from: { kind: "change" as const, id: "change.archive-l4" },
        to: { kind: "artifact" as const, id: primaryL4.id },
        rationale: "The L4 evaluation capture was archived.",
      }]
      : []),
  ];
  const changes = [
    {
      id: "change.brief",
      kind: "created" as const,
      target: { kind: "artifact" as const, id: brief.id },
      summary: "Recorded the documentary brief.",
      afterFingerprint: brief.fingerprint,
    },
    ...l4Artifacts.map((artifact) => ({
      id: `change.${artifact.id}`,
      kind: "created" as const,
      target: { kind: "artifact" as const, id: artifact.id },
      summary: "Published the L4 evaluation capture.",
      afterFingerprint: artifact.fingerprint,
    })),
    ...(options.archived === true && primaryL4
      ? [{
        id: "change.archive-l4",
        kind: "archived" as const,
        target: { kind: "artifact" as const, id: primaryL4.id },
        summary: "Archived the L4 evaluation capture.",
      }]
      : []),
  ];
  const previousSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: SPICE_CLOSEOUT_REVIEW_PREVIOUS_SNAPSHOT_ID,
    revision: 1,
    generatedAt: SPICE_CLOSEOUT_REVIEW_AT,
    subject: {
      id: subjectId,
      name: "Closeout fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: brief.id,
    },
    freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: SPICE_CLOSEOUT_REVIEW_AT,
      appliedAt: SPICE_CLOSEOUT_REVIEW_AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact" as const, id: brief.id },
        summary: "Recorded the documentary brief.",
        afterFingerprint: brief.fingerprint,
      }],
    },
    artifacts: [brief, ...sourceArtifacts],
    consumptions: [],
    observations: [],
    requirements: [{
      id: requirementId,
      name: `Electrical observation ${criterion.id}`,
      statement:
        `Reviewed brief gate ${criterion.briefItem.id} evaluated by the sealed electrical observation method sheet.`,
      version: sheetFingerprint.digest,
      criterion: {
        metric: criterion.id,
        operator: "<=",
        limit: { value: 3, unit: "V" },
      },
      trace: {
        sourceArtifactId: sheetSeal
          ? `electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`
          : brief.id,
        elementId: criterion.briefItem.id,
        targetArtifactIds: sheetSeal
          ? [`electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`]
          : [brief.id],
      },
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    }],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "provenance.change.brief",
        relation: "changes" as const,
        from: { kind: "change" as const, id: "change.brief" },
        to: { kind: "artifact" as const, id: brief.id },
        rationale: "The applied change introduced the brief document.",
      },
      {
        id: "trace-requirement-to-brief",
        relation: "traces_to" as const,
        from: { kind: "requirement" as const, id: requirementId },
        to: { kind: "artifact" as const, id: brief.id },
        rationale: "The placeholder requirement constrains the brief artifact.",
      },
      ...(sheetSeal
        ? [{
          id: `trace-${requirementId}-to-sheet`,
          relation: "traces_to" as const,
          from: { kind: "requirement" as const, id: requirementId },
          to: {
            kind: "artifact" as const,
            id:
              `electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`,
          },
          rationale:
            "The documentary electrical requirement is defined by the sealed observation method sheet.",
        }]
        : []),
    ],
    proposedActions: [],
  });
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: SPICE_CLOSEOUT_REVIEW_SNAPSHOT_ID,
    revision: 2,
    previous: {
      snapshotId: previousSnapshot.id,
      revision: previousSnapshot.revision,
    },
    generatedAt: SPICE_CLOSEOUT_REVIEW_AT,
    subject: {
      id: subjectId,
      name: "Closeout fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: brief.id,
    },
    freshness: options.stale === true
      ? {
        status: "stale" as const,
        changedAt: SPICE_CLOSEOUT_REVIEW_AT,
        reason: "An L4 evaluation is stale.",
        invalidatedByChangeIds: primaryL4 ? [`change.${primaryL4.id}`] : [],
      }
      : fresh(SPICE_CLOSEOUT_REVIEW_AT),
    changeSet: {
      id: "change-set.closeout",
      name: "Closeout basis",
      status: "applied",
      createdAt: SPICE_CLOSEOUT_REVIEW_AT,
      appliedAt: SPICE_CLOSEOUT_REVIEW_AT,
      changes,
    },
    artifacts,
    consumptions,
    observations: observationNeeded && actual
      ? [{
        id: observationId,
        name: `Derived electrical observation ${criterion.id}`,
        metric: criterion.id,
        quantity: actual,
        source: {
          operation: {
            serverId: producerServerId,
            tool: producerTool,
            runId: producerRunId,
          },
          artifactIds: [
            primaryL4!.id,
            `spice-admitted-result-${l3ResultFingerprint.digest}`,
          ],
          capturedAt: SPICE_CLOSEOUT_REVIEW_AT,
        },
        freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
      }]
      : [],
    requirements: [{
      id: requirementId,
      name: `Electrical observation ${criterion.id}`,
      statement:
        `Reviewed brief gate ${criterion.briefItem.id} evaluated by the sealed electrical observation method sheet.`,
      version: sheetFingerprint.digest,
      criterion: {
        metric: criterion.id,
        operator: "<=",
        limit: { value: 3, unit: "V" },
      },
      trace: {
        sourceArtifactId: sheetSeal
          ? `electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`
          : brief.id,
        elementId: criterion.briefItem.id,
        targetArtifactIds: sheetSeal
          ? [`electrical-observation-method-sheet-seal-${sheetSeal.fingerprint.digest}`]
          : [brief.id],
      },
      freshness: fresh(SPICE_CLOSEOUT_REVIEW_AT),
    }],
    evaluations,
    violations,
    provenance,
    proposedActions,
  });
  const reviewBasis = {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId,
  };
  const basis = {
    kind: "thread-snapshot" as const,
    ...reviewBasis,
  };
  const l4Operation = {
    id: "verify.evaluate-admitted-spice-observations",
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const l3Operation = {
    id: "simulate.run-admitted-spice",
    version: "1",
    bindings: [{
      name: "compilationAdmission",
      source: {
        kind: "thread-entity" as const,
        reference: {
          snapshotId: previousSnapshot.id,
          snapshotRevision: previousSnapshot.revision,
          kind: "artifact" as const,
          id: "artifact.brief",
        },
      },
    }],
  };
  const objective = "Close out the exact L4 evaluation.";
  const project = {
    schemaVersion: "4.0",
    id: `${projectId}:r2`,
    revision: 2,
    previous: { snapshotId: `${projectId}:r1`, revision: 1 },
    generatedAt: SPICE_CLOSEOUT_REVIEW_AT,
    project: {
      id: projectId,
      name: "Closeout review",
      subjectId,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:closeout-review" },
        capturedAt: SPICE_CLOSEOUT_REVIEW_AT,
        capturedBy: { id: "agent:guide", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: options.extraSnapshot === true
      ? [reviewBasis, {
        snapshotId: "historical-thread-snapshot",
        revision: reviewBasis.revision,
        subjectId,
      }]
      : [{
        snapshotId: previousSnapshot.id,
        revision: previousSnapshot.revision,
        subjectId,
      }, reviewBasis],
    phases: [{
      id: "phase.verify",
      name: "Verify",
      order: 1,
      description: "Evaluate and close out observations.",
      workItemIds: [
        ...(attachL3Run ? [SPICE_CLOSEOUT_L3_WORK_ID] : []),
        ...(attachProducerRun ? [SPICE_CLOSEOUT_L4_WORK_ID] : []),
      ],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: [
      ...(attachL3Run
        ? [{
          id: SPICE_CLOSEOUT_L3_WORK_ID,
          activityId: `activity:${SPICE_CLOSEOUT_L3_WORK_ID}`,
          phaseId: "phase.verify",
          title: "Run admitted SPICE",
          description: "Execute admitted SPICE.",
          kind: "simulate",
          operation: l3Operation,
          status: "completed",
          owner: "agent",
          dependsOnWorkItemIds: [],
          evidenceRefs: [{
            snapshotId: previousSnapshot.id,
            snapshotRevision: previousSnapshot.revision,
            kind: "artifact" as const,
            id: `spice-admitted-result-${l3ResultFingerprint.digest}`,
          }],
          decisionIds: [],
          blockerIds: [],
        }]
        : []),
      ...(attachProducerRun
        ? [{
          id: SPICE_CLOSEOUT_L4_WORK_ID,
          activityId: `activity:${SPICE_CLOSEOUT_L4_WORK_ID}`,
          phaseId: "phase.verify",
          title: "Evaluate observations",
          description: "Evaluate admitted SPICE observations.",
          kind: "verify",
          operation: l4Operation,
          status: "completed",
          owner: "agent",
          dependsOnWorkItemIds: attachL3Run ? [SPICE_CLOSEOUT_L3_WORK_ID] : [],
          evidenceRefs: primaryL4
            ? [{
              snapshotId: snapshot.id,
              snapshotRevision: snapshot.revision,
              kind: "artifact",
              id: primaryL4.id,
            }]
            : [],
          decisionIds: [],
          blockerIds: [],
        }]
        : []),
    ],
    agentRuns: [
      ...(attachL3Run
        ? [{
          id: SPICE_CLOSEOUT_L3_RUN_ID,
          workItemId: SPICE_CLOSEOUT_L3_WORK_ID,
          status: "completed",
          summary: "Executed the exact admitted SPICE compilation.",
          queuedAt: SPICE_CLOSEOUT_REVIEW_AT,
          startedAt: SPICE_CLOSEOUT_REVIEW_AT,
          completedAt: SPICE_CLOSEOUT_REVIEW_AT,
          basis: {
            kind: "thread-snapshot",
            snapshotId: previousSnapshot.id,
            revision: previousSnapshot.revision,
            subjectId,
          },
          inputFingerprint: { algorithm: "sha256", digest: "3".repeat(64) },
          evidenceRefs: [{
            snapshotId: previousSnapshot.id,
            snapshotRevision: previousSnapshot.revision,
            kind: "artifact" as const,
            id: `spice-admitted-result-${l3ResultFingerprint.digest}`,
          }],
          resultSnapshot: {
            snapshotId: previousSnapshot.id,
            revision: previousSnapshot.revision,
            subjectId,
          },
        }]
        : []),
      ...(attachProducerRun
        ? [{
          id: SPICE_CLOSEOUT_L4_RUN_ID,
          workItemId: SPICE_CLOSEOUT_L4_WORK_ID,
          status: "completed",
          summary: "Evaluated the exact admitted SPICE observations.",
          queuedAt: SPICE_CLOSEOUT_REVIEW_AT,
          startedAt: SPICE_CLOSEOUT_REVIEW_AT,
          completedAt: SPICE_CLOSEOUT_REVIEW_AT,
          basis: {
            kind: "thread-snapshot",
            snapshotId: previousSnapshot.id,
            revision: previousSnapshot.revision,
            subjectId,
          },
          inputFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
          evidenceRefs: primaryL4
            ? [{
              snapshotId: snapshot.id,
              snapshotRevision: snapshot.revision,
              kind: "artifact",
              id: primaryL4.id,
            }]
            : [],
          resultSnapshot: {
            snapshotId: snapshot.id,
            revision: options.producerResultRevision ?? snapshot.revision,
            subjectId,
          },
        }]
        : []),
    ],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: SPICE_CLOSEOUT_REVIEW_AT,
      appliedAt: SPICE_CLOSEOUT_REVIEW_AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${projectId}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: SPICE_CLOSEOUT_REVIEW_AT,
      appliedAt: SPICE_CLOSEOUT_REVIEW_AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${projectId}:r2`, revision: 2 },
    }],
  } as unknown as EngineeringProjectSnapshot;
  const sheets = new MemorySheetStore(canonicalSheetText, sheetFingerprint);
  const evidenceReads = { reads: 0 };
  const evidence: AdmittedSpiceObservationEvidenceReader = {
    read: (fingerprint) => {
      evidenceReads.reads += 1;
      if (options.missingResult === true) return Promise.resolve(undefined);
      if (fingerprint.digest !== l3ResultFingerprint.digest) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        observables: [{ name: "v(n1)", value: 1, unit: "V" as const }],
      });
    },
  };
  return {
    projectId,
    subjectId,
    project,
    snapshot,
    previousSnapshot,
    basis,
    sheet: sheetRecord,
    sheetFingerprint,
    sheetSeal,
    l4Capture: storedBody,
    l4Fingerprint: storedFingerprint,
    l4Artifact: primaryL4,
    l3ResultFingerprint,
    evaluationCaptures,
    sheetCaptures,
    spiceCaptures,
    sheets,
    evidence,
    evidenceReads,
    dependencies: {
      sheets,
      evaluationCaptures:
        evaluationCaptures as unknown as AdmittedSpiceObservationEvaluationCaptureStore,
      sheetCaptures,
      spiceCaptures,
      evidence,
    },
  };
}

function closeoutSheet(input: {
  readonly projectId: string;
  readonly subjectId: string;
  readonly captureFingerprint: ContentFingerprint;
  readonly evidenceFingerprint: ContentFingerprint;
  readonly resultFingerprint: ContentFingerprint;
}): Record<string, unknown> {
  const sheet = validElectricalObservationMethodSheet();
  const criteria = sheet.criteria as Array<Record<string, unknown>>;
  return {
    ...sheet,
    project: { id: input.projectId, subjectId: input.subjectId },
    subject: { id: input.subjectId },
    basis: {
      snapshotId: SPICE_CLOSEOUT_REVIEW_PREVIOUS_SNAPSHOT_ID,
      revision: 1,
      fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
    },
    spice: {
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-spice@1",
        runId: SPICE_CLOSEOUT_L3_RUN_ID,
      },
      capture: {
        id: `spice-admitted-capture-${input.captureFingerprint.digest}`,
        fingerprint: input.captureFingerprint,
      },
      evidence: {
        id: `spice-admitted-evidence-${input.evidenceFingerprint.digest}`,
        fingerprint: input.evidenceFingerprint,
      },
      result: {
        id: `spice-admitted-result-${input.resultFingerprint.digest}`,
        fingerprint: input.resultFingerprint,
      },
    },
    criteria: [criteria[0]],
  };
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
    sealedAt: SPICE_CLOSEOUT_REVIEW_AT,
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
      nativeObservationNames: ["v(n1)"],
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
  if (fingerprintsEqual(fingerprint, sheetFingerprint)) {
    throw new TypeError(
      "Seal-capture artifact fingerprint must not equal the method-sheet content fingerprint.",
    );
  }
  await captures.save(fingerprint, text);
  return { capture, fingerprint, text };
}

function evaluationMessage(status: RequirementEvaluationStatus): string {
  if (status === "pass") {
    return "The derived observation satisfies the reviewed comparator.";
  }
  if (status === "fail") {
    return "The derived observation does not satisfy the reviewed comparator.";
  }
  if (status === "error") return "The derived observation could not be evaluated.";
  return "Native observation is unresolved on exact L3 evidence.";
}

function fresh(at: string) {
  return {
    status: "fresh" as const,
    changedAt: at,
    invalidatedByChangeIds: [] as const,
  };
}

class MemoryTextCaptures implements MemoryTextCaptureStore {
  reads = 0;
  saves = 0;
  readonly #items = new Map<string, string>();
  seed(fingerprint: ContentFingerprint, text: string) {
    this.#items.set(fingerprint.digest, text);
  }
  save(fingerprint: ContentFingerprint, text: string) {
    this.saves += 1;
    this.#items.set(fingerprint.digest, text);
    return Promise.resolve({
      fingerprint,
      uri: `casys://memory/${fingerprint.digest}`,
    });
  }
  read(fingerprint: ContentFingerprint) {
    this.reads += 1;
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
    if (fingerprint.digest !== this.fingerprint.digest) {
      return undefined;
    }
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
