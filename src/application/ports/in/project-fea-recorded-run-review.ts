/**
 * Inward port for compiling `verify.run-fea-static-proof@2` thread-entity
 * bindings from one sealed proof-case document.
 *
 * There is no `fea.run.*` grammar. The run admits the sealed JSON document
 * plus the canonical part STEP named inside it. This is not the isolated `@3`
 * authority. The caller never supplies material, mesh, loads or a cad-model id.
 */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../domain/project/engineering-project.ts";
import type { RecordedCalculixBindingDiagnostic } from "../../../domain/analysis/recorded-calculix-bindings.ts";

export interface ProjectFeaRecordedRunReviewCommand {
  readonly projectId: string;
  /** When omitted, the unique current Thread tip on the project is selected. */
  readonly basis?: EngineeringThreadSnapshotBasis;
  /** When omitted, the unique sealed proof document on the basis is selected. */
  readonly proofArtifactId?: string;
}

export interface FeaRecordedRunReviewSelection {
  readonly proofArtifactId: string;
  readonly stepArtifactId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly workItemId: string;
  readonly decisionId: string;
}

export interface FeaRecordedRunReviewNext {
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

export type ProjectFeaRecordedRunReviewResult =
  | {
    readonly status: "resolved";
    readonly diagnostics: readonly RecordedCalculixBindingDiagnostic[];
    readonly rejectedLookalikes: readonly RecordedCalculixBindingDiagnostic[];
    /** Exact basis the compilation used; never `latest`. */
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly selected: FeaRecordedRunReviewSelection;
    readonly operation: EngineeringOperationRef;
    /** Thread-entity bindings; grants no approval. */
    readonly bindings: readonly EngineeringOperationInputBinding[];
    readonly next: FeaRecordedRunReviewNext;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostics: readonly RecordedCalculixBindingDiagnostic[];
    readonly rejectedLookalikes: readonly RecordedCalculixBindingDiagnostic[];
    readonly basis?: EngineeringThreadSnapshotBasis;
    readonly selected?: undefined;
    readonly operation?: undefined;
    readonly bindings?: undefined;
    readonly next?: undefined;
  };

export interface ProjectFeaRecordedRunReviewUseCase {
  execute(value: unknown): Promise<ProjectFeaRecordedRunReviewResult>;
}
