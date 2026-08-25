/** Read-only public preparation for one human assembly-integrity L5 closeout. */

import type {
  AssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import type {
  AssemblyIntegrityEvaluationCriterion,
  AssemblyIntegrityEvaluationLimits,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectAssemblyIntegrityEvaluationCloseoutReviewRequest {
  readonly projectId: string;
}

export interface ProjectAssemblyIntegrityEvaluationCloseoutReviewEvidenceRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly freshness: "fresh";
}

export interface ProjectAssemblyIntegrityEvaluationCloseoutReviewResolved {
  readonly family: "assembly-integrity";
  readonly basis: AssemblyIntegrityEvaluationCloseoutAdmission["basis"];
  readonly acceptanceEligibility: boolean;
  /** Literal L4 statuses in the fixed five-criterion method order. */
  readonly criteria: readonly AssemblyIntegrityEvaluationCriterion[];
  /** L4 limits are retained literally; L5 is neither safety nor certification. */
  readonly limitations: AssemblyIntegrityEvaluationLimits & {
    readonly certification: "not-issued";
    readonly l4PassIsNotL5: true;
  };
  readonly evidence: {
    readonly evaluationCapture:
      ProjectAssemblyIntegrityEvaluationCloseoutReviewEvidenceRef;
    readonly geometryModule:
      ProjectAssemblyIntegrityEvaluationCloseoutReviewEvidenceRef;
    readonly assemblyStep: ProjectAssemblyIntegrityEvaluationCloseoutReviewEvidenceRef;
    readonly observation: ProjectAssemblyIntegrityEvaluationCloseoutReviewEvidenceRef;
  };
  /** Present only when every one of the five L4 criteria is literal pass. */
  readonly accept?: {
    readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
  /** Always available after a unique fresh L4 recross; it grants no remediation. */
  readonly reject: {
    readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  };
}

export type ProjectAssemblyIntegrityEvaluationCloseoutReviewResult =
  | {
    readonly status: "resolved";
    readonly selected: ProjectAssemblyIntegrityEvaluationCloseoutReviewResolved;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly family: "assembly-integrity";
    readonly diagnostic: { readonly code: string; readonly message: string };
  };

export interface ProjectAssemblyIntegrityEvaluationCloseoutReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAssemblyIntegrityEvaluationCloseoutReviewResult>;
}
