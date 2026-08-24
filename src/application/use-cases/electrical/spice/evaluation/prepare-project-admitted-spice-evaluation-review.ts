/**
 * Provider-free preparation of an admitted SPICE observation evaluation.
 *
 * The caller names only a project. The server reopens the unique Thread tip,
 * unique sealed electrical method sheet, and unique admitted SPICE evidence.
 */

import type {
  ProjectAdmittedSpiceEvaluationReviewRequest,
  ProjectAdmittedSpiceEvaluationReviewResult,
  ProjectAdmittedSpiceEvaluationReviewUseCase,
} from "../../../../ports/in/electrical/spice/evaluation/project-admitted-spice-evaluation-review.ts";
import type { ElectricalObservationMethodSheetStore } from "../../../../ports/out/electrical/observation-method-sheet-store.ts";
import type { AdmittedSpiceObservationEvidenceReader } from "../../../../ports/out/electrical/spice/evaluation/admitted-spice-observation-evidence-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../../ports/out/engineering-project-revision-store.ts";
import {
  ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX,
  validateElectricalObservationMethodSheetSealCapture,
} from "../../../../../domain/electrical/observation-method-sheet-seal-capture.ts";
import {
  deriveSpiceAdmittedObservationEvaluationMethod,
  fingerprintSpiceAdmittedObservationEvaluationMethod,
} from "../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import {
  encodeSpiceAdmittedObservationEvaluationAdmission,
  parseSpiceAdmittedObservationEvaluationParameters,
} from "../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import {
  type ElectricalObservationMethodSheet,
  fingerprintElectricalObservationMethodSheet,
} from "../../../../../domain/electrical/observation-method-sheet.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import { selectCurrentThreadTip } from "../../../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../../../domain/project/engineering-project-validation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../../domain/thread/thread-snapshot-store.ts";
import {
  resolveAdmittedSpiceEvaluationLineage,
  uniqueFreshElectricalMethodSheetSeal,
} from "../../../../../domain/electrical/spice/evaluation/lineage.ts";

export type ProjectAdmittedSpiceEvaluationReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "thread_tip_unavailable"
  | "snapshot_not_found"
  | "sheet_not_found"
  | "evidence_not_found"
  | "recross_failed";

export class ProjectAdmittedSpiceEvaluationReviewError extends Error {
  constructor(
    readonly code: ProjectAdmittedSpiceEvaluationReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAdmittedSpiceEvaluationReviewError";
  }
}

export interface EvaluationReviewSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface EvaluationReviewSheetCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface PrepareProjectAdmittedSpiceEvaluationReviewDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: EvaluationReviewSnapshotStore;
  readonly sheets: ElectricalObservationMethodSheetStore;
  readonly sheetCaptures: EvaluationReviewSheetCaptureStore;
  readonly evidence: AdmittedSpiceObservationEvidenceReader;
}

