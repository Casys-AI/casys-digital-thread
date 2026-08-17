/**
 * Inward port for compiling one catalogued mechanical proof case into the
 * canonical `verify.seal-proof-case@1` MRTR parameters.
 *
 * The caller names the project. The catalog id and Thread basis are optional:
 * omitted `caseId` selects the unique catalogued case for that project;
 * omitted `basis` selects the unique current Thread tip from the project
 * ledger. That is not `latest`. No JSON, path, material, mesh, force, box or
 * SysON UUID is accepted. A mismatch against Thread yields `unresolved`
 * with diagnostics and no parameters.
 */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import type { FeaProofSealBindingDiagnostic } from "../../../domain/analysis/fea-proof-seal-bindings.ts";

export interface ProjectFeaProofSealReviewCommand {
  readonly projectId: string;
  /** When omitted, the unique current Thread tip on the project is selected. */
  readonly basis?: EngineeringThreadSnapshotBasis;
  /** When omitted, the unique catalogued case for this project is selected. */
  readonly caseId?: string;
}

export interface FeaProofSealReviewSelection {
  readonly caseId: string;
  readonly proofDigest: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryArtifactId: string;
  readonly requirementsArtifactId: string;
  readonly stepArtifactId: string;
  readonly workItemId: string;
  readonly decisionId: string;
}

export interface FeaProofSealReviewNext {
  readonly append: {
    readonly tool: "project_change_append";
    readonly arguments: {
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
  readonly queue: {
    readonly tool: "project_agent_run_queue";
    readonly workItemId: string;
  };
}

export type ProjectFeaProofSealReviewResult =
  | {
    readonly status: "resolved";
    readonly caseId: string;
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
    /** Exact basis the compilation used; never `latest`. */
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly selected: FeaProofSealReviewSelection;
    /** Compiled `fea.proof.*`; grants no approval. */
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: FeaProofSealReviewNext;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly caseId: string;
    readonly diagnostics: readonly FeaProofSealBindingDiagnostic[];
    readonly basis?: EngineeringThreadSnapshotBasis;
    readonly selected?: undefined;
    readonly decisionParameters?: undefined;
    readonly next?: undefined;
  };

export interface ProjectFeaProofSealReviewUseCase {
  execute(value: unknown): Promise<ProjectFeaProofSealReviewResult>;
}
