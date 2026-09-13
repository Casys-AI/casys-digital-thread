/**
 * Outbound facts for the project-response index.
 *
 * Adapters reopen exact requirements-brief traces and immutable Thread
 * entities. Joins and applicability stay in the application read model. The
 * reader never selects a provider, runtime, or viewer package.
 */

import type { RequirementsBriefSourceImpactState } from "../../../../domain/architecture/requirements/requirements-brief-impact.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type {
  RequirementEvaluationStatus,
  ThreadFreshness,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ProjectResponseBriefIdentity } from "../../in/project-response/project-response-read-model.ts";

export interface ProjectResponseTraceRequirementFact {
  readonly threadRequirementId: string;
  readonly requirementId: string;
  readonly sourceItemId: string;
  readonly sourceState: RequirementsBriefSourceImpactState;
}

export interface ProjectResponseDocumentaryDeclarationFact {
  readonly kind: "retrospective-documentary";
  readonly linkedAt: string;
  readonly artifactId: string;
  readonly requirementsArtifactId: string;
  readonly claimId: string;
  readonly revision: number;
}

export interface ProjectResponseAvailableTraceFact {
  readonly status: "available";
  readonly artifactId: string;
  readonly threadRequirementIds: readonly string[];
  readonly origin: "native" | "documentary";
  readonly sourceBrief: ProjectResponseBriefIdentity;
  readonly requirementsArtifactId: string;
  readonly declaration?: ProjectResponseDocumentaryDeclarationFact;
  readonly requirements: readonly ProjectResponseTraceRequirementFact[];
}

export interface ProjectResponseTraceGapFact {
  readonly status: "TRACE GAP";
  readonly artifactId: string;
  readonly threadRequirementIds: readonly string[];
}

export type ProjectResponseTraceFact =
  | ProjectResponseAvailableTraceFact
  | ProjectResponseTraceGapFact;

export interface ProjectResponseThreadRequirementFact {
  readonly id: string;
  readonly sourceArtifactId: string;
  readonly freshness: ThreadFreshness;
}

export interface ProjectResponseThreadEvaluationFact {
  readonly id: string;
  readonly requirementId: string;
  readonly status: RequirementEvaluationStatus;
  readonly observationIds: readonly string[];
  readonly evidenceArtifactIds: readonly string[];
  readonly evaluatedAt: string;
  readonly freshness: ThreadFreshness;
}

export interface ProjectResponseThreadObservationFact {
  readonly id: string;
  readonly sourceArtifactIds: readonly string[];
  readonly freshness: ThreadFreshness;
}

export interface ProjectResponseThreadArtifactFact {
  readonly id: string;
  readonly freshness: ThreadFreshness;
  readonly consumptionMismatch: boolean;
}

export interface ProjectResponseEvidenceFacts {
  readonly traces: readonly ProjectResponseTraceFact[];
  readonly requirements: readonly ProjectResponseThreadRequirementFact[];
  readonly evaluations: readonly ProjectResponseThreadEvaluationFact[];
  readonly observations: readonly ProjectResponseThreadObservationFact[];
  readonly artifacts: readonly ProjectResponseThreadArtifactFact[];
  readonly archivedRefKeys: readonly string[];
}

export interface ProjectResponseEvidenceReader {
  read(input: {
    readonly project: EngineeringProjectSnapshot;
    readonly thread?: ThreadSnapshot;
  }): Promise<ProjectResponseEvidenceFacts>;
}

export function emptyProjectResponseEvidenceFacts(): ProjectResponseEvidenceFacts {
  return {
    traces: [],
    requirements: [],
    evaluations: [],
    observations: [],
    artifacts: [],
    archivedRefKeys: [],
  };
}
