/**
 * Provider-free preparation of a vector-correction review.
 *
 * Reopens one exact Thread basis, one failing evaluation and one
 * sensitivity-study capture. It writes no Thread artefact.
 */

import type {
  ProjectVectorCorrectionReviewCommand,
  ProjectVectorCorrectionReviewErrorBody,
  ProjectVectorCorrectionReviewResult,
  ProjectVectorCorrectionReviewUseCase,
} from "../../../ports/in/sensitivity/vector-correction/project-vector-correction-review.ts";
import { assembleVectorCorrectionDecision } from "../../../../domain/sensitivity/vector-correction/vector-correction-assembly.ts";
import {
  encodeVectorCorrectionDecisionParameters,
  parseVectorCorrectionDecisionParameters,
} from "../../../../domain/sensitivity/vector-correction/vector-correction-proposal.ts";
import { VECTOR_CORRECTION_UNLINKED_LABEL } from "../../../../domain/sensitivity/vector-correction/vector-correction-origin.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { parseExactThreadSnapshotBasis } from "../../../../domain/project/thread-tip.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { reconstructSensitivityEdgesFromStudyCapture } from "../../../../domain/sensitivity/edges/sensitivity-edge-from-study.ts";
import {
  isSensitivityStudyResultArtifactId,
  type SensitivityStudyResult,
  validateSensitivityStudyResult,
} from "../../../../domain/sensitivity/study/sensitivity-study-result.ts";

export type ProjectVectorCorrectionReviewErrorCode =
  | "invalid_request"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "capture_not_found"
  | "capture_resolution_failed"
  | "capture_integrity_failed";

export class ProjectVectorCorrectionReviewError extends Error {
  constructor(
    readonly code: ProjectVectorCorrectionReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectVectorCorrectionReviewError";
  }
}

export interface VectorCorrectionReviewThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface VectorCorrectionStudyCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface PrepareProjectVectorCorrectionReviewDependencies {
  readonly snapshots: VectorCorrectionReviewThreadSnapshotStore;
  readonly studyCaptures: VectorCorrectionStudyCaptureStore;
}

export class PrepareProjectVectorCorrectionReview
  implements ProjectVectorCorrectionReviewUseCase {
  readonly #snapshots: VectorCorrectionReviewThreadSnapshotStore;
  readonly #studyCaptures: VectorCorrectionStudyCaptureStore;

  constructor(dependencies: PrepareProjectVectorCorrectionReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#studyCaptures = dependencies.studyCaptures;
  }

  async execute(value: unknown): Promise<ProjectVectorCorrectionReviewResult> {
    let command: ProjectVectorCorrectionReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The vector-correction review request failed exact validation.",
      );
    }

    let snapshot: ThreadSnapshot | undefined;
    try {
      snapshot = await readSnapshot(this.#snapshots, command.basis.snapshotId);
    } catch {
      throw reviewError(
        "snapshot_resolution_failed",
        "The exact Thread basis snapshot could not be reopened.",
      );
    }
    if (!snapshot) {
      throw reviewError(
        "snapshot_not_found",
        "The exact Thread basis snapshot is unavailable.",
      );
    }

    try {
      const validatedSnapshot = validateThreadSnapshot(snapshot);
      assertExactBasis(validatedSnapshot, command);
      const evaluation = requireFreshEvaluation(
        validatedSnapshot,
        command.evaluationId,
      );
      const studyArtifact = requireStudyArtifact(
        validatedSnapshot,
        command.studyArtifactId,
      );
      const capture = await this.#reopenStudyCapture(studyArtifact);
      const assembled = assembleVectorCorrectionDecision({
        evaluation,
        requirement: validatedSnapshot.requirements.find((item) =>
          item.id === evaluation.requirementId
        ),
        observations: validatedSnapshot.observations,
        study: {
          digest: studyArtifact.fingerprint.digest,
          baseValue: capture.studyCase.baseValue,
          metrics: capture.studyCase.metrics,
          baseMeasurements: capture.measurements.base,
        },
        studyCapture: {
          artifactId: studyArtifact.id,
          fingerprint: studyArtifact.fingerprint,
        },
        edges: reconstructSensitivityEdgesFromStudyCapture(capture),
        caseDigest: capture.caseDigest,
      });
      if (assembled.status !== "proposed") {
        return unresolvedFromAssembly(assembled);
      }
      const decisionParameters = encodeVectorCorrectionDecisionParameters(
        assembled.decision,
      );
      const reparsed = parseVectorCorrectionDecisionParameters(decisionParameters);
      const reencoded = encodeVectorCorrectionDecisionParameters(reparsed);
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError("Vector-correction MRTR replay is not canonical.");
      }
      return deepFreeze({
        status: "ready-for-review" as const,
        proposal: reparsed,
        decisionParameters: reencoded,
      });
    } catch (error) {
      if (error instanceof ProjectVectorCorrectionReviewError) throw error;
      throw reviewError(
        "capture_integrity_failed",
        "The reopened evaluation and study capture are not an exact vector-correction source.",
      );
    }
  }

  async #reopenStudyCapture(
    artifact: ThreadArtifact,
  ): Promise<SensitivityStudyResult> {
    let text: string | undefined;
    try {
      text = await this.#studyCaptures.read(artifact.fingerprint);
    } catch {
      throw reviewError(
        "capture_resolution_failed",
        "The exact sensitivity-study capture could not be reopened.",
      );
    }
    if (text === undefined) {
      throw reviewError(
        "capture_not_found",
        "The exact sensitivity-study capture is unavailable.",
      );
    }
    return await validateSensitivityStudyResult(JSON.parse(text));
  }
}

