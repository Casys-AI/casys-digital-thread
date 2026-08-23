/**
 * Inward port for compiling reviewed brief architecture into the canonical
 * `model.write-architecture@1` MRTR parameters.
 *
 * The caller declares the package, the system, optional typed component rows
 * and optional AttributeUsage rows, and names the exact brief item that
 * states each one. Zero components is a single-part system.
 * The server reopens the human-approved canonical brief itself: no brief
 * bytes, SysML text, provider, tool or parameter envelope is accepted from
 * the caller. A declaration whose brief item is absent, non-committing or
 * unsourced yields `unresolved` with diagnostics and no parameters — never a
 * partially compiled proposal.
 *
 * Architecture elements are not normative gates. A cited item must exist, be
 * sourced, and must not be an `exclusion` or `open-question`; those two kinds
 * declare what is out of scope or still undecided.
 */

import type {
  ProjectBriefItemKind,
  ProjectBriefSourceRef,
} from "../../../../../domain/project/project-brief.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringDecisionProposalParameter,
} from "../../../../../domain/project/engineering-project.ts";

/** One reviewed PartUsage occurrence transcribed from an exact brief item. */
export interface BriefArchitectureComponentDeclaration {
  /**
   * Component slug used by the `component.<slug>.<field>` grammar.
   * Shared proposal-parameter slug: letters, digits, hyphen, underscore.
   * Not a SysML identifier.
   */
  readonly slug: string;
  readonly name: string;
  readonly usage: string;
  /** Parent PartDefinition or system name. Omitted: the production parser defaults to `system.name`. */
  readonly parent?: string;
  /** Exact brief item that states this retained occurrence. */
  readonly sourceItemId: string;
}

/** One reviewed AttributeUsage transcribed from an exact brief item. */
export interface BriefArchitectureAttributeDeclaration {
  /**
   * Attribute slug used by the `attribute.<slug>.<field>` grammar.
   * Shared proposal-parameter slug: letters, digits, hyphen, underscore.
   * Not a SysML identifier.
   */
  readonly slug: string;
  readonly name: string;
  /** Owning PartDefinition. Omitted: the production parser defaults to `system.name`. */
  readonly parent?: string;
  readonly sourceItemId: string;
}

export interface ProjectBriefArchitectureReviewCommand {
  readonly projectId: string;
  readonly packageName: string;
  /** Exact brief item that states the architecture package. */
  readonly packageSourceItemId: string;
  readonly systemName: string;
  /** Exact brief item that states the architecture system. */
  readonly systemSourceItemId: string;
  readonly components: readonly BriefArchitectureComponentDeclaration[];
  readonly attributes?: readonly BriefArchitectureAttributeDeclaration[];
}

/**
 * Field-level trace from one emitted parameter back to the brief. It records
 * where a value came from; it does not assert that the value restates the
 * item's prose, which only the signing human can judge.
 */
export interface BriefArchitectureProvenanceEntry {
  readonly parameterKey: string;
  readonly sourceItemId: string;
  readonly sourceItemKind: ProjectBriefItemKind;
  readonly sourceRefs: readonly ProjectBriefSourceRef[];
}

export type BriefArchitectureDiagnosticCode =
  | "brief-item-absent"
  | "brief-item-not-committing"
  | "brief-item-unsourced"
  | "duplicate-component-slug"
  | "duplicate-attribute-slug"
  | "invalid-component-slug"
  | "invalid-attribute-slug"
  | "proposal-grammar-rejected";

export interface BriefArchitectureDiagnostic {
  readonly code: BriefArchitectureDiagnosticCode;
  /** Null for a command-level diagnostic that no single component owns. */
  readonly slug: string | null;
  readonly sourceItemId: string | null;
  readonly message: string;
}

export interface ProjectBriefArchitectureReviewResult {
  readonly status: "resolved" | "unresolved";
  /** Exact human-approved brief the compilation was derived from. */
  readonly briefBasis: EngineeringApprovedBriefBasis;
  readonly diagnostics: readonly BriefArchitectureDiagnostic[];
  readonly provenance: readonly BriefArchitectureProvenanceEntry[];
  /** Present only when `status` is `resolved`; it grants no approval. */
  readonly decisionParameters?: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectBriefArchitectureReviewUseCase {
  execute(value: unknown): Promise<ProjectBriefArchitectureReviewResult>;
}
