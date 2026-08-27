/**
 * Project-only public review for a pending L4 assembly-integrity work item.
 *
 * The caller supplies no basis, evidence, method, provider, tolerance, fact,
 * rule, or verdict.  The server selects the unique current L4 work leaf and
 * its required L3 evidence dependency before producing MRTR material.
 */

import type {
  AssemblyIntegrityEvaluationAdmission,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-admission.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export interface ProjectAssemblyIntegrityEvaluationReviewRequest {
  readonly projectId: string;
}

export interface ProjectAssemblyIntegrityEvaluationReviewDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ProjectAssemblyIntegrityEvaluationReviewResult =
  | {
    readonly status: "resolved";
    readonly projectId: string;
    readonly basis: {
      readonly snapshotId: string;
      readonly revision: number;
      readonly subjectId: string;
    };
    readonly work: {
      readonly workItemId: string;
    };
    readonly decision: {
      readonly decisionId: string;
      readonly title: string;
      readonly question: string;
    };
    readonly admission: AssemblyIntegrityEvaluationAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: {
      readonly propose: {
        readonly tool: "project_decision_propose";
        readonly arguments: {
          readonly decisionId: string;
          readonly proposal: {
            readonly summary: string;
            readonly parameters: readonly EngineeringDecisionProposalParameter[];
          };
        };
      };
    };
    readonly diagnostics: readonly [];
    readonly grants: "none";
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly projectId: string;
    readonly diagnostics: readonly ProjectAssemblyIntegrityEvaluationReviewDiagnostic[];
    readonly grants: "none";
  };

export interface ProjectAssemblyIntegrityEvaluationReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectAssemblyIntegrityEvaluationReviewResult>;
}
