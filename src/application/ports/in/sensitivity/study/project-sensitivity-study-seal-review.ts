/**
 * Inward port for compiling one catalogued sensitivity-study template into
 * the canonical `analyze.seal-sensitivity-study@1` MRTR parameters.
 *
 * The caller names the project. The catalog id and Thread basis are optional:
 * omitted `caseId` selects the unique catalogued template for that project, or
 * the unique signed catalog-offer on the current tip when the catalog does
 * not uniquely select (absent or ambiguous); omitted `basis` selects the
 * unique current Thread tip from the project ledger. That is not `latest`.
 * No JSON, path, mesh, load, box, hash or cadSource is accepted. A mismatch
 * against Thread yields `unresolved` or `unavailable` with diagnostics and
 * no parameters.
 */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";
import type { SensitivityStudySealAuthorityKind } from "../../../../../domain/sensitivity/study/sensitivity-catalog-offer-join.ts";
import type { SensitivityStudySealDiagnostic } from "../../../../../domain/sensitivity/study/sensitivity-study-seal-bindings.ts";
import type { SensitivityCadSource } from "../../../../../domain/sensitivity/study/sensitivity-study-v2.ts";

export interface ProjectSensitivityStudySealReviewCommand {
  readonly projectId: string;
  /** When omitted, the unique current Thread tip on the project is selected. */
  readonly basis?: EngineeringThreadSnapshotBasis;
  /** When omitted, the unique catalogued template or signed catalog-offer is selected. */
  readonly caseId?: string;
}

export interface SensitivityStudySealReviewSelection {
  readonly caseId: string;
  readonly caseDigest: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly admissionArtifactId: string;
  readonly cadSource: SensitivityCadSource;
  readonly workItemId: string;
  readonly decisionId: string;
  readonly authority: SensitivityStudySealAuthorityKind;
}

export interface SensitivityStudySealReviewNext {
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

export type ProjectSensitivityStudySealReviewResult =
  | {
    readonly status: "resolved";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
    /** Exact basis the compilation used; never `latest`. */
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly selected: SensitivityStudySealReviewSelection;
    /** Compiled `sensitivity.case.*`; grants no approval. */
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly next: SensitivityStudySealReviewNext;
  }
  | {
    readonly status: "unresolved" | "unavailable";
    readonly caseId: string;
    readonly diagnostics: readonly SensitivityStudySealDiagnostic[];
    readonly basis?: EngineeringThreadSnapshotBasis;
    readonly selected?: undefined;
    readonly decisionParameters?: undefined;
    readonly next?: undefined;
  };

export interface ProjectSensitivityStudySealReviewUseCase {
  execute(value: unknown): Promise<ProjectSensitivityStudySealReviewResult>;
}
