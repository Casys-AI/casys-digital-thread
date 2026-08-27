/**
 * Inward port for a factual assembly-integrity observation review.
 *
 * The caller names no observer capability. It supplies exactly the project,
 * current Thread basis and reviewed primary geometry-module identity; the
 * server-owned resolver recrosses current state and selects profile, method
 * and configured runtime behind this boundary.
 */

import type { AssemblyIntegrityObservationAdmission } from "../../../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringGateClaim,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";

export interface ProjectAssemblyIntegrityReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryModule: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export interface ProjectAssemblyIntegrityReviewDiagnostic {
  readonly code: string;
  readonly artifactId: string | null;
  readonly message: string;
}

export interface ProjectAssemblyIntegrityReviewWork {
  readonly phaseId: string;
  readonly workItemId: string;
  readonly operation: EngineeringOperationRef;
  /** Present only when an existing planned leaf supplied generic gate claims. */
  readonly gateClaims?: readonly EngineeringGateClaim[];
}

export interface ProjectAssemblyIntegrityReviewDecision {
  readonly decisionId: string;
  readonly title: string;
  readonly question: string;
}

/**
 * Paste-ready project mutations for the review. A pre-existing structurally
 * exact planned leaf receives only the MRTR proposal; otherwise the review
 * retains the bounded append-plus-propose fallback without a gate claim.
 */
export type ProjectAssemblyIntegrityReviewNext =
  | {
    readonly append: {
      readonly tool: "project_change_append";
      readonly arguments: {
        /** Stable mutation identity; the caller must preserve it on retry. */
        readonly commandId: string;
        /** Project aggregate selected by the exact read-only review. */
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
          readonly owner: "agent";
          readonly dependsOnWorkItemIds: readonly string[];
          readonly decisionIds: readonly string[];
          readonly operation: EngineeringOperationRef;
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
        readonly decisionId: string;
        readonly proposal: {
          readonly summary: string;
          readonly parameters: readonly EngineeringDecisionProposalParameter[];
        };
      };
    };
  }
  | {
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

export type ProjectAssemblyIntegrityReviewResult =
  | {
    readonly status: "resolved";
    readonly projectId: string;
    /** Exact current Thread basis proved by the injected read-only resolver. */
    readonly basis: EngineeringThreadSnapshotBasis;
    /** Exact primary `geometry-module-capture/1.0` artifact proved by that resolver. */
    readonly geometryModule: ProjectAssemblyIntegrityReviewCommand["geometryModule"];
    readonly diagnostics: readonly ProjectAssemblyIntegrityReviewDiagnostic[];
    readonly operation: EngineeringOperationRef;
    readonly work: ProjectAssemblyIntegrityReviewWork;
    readonly decision: ProjectAssemblyIntegrityReviewDecision;
    readonly admission: AssemblyIntegrityObservationAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: ProjectAssemblyIntegrityReviewNext;
    readonly grants: "none";
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly geometryModule: ProjectAssemblyIntegrityReviewCommand["geometryModule"];
    readonly diagnostics: readonly ProjectAssemblyIntegrityReviewDiagnostic[];
    readonly grants: "none";
  };

export interface ProjectAssemblyIntegrityReviewUseCase {
  execute(value: unknown): Promise<ProjectAssemblyIntegrityReviewResult>;
}
