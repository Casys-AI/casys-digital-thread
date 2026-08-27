/**
 * Inward port for compiling reviewed brief criteria into the canonical
 * `model.write-requirements@1` MRTR parameters.
 *
 * The caller declares one typed criterion per requirement and names the exact
 * brief item that states it. The server reopens the human-approved canonical
 * brief itself: no brief bytes, SysML text, provider, tool or parameter
 * envelope is accepted from the caller. A declaration whose brief item is
 * absent, non-normative or unsourced yields `unresolved` with diagnostics and
 * no parameters — never a partially compiled proposal.
 */

import type {
  ProjectBriefItemKind,
  ProjectBriefSourceRef,
} from "../../../../../domain/project/project-brief.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
} from "../../../../../domain/project/engineering-project.ts";

/** One reviewed measurable criterion transcribed from an exact brief item. */
export interface BriefRequirementDeclaration {
  /** Requirement slug used by the `requirement.<slug>.<field>` grammar. */
  readonly slug: string;
  readonly name: string;
  readonly metric: string;
  readonly operator: string;
  readonly threshold: number;
  readonly unit: string;
  /** Exact brief item that states this criterion. */
  readonly sourceItemId: string;
}

export interface ProjectBriefRequirementsReviewCommand {
  readonly projectId: string;
  readonly containerComponent: string;
  /** Exact brief item that names the component the requirements are anchored to. */
  readonly containerSourceItemId: string;
  readonly requirements: readonly BriefRequirementDeclaration[];
}

/**
 * Field-level trace from one emitted parameter back to the brief. It records
 * where a value came from; it does not assert that the value restates the
 * item's prose, which only the signing human can judge.
 */
export interface BriefRequirementsProvenanceEntry {
  readonly parameterKey: string;
  readonly sourceItemId: string;
  readonly sourceItemKind: ProjectBriefItemKind;
  readonly sourceRefs: readonly ProjectBriefSourceRef[];
  /**
   * Code-owned unit normalisation applied between the declared value and the
   * emitted one. Anything but `identity` means the human signs a number the
   * agent did not type, so the transformation is named here rather than left
   * to happen invisibly upstream.
   */
  readonly transformation: BriefRequirementsTransformation;
}

export type BriefRequirementsTransformation =
  | "identity"
  | "MPa-to-Pa"
  | "kN-to-N"
  | "MJ-to-J"
  | "kJ-to-J"
  | "bar-to-Pa"
  | "degC-to-K";

export type BriefRequirementsDiagnosticCode =
  | "brief-item-absent"
  | "brief-item-not-normative"
  | "brief-item-unsourced"
  | "duplicate-requirement-slug"
  | "proposal-grammar-rejected";

export interface BriefRequirementsDiagnostic {
  readonly code: BriefRequirementsDiagnosticCode;
  /** Null for a command-level diagnostic that no single requirement owns. */
  readonly slug: string | null;
  readonly sourceItemId: string | null;
  readonly message: string;
}

export interface ProjectBriefRequirementsReviewResult {
  readonly status: "resolved" | "unresolved";
  /** Exact human-approved brief the compilation was derived from. */
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly diagnostics: readonly BriefRequirementsDiagnostic[];
  readonly provenance: readonly BriefRequirementsProvenanceEntry[];
  /** Present only when `status` is `resolved`; it grants no approval. */
  readonly decisionParameters?: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectBriefRequirementsReviewUseCase {
  execute(value: unknown): Promise<ProjectBriefRequirementsReviewResult>;
}
