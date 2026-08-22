/**
 * Inward port for preparing the human review of one admitted SPICE
 * observation evaluation. The public caller names only the project.
 *
 * Values, units, native names, provider, SysON tool and args stay
 * server-owned. This grants no L4 verdict and no ngspice dispatch.
 */

import type { SpiceAdmittedObservationEvaluationAdmission } from "../../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation-proposal.ts";
import type { SpiceAdmittedObservationEvaluationMethod } from "../../../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../../domain/project/engineering-project.ts";

export interface ProjectAdmittedSpiceEvaluationReviewRequest {
  readonly projectId: string;
}

export interface ProjectAdmittedSpiceEvaluationReviewResult {
  readonly admission: SpiceAdmittedObservationEvaluationAdmission;
  readonly method: SpiceAdmittedObservationEvaluationMethod;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectAdmittedSpiceEvaluationReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAdmittedSpiceEvaluationReviewResult>;
}
