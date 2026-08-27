/** Read-only public preparation for one human assembly-integrity L5 closeout. */

import type {
  AssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import type {
  AssemblyIntegrityEvaluationCriterion,
  AssemblyIntegrityEvaluationLimits,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringGateClaim,
  EngineeringOperationRef,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";

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
    readonly next: ProjectAssemblyIntegrityEvaluationCloseoutReviewNext;
  };
  /** Always available after a unique fresh L4 recross; it grants no remediation. */
  readonly reject: {
    readonly admission: AssemblyIntegrityEvaluationCloseoutAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: ProjectAssemblyIntegrityEvaluationCloseoutReviewNext;
  };
}

/**
 * Paste-ready append and proposal for one chosen L5 consequence. The leaf is
 * freshness-bound to the exact current L4 tip; a later head fails existing
 * append authority rather than client trust.
 *
 * Both argument envelopes are complete mutation payloads except `issuedAt`.
 * `deno task mcp:call` fills omitted `issuedAt` when `commandId` is present.
 * A direct client must add `issuedAt` itself. `propose.expectedRevision` is
 * the project revision after one successful `project_change_append`.
 */
export interface ProjectAssemblyIntegrityEvaluationCloseoutReviewNext {
  readonly append: {
    readonly tool: "project_change_append";
    readonly arguments: {
      readonly commandId: string;
      readonly projectId: string;
      readonly baseSnapshot: EngineeringThreadSnapshotRef;
      readonly expectedRevision: number;
      readonly phases: readonly {
        readonly id: string;
        readonly name: string;
        readonly description: string;
      }[];
      readonly workItems: readonly {
        readonly id: string;
        readonly phaseId: string;
        readonly owner: "human";
        readonly dependsOnWorkItemIds: readonly string[];
        readonly decisionIds: readonly string[];
        readonly operation: EngineeringOperationRef;
        readonly gateClaims: readonly EngineeringGateClaim[];
      }[];
      readonly requiredDecisions: readonly {
        readonly id: string;
        readonly phaseId: string;
        readonly title: string;
        readonly question: string;
      }[];
    };
  };
  readonly propose: {
    readonly tool: "project_decision_propose";
    readonly arguments: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly decisionId: string;
      readonly proposal: {
        readonly summary: string;
        readonly parameters: readonly EngineeringDecisionProposalParameter[];
      };
    };
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
