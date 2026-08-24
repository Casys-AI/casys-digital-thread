/**
 * Read-only preparation for one cross-domain impact-manifest seal.
 *
 * The public command deliberately names only a project and an opaque manifest
 * content address. Branches, causal edges, evidence artifacts, provider
 * envelopes, runtime arguments and a human approval are never caller input.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  CrossDomainImpactManifestSealAdmission,
} from "../../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../domain/project/engineering-project.ts";

export interface ProjectCrossDomainImpactManifestSealReviewCommand {
  readonly projectId: string;
  readonly manifestRef: {
    readonly fingerprint: ContentFingerprint;
  };
}

export interface ProjectCrossDomainImpactManifestSealReviewDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type ProjectCrossDomainImpactManifestSealReviewResult =
  | {
    readonly status: "resolved";
    /** Exact human-review facts only; it does not grant an MRTR or dispatch. */
    readonly admission: CrossDomainImpactManifestSealAdmission;
    /** Canonical grammar for `verify.seal-cross-domain-impact-manifest@2`. */
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
    readonly diagnostics:
      readonly ProjectCrossDomainImpactManifestSealReviewDiagnostic[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics:
      readonly ProjectCrossDomainImpactManifestSealReviewDiagnostic[];
  };

export interface ProjectCrossDomainImpactManifestSealReviewUseCase {
  execute(
    value: unknown,
  ): Promise<ProjectCrossDomainImpactManifestSealReviewResult>;
}
