/**
 * Inward port for compiling a closed `model.recapture-requirements@1` review.
 *
 * The caller may name only the project and, when several captured families
 * exist, the exact product-navigation PartDefinition element id. Provider
 * identities, runtimes and SysML text are refused. This writes no project or
 * Thread state and grants no MRTR.
 */

import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { RequirementsRecaptureAdmission } from "../../../../../domain/architecture/requirements/requirements-recapture-proposal.ts";
import type { RequirementsTracedRecaptureAdmission } from "../../../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";

export interface ProjectRequirementsRecaptureReviewCommand {
  readonly projectId: string;
  /** Product-navigation PartDefinition element id. Selects among sealed families. */
  readonly targetElementId?: string;
}

export type RequirementsRecaptureDiagnosticCode =
  | "project-not-found"
  | "basis-absent"
  | "basis-ambiguous"
  | "architecture-absent"
  | "architecture-invalid"
  | "predecessor-absent"
  | "predecessor-ambiguous"
  | "predecessor-invalid"
  | "target-required"
  | "target-unknown"
  | "target-changed"
  | "same-architecture-noop"
  | "writer-sibling-uncertain"
  | "snapshot-invalid";

export interface RequirementsRecaptureDiagnostic {
  readonly code: RequirementsRecaptureDiagnosticCode;
  readonly message: string;
}

export type ProjectRequirementsRecaptureReviewResult =
  | {
    readonly status: "resolved";
    readonly operation: {
      readonly id: "model.recapture-requirements";
      readonly version: "1" | "2";
    };
    readonly admission:
      | RequirementsRecaptureAdmission
      | RequirementsTracedRecaptureAdmission;
    readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  }
  | {
    readonly status: "unresolved";
    readonly diagnostics: readonly RequirementsRecaptureDiagnostic[];
  };

export interface ProjectRequirementsRecaptureReviewUseCase {
  execute(value: unknown): Promise<ProjectRequirementsRecaptureReviewResult>;
}
