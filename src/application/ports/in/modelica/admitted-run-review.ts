/**
 * Inward port for preparing the human review of one admitted Modelica run.
 *
 * The caller names only an exact Thread basis and the sealed compilation
 * admission already attached to it. Runtime, isolation, output, profile and
 * source facts are reopened or selected behind server-owned outward ports.
 */

import type { ModelicaAdmittedRunAdmission } from "../../../../domain/modelica/admitted/run-proposal.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

export interface ProjectAdmittedModelicaRunReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectAdmittedModelicaRunReviewResult {
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectAdmittedModelicaRunReviewUseCase {
  execute(value: unknown): Promise<ProjectAdmittedModelicaRunReviewResult>;
}
