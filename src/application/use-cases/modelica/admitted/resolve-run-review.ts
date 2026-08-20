/**
 * Public, provider-free resolution of an admitted Modelica run review.
 *
 * The caller names only a project. The server reopens the project's unique
 * current Thread tip, selects its unique fresh compile.seal-admission@1
 * document, then delegates those exact identities to the sealed-admission
 * validator. No caller-selected or caller-derived identity crosses this seam.
 */

import type {
  ProjectAdmittedModelicaRunReviewCommand,
  ProjectAdmittedModelicaRunReviewRequest,
  ProjectAdmittedModelicaRunReviewResult,
  ProjectAdmittedModelicaRunReviewUseCase,
} from "../../../ports/in/modelica/admitted-run-review.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import { selectCurrentThreadTip } from "../../../../domain/project/thread-tip.ts";
import type {
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "../../../../domain/project/engineering-project-validation.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";

const ADMISSION_ARTIFACT_ID_PREFIX = "technical-compilation-admission-" as const;
const ADMISSION_CAPTURE_URI_PREFIX =
  "casys://technical-compilation-admission-capture/sha256/" as const;
const ADMISSION_MEDIA_TYPE = "application/json" as const;
const ADMISSION_PRODUCER_SERVER = "digital-thread" as const;
const ADMISSION_PRODUCER_TOOL = "compile.seal-admission@1" as const;

export type ResolveProjectAdmittedModelicaRunReviewErrorCode =
  | "invalid_request"
  | "project_not_found"
  | "project_resolution_failed"
  | "project_integrity_failed"
  | "thread_tip_unavailable"
  | "snapshot_not_found"
  | "snapshot_resolution_failed"
  | "snapshot_integrity_failed"
  | "admission_not_found"
  | "admission_ambiguous";

export class ResolveProjectAdmittedModelicaRunReviewError extends Error {
  constructor(
    readonly code: ResolveProjectAdmittedModelicaRunReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ResolveProjectAdmittedModelicaRunReviewError";
  }
}

export interface AdmittedModelicaRunReviewProjectReader {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface AdmittedModelicaRunReviewSnapshotReader {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  /** Prefer a durable reread when the active store can provide one. */
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface ResolveProjectAdmittedModelicaRunReviewDependencies {
  readonly projects: AdmittedModelicaRunReviewProjectReader;
  readonly snapshots: AdmittedModelicaRunReviewSnapshotReader;
  /** Exact validator also reused by execution-time MRTR revalidation. */
  readonly exactReview: ProjectAdmittedModelicaRunReviewUseCase;
}

export class ResolveProjectAdmittedModelicaRunReview
  implements ProjectAdmittedModelicaRunReviewUseCase {
  constructor(
    private readonly dependencies: ResolveProjectAdmittedModelicaRunReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectAdmittedModelicaRunReviewResult> {
    const request = parseRequest(value);
    const project = await this.#readProject(request.projectId);
    const basis = resolveCurrentBasis(project, request.projectId);
    const snapshot = await this.#readSnapshot(basis);
    const artifact = selectUniqueFreshAdmission(snapshot);
    const command = deepFreeze<ProjectAdmittedModelicaRunReviewCommand>({
      projectId: request.projectId,
      basis,
      artifactId: artifact.id,
      artifactFingerprint: artifact.fingerprint,
    });
    return await this.dependencies.exactReview.execute(command);
  }

  async #readProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    let raw: EngineeringProjectSnapshot | undefined;
    try {
      raw = await this.dependencies.projects.get(projectId);
    } catch {
      throw resolutionError(
        "project_resolution_failed",
        "The current engineering project could not be reopened.",
      );
    }
    if (!raw) {
      throw resolutionError(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    let project: EngineeringProjectSnapshot;
    try {
      project = validateEngineeringProjectSnapshot(raw);
    } catch {
      throw resolutionError(
        "project_integrity_failed",
        "The current engineering project failed closed validation.",
      );
    }
    if (
      project.schemaVersion !== "3.0" ||
      project.project.id !== projectId
    ) {
      throw resolutionError(
        "project_integrity_failed",
        "The project reader did not return the exact requested V3 engineering project.",
      );
    }
    return project;
  }

  async #readSnapshot(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<ThreadSnapshot> {
    let raw: ThreadSnapshot | undefined;
    try {
      raw = this.dependencies.snapshots.getFresh
        ? await this.dependencies.snapshots.getFresh(basis.snapshotId)
        : await this.dependencies.snapshots.get(basis.snapshotId);
    } catch {
      throw resolutionError(
        "snapshot_resolution_failed",
        "The current Thread tip could not be reopened.",
      );
    }
    if (!raw) {
      throw resolutionError(
        "snapshot_not_found",
        "The current Thread tip is unavailable.",
      );
    }

    let snapshot: ThreadSnapshot;
    try {
      snapshot = validateThreadSnapshot(raw);
    } catch {
      throw resolutionError(
        "snapshot_integrity_failed",
        "The current Thread tip failed closed validation.",
      );
    }
    if (
      snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw resolutionError(
        "snapshot_integrity_failed",
        "The snapshot reader returned a stale or foreign Thread identity.",
      );
    }
    return snapshot;
  }
}

function parseRequest(value: unknown): ProjectAdmittedModelicaRunReviewRequest {
  try {
    const request = exactRecord(
      value,
      ["projectId"],
      "$admittedModelicaRunReview",
    );
    return deepFreeze({
      projectId: safeId(
        request.projectId,
        "$admittedModelicaRunReview.projectId",
      ),
    });
  } catch {
    throw resolutionError(
      "invalid_request",
      "The admitted Modelica execution-review request failed exact validation.",
    );
  }
}

function resolveCurrentBasis(
  project: EngineeringProjectSnapshot,
  projectId: string,
): EngineeringThreadSnapshotBasis {
  const selected = selectCurrentThreadTip(project.threadSnapshots);
  if (selected.status !== "ok") {
    throw resolutionError(
      "thread_tip_unavailable",
      selected.diagnostic.code === "basis-absent"
        ? "The engineering project has no current Thread tip."
        : "The engineering project declares more than one current Thread tip; the server will not choose one.",
    );
  }
  if (
    project.project.id !== projectId ||
    project.project.subjectId !== selected.basis.subjectId
  ) {
    throw resolutionError(
      "thread_tip_unavailable",
      "The current Thread tip is foreign to the engineering project subject.",
    );
  }
  return selected.basis;
}

function selectUniqueFreshAdmission(snapshot: ThreadSnapshot): ThreadArtifact {
  const archived = archivedRefKeys(snapshot);
  const candidates = snapshot.artifacts.filter((artifact) =>
    isCanonicalFreshAdmission(artifact) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (candidates.length === 0) {
    throw resolutionError(
      "admission_not_found",
      "The current Thread tip has no fresh digital-thread compile.seal-admission@1 document.",
    );
  }
  if (candidates.length !== 1) {
    throw resolutionError(
      "admission_ambiguous",
      `The current Thread tip has ${candidates.length} fresh digital-thread compile.seal-admission@1 documents; the server will not choose one.`,
    );
  }
  return candidates[0]!;
}

function isCanonicalFreshAdmission(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "document" &&
    artifact.freshness.status === "fresh" &&
    artifact.fingerprint.algorithm === "sha256" &&
    artifact.id === `${ADMISSION_ARTIFACT_ID_PREFIX}${digest}` &&
    artifact.version === digest &&
    artifact.uri === `${ADMISSION_CAPTURE_URI_PREFIX}${digest}` &&
    artifact.mediaType === ADMISSION_MEDIA_TYPE &&
    artifact.producer.serverId === ADMISSION_PRODUCER_SERVER &&
    artifact.producer.tool === ADMISSION_PRODUCER_TOOL;
}

function resolutionError(
  code: ResolveProjectAdmittedModelicaRunReviewErrorCode,
  message: string,
): ResolveProjectAdmittedModelicaRunReviewError {
  return new ResolveProjectAdmittedModelicaRunReviewError(code, message);
}
