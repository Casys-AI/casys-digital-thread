/**
 * Generic L4 publication topology for admitted Modelica L5 closeout tests.
 *
 * Placeholder identities only. Not lamp evidence and not a production kit.
 */

import type { AdmittedObservationEvaluationCaptureStore } from "../application/ports/out/modelica/evaluation/admitted-observation-evaluation-capture-store.ts";
import type { ThermalMethodSheetStore } from "../application/ports/out/modelica/thermal-method-sheet-store.ts";
import {
  canonicalAdmittedObservationEvaluationCaptureText,
  validateAdmittedObservationEvaluationCapture,
} from "../adapters/modelica/evaluation/admitted-observation-evaluation-capture.ts";
import { ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX } from "../adapters/shared/cas/file-capture-store.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
  MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  thermalMethodSheetUri,
  validateModelicaThermalMethodSheetSealCapture,
} from "../adapters/modelica/thermal-method-sheet/thermal-method-sheet-seal-capture.ts";
import {
  MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
} from "../domain/modelica/thermal-method-sheet-proposal.ts";
import { requirementEvaluationIdentity } from "../domain/thread/requirement-evaluation-identity.ts";
import {
  fingerprintModelicaThermalMethodSheet,
  MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
  validateModelicaThermalMethodSheet,
} from "../domain/modelica/thermal-method-sheet.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type {
  RequirementEvaluationStatus,
  ThreadArtifact,
} from "../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../domain/thread/thread-snapshot-validation.ts";
import { validThermalMethodSheetPlaceholder } from "./modelica-thermal-method-sheet-fixtures.ts";

export const CLOSEOUT_REVIEW_AT = "2026-08-21T12:00:00.000Z";
export const CLOSEOUT_REVIEW_PROJECT_ID = "project.closeout-review";
export const CLOSEOUT_REVIEW_SUBJECT_ID = "subject.closeout-review";
export const CLOSEOUT_REVIEW_SNAPSHOT_ID = "placeholder-thread-snapshot";
export const CLOSEOUT_REVIEW_PREVIOUS_SNAPSHOT_ID =
  "placeholder-thread-snapshot-pre-l4";
export const CLOSEOUT_REVIEW_L4_RUN_ID = "run.evaluate-observations";
export const CLOSEOUT_REVIEW_L4_WORK_ID = "work.evaluate-observations";
export const CLOSEOUT_REVIEW_CAPTURE_DIGEST = "a".repeat(64);
export const CLOSEOUT_REVIEW_EVIDENCE_DIGEST = "b".repeat(64);
export const CLOSEOUT_REVIEW_RESULT_DIGEST = "c".repeat(64);

export type CloseoutReviewEvaluationStatus = RequirementEvaluationStatus;

