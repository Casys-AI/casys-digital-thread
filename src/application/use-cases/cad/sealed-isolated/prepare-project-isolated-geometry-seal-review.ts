/**
 * Provider-free preparation of an isolated geometry seal review.
 *
 * This use case does not execute source, copy STEP bytes, or grant Product or
 * FEA authority. It reopens one exact documentary Build123d execution capture
 * and derives the canonical MRTR parameters for a later document-only seal.
 */

import type {
  ProjectIsolatedGeometrySealReviewCommand,
  ProjectIsolatedGeometrySealReviewResult,
  ProjectIsolatedGeometrySealReviewUseCase,
} from "../../../ports/in/cad/sealed-isolated/project-isolated-geometry-seal-review.ts";
import type { Build123dExecutionCaptureStore } from "../../../ports/out/cad/isolated/build123d-execution-evidence-store.ts";
import {
  type Build123dExecutionCapture,
  validateBuild123dExecutionBasis,
} from "../../../../domain/cad/isolated/build123d-execution-evidence.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import {
  encodeIsolatedGeometrySealParameters,
  type IsolatedGeometrySealAdmission,
  parseIsolatedGeometrySealParameters,
} from "../../../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { parseExactThreadSnapshotBasis } from "../../../../domain/project/thread-tip.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export type ProjectIsolatedGeometrySealReviewErrorCode =
  | "invalid_request"
  | "capture_not_found"
  | "capture_resolution_failed"
  | "capture_integrity_failed";

/** Stable application error. Provider details, storage paths and causes stay internal. */
export class ProjectIsolatedGeometrySealReviewError extends Error {
  constructor(
    readonly code: ProjectIsolatedGeometrySealReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectIsolatedGeometrySealReviewError";
  }
}

export interface IsolatedGeometrySealReviewThreadSnapshotStore
  extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectIsolatedGeometrySealReviewDependencies {
  readonly snapshots: IsolatedGeometrySealReviewThreadSnapshotStore;
  readonly captures: Build123dExecutionCaptureStore;
}

export class PrepareProjectIsolatedGeometrySealReview
  implements ProjectIsolatedGeometrySealReviewUseCase {
  readonly #snapshots: IsolatedGeometrySealReviewThreadSnapshotStore;
  readonly #captures: Build123dExecutionCaptureStore;

  constructor(dependencies: PrepareProjectIsolatedGeometrySealReviewDependencies) {
    this.#snapshots = dependencies.snapshots;
    this.#captures = dependencies.captures;
  }

  async execute(value: unknown): Promise<ProjectIsolatedGeometrySealReviewResult> {
    let command: ProjectIsolatedGeometrySealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The isolated geometry seal-review request failed exact validation.",
      );
    }

    let snapshot: ThreadSnapshot | undefined;
    try {
      snapshot = await readSnapshot(this.#snapshots, command.basis.snapshotId);
    } catch {
      throw reviewError(
        "capture_resolution_failed",
        "The exact Thread basis snapshot could not be reopened.",
      );
    }
    if (!snapshot) {
      throw reviewError(
        "capture_not_found",
        "The exact Thread basis snapshot is unavailable.",
      );
    }

    let capture: Build123dExecutionCapture | undefined;
    try {
      capture = await this.#captures.read(command.artifactFingerprint);
    } catch {
      throw reviewError(
        "capture_resolution_failed",
        "The exact Build123d execution capture could not be reopened.",
      );
    }
    if (!capture) {
      throw reviewError(
        "capture_not_found",
        "The exact Build123d execution capture is unavailable.",
      );
    }

    try {
      const validatedSnapshot = validateThreadSnapshot(snapshot);
      const artifact = exactExecutionCaptureArtifact(
        validatedSnapshot,
        command,
      );
      const observedFingerprint = await sha256Fingerprint(capture);
      if (
        !fingerprintsEqual(observedFingerprint, command.artifactFingerprint) ||
        !fingerprintsEqual(observedFingerprint, artifact.fingerprint) ||
        capture.projectId !== command.projectId
      ) {
        throw new TypeError("The execution capture identity disagrees.");
      }
      const admission = await deriveSealAdmission(
        command,
        validatedSnapshot,
        capture,
      );
      const decisionParameters = encodeIsolatedGeometrySealParameters(admission);
      const reparsed = parseIsolatedGeometrySealParameters(decisionParameters);
      const reencoded = encodeIsolatedGeometrySealParameters(reparsed);
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError("Isolated geometry seal MRTR replay is not canonical.");
      }
      return deepFreeze({ admission: reparsed, decisionParameters: reencoded });
    } catch {
      throw reviewError(
        "capture_integrity_failed",
        "The reopened Build123d execution capture is not an exact documentary isolated-geometry source.",
      );
    }
  }
}

