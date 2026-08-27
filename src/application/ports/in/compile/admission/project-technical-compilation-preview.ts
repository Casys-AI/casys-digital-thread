/**
 * Inward port for a provider-free technical-compilation preview.
 *
 * The caller names the project and opaque capture references only. Omitted
 * `basis` is the unique current Thread tip, not `latest`. Profile selection
 * and SysML bindings are server-owned unique joins.
 */

import type { TechnicalCompilationDocument } from "../../../../../domain/compile/admission/technical-compilation.ts";
import type { TechnicalCompilationJoinGap } from "../../../../../domain/compile/admission/technical-compilation-preview-review.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { EngineeringDecisionProposalParameter } from "../../../../../domain/project/engineering-project.ts";
import type { TechnicalSourceAnalysisCaptureLocator } from "../../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { TechnicalCompilationDraftReference } from "../../../out/compile/admission/technical-compilation-draft-store.ts";

export interface ProjectTechnicalCompilationPreviewCommand {
  readonly projectId: string;
  readonly basis?: EngineeringThreadSnapshotBasis;
  /** Opaque, immutable locators from `project_technical_source_capture` result.reference. */
  readonly sourceRefs: readonly TechnicalSourceAnalysisCaptureLocator[];
}

interface ProjectTechnicalCompilationPreviewBaseResult {
  readonly document: TechnicalCompilationDocument;
  readonly fingerprint: ContentFingerprint;
  /**
   * Agent-facing join explanation. Not stored in the compilation document.
   * Empty when the document is ready-for-review.
   */
  readonly gaps: readonly TechnicalCompilationJoinGap[];
}

/**
 * Only this arm has a persisted review draft and server-derived MRTR proposal
 * parameters. They identify a separate admission operation and confer no
 * execution authority.
 */
export interface ProjectTechnicalCompilationReadyPreview
  extends ProjectTechnicalCompilationPreviewBaseResult {
  readonly status: "ready-for-review";
  readonly draft: TechnicalCompilationDraftReference;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
}

export interface ProjectTechnicalCompilationNonReadyPreview
  extends ProjectTechnicalCompilationPreviewBaseResult {
  readonly status: "unresolved" | "rejected";
}

export type ProjectTechnicalCompilationPreviewResult =
  | ProjectTechnicalCompilationReadyPreview
  | ProjectTechnicalCompilationNonReadyPreview;

export interface ProjectTechnicalCompilationPreviewUseCase {
  execute(value: unknown): Promise<ProjectTechnicalCompilationPreviewResult>;
}