export class PrepareProjectAdmittedSpiceEvaluationReview
  implements ProjectAdmittedSpiceEvaluationReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectAdmittedSpiceEvaluationReviewDependencies,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectAdmittedSpiceEvaluationReviewResult> {
    let request: ProjectAdmittedSpiceEvaluationReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The admitted SPICE evaluation-review request failed exact validation.",
      );
    }
    const project = await this.dependencies.projects.get(request.projectId);
    if (!project) {
      throw reviewError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    let validatedProject;
    try {
      validatedProject = validateEngineeringProjectSnapshot(project);
    } catch {
      throw reviewError(
        "recross_failed",
        "The current engineering project failed closed validation.",
      );
    }
    if (validatedProject.project.id !== request.projectId) {
      throw reviewError(
        "recross_failed",
        "The project reader did not return the exact requested engineering project.",
      );
    }
    const tip = selectCurrentThreadTip(validatedProject.threadSnapshots);
    if (tip.status !== "ok") {
      throw reviewError(
        "thread_tip_unavailable",
        tip.diagnostic.code === "basis-absent"
          ? "The engineering project has no current Thread tip."
          : "The engineering project declares more than one current Thread tip; the server will not choose one.",
      );
    }
    const basis = tip.basis;
    if (validatedProject.project.subjectId !== basis.subjectId) {
      throw reviewError(
        "thread_tip_unavailable",
        "The current Thread tip is foreign to the engineering project subject.",
      );
    }
    const snapshot = await readSnapshot(this.dependencies.snapshots, basis);
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    let sheetArtifact;
    try {
      sheetArtifact = uniqueFreshElectricalMethodSheetSeal(snapshot);
    } catch (error) {
      throw reviewError(
        "recross_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    const sheet = await reopenNamedMethodSheet(
      this.dependencies,
      sheetArtifact,
    );
    if (
      sheet.project.id !== request.projectId ||
      sheet.subject.id !== basis.subjectId
    ) {
      throw reviewError(
        "recross_failed",
        "The reopened electrical observation method sheet is foreign to the requested project.",
      );
    }
    let lineage;
    try {
      lineage = resolveAdmittedSpiceEvaluationLineage(snapshot, sheet);
    } catch (error) {
      throw reviewError(
        "recross_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
    let evidence;
    try {
      evidence = await this.dependencies.evidence.read(
        lineage.result.fingerprint,
      );
    } catch {
      throw reviewError(
        "recross_failed",
        "The reopened admitted SPICE result is not an exact observation identity.",
      );
    }
    if (!evidence) {
      throw reviewError(
        "evidence_not_found",
        "The exact admitted SPICE result is unavailable.",
      );
    }
    try {
      const method = await deriveSpiceAdmittedObservationEvaluationMethod(sheet);
      const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(
        sheet,
      );
      const methodFingerprint =
        await fingerprintSpiceAdmittedObservationEvaluationMethod(method);
      const decisionParameters = encodeSpiceAdmittedObservationEvaluationAdmission({
        schemaVersion: "spice-admitted-observation-evaluation-admission/1.0",
        methodSchemaVersion: method.schemaVersion,
        projectId: request.projectId,
        subjectId: basis.subjectId,
        basis: {
          snapshotId: basis.snapshotId,
          revision: basis.revision,
          fingerprint: snapshotFingerprint,
        },
        sheet: { id: sheet.id, fingerprint: sheetFingerprint },
        capture: {
          artifactId: lineage.spiceCapture.id,
          fingerprint: lineage.spiceCapture.fingerprint,
        },
        evidence: {
          artifactId: lineage.evidence.id,
          fingerprint: lineage.evidence.fingerprint,
        },
        result: {
          artifactId: lineage.result.id,
          fingerprint: lineage.result.fingerprint,
        },
        methodFingerprint,
        profileId: method.profile.id,
        unitAlgebra: {
          id: method.unitAlgebra.id,
          fingerprint: method.unitAlgebra.fingerprint,
        },
      });
      const admission = parseSpiceAdmittedObservationEvaluationParameters(
        decisionParameters,
      );
      const reencoded = encodeSpiceAdmittedObservationEvaluationAdmission(
        admission,
      );
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError(
          "Admitted SPICE observation evaluation MRTR replay is not canonical.",
        );
      }
      return deepFreeze({ admission, method, decisionParameters: reencoded });
    } catch (error) {
      if (error instanceof ProjectAdmittedSpiceEvaluationReviewError) throw error;
      throw reviewError(
        "recross_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function parseRequest(
  value: unknown,
): ProjectAdmittedSpiceEvaluationReviewRequest {
  const request = exactRecord(
    value,
    ["projectId"],
    "$admittedSpiceEvaluationReview",
  );
  return deepFreeze({
    projectId: safeId(
      request.projectId,
      "$admittedSpiceEvaluationReview.projectId",
    ),
  });
}

async function reopenNamedMethodSheet(
  dependencies: PrepareProjectAdmittedSpiceEvaluationReviewDependencies,
  artifact: ThreadArtifact,
): Promise<ElectricalObservationMethodSheet> {
  const expectedUri =
    `${ELECTRICAL_OBSERVATION_METHOD_SHEET_SEAL_CAPTURE_URI_PREFIX}${artifact.fingerprint.digest}`;
  if (artifact.uri !== expectedUri) {
    throw reviewError(
      "recross_failed",
      "The sealed electrical observation method-sheet URI is not the canonical content-addressed capture URI.",
    );
  }
  let stored: string | undefined;
  try {
    stored = await dependencies.sheetCaptures.read(artifact.fingerprint);
  } catch {
    throw reviewError(
      "recross_failed",
      "The sealed electrical observation method-sheet capture could not be reopened.",
    );
  }
  if (stored === undefined) {
    throw reviewError(
      "sheet_not_found",
      "The exact sealed electrical observation method sheet is unavailable.",
    );
  }
  let capture;
  try {
    capture = validateElectricalObservationMethodSheetSealCapture(
      JSON.parse(stored),
    );
  } catch {
    throw reviewError(
      "recross_failed",
      "The named capture is not an electrical observation method-sheet seal.",
    );
  }
  const fingerprint = await sha256Fingerprint(capture);
  if (
    stored !== deterministicJson(capture) ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint)
  ) {
    throw reviewError(
      "recross_failed",
      "The reopened electrical observation method-sheet seal fingerprint does not match the Thread artifact.",
    );
  }
  let sheet;
  try {
    sheet = await dependencies.sheets.read(capture.sheet.fingerprint);
  } catch {
    throw reviewError(
      "recross_failed",
      "The exact electrical observation method sheet could not be reopened.",
    );
  }
  if (!sheet) {
    throw reviewError(
      "sheet_not_found",
      "The exact sealed electrical observation method sheet is unavailable.",
    );
  }
  const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(
    sheet,
  );
  if (
    sheet.id !== capture.sheet.id ||
    !fingerprintsEqual(sheetFingerprint, capture.sheet.fingerprint)
  ) {
    throw reviewError(
      "recross_failed",
      "The reopened electrical observation method sheet does not match the sealed L4 lineage.",
    );
  }
  return sheet;
}

async function readSnapshot(
  snapshots: EvaluationReviewSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const raw = snapshots.getFresh
    ? await snapshots.getFresh(basis.snapshotId)
    : await snapshots.get(basis.snapshotId);
  if (!raw) {
    throw reviewError(
      "snapshot_not_found",
      "The current Thread tip is unavailable.",
    );
  }
  const snapshot = validateThreadSnapshot(raw);
  if (
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw reviewError(
      "recross_failed",
      "The snapshot reader returned a stale or foreign Thread identity.",
    );
  }
  return snapshot;
}

function reviewError(
  code: ProjectAdmittedSpiceEvaluationReviewErrorCode,
  message: string,
): ProjectAdmittedSpiceEvaluationReviewError {
  return new ProjectAdmittedSpiceEvaluationReviewError(code, message);
}
