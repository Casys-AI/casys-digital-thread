/** Shared exact reopen and next-hop compiler for sensitivity-study consumers. */

import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  isSensitivityStudyResultArtifactId,
  SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA,
  SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX,
  type SensitivityStudyResult,
  validateSensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import {
  SENSITIVITY_STUDY_CAPTURE_SCHEMA,
  SENSITIVITY_STUDY_CAPTURE_URI_PREFIX,
} from "../../../domain/sensitivity/study/sensitivity-study-capture.ts";
import {
  encodeSensitivityStudyConsumerDecisionParameters,
  parseSensitivityStudyConsumerDecisionParameters,
  type SensitivityStudyConsumerAdmission,
  sensitivityStudyConsumerAdmission,
  type SensitivityStudyConsumerOperation,
} from "../../../domain/sensitivity/study/sensitivity-study-consumer-admission.ts";
import {
  feaReviewNext,
  type FeaReviewProjectReader,
  type FeaReviewSnapshotStore,
  openFeaReviewSnapshot,
  validateFeaReviewNextState,
} from "../fea/seal-case/fea-review-support.ts";

export interface SensitivityStudyCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface OpenSensitivityConsumerReviewInput {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly studyArtifactId: string;
  readonly projects: FeaReviewProjectReader;
  readonly snapshots: FeaReviewSnapshotStore;
  readonly studyCaptures: SensitivityStudyCaptureReader;
}

export type SensitivityConsumerReviewDiagnostic = {
  readonly code: string;
  readonly message: string;
  readonly recovery: string;
};

export type OpenedSensitivityConsumerReview =
  | {
    readonly status: "ok";
    readonly project: EngineeringProjectSnapshot;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
    readonly artifact: ThreadArtifact;
    readonly capture: SensitivityStudyResult;
    readonly sourceWorkItemId: string;
  }
  | {
    readonly status: "unresolved";
    readonly diagnostic: SensitivityConsumerReviewDiagnostic;
  };

/**
 * Reopen only a current, fresh, canonical sensitivity result produced by the
 * completed run recorded in the same project ledger.
 */
