import type { TechnicalCompilationDocument } from "../../../../../domain/compile/admission/technical-compilation.ts";
import type { TechnicalSourceAnalysisCaptureLocator } from "../../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export const TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA =
  "technical-compilation-draft-reference/1.0" as const;

export interface TechnicalCompilationDraftReference {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA;
  /** Deterministic content-addressed id, not a path or provider URI. */
  readonly draftId: string;
  /** Project scope is explicit; a global CAS object grants no project authority. */
  readonly projectId: string;
  readonly documentFingerprint: ContentFingerprint;
  /** Hash of the complete persisted envelope, including `projectId`. */
  readonly envelopeFingerprint: ContentFingerprint;
}

export interface TechnicalCompilationDraft {
  readonly projectId: string;
  readonly document: TechnicalCompilationDocument;
  readonly fingerprint: ContentFingerprint;
  /** Exact capture locators required for future evidence replay at sealing. */
  readonly sourceCaptures: readonly TechnicalCompilationDraftSourceCapture[];
}

export interface TechnicalCompilationDraftSourceCapture {
  readonly sourceId: string;
  readonly reference: TechnicalSourceAnalysisCaptureLocator;
  readonly referenceFingerprint: ContentFingerprint;
}

/**
 * Content-addressed draft persistence. The application supplies and later
 * verifies the deterministic reference; implementations hide storage details.
 */
export interface TechnicalCompilationDraftStore {
  save(
    reference: TechnicalCompilationDraftReference,
    draft: TechnicalCompilationDraft,
  ): Promise<TechnicalCompilationDraftReference>;
  read(
    reference: TechnicalCompilationDraftReference,
  ): Promise<TechnicalCompilationDraft | undefined>;
}
