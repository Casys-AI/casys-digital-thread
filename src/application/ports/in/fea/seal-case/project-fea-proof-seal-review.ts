/**
 * Inward port for compiling one captured mechanical proof-case source into the
 * canonical `verify.seal-proof-case@1` MRTR parameters.
 *
 * The caller names the project and the opaque source fingerprint. The server
 * selects the unique current Thread tip — not `latest`. No JSON, path,
 * material, mesh, force, box, provider, tool or SysON UUID is accepted from
 * the caller. A mismatch against Thread yields `unresolved` with diagnostics
 * and no parameters.
 */

import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";
import type { FeaProofSealBindingDiagnostic } from "../../../../../domain/fea/seal-case/fea-proof-seal-bindings.ts";
import type { SensitivityCatalogOffer } from "../../../../../domain/sensitivity/study/sensitivity-catalog-from-proof.ts";

export type FeaProofSensitivityCatalog =
  | SensitivityCatalogOffer
  | {
    readonly status: "admission-absent";
    readonly message: string;
  }
  | {
    readonly status:
      | "admission-ambiguous"
      | "admission-unavailable"
      | "admission-unlinked";
    readonly message: string;
  };

export interface ProjectFeaProofSealReviewCommand {
  readonly projectId: string;
  readonly caseRef: { readonly fingerprint: string };
  /** Explicit opt-in; omission and false do not authorize a catalog artifact. */
  readonly sensitivityCatalogOptIn?: boolean;
}

export interface FeaProofSealReviewSelection {
  readonly caseId: string;
  readonly sourceFingerprint: string;
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
    /**
     * Opt-in compiled from the sealed proof plus a unique admission lever.
     * Never written into `fea.proof.*`. Absence of a lever does not block FEA.
     */
    readonly sensitivityCatalog: FeaProofSensitivityCatalog;
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