export interface AdmittedModelicaCloseoutEvidenceFixtureOptions {
  readonly projectId?: string;
  readonly subjectId?: string;
  readonly evaluationStatus?: CloseoutReviewEvaluationStatus;
  readonly l4Count?: 1 | 2;
  readonly includeL4Artifact?: boolean;
  readonly includeSheet?: boolean;
  readonly attachProducerRun?: boolean;
  readonly producerTool?: string;
  readonly producerServerId?: string;
  readonly producerRunId?: string;
  readonly producerResultRevision?: number;
  readonly archived?: boolean;
  readonly stale?: boolean;
  readonly l4Body?: unknown;
  readonly captureRows?:
    | "default"
    | "duplicate"
    | "extra"
    | "overlap"
    | "missing-computed"
    | "unit-mismatch"
    | "non-numeric";
  readonly captureUri?: string | null;
  readonly sheetForeignProject?: boolean;
  readonly extraSnapshot?: boolean;
  readonly threadRequirementId?: string;
  readonly extraSheetOutputRequirementElementId?: string;
  readonly sheetRequirementElementId?: string;
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

export async function createAdmittedModelicaCloseoutEvidenceFixture(
  options: AdmittedModelicaCloseoutEvidenceFixtureOptions = {},
) {
  const projectId = options.projectId ?? CLOSEOUT_REVIEW_PROJECT_ID;
  const subjectId = options.subjectId ?? CLOSEOUT_REVIEW_SUBJECT_ID;
  const evaluationStatus = options.evaluationStatus ?? "unresolved";
  const threadRequirementId = options.threadRequirementId ??
    "placeholder-requirement";
  const elementId = "placeholder-requirement";
  const includeL4Artifact = options.includeL4Artifact !== false;
  const includeSheet = options.includeSheet !== false;
  const attachProducerRun = options.attachProducerRun ?? includeL4Artifact;
  const l4Count = options.l4Count ?? 1;
  const producerTool = options.producerTool ??
    "verify.evaluate-admitted-modelica-observations@1";
  const producerServerId = options.producerServerId ?? "digital-thread";
  const producerRunId = options.producerRunId ?? CLOSEOUT_REVIEW_L4_RUN_ID;
  const sheetRecord = validateModelicaThermalMethodSheet(
    withOptionalSheetOutput(
      withSheetRequirementElementId(
        {
          ...validThermalMethodSheetPlaceholder(),
          project: {
            id: options.sheetForeignProject === true
              ? "project.foreign-sheet"
              : projectId,
            subjectId: options.sheetForeignProject === true
              ? "subject.foreign-sheet"
              : subjectId,
          },
          subject: {
            id: options.sheetForeignProject === true
              ? "subject.foreign-sheet"
              : subjectId,
          },
          basis: {
            snapshotId: CLOSEOUT_REVIEW_SNAPSHOT_ID,
            revision: 1,
            fingerprint: { algorithm: "sha256", digest: "0".repeat(64) },
          },
        },
        options.sheetRequirementElementId,
      ),
      options.extraSheetOutputRequirementElementId,
    ),
  );
  const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(
    sheetRecord,
  );
  const sheetCaptures = new MemoryTextCaptures();
  const sheetSeal = includeSheet
    ? await persistMethodSheetSeal(sheetCaptures, sheetRecord, sheetFingerprint)
    : undefined;
  const l4Capture = validateAdmittedObservationEvaluationCapture({
    schemaVersion: "modelica-admitted-observation-evaluation-capture/1.0",
    kind: "modelica-admitted-observation-evaluation",
    operation: {
      id: "verify.evaluate-admitted-modelica-observations",
      version: "1",
    },
    request: {
      name: "syson_constraint_evaluate",
      arguments: { constraints: [], values: {} },
    },
    response: {
      structuredContent: {
        results: evaluationStatus === "unresolved" ? [] : [{
          constraintId: elementId,
          status: evaluationStatus,
          computedValue: 0,
          threshold: 1,
          margin: 1,
          marginPercent: 100,
          unit: "unit-pending-source",
        }],
      },
    },
    unresolved: evaluationStatus === "unresolved"
      ? [{
        requirementElementId: "placeholder-requirement",
        reason: "unit-identity-mismatch",
      }]
      : [],
  });
  const captureForStore = options.l4Body === undefined &&
      options.captureRows !== undefined && options.captureRows !== "default"
    ? validateAdmittedObservationEvaluationCapture(
      captureRowVariant(l4Capture, options.captureRows),
    )
    : l4Capture;
  const storedBody = options.l4Body ?? captureForStore;
  const l4Text = options.l4Body === undefined
    ? canonicalAdmittedObservationEvaluationCaptureText(captureForStore)
    : deterministicJson(options.l4Body);
  const storedFingerprint = options.l4Body === undefined
    ? await sha256Fingerprint(captureForStore)
    : await sha256Fingerprint(options.l4Body);
  const evaluationCaptures = new MemoryTextCaptures();
  evaluationCaptures.seed(storedFingerprint, l4Text);
  const secondCapture = validateAdmittedObservationEvaluationCapture({
    ...l4Capture,
    request: {
      name: "syson_constraint_evaluate",
      arguments: { constraints: [], values: { marker: 1 } },
    },
  });
  const secondFingerprint = await sha256Fingerprint(secondCapture);
  if (l4Count === 2) {
    evaluationCaptures.seed(
      secondFingerprint,
      canonicalAdmittedObservationEvaluationCaptureText(secondCapture),
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
    freshness: fresh(CLOSEOUT_REVIEW_AT),
  };
  const sourceArtifacts: ThreadArtifact[] = [];
  if (sheetSeal) {
    sourceArtifacts.push({
      id: `modelica-thermal-method-sheet-seal-${sheetSeal.fingerprint.digest}`,
      name: "Modelica thermal method sheet",
      kind: "document",
      version: sheetSeal.fingerprint.digest,
      fingerprint: sheetSeal.fingerprint,
      uri:
        `${MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${sheetSeal.fingerprint.digest}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "verify.seal-modelica-thermal-method-sheet@1",
        runId: "run.seal-sheet",
      },
      inputArtifactIds: [],
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    });
  }
  sourceArtifacts.push(
    {
      id: `modelica-admitted-capture-${CLOSEOUT_REVIEW_CAPTURE_DIGEST}`,
      name: "Admitted Modelica execution capture",
      kind: "document",
      version: CLOSEOUT_REVIEW_CAPTURE_DIGEST,
      fingerprint: {
        algorithm: "sha256",
        digest: CLOSEOUT_REVIEW_CAPTURE_DIGEST,
      },
      uri:
        `casys://modelica-admitted-execution-capture/sha256/${CLOSEOUT_REVIEW_CAPTURE_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: "run.admitted-modelica",
      },
      inputArtifactIds: [],
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    },
    {
      id: `modelica-admitted-evidence-${CLOSEOUT_REVIEW_EVIDENCE_DIGEST}`,
      name: "Admitted evidence",
      kind: "evidence",
      version: CLOSEOUT_REVIEW_EVIDENCE_DIGEST,
      fingerprint: {
        algorithm: "sha256",
        digest: CLOSEOUT_REVIEW_EVIDENCE_DIGEST,
      },
      uri: `casys://isolated-output/sha256/${CLOSEOUT_REVIEW_EVIDENCE_DIGEST}`,
      mediaType: "application/json",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: "run.admitted-modelica",
      },
      inputArtifactIds: [],
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    },
    {
      id: `modelica-admitted-result-${CLOSEOUT_REVIEW_RESULT_DIGEST}`,
      name: "Admitted OpenModelica result",
      kind: "solver-result",
      version: CLOSEOUT_REVIEW_RESULT_DIGEST,
      fingerprint: {
        algorithm: "sha256",
        digest: CLOSEOUT_REVIEW_RESULT_DIGEST,
      },
      uri: `casys://isolated-output/sha256/${CLOSEOUT_REVIEW_RESULT_DIGEST}`,
      mediaType: "text/csv",
      producer: {
        serverId: "digital-thread",
        tool: "simulate.run-admitted-modelica@1",
        runId: "run.admitted-modelica",
      },
      inputArtifactIds: [],
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    },
  );
  const l4Fingerprints = [storedFingerprint];
  if (l4Count === 2) l4Fingerprints.push(secondFingerprint);
  const l4Artifacts: ThreadArtifact[] = includeL4Artifact
    ? l4Fingerprints.map((fingerprint, index) => {
      const digest = fingerprint.digest;
      const uri = options.captureUri === null ? undefined : options.captureUri ??
        `${ADMITTED_OBSERVATION_EVALUATION_CAPTURE_URI_PREFIX}sha256/${digest}`;
      return {
        id: `modelica-admitted-observation-evaluation-${digest}`,
        name: "Admitted Modelica observation evaluation",
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
            changedAt: CLOSEOUT_REVIEW_AT,
            reason: "Superseded by a later evaluation.",
            invalidatedByChangeIds: [
              `change.${`modelica-admitted-observation-evaluation-${digest}`}`,
            ],
          }
          : fresh(CLOSEOUT_REVIEW_AT),
      };
    })
    : [];
  const observationNeeded = evaluationStatus === "pass" ||
    evaluationStatus === "fail";
  const observationId = "placeholder-output-observation";
  const primaryL4 = l4Artifacts[0];
  const evaluationId = primaryL4 === undefined
    ? `${threadRequirementId}-evaluation-absent`
    : requirementEvaluationIdentity({
      requirementId: threadRequirementId,
      evidenceFingerprint: primaryL4.fingerprint,
    }).id;
  const violationId = "placeholder-requirement-violation";
  const artifacts = [brief, ...sourceArtifacts, ...l4Artifacts];
  const consumptions = l4Artifacts.flatMap((artifact) =>
    sourceArtifacts.map((source) => ({
      id: `consume-${source.id}-by-${artifact.id}`,
      artifactId: source.id,
      consumer: artifact.producer,
      observedFingerprint: source.fingerprint,
      verifiedAt: CLOSEOUT_REVIEW_AT,
      status: "verified" as const,
    }))
  );
  const evaluations = primaryL4
    ? [{
      id: evaluationId,
      name: "placeholder evaluation",
      requirementId: threadRequirementId,
      observationIds: observationNeeded ? [observationId] : [],
      status: evaluationStatus,
      evaluatedAt: CLOSEOUT_REVIEW_AT,
      evaluator: {
        serverId: "syson",
        tool: "syson_constraint_evaluate",
        runId: producerRunId,
      },
      ...(observationNeeded
        ? {
          comparison: {
            observationId,
            actual: { value: 0, unit: "unit-pending-source" },
            operator: "<=" as const,
            limit: { value: 1, unit: "unit-pending-source" },
            normalizedUnit: "unit-pending-source",
            margin: { value: 1, unit: "unit-pending-source" },
          },
        }
        : {}),
      evidenceArtifactIds: [primaryL4.id],
      message: evaluationMessage(evaluationStatus),
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    }]
    : [];
  const violations = evaluationStatus === "fail" && primaryL4
    ? [{
      id: violationId,
      name: "placeholder limit exceeded",
      requirementId: threadRequirementId,
      evaluationId,
      severity: "error" as const,
      status: "open" as const,
      detectedAt: CLOSEOUT_REVIEW_AT,
      observationIds: [observationId],
      evidenceArtifactIds: [primaryL4.id],
      summary: "The exact L4 evaluation recorded a fail. It is not L5.",
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    }]
    : [];
  const proposedActions = evaluationStatus === "fail"
    ? [{
      id: "action.review-fail",
      name: "Review the failed admitted Modelica evaluation",
      kind: "review" as const,
      readiness: "ready" as const,
      rationale: "A published L4 fail is not an L5 closeout.",
      targets: [
        { kind: "evaluation" as const, id: evaluationId },
        { kind: "violation" as const, id: violationId },
      ],
      addressesViolationIds: [violationId],
      dependsOnActionIds: [],
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
      from: { kind: "requirement" as const, id: threadRequirementId },
      to: { kind: "artifact" as const, id: brief.id },
      rationale: "The placeholder requirement constrains the brief artifact.",
    },
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
          "The admitted observation evaluation reopened this exact fingerprint-attested source artifact.",
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
          "The admitted observation evaluation evaluates the named Thread requirement.",
      },
      {
        id: `evidences-${item.id}`,
        relation: "evidences" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "artifact" as const, id: item.evidenceArtifactIds[0]! },
        rationale: "The evaluation is evidenced by the reread SysON capture.",
      },
      ...item.observationIds.map((observation) => ({
        id: `${item.id}-uses-${observation}`,
        relation: "uses" as const,
        from: { kind: "evaluation" as const, id: item.id },
        to: { kind: "observation" as const, id: observation },
        rationale:
          "The evaluation uses the exact admitted Modelica observation already published on the Thread.",
      })),
    ]),
    ...(observationNeeded
      ? [{
        id: `${observationId}-from-evidence`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observationId },
        to: {
          kind: "artifact" as const,
          id: `modelica-admitted-evidence-${CLOSEOUT_REVIEW_EVIDENCE_DIGEST}`,
        },
        rationale: "The observation is reported by the exact normalized evidence.",
      }, {
        id: `${observationId}-from-result`,
        relation: "derived_from" as const,
        from: { kind: "observation" as const, id: observationId },
        to: {
          kind: "artifact" as const,
          id: `modelica-admitted-result-${CLOSEOUT_REVIEW_RESULT_DIGEST}`,
        },
        rationale: "The observation is reported by the exact retained solver result.",
      }]
      : []),
    ...violations.flatMap((item) => [
      {
        id: `caused-by-${item.id}`,
        relation: "caused_by" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "evaluation" as const, id: item.evaluationId },
        rationale: "The named violation is caused by the failed L4 evaluation.",
      },
      {
        id: `evidences-${item.id}`,
        relation: "evidences" as const,
        from: { kind: "violation" as const, id: item.id },
        to: { kind: "artifact" as const, id: item.evidenceArtifactIds[0]! },
        rationale: "The violation is evidenced by the exact L4 capture.",
      },
    ]),
    ...proposedActions.flatMap((item) =>
      item.addressesViolationIds.map((violation) => ({
        id: `addresses-${item.id}`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: item.id },
        to: { kind: "violation" as const, id: violation },
        rationale: "The proposed review addresses the published L4 fail.",
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
    id: CLOSEOUT_REVIEW_PREVIOUS_SNAPSHOT_ID,
    revision: 1,
    generatedAt: CLOSEOUT_REVIEW_AT,
    subject: {
      id: subjectId,
      name: "Closeout fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: brief.id,
    },
    freshness: fresh(CLOSEOUT_REVIEW_AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: CLOSEOUT_REVIEW_AT,
      appliedAt: CLOSEOUT_REVIEW_AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact" as const, id: brief.id },
        summary: "Recorded the documentary brief.",
        afterFingerprint: brief.fingerprint,
      }],
    },
    artifacts: [brief],
    consumptions: [],
    observations: [],
    requirements: [{
      id: "placeholder-requirement",
      name: "placeholder",
      statement: "Placeholder requirement. Not a thermal verdict.",
      version: "1",
      criterion: {
        metric: "placeholder-output",
        operator: "<=",
        limit: { value: 1, unit: "unit-pending-source" },
      },
      trace: {
        sourceArtifactId: brief.id,
        elementId: "placeholder-requirement",
        targetArtifactIds: [brief.id],
      },
      freshness: fresh(CLOSEOUT_REVIEW_AT),
    }],
    evaluations: [],
    violations: [],
    provenance: [{
      id: "provenance.change.brief",
      relation: "changes" as const,
      from: { kind: "change" as const, id: "change.brief" },
      to: { kind: "artifact" as const, id: brief.id },
      rationale: "The applied change introduced the brief document.",
    }, {
      id: "trace-requirement-to-brief",
      relation: "traces_to" as const,
      from: { kind: "requirement" as const, id: "placeholder-requirement" },
      to: { kind: "artifact" as const, id: brief.id },
      rationale: "The placeholder requirement constrains the brief artifact.",
    }],
    proposedActions: [],
  });
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: CLOSEOUT_REVIEW_SNAPSHOT_ID,
    revision: 2,
    previous: {
      snapshotId: previousSnapshot.id,
      revision: previousSnapshot.revision,
    },
    generatedAt: CLOSEOUT_REVIEW_AT,
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
        changedAt: CLOSEOUT_REVIEW_AT,
        reason: "An L4 evaluation is stale.",
        invalidatedByChangeIds: primaryL4 ? [`change.${primaryL4.id}`] : [],
      }
      : fresh(CLOSEOUT_REVIEW_AT),
    changeSet: {
      id: "change-set.closeout",
      name: "Closeout basis",
      status: "applied",
      createdAt: CLOSEOUT_REVIEW_AT,
      appliedAt: CLOSEOUT_REVIEW_AT,
      changes,
    },
    artifacts,
    consumptions,
    observations: observationNeeded
      ? [{
        id: observationId,
        name: "Admitted Modelica placeholder-output",
        metric: "placeholder-output",
        quantity: { value: 0, unit: "unit-pending-source" },
        source: {
          operation: {
            serverId: "digital-thread",
            tool: "simulate.run-admitted-modelica@1",
            runId: "run.admitted-modelica",
          },
          artifactIds: [
            `modelica-admitted-evidence-${CLOSEOUT_REVIEW_EVIDENCE_DIGEST}`,
            `modelica-admitted-result-${CLOSEOUT_REVIEW_RESULT_DIGEST}`,
          ],
          capturedAt: CLOSEOUT_REVIEW_AT,
        },
        freshness: fresh(CLOSEOUT_REVIEW_AT),
      }]
      : [],
    requirements: [{
      id: threadRequirementId,
      name: "placeholder",
      statement: "Placeholder requirement. Not a thermal verdict.",
      version: "1",
      criterion: {
        metric: "placeholder-output",
        operator: "<=",
        limit: { value: 1, unit: "unit-pending-source" },
      },
      trace: {
        sourceArtifactId: brief.id,
        elementId,
        targetArtifactIds: [brief.id],
      },
      freshness: fresh(CLOSEOUT_REVIEW_AT),
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
    id: "verify.evaluate-admitted-modelica-observations",
    version: "1",
    bindings: [{
      name: "approvedBrief",
      source: { kind: "approved-brief" as const },
    }],
  };
  const objective = "Close out the exact L4 evaluation.";
  const project = {
    schemaVersion: "4.0",
    id: `${projectId}:r2`,
    revision: 2,
    previous: { snapshotId: `${projectId}:r1`, revision: 1 },
    generatedAt: CLOSEOUT_REVIEW_AT,
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
        capturedAt: CLOSEOUT_REVIEW_AT,
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
      workItemIds: attachProducerRun ? [CLOSEOUT_REVIEW_L4_WORK_ID] : [],
      requiredDecisionIds: [],
      evidenceRefs: [],
    }],
    workItems: attachProducerRun
      ? [{
        id: CLOSEOUT_REVIEW_L4_WORK_ID,
        activityId: `activity:${CLOSEOUT_REVIEW_L4_WORK_ID}`,
        phaseId: "phase.verify",
        title: "Evaluate observations",
        description: "Evaluate admitted Modelica observations.",
        kind: "verify",
        operation: l4Operation,
        status: "completed",
        owner: "agent",
        dependsOnWorkItemIds: [],
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
      : [],
    agentRuns: attachProducerRun
      ? [{
        id: CLOSEOUT_REVIEW_L4_RUN_ID,
        workItemId: CLOSEOUT_REVIEW_L4_WORK_ID,
        status: "completed",
        summary: "Evaluated the exact admitted Modelica observations.",
        queuedAt: CLOSEOUT_REVIEW_AT,
        startedAt: CLOSEOUT_REVIEW_AT,
        completedAt: CLOSEOUT_REVIEW_AT,
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
      : [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: CLOSEOUT_REVIEW_AT,
      appliedAt: CLOSEOUT_REVIEW_AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${projectId}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: CLOSEOUT_REVIEW_AT,
      appliedAt: CLOSEOUT_REVIEW_AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${projectId}:r2`, revision: 2 },
    }],
  } as unknown as EngineeringProjectSnapshot;
  const sheets: ThermalMethodSheetStore = {
    save: () => Promise.reject(new Error("review must not write sheets")),
    read: (fingerprint) =>
      Promise.resolve(
        fingerprint.digest === sheetFingerprint.digest ? sheetRecord : undefined,
      ),
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
    evaluationCaptures,
    sheetCaptures,
    sheets,
    dependencies: {
      sheets,
      evaluationCaptures:
        evaluationCaptures as unknown as AdmittedObservationEvaluationCaptureStore,
      sheetCaptures,
    },
  };
}

async function persistMethodSheetSeal(
  captures: MemoryTextCaptures,
  sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
  sheetFingerprint: ContentFingerprint,
) {
  const capture = validateModelicaThermalMethodSheetSealCapture({
    schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_CAPTURE_SCHEMA,
    kind: "modelica-thermal-method-sheet-seal",
    operation: {
      id: "verify.seal-modelica-thermal-method-sheet",
      version: "1",
    },
    trustedRunId: "run.seal-sheet",
    decisionId: "placeholder-seal-decision",
    sealedAt: CLOSEOUT_REVIEW_AT,
    admission: {
      schemaVersion: MODELICA_THERMAL_METHOD_SHEET_SEAL_ADMISSION_SCHEMA,
      sheetSchemaVersion: MODELICA_THERMAL_METHOD_SHEET_SCHEMA,
      sheetId: sheet.id,
      sheetFingerprint,
      projectId: sheet.project.id,
      subjectId: sheet.subject.id,
      basis: sheet.basis,
      model: sheet.model,
      sealDecisionId: sheet.review.sealDecisionId,
    },
    sheet: {
      id: sheet.id,
      fingerprint: sheetFingerprint,
      uri: thermalMethodSheetUri(sheetFingerprint),
    },
    recross: {
      sourceCapture: {
        fingerprint: sheet.model.sourceCaptureFingerprint,
        role: "modelica-model",
        language: "modelica",
      },
      attributeUsageIds: sheet.bindings.parameterizes.map((item) =>
        item.attributeUsageId
      ),
      requirementElementIds: sheet.bindings.outputRequirements.map((item) =>
        item.requirementElementId
      ),
    },
  });
  const text = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(capture);
  await captures.save(fingerprint, text);
  return { capture, fingerprint, text };
}

function withSheetRequirementElementId(
  sheet: Record<string, unknown>,
  requirementElementId: string | undefined,
): Record<string, unknown> {
  if (requirementElementId === undefined) return sheet;
  const outputs = (sheet.outputs as Array<Record<string, unknown>>).map(
    (output, index) => index === 0 ? { ...output, requirementElementId } : output,
  );
  const bindings = sheet.bindings as {
    parameterizes: unknown;
    outputRequirements: Array<Record<string, unknown>>;
  };
  return {
    ...sheet,
    outputs,
    bindings: {
      ...bindings,
      outputRequirements: bindings.outputRequirements.map((binding, index) =>
        index === 0 ? { ...binding, requirementElementId } : binding
      ),
    },
  };
}

function withOptionalSheetOutput(
  sheet: Record<string, unknown>,
  extraRequirementElementId: string | undefined,
): Record<string, unknown> {
  if (extraRequirementElementId === undefined) return sheet;
  const outputs = sheet.outputs as Array<Record<string, unknown>>;
  const bindings = sheet.bindings as {
    parameterizes: unknown;
    outputRequirements: Array<Record<string, unknown>>;
  };
  return {
    ...sheet,
    outputs: [
      ...outputs,
      {
        modelSymbolId: "placeholder-output",
        role: "max_abs",
        quantityMeaning: "named-thermal-observation",
        declaredUnit: "unit-pending-source",
        requirementElementId: extraRequirementElementId,
        requirementMetric: "placeholder-output",
        limitation: "Second mapping. Not a verdict.",
      },
    ],
    bindings: {
      ...bindings,
      outputRequirements: [
        ...bindings.outputRequirements,
        {
          modelSymbolId: "placeholder-output",
          role: "max_abs",
          requirementElementId: extraRequirementElementId,
          requirementMetric: "placeholder-output",
        },
      ],
    },
  };
}

function captureRowVariant(
  capture: ReturnType<typeof validateAdmittedObservationEvaluationCapture>,
  variant:
    | "duplicate"
    | "extra"
    | "overlap"
    | "missing-computed"
    | "unit-mismatch"
    | "non-numeric",
) {
  const row = {
    constraintId: "placeholder-requirement",
    status: "pass",
    computedValue: 0,
    threshold: 1,
    margin: 1,
    marginPercent: 100,
    unit: "unit-pending-source",
  };
  if (variant === "duplicate") {
    return {
      ...capture,
      unresolved: [],
      response: { structuredContent: { results: [row, { ...row }] } },
    };
  }
  if (variant === "extra") {
    return {
      ...capture,
      unresolved: [],
      response: {
        structuredContent: {
          results: [row, { ...row, constraintId: "extra-requirement" }],
        },
      },
    };
  }
  if (variant === "missing-computed") {
    return {
      ...capture,
      unresolved: [],
      response: {
        structuredContent: {
          results: [{
            constraintId: "placeholder-requirement",
            status: "pass",
            unit: "unit-pending-source",
          }],
        },
      },
    };
  }
  if (variant === "unit-mismatch") {
    return {
      ...capture,
      unresolved: [],
      response: { structuredContent: { results: [{ ...row, unit: "K" }] } },
    };
  }
  if (variant === "non-numeric") {
    return {
      ...capture,
      unresolved: [],
      response: {
        structuredContent: {
          results: [{ ...row, computedValue: "1" }],
        },
      },
    };
  }
  return {
    ...capture,
    unresolved: [{
      requirementElementId: "placeholder-requirement",
      reason: "unit-identity-mismatch",
    }],
    response: { structuredContent: { results: [row] } },
  };
}

function evaluationMessage(status: CloseoutReviewEvaluationStatus): string {
  switch (status) {
    case "pass":
      return "SysON reported the observed value is within the reviewed limit.";
    case "fail":
      return "SysON reported the observed value exceeds the reviewed limit.";
    case "error":
      return "The oracle returned an error evaluating this limit.";
    case "unresolved":
      return "Identity unit policy left this observation unresolved. It is not a fail.";
  }
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
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
