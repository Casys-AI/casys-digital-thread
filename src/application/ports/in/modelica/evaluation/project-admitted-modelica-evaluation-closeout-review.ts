/**
 * Read-only entry point for the generic admitted Modelica L5 closeout review.
 * The caller names only a project; the server selects the unique current
 * Thread tip and reopens every identity itself.
 *
 * L4 pass/fail/unresolved/error stay literal. They never imply accept or
 * reject. Both human closeout grammars are always derived when evidence
 * recrosses.
 */

import type {
  AdmittedObservationEvaluationCloseoutAdmission,
} from "../../../../../domain/modelica/evaluation/admitted-observation-evaluation-closeout-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EvaluationComparison,
  RequirementEvaluationStatus,
} from "../../../../../domain/thread/thread-snapshot.ts";

export interface ProjectAdmittedModelicaEvaluationCloseoutReviewRequest {
  readonly projectId: string;
}

export interface ProjectAdmittedModelicaEvaluationCloseoutReviewEvidenceRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly freshness: "fresh";
}

export interface ProjectAdmittedModelicaEvaluationCloseoutReviewEvaluation {
  readonly id: string;
  readonly requirementId: string;
  readonly status: RequirementEvaluationStatus;
  readonly evidenceArtifactId: string;
  readonly observationIds: readonly string[];
  readonly message: string;
  readonly comparison?: EvaluationComparison;
  readonly output: {
    readonly modelSymbolId: string;
    readonly role: "final" | "max_abs";
    readonly declaredUnit: string;
    readonly limitation: string;
  };
}

export interface ProjectAdmittedModelicaEvaluationCloseoutReviewResolved {
  readonly basis: AdmittedObservationEvaluationCloseoutAdmission["basis"];
  readonly capture: ProjectAdmittedModelicaEvaluationCloseoutReviewEvidenceRef;
  readonly sheet: AdmittedObservationEvaluationCloseoutAdmission["sheet"];
  readonly evaluations:
    readonly ProjectAdmittedModelicaEvaluationCloseoutReviewEvaluation[];
  readonly limitations: {
    readonly engineCalls: "none";
    readonly l4PassIsNotL5: true;
    readonly sheetScope: string;
    readonly sheetLimitations: string;
  };
  readonly accept: {
    readonly admission: AdmittedObservationEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
  readonly reject: {
    readonly admission: AdmittedObservationEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
}

export type ProjectAdmittedModelicaEvaluationCloseoutReviewResult =
  | {
    readonly status: "resolved";
    readonly selected: ProjectAdmittedModelicaEvaluationCloseoutReviewResolved;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: { readonly code: string; readonly message: string };
  };

export interface ProjectAdmittedModelicaEvaluationCloseoutReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAdmittedModelicaEvaluationCloseoutReviewResult>;
}
