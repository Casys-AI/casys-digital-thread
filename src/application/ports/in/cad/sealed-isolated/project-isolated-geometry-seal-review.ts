/**
 * Inward port for preparing the human review of one isolated geometry seal.
 *
 * The caller names only an exact Thread basis and the documentary execution
 * capture already attached to it. Published STEP bytes stay behind the
 * isolated-output publication gate and are not returned here.
 */

import type { IsolatedGeometrySealAdmission } from "../../../../../domain/cad/sealed-isolated/isolated-geometry-seal-proposal.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";

export interface ProjectIsolatedGeometrySealReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectIsolatedGeometrySealReviewResult {
  /** Complete typed identity shown to the human; it grants no dispatch right. */
  readonly admission: IsolatedGeometrySealAdmission;
  /** Unique canonical MRTR scalar sequence for `design.seal-isolated-geometry@1`. */
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectIsolatedGeometrySealReviewUseCase {
  execute(value: unknown): Promise<ProjectIsolatedGeometrySealReviewResult>;
}
