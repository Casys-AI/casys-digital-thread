/**
 * Inward port for a provider-free architecture SysML analysis preview.
 *
 * Callers supply one opaque capture reference. The preview always reopens
 * that capture. It writes no Thread state. Unresolved constructs are
 * first-class and are never omitted from the result.
 */

import type { SourceAnalysisBundle } from "../../../../../domain/compile/source/source-analysis.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";

export type ProjectArchitectureSysmlPreviewStatus =
  | "ready-for-review"
  | "unresolved"
  | "rejected";

export interface ProjectArchitectureSysmlPreviewCommand {
  readonly sourceRef: Readonly<Record<string, unknown>>;
}

export interface ProjectArchitectureSysmlPreviewResult {
  readonly status: ProjectArchitectureSysmlPreviewStatus;
  readonly analysis: SourceAnalysisBundle;
  readonly unresolvedConstructs: SourceAnalysisBundle["unresolvedConstructs"];
  readonly sourceRef: Readonly<Record<string, unknown>>;
  readonly decisionParameters?: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectArchitectureSysmlPreviewUseCase {
  execute(value: unknown): Promise<ProjectArchitectureSysmlPreviewResult>;
}