export async function openSensitivityConsumerReview(
  input: OpenSensitivityConsumerReviewInput,
): Promise<OpenedSensitivityConsumerReview> {
  const opened = await openFeaReviewSnapshot({
    projectId: input.projectId,
    named: input.basis,
    projects: input.projects,
    snapshots: input.snapshots,
  });
  if (opened.status !== "ok" || !opened.project) {
    return refusal(
      opened.status === "unresolved" ? opened.diagnostic.code : opened.status,
      "The exact project and Thread basis could not be reopened.",
      "Use the unique current Thread tip from project_snapshot; do not use latest or a historical basis.",
    );
  }
  const project = opened.project;
  const artifact = opened.snapshot.artifacts.find((candidate) =>
    candidate.id === input.studyArtifactId
  );
  if (
    !artifact || artifact.kind !== "evidence" ||
    artifact.freshness.status !== "fresh" ||
    !isSensitivityStudyResultArtifactId(artifact.id, artifact.fingerprint) ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !== "analyze.run-fea-sensitivity@1"
  ) {
    return refusal(
      "capture_not_found",
      "The named artifact is not one fresh canonical sensitivity-study result on this basis.",
      "Bind the exact fresh result published by analyze.run-fea-sensitivity@1.",
    );
  }
  const text = await input.studyCaptures.read(artifact.fingerprint);
  if (!text) {
    return refusal(
      "capture_not_found",
      "The sensitivity-study result is not readable from content-addressed storage.",
      "Re-run the exact sealed study; do not reconstruct or repair its bytes.",
    );
  }
  let capture: SensitivityStudyResult;
  try {
    capture = await validateSensitivityStudyResult(JSON.parse(text));
  } catch {
    return refusal(
      "capture_integrity_failed",
      "The sensitivity-study result failed its closed schema.",
      "Re-run the exact sealed study; do not repair the capture.",
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  const expectedUri = capture.schemaVersion === SENSITIVITY_STUDY_CAPTURE_SCHEMA
    ? `${SENSITIVITY_STUDY_CAPTURE_URI_PREFIX}${fingerprint.digest}`
    : capture.schemaVersion === SENSITIVITY_STUDY_REUSE_RESULT_SCHEMA
    ? `${SENSITIVITY_STUDY_REUSE_RESULT_URI_PREFIX}${fingerprint.digest}`
    : "";
  if (
    !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
    artifact.uri !== expectedUri ||
    artifact.producer.runId !== capture.trustedRunId
  ) {
    return refusal(
      "capture_integrity_failed",
      "The result bytes, URI, artifact fingerprint and trusted run identity do not recross.",
      "Re-run the exact sealed study from an intact Thread basis.",
    );
  }
  const sourceRun = project.agentRuns.find((run) =>
    run.id === capture.trustedRunId && run.status === "completed" &&
    run.evidenceRefs.some((reference) => reference.id === artifact.id)
  );
  if (!sourceRun) {
    return refusal(
      "source_run_unlinked",
      "The capture trusted run is not a completed producer in this project ledger.",
      "Use the study result from the current project, not a transplanted artifact.",
    );
  }
  return {
    status: "ok",
    project,
    basis: opened.basis,
    snapshot: opened.snapshot,
    artifact,
    capture,
    sourceWorkItemId: sourceRun.workItemId,
  };
}

export function compileSensitivityConsumerNext(input: {
  readonly opened: Extract<OpenedSensitivityConsumerReview, { status: "ok" }>;
  readonly operation: SensitivityStudyConsumerOperation;
  readonly role: "base-evaluation" | "edges";
  readonly phaseName: string;
  readonly phaseDescription: string;
  readonly decisionTitle: string;
  readonly decisionQuestion: string;
  readonly summary: string;
}):
  | {
    readonly status: "ready";
    readonly admission: SensitivityStudyConsumerAdmission;
    readonly decisionParameters: ReturnType<
      typeof encodeSensitivityStudyConsumerDecisionParameters
    >;
    readonly workItemId: string;
    readonly decisionId: string;
    readonly next: ReturnType<typeof feaReviewNext>;
  }
  | {
    readonly status: "unresolved";
    readonly diagnostic: SensitivityConsumerReviewDiagnostic;
  } {
  const { opened } = input;
  const token = `${
    opened.artifact.fingerprint.digest.slice(0, 16)
  }-r${opened.basis.revision}`;
  const phaseId = `phase-sensitivity-${input.role}-${token}`;
  const workItemId = `work-sensitivity-${input.role}-${token}`;
  const decisionId = `decision-sensitivity-${input.role}-${token}`;
  const nextState = validateFeaReviewNextState({
    project: opened.project,
    projectId: opened.project.project.id,
    basis: opened.basis,
    phaseId,
    workItemId,
    decisionId,
  });
  if (nextState.status !== "ready") {
    return {
      status: "unresolved",
      diagnostic: {
        code: nextState.diagnostic.code,
        message: nextState.diagnostic.message,
        recovery: "Refresh the review at the unique current project head.",
      },
    };
  }
  const admission = sensitivityStudyConsumerAdmission({
    operation: input.operation,
    projectId: opened.project.project.id,
    basis: opened.basis,
    artifactId: opened.artifact.id,
    artifactFingerprint: opened.artifact.fingerprint,
    capture: opened.capture,
  });
  const decisionParameters = encodeSensitivityStudyConsumerDecisionParameters(
    admission,
  );
  parseSensitivityStudyConsumerDecisionParameters(
    decisionParameters,
    input.operation,
  );
  const operation: EngineeringOperationRef = {
    id: input.operation.id,
    version: input.operation.version,
    bindings: [{
      name: "studyCapture",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: opened.basis.snapshotId,
          snapshotRevision: opened.basis.revision,
          kind: "artifact",
          id: opened.artifact.id,
        },
      },
    }],
  };
  return {
    status: "ready",
    admission,
    decisionParameters,
    workItemId,
    decisionId,
    next: feaReviewNext({
      projectId: opened.project.project.id,
      basis: opened.basis,
      operation,
      summary: input.summary,
      parameters: decisionParameters,
      expectedRevision: nextState.expectedRevision,
      phaseId,
      phaseName: input.phaseName,
      phaseDescription: input.phaseDescription,
      workItemId,
      decisionId,
      decisionTitle: input.decisionTitle,
      decisionQuestion: input.decisionQuestion,
      dependsOnWorkItemIds: [opened.sourceWorkItemId],
    }),
  };
}

function refusal(
  code: string,
  message: string,
  recovery: string,
): Extract<OpenedSensitivityConsumerReview, { status: "unresolved" }> {
  return { status: "unresolved", diagnostic: { code, message, recovery } };
}
