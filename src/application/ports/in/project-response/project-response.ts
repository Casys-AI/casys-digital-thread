/**
 * Inward read port for the server-owned project-response index.
 *
 * `read` selects the unique current Thread tip. `project` consumes already
 * resolved immutable snapshots and never refetches a newer tip. latest,
 * labels, providers and runtimes are refused.
 */

import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type {
  ProjectResponseBasis,
  ProjectResponseReadModel,
} from "../../../../domain/project/project-response.ts";

export type {
  ProjectResponseApplicability,
  ProjectResponseBasis,
  ProjectResponseBriefIdentity,
  ProjectResponseCorrespondence,
  ProjectResponseDiagnostic,
  ProjectResponseEvaluationStatus,
  ProjectResponseGap,
  ProjectResponseItem,
  ProjectResponseOrigin,
  ProjectResponseReadModel,
  ProjectResponseRequirementEvaluation,
  ProjectResponseRequirementEvidence,
  ProjectResponseStatus,
  ProjectResponseThreadIdentity,
} from "../../../../domain/project/project-response.ts";

export {
  parseProjectResponseBasis,
  parseProjectResponseBriefIdentity,
  parseProjectResponseThreadIdentity,
  PROJECT_RESPONSE_SCHEMA,
  projectResponseBasesEqual,
  unavailableProjectResponse,
} from "../../../../domain/project/project-response.ts";

export interface ProjectResponseReadQuery {
  readonly projectId: string;
  readonly expectedBasis?: ProjectResponseBasis;
}

export interface ProjectResponseProjectionQuery {
  readonly project: EngineeringProjectSnapshot;
  readonly thread?: ThreadSnapshot;
}

export interface ProjectResponseUseCase {
  read(query: ProjectResponseReadQuery): Promise<ProjectResponseReadModel>;
  /**
   * Workbench GET packaging: exact already-resolved project and optional
   * Thread. Must not fetch a newer tip while enriching an older payload.
   */
  project(
    query: ProjectResponseProjectionQuery,
  ): Promise<ProjectResponseReadModel>;
}
