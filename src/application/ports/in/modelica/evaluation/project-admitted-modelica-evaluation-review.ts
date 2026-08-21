/**
 * Inward port for preparing the human review of one admitted Modelica
 * observation evaluation. The public caller names only the project.
 *
 * Values, units, output names, features, limits, provider, SysON tool and
 * args stay server-owned. This grants no L4 verdict and no OMC dispatch.
 */

import type { AdmittedObservationEvaluationAdmission } from "../../../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import type { AdmittedObservationEvaluationMethod } from "../../../../../domain/modelica/evaluation/admitted-observation-evaluation.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectAdmittedModelicaEvaluationReviewRequest {
  readonly projectId: string;
}

export interface ProjectAdmittedModelicaEvaluationReviewResult {
  readonly admission: AdmittedObservationEvaluationAdmission;
  readonly method: AdmittedObservationEvaluationMethod;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectAdmittedModelicaEvaluationReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAdmittedModelicaEvaluationReviewResult>;
}
