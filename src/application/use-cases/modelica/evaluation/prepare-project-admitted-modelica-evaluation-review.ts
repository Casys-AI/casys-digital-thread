/**
 * Provider-free preparation of an admitted Modelica observation evaluation.
 *
 * The caller names only a project. The server reopens the unique Thread tip,
 * unique sealed thermal method sheet, and unique admitted evidence, then
 * derives canonical MRTR parameters. No values, units, SysON envelope or OMC
 * dispatch are accepted or returned.
 */

import type {
  ProjectAdmittedModelicaEvaluationReviewRequest,
  ProjectAdmittedModelicaEvaluationReviewResult,
  ProjectAdmittedModelicaEvaluationReviewUseCase,
} from "../../../ports/in/modelica/evaluation/project-admitted-modelica-evaluation-review.ts";
import type { ThermalMethodSheetCompilationJoin } from "../../../ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type { AdmittedObservationEvidenceReader } from "../../../ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  admittedModelicaUnitIdentityPolicy,
  deriveAdmittedObservationEvaluationMethod,
  fingerprintAdmittedObservationEvaluationMethod,
  mapAdmittedObservationEvidenceBySourceIdentity,
  selectAdmittedObservationEvaluations,
  selectUniqueThreadRequirementByPair,
} from "../../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import {
  encodeAdmittedObservationEvaluationAdmission,
  parseAdmittedObservationEvaluationParameters,
} from "../../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { SIMULATE_RUN_ADMITTED_MODELICA_OPERATION } from "../../../../domain/modelica/admitted/run-proposal.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import { selectCurrentThreadTip } from "../../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

const EVIDENCE_ARTIFACT_ID_PREFIX = "modelica-admitted-evidence-" as const;
const EVIDENCE_PRODUCER_TOOL =
  `${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.id}@${SIMULATE_RUN_ADMITTED_MODELICA_OPERATION.version}`;

export type ProjectAdmittedModelicaEvaluationReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "thread_tip_unavailable"
  | "snapshot_not_found"
  | "sheet_not_found"
  | "evidence_not_found"
  | "evidence_ambiguous"
  | "recross_failed";

export class ProjectAdmittedModelicaEvaluationReviewError extends Error {
  constructor(
    readonly code: ProjectAdmittedModelicaEvaluationReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAdmittedModelicaEvaluationReviewError";
  }
}

export interface EvaluationReviewSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectAdmittedModelicaEvaluationReviewDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: EvaluationReviewSnapshotStore;
  readonly methodSheets: ThermalMethodSheetCompilationJoin;
  readonly evidence: AdmittedObservationEvidenceReader;
  readonly sourceCaptures: ThermalMethodSheetSourceCaptureReader;
}