function parseCommand(value: unknown): ProjectIsolatedGeometrySealReviewCommand {
  const command = exactRecord(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    "$isolatedGeometrySealReview",
  );
  const projectId = safeId(
    command.projectId,
    "$isolatedGeometrySealReview.projectId",
  );
  const basis = parseExactThreadSnapshotBasis(
    command.basis,
    "$isolatedGeometrySealReview.basis",
  );
  const artifactFingerprint = validateContentFingerprint(
    command.artifactFingerprint,
    "$isolatedGeometrySealReview.artifactFingerprint",
  );
  const artifactId = safeId(
    command.artifactId,
    "$isolatedGeometrySealReview.artifactId",
  );
  if (artifactId !== `build123d-execution-capture-${artifactFingerprint.digest}`) {
    throw new TypeError("The execution capture artifact id must derive from its hash.");
  }
  return deepFreeze({ projectId, basis, artifactId, artifactFingerprint });
}

async function readSnapshot(
  snapshots: IsolatedGeometrySealReviewThreadSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  if (snapshots.getFresh) return await snapshots.getFresh(snapshotId);
  return await snapshots.get(snapshotId);
}

function exactExecutionCaptureArtifact(
  snapshot: ThreadSnapshot,
  command: ProjectIsolatedGeometrySealReviewCommand,
): ThreadArtifact {
  if (
    snapshot.id !== command.basis.snapshotId ||
    snapshot.revision !== command.basis.revision ||
    snapshot.subject.id !== command.basis.subjectId
  ) {
    throw new TypeError("The snapshot is not the exact named Thread basis.");
  }
  const matches = snapshot.artifacts.filter((artifact) =>
    artifact.id === command.artifactId && artifact.kind === "document" &&
    fingerprintsEqual(artifact.fingerprint, command.artifactFingerprint) &&
    artifact.freshness.status === "fresh" &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool ===
      `${DESIGN_EXECUTE_BUILD123D_OPERATION.id}@${DESIGN_EXECUTE_BUILD123D_OPERATION.version}`
  );
  if (matches.length !== 1) {
    throw new TypeError(
      "The execution capture is absent, stale, ambiguous, or not a documentary isolated execution.",
    );
  }
  return matches[0]!;
}

async function deriveSealAdmission(
  command: ProjectIsolatedGeometrySealReviewCommand,
  snapshot: ThreadSnapshot,
  capture: Build123dExecutionCapture,
): Promise<IsolatedGeometrySealAdmission> {
  validateBuild123dExecutionBasis(capture.basis, "$executionCapture.basis");
  const step = exactGeometryOutput(capture);
  const snapshotFingerprint = await sha256Fingerprint(snapshot);
  const admission: IsolatedGeometrySealAdmission = {
    schemaVersion: "isolated-geometry-seal-admission/1.0",
    executionCapture: {
      id: command.artifactId,
      fingerprint: command.artifactFingerprint,
    },
    draft: capture.noncanonicalDraft,
    publication: {
      fingerprint: capture.publicationRef.fingerprint,
    },
    step: {
      role: step.role as IsolatedGeometrySealAdmission["step"]["role"],
      basename: step.basename as IsolatedGeometrySealAdmission["step"]["basename"],
      mediaType: step.mediaType as IsolatedGeometrySealAdmission["step"]["mediaType"],
      format: step.format as IsolatedGeometrySealAdmission["step"]["format"],
      sha256: step.sha256,
      byteCount: step.byteCount,
    },
    basis: {
      snapshotId: command.basis.snapshotId,
      revision: command.basis.revision,
      subjectId: command.basis.subjectId,
      fingerprint: snapshotFingerprint,
    },
  };
  return parseIsolatedGeometrySealParameters(
    encodeIsolatedGeometrySealParameters(admission),
  );
}

function exactGeometryOutput(
  capture: Build123dExecutionCapture,
): Build123dExecutionCapture["receiptRecord"]["outputs"][number] {
  const matches = capture.receiptRecord.outputs.filter((output) =>
    output.role === "geometry"
  );
  if (matches.length !== 1) {
    throw new TypeError("The execution receipt must contain one geometry output.");
  }
  return matches[0]!;
}

function reviewError(
  code: ProjectIsolatedGeometrySealReviewErrorCode,
  message: string,
): ProjectIsolatedGeometrySealReviewError {
  return new ProjectIsolatedGeometrySealReviewError(code, message);
}
