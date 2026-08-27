/**
 * Inward port for preparing the human review of one qualified Build123d run.
 *
 * The caller names only an exact Thread basis and the sealed compilation
 * admission already attached to it. Runtime, isolation, output, profile and
 * source facts are reopened or selected behind server-owned outward ports.
 */

import type { Build123dExecutionAdmission } from "../../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import type { CompilationAdmissionRunOperation } from "../../../../../domain/compile/admission/compilation-admission-run-operation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../../domain/project/engineering-project.ts";

export interface ProjectBuild123dExecutionReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectBuild123dExecutionReviewResult {
  /** Complete typed identity shown to the human; it grants no dispatch right. */
  readonly admission: Build123dExecutionAdmission;
  /** Unique canonical MRTR scalar sequence for `design.execute-build123d@1`. */
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  /**
   * Registered `design.execute-build123d@1` work-item operation. Reuse
   * verbatim: `compilationAdmission` names the selected admission artifact on
   * the current review Thread basis, never a historical creation snapshot.
   */
  readonly operation: CompilationAdmissionRunOperation;
}

export interface ProjectBuild123dExecutionReviewUseCase {
  execute(value: unknown): Promise<ProjectBuild123dExecutionReviewResult>;
}