function parseCommand(value: unknown): ProjectVectorCorrectionReviewCommand {
  const command = exactRecord(
    value,
    ["projectId", "basis", "evaluationId", "studyArtifactId"],
    "$vectorCorrectionReview",
  );
  const projectId = safeId(command.projectId, "$vectorCorrectionReview.projectId");
  const basis = parseExactThreadSnapshotBasis(
    command.basis,
    "$vectorCorrectionReview.basis",
  );
  return deepFreeze({
    projectId,
    basis,
    evaluationId: safeId(
      command.evaluationId,
      "$vectorCorrectionReview.evaluationId",
    ),
    studyArtifactId: safeId(
      command.studyArtifactId,
      "$vectorCorrectionReview.studyArtifactId",
    ),
  });
}

async function readSnapshot(
  snapshots: VectorCorrectionReviewThreadSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  if (snapshots.getFresh) return await snapshots.getFresh(snapshotId);
  return await snapshots.get(snapshotId);
}

function assertExactBasis(
  snapshot: ThreadSnapshot,
  command: ProjectVectorCorrectionReviewCommand,
): void {
  if (
    snapshot.id !== command.basis.snapshotId ||
    snapshot.revision !== command.basis.revision ||
    snapshot.subject.id !== command.basis.subjectId
  ) {
    throw new TypeError("The snapshot is not the exact named Thread basis.");
  }
}

function requireFreshEvaluation(
  snapshot: ThreadSnapshot,
  evaluationId: string,
): RequirementEvaluation {
  const matches = snapshot.evaluations.filter((item) => item.id === evaluationId);
  if (matches.length !== 1) {
    throw new TypeError("The failing evaluation is absent or ambiguous.");
  }
  const evaluation = matches[0]!;
  if (evaluation.freshness.status !== "fresh") {
    throw new TypeError("The failing evaluation is not fresh.");
  }
  return evaluation;
}

function requireStudyArtifact(
  snapshot: ThreadSnapshot,
  artifactId: string,
): ThreadArtifact {
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === artifactId &&
    artifact.freshness.status === "fresh"
  );
  if (matches.length !== 1) {
    throw new TypeError("The study capture is absent, stale, or ambiguous.");
  }
  const artifact = matches[0]!;
  if (!isSensitivityStudyResultArtifactId(artifact.id, artifact.fingerprint)) {
    throw new TypeError(
      "The study capture artifact id must derive from its fingerprint.",
    );
  }
  return artifact;
}

function unresolvedFromAssembly(
  assembled: Exclude<
    ReturnType<typeof assembleVectorCorrectionDecision>,
    { readonly status: "proposed" }
  >,
): ProjectVectorCorrectionReviewResult {
  const label =
    "label" in assembled && assembled.label === VECTOR_CORRECTION_UNLINKED_LABEL
      ? VECTOR_CORRECTION_UNLINKED_LABEL
      : undefined;
  const error: ProjectVectorCorrectionReviewErrorBody = {
    code: assembled.reason,
    context: {
      reason: assembled.reason,
      detail: assembled.detail,
      ...(label ? { label } : {}),
    },
    recovery: label === VECTOR_CORRECTION_UNLINKED_LABEL
      ? "Cite the study-base observation of the bound capture, or run a new study at the failing point. Do not invent a join."
      : "Keep the application point and z* inside the declared neighborhood; do not clamp or convert units.",
  };
  return deepFreeze({ status: "unresolved" as const, error });
}

function reviewError(
  code: ProjectVectorCorrectionReviewErrorCode,
  message: string,
): ProjectVectorCorrectionReviewError {
  return new ProjectVectorCorrectionReviewError(code, message);
}
