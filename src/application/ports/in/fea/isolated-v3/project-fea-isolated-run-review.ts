/**
 * Inward port for compiling `verify.run-fea-static-proof@3` thread-entity
 * bindings from one sealed proof-case document.
 *
 * There is no `fea.run.*` grammar. The run admits the sealed JSON document
 * plus the canonical part STEP named inside it. Historical MCP `@1`/`@2` are
 * not this authority. The caller never supplies material, mesh, loads or a
 * cad-model id.
 */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";
import type { IsolatedCalculixBindingDiagnostic } from "../../../../../domain/fea/isolated-v3/isolated-calculix-bindings.ts";

export interface ProjectFeaIsolatedRunReviewCommand {
  readonly projectId: string;
  /** When omitted, the unique current Thread tip on the project is selected. */
  readonly basis?: EngineeringThreadSnapshotBasis;
  /** When omitted, the unique sealed proof document on the basis is selected. */
  readonly proofArtifactId?: string;
}

export interface FeaIsolatedRunReviewSelection {
  readonly proofArtifactId: string;
  readonly stepArtifactId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly workItemId: string;
  readonly decisionId: string;
  /** Failed leaf named as predecessor; absent on the first-run append. */
  readonly predecessorWorkItemId?: string;
  /** Evidence-free terminal run that authorized the successor; first-run omits it. */
  readonly failedRunId?: string;
}

export interface FeaIsolatedRunReviewNext {
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
        readonly predecessorRevisionId?: string;
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

export type ProjectFeaIsolatedRunReviewResult =
  | {
    readonly status: "resolved";
    readonly diagnostics: readonly IsolatedCalculixBindingDiagnostic[];
    readonly rejectedLookalikes: readonly IsolatedCalculixBindingDiagnostic[];
    /** Exact basis the compilation used; never `latest`. */
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly selected: FeaIsolatedRunReviewSelection;
    readonly operation: EngineeringOperationRef;
    /** Thread-entity bindings; grants no approval. */
    readonly bindings: readonly EngineeringOperationInputBinding[];
    readonly next: FeaIsolatedRunReviewNext;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly diagnostics: readonly IsolatedCalculixBindingDiagnostic[];
    readonly rejectedLookalikes: readonly IsolatedCalculixBindingDiagnostic[];
    readonly basis?: EngineeringThreadSnapshotBasis;
    readonly selected?: undefined;
    readonly operation?: undefined;
    readonly bindings?: undefined;
    readonly next?: undefined;
  };

export interface ProjectFeaIsolatedRunReviewUseCase {
  execute(value: unknown): Promise<ProjectFeaIsolatedRunReviewResult>;
}