export class PrepareProjectAdmittedModelicaEvaluationReview
  implements ProjectAdmittedModelicaEvaluationReviewUseCase {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: EvaluationReviewSnapshotStore;
  readonly #methodSheets: ThermalMethodSheetCompilationJoin;
  readonly #evidence: AdmittedObservationEvidenceReader;
  readonly #sourceCaptures: ThermalMethodSheetSourceCaptureReader;

  constructor(
    dependencies: PrepareProjectAdmittedModelicaEvaluationReviewDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#methodSheets = dependencies.methodSheets;
    this.#evidence = dependencies.evidence;
    this.#sourceCaptures = dependencies.sourceCaptures;
  }

  async execute(
    value: unknown,
  ): Promise<ProjectAdmittedModelicaEvaluationReviewResult> {
    let request: ProjectAdmittedModelicaEvaluationReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The admitted Modelica evaluation-review request failed exact validation.",
      );
    }

    const project = await this.#projects.get(request.projectId);
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

    const snapshot = await readSnapshot(this.#snapshots, basis);
    const snapshotFingerprint = await sha256Fingerprint(snapshot);
    const sheet = await this.#methodSheets.read({
      projectId: request.projectId,
      basis,
    });
    if (!sheet) {
      throw reviewError(
        "sheet_not_found",
        "The exact sealed thermal method sheet is unavailable.",
      );
    }
    if (
      sheet.project.id !== request.projectId ||
      sheet.subject.id !== basis.subjectId
    ) {
      throw reviewError(
        "recross_failed",
        "The reopened thermal method sheet is foreign to the requested project.",
      );
    }
    try {
      for (const output of sheet.outputs) {
        selectUniqueThreadRequirementByPair(snapshot.requirements, output);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw reviewError("recross_failed", message);
    }

    const evidenceArtifact = selectUniqueFreshEvidence(snapshot);
    let evidence;
    try {
      evidence = await this.#evidence.read(evidenceArtifact.fingerprint);
    } catch {
      throw reviewError(
        "recross_failed",
        "The reopened admitted Modelica evidence is not an exact observation identity.",
      );
    }
    if (!evidence) {
      throw reviewError(
        "evidence_not_found",
        "The exact admitted Modelica evidence is unavailable.",
      );
    }
    if (evidence.modelName !== sheet.model.moduleName) {
      throw reviewError(
        "recross_failed",
        "The admitted Modelica evidence model is not the exact method-sheet module.",
      );
    }

    try {
      const unitPolicy = await admittedModelicaUnitIdentityPolicy();
      const method = deriveAdmittedObservationEvaluationMethod(sheet, unitPolicy);
      let source;
      try {
        source = await this.#sourceCaptures.read(
          sheet.model.sourceCaptureFingerprint,
        );
      } catch {
        throw reviewError(
          "recross_failed",
          "The reopened source capture is not an exact modelica-model identity.",
        );
      }
      if (!source) {
        throw reviewError(
          "recross_failed",
          "The exact Modelica source capture is unavailable.",
        );
      }
      const mapped = mapAdmittedObservationEvidenceBySourceIdentity(
        method,
        source.symbols,
        evidence.outputs,
        evidence.metrics,
      );
      selectAdmittedObservationEvaluations(
        method,
        mapped.outputs,
        mapped.metrics,
      );
      const sheetFingerprint = await fingerprintModelicaThermalMethodSheet(sheet);
      const methodFingerprint = await fingerprintAdmittedObservationEvaluationMethod(
        method,
      );
      const decisionParameters = encodeAdmittedObservationEvaluationAdmission({
        schemaVersion: "modelica-admitted-observation-evaluation-admission/1.0",
        methodSchemaVersion: method.schemaVersion,
        projectId: request.projectId,
        subjectId: basis.subjectId,
        basis: {
          snapshotId: basis.snapshotId,
          revision: basis.revision,
          fingerprint: snapshotFingerprint,
        },
        sheet: { id: sheet.id, fingerprint: sheetFingerprint },
        evidence: {
          artifactId: evidenceArtifact.id,
          fingerprint: evidenceArtifact.fingerprint,
        },
        methodFingerprint,
        profileId: method.profile.id,
        unitPolicy: {
          id: method.unitPolicy.id,
          fingerprint: method.unitPolicy.fingerprint,
        },
      });
      const admission = parseAdmittedObservationEvaluationParameters(
        decisionParameters,
      );
      const reencoded = encodeAdmittedObservationEvaluationAdmission(admission);
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError(
          "Admitted observation evaluation MRTR replay is not canonical.",
        );
      }
      return deepFreeze({ admission, method, decisionParameters: reencoded });
    } catch (error) {
      if (error instanceof ProjectAdmittedModelicaEvaluationReviewError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw reviewError("recross_failed", message);
    }
  }
}

function parseRequest(
  value: unknown,
): ProjectAdmittedModelicaEvaluationReviewRequest {
  const request = exactRecord(
    value,
    ["projectId"],
    "$admittedModelicaEvaluationReview",
  );
  return deepFreeze({
    projectId: safeId(
      request.projectId,
      "$admittedModelicaEvaluationReview.projectId",
    ),
  });
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

function selectUniqueFreshEvidence(snapshot: ThreadSnapshot): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const candidates = snapshot.artifacts.filter((artifact) =>
    isCanonicalFreshEvidence(artifact) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (candidates.length === 0) {
    throw reviewError(
      "evidence_not_found",
      "The current Thread tip has no fresh digital-thread simulate.run-admitted-modelica@1 evidence.",
    );
  }
  if (candidates.length !== 1) {
    throw reviewError(
      "evidence_ambiguous",
      `The current Thread tip has ${candidates.length} fresh admitted Modelica evidence artifacts; the server will not choose one.`,
    );
  }
  return candidates[0]!;
}

function isCanonicalFreshEvidence(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "evidence" &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${EVIDENCE_ARTIFACT_ID_PREFIX}${digest}` &&
    artifact.version === digest &&
    artifact.producer.serverId === "digital-thread" &&
    artifact.producer.tool === EVIDENCE_PRODUCER_TOOL;
}

function reviewError(
  code: ProjectAdmittedModelicaEvaluationReviewErrorCode,
  message: string,
): ProjectAdmittedModelicaEvaluationReviewError {
  return new ProjectAdmittedModelicaEvaluationReviewError(code, message);
}
