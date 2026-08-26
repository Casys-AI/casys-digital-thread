/**
 * Inward port: reopen one sealed compilation as executable source bytes.
 *
 * This is the recurrent microVM entry. Language-specific MRTR grammars and
 * IsolatedCodeRunner profiles stay outside. Callers never pass source text.
 */

import type {
  TechnicalCompilationDocument,
  TechnicalCompilationProjection,
  TechnicalCompilationTarget,
} from "../../../../../domain/compile/admission/technical-compilation.ts";
import type {
  TechnicalSourceAnalysisCaptureLocator,
  TechnicalSourceAttachmentProvenance,
  TechnicalSourceClosureProvenance,
  TechnicalSourceEffectiveUnit,
} from "../../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";
import type { ReopenedTechnicalCompilationAdmission } from "../../../out/compile/admission/technical-compilation-admission-reader.ts";

export interface ReopenAdmittedCompilationSourceCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
  readonly expectedTarget: TechnicalCompilationTarget;
}

export interface ReopenedAdmittedCompilationSource {
  readonly reopened: ReopenedTechnicalCompilationAdmission;
  readonly document: TechnicalCompilationDocument;
  readonly documentFingerprint: ContentFingerprint;
  readonly projection: TechnicalCompilationProjection;
  readonly sourceId: string;
  readonly sourceText: string;
  readonly sourceFingerprint: ContentFingerprint;
  readonly analysisFingerprint: ContentFingerprint;
  readonly effectiveUnit: TechnicalSourceEffectiveUnit;
  readonly attachment: TechnicalSourceAttachmentProvenance;
  readonly sourceClosure: TechnicalSourceClosureProvenance;
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
}

export type ReopenAdmittedCompilationSourceErrorCode =
  | "invalid_request"
  | "admission_not_found"
  | "admission_resolution_failed"
  | "admission_integrity_failed";

export class ReopenAdmittedCompilationSourceError extends Error {
  constructor(
    readonly code: ReopenAdmittedCompilationSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReopenAdmittedCompilationSourceError";
  }
}

export interface ReopenAdmittedCompilationSourceUseCase {
  execute(
    value: unknown,
  ): Promise<ReopenedAdmittedCompilationSource>;
}
