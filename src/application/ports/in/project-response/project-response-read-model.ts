/**
 * Provider-neutral project-response read model.
 *
 * Enumerates every item of the current human-approved brief against recorded
 * evidence. `status: "available"` means the index was readable, never that
 * the engineering response is ready, passing, or complete.
 */

import {
  closedRecord,
  exactRecord,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { RequirementsBriefSourceImpactState } from "../../../../domain/architecture/requirements/requirements-brief-impact.ts";
import type { ProjectBriefItem } from "../../../../domain/project/project-brief.ts";
import type { ThreadFreshness } from "../../../../domain/thread/thread-snapshot.ts";

export const PROJECT_RESPONSE_SCHEMA = "project-response/1.0" as const;

export type ProjectResponseStatus = "available" | "unavailable" | "unresolved";

export type ProjectResponseCorrespondence =
  | "native"
  | "documentary"
  | "unresolved"
  | "TRACE GAP";

export type ProjectResponseOrigin = "native" | "documentary";

export type ProjectResponseApplicability =
  | "current"
  | "historical"
  | "unresolved";

export type ProjectResponseEvaluationStatus =
  | "pass"
  | "fail"
  | "unresolved"
  | "error";

export interface ProjectResponseBriefIdentity {
  readonly briefId: string;
  readonly snapshotId: string;
  readonly revision: number;
}

export interface ProjectResponseThreadIdentity {
  readonly snapshotId: string;
  readonly revision: number;
  readonly subjectId: string;
}

export interface ProjectResponseBasis {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly brief: ProjectResponseBriefIdentity;
  readonly thread?: ProjectResponseThreadIdentity;
}

export interface ProjectResponseDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface ProjectResponseGap {
  readonly code: string;
  readonly message: string;
}

export interface ProjectResponseRequirementEvaluation {
  readonly evaluationId: string;
  readonly status: ProjectResponseEvaluationStatus;
  readonly applicability: ProjectResponseApplicability;
  readonly observationIds: readonly string[];
  readonly evidenceArtifactIds: readonly string[];
  readonly evaluatedAt: string;
  readonly freshness: ThreadFreshness;
}

export interface ProjectResponseRequirementEvidence {
  readonly threadRequirementId: string;
  readonly requirementsArtifactId: string;
  readonly traceArtifactId: string;
  readonly origin: ProjectResponseOrigin;
  readonly sourceBrief: ProjectResponseBriefIdentity;
  readonly sourceItemId: string;
  readonly sourceState: RequirementsBriefSourceImpactState;
  readonly applicability: ProjectResponseApplicability;
  readonly evaluations: readonly ProjectResponseRequirementEvaluation[];
}

export interface ProjectResponseItem {
  readonly item: ProjectBriefItem;
  readonly correspondence: ProjectResponseCorrespondence;
  readonly requirements: readonly ProjectResponseRequirementEvidence[];
  readonly gaps: readonly ProjectResponseGap[];
}

export interface ProjectResponseReadModel {
  readonly schemaVersion: typeof PROJECT_RESPONSE_SCHEMA;
  readonly status: ProjectResponseStatus;
  readonly basis?: ProjectResponseBasis;
  readonly items: readonly ProjectResponseItem[];
  readonly diagnostics: readonly ProjectResponseDiagnostic[];
  readonly grants: "none";
}

export function parseProjectResponseBriefIdentity(
  value: unknown,
  path: string,
): ProjectResponseBriefIdentity {
  const rec = exactRecord(value, ["briefId", "snapshotId", "revision"], path);
  return {
    briefId: parseBasisId(rec.briefId, `${path}.briefId`),
    snapshotId: parseBasisId(rec.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(rec.revision, `${path}.revision`),
  };
}

export function parseProjectResponseThreadIdentity(
  value: unknown,
  path: string,
): ProjectResponseThreadIdentity {
  const rec = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    path,
  );
  return {
    snapshotId: parseBasisId(rec.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(rec.revision, `${path}.revision`),
    subjectId: parseBasisId(rec.subjectId, `${path}.subjectId`),
  };
}

export function parseProjectResponseBasis(
  value: unknown,
  path: string,
): ProjectResponseBasis {
  const rec = closedRecord(value, [
    "projectId",
    "projectRevision",
    "brief",
    "thread",
  ], [
    "projectId",
    "projectRevision",
    "brief",
  ], path);
  const basis: ProjectResponseBasis = {
    projectId: parseBasisId(rec.projectId, `${path}.projectId`),
    projectRevision: positiveInteger(
      rec.projectRevision,
      `${path}.projectRevision`,
    ),
    brief: parseProjectResponseBriefIdentity(rec.brief, `${path}.brief`),
  };
  if (rec.thread === undefined) return basis;
  return {
    ...basis,
    thread: parseProjectResponseThreadIdentity(rec.thread, `${path}.thread`),
  };
}

export function projectResponseBasesEqual(
  left: ProjectResponseBasis,
  right: ProjectResponseBasis,
): boolean {
  if (
    left.projectId !== right.projectId ||
    left.projectRevision !== right.projectRevision ||
    left.brief.briefId !== right.brief.briefId ||
    left.brief.snapshotId !== right.brief.snapshotId ||
    left.brief.revision !== right.brief.revision
  ) {
    return false;
  }
  if (Boolean(left.thread) !== Boolean(right.thread)) return false;
  if (!left.thread || !right.thread) return true;
  return left.thread.snapshotId === right.thread.snapshotId &&
    left.thread.revision === right.thread.revision &&
    left.thread.subjectId === right.thread.subjectId;
}

export function unavailableProjectResponse(
  extras: Partial<ProjectResponseReadModel> = {},
): ProjectResponseReadModel {
  return {
    schemaVersion: PROJECT_RESPONSE_SCHEMA,
    status: extras.status ?? "unavailable",
    items: extras.items ?? [],
    diagnostics: extras.diagnostics ?? [],
    grants: "none",
    ...(extras.basis ? { basis: extras.basis } : {}),
  };
}

function parseBasisId(value: unknown, path: string): string {
  const id = safeId(nonEmptyText(value, path), path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}
