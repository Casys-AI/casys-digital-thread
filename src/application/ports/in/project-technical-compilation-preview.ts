/**
 * Inward port for a provider-free technical-compilation preview.
 *
 * The caller supplies exact identifiers and opaque capture references only.
 * Source bytes, parser output, Thread/SysML captures, and qualification
 * profiles are reopened by server-owned outward ports.
 */

import type {
  TechnicalCompilationDocument,
  TechnicalCompilationProfileRequest,
  TechnicalSemanticBinding,
} from "../../../domain/analysis/technical-compilation.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../domain/project/engineering-project.ts";
import type { EngineeringDecisionProposalParameter } from "../../../domain/project/engineering-project.ts";
import type { TechnicalCompilationDraftReference } from "../out/technical-compilation-draft-store.ts";

export interface ProjectTechnicalCompilationPreviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  /** Opaque, immutable references emitted by the source-capture boundary. */
  readonly sourceRefs: readonly Readonly<Record<string, unknown>>[];
  readonly bindings: readonly TechnicalSemanticBinding[];
  readonly profileRequests: readonly TechnicalCompilationProfileRequest[];
}

interface ProjectTechnicalCompilationPreviewBaseResult {
  readonly document: TechnicalCompilationDocument;
  readonly fingerprint: ContentFingerprint;
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
