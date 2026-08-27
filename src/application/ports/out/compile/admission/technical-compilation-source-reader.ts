import type {
  TechnicalCompilationBasis,
  TechnicalCompilationSource,
} from "../../../../../domain/compile/admission/technical-compilation.ts";
import type {
  TechnicalSourceAnalysisCaptureLocator,
  TechnicalSourceAttachmentAlignment,
  TechnicalSourceAttachmentProvenance,
  TechnicalSourceClosureProvenance,
  TechnicalSourceEffectiveUnit,
} from "../../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface TechnicalCompilationSourceReadRequest {
  readonly projectId: string;
  readonly basis: TechnicalCompilationBasis;
  /** Treated only as a capture-store locator, never as source facts. */
  readonly reference: TechnicalSourceAnalysisCaptureLocator;
  readonly referenceFingerprint: ContentFingerprint;
}

export interface ReopenedTechnicalCompilationSource {
  /** Fingerprint of the exact normalized reference the reader resolved. */
  readonly referenceFingerprint: ContentFingerprint;
  readonly source: TechnicalCompilationSource;
  /**
   * Evidence identities attested by replay of the registered source-capture
   * profile. None of these fields may be supplied directly to the preview.
   */
  readonly provenance: TechnicalCompilationSourceProvenance;
}

export interface TechnicalCompilationSourceProvenance {
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly analyzer: {
    readonly id: string;
    readonly version: string;
  };
  readonly sourceFingerprint: ContentFingerprint;
  /** Fingerprint of the complete opaque capture locator. */
  readonly captureFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
  readonly effectiveUnit: TechnicalSourceEffectiveUnit;
  readonly attachment: TechnicalSourceAttachmentProvenance;
  readonly sourceClosure: TechnicalSourceClosureProvenance;
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
  readonly attachmentAlignment: TechnicalSourceAttachmentAlignment;
}

/** Reopens source bytes and parser facts from their immutable captures. */
export interface TechnicalCompilationSourceReader {
  read(
    request: TechnicalCompilationSourceReadRequest,
  ): Promise<ReopenedTechnicalCompilationSource | undefined>;
}
