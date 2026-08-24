/**
 * Persist and reopen one opaque technical-source capture locator.
 *
 * Callers never submit the full capture document. Profile resolution is
 * server-owned.
 */

import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
  type TechnicalProjectSourceAnchor,
  type TechnicalSourceAnalysisCaptureLocator,
} from "../../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import type { SourceAnalysisBundle } from "../../../../../domain/compile/source/source-analysis.ts";

export type TechnicalSourceAnalysisCaptureErrorCode =
  | "source_size_limit_exceeded"
  | "source_capture_readback_failed"
  | "analysis_identity_mismatch"
  | "analysis_capture_readback_failed"
  | "source_capture_invalid"
  | "analysis_capture_invalid"
  | "analysis_rejected"
  | "locator_cas_tampered"
  | "capture_document_invalid";

export class TechnicalSourceAnalysisCaptureError extends Error {
  constructor(
    readonly code: TechnicalSourceAnalysisCaptureErrorCode,
    message: string,
    readonly reference?: unknown,
  ) {
    super(message);
    this.name = "TechnicalSourceAnalysisCaptureError";
  }
}

export interface TechnicalSourceCaptureProfile {
  readonly id: string;
  readonly version: string;
  readonly role: "cad-script" | "modelica-model" | "spice-circuit";
  readonly language: "python" | "modelica" | "spice";
  readonly maxSourceBytes: number;
}

export interface PersistedTechnicalSourceAnalysis {
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly document: {
    readonly projectSource: TechnicalProjectSourceAnchor;
    readonly source: { readonly id: string };
  };
}

export interface ReopenedTechnicalSourceAnalysisLocator {
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly document: {
    readonly schemaVersion: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA;
    readonly projectSource: TechnicalProjectSourceAnchor;
    readonly source: {
      readonly id: string;
      readonly role: TechnicalSourceCaptureProfile["role"];
      readonly language: TechnicalSourceCaptureProfile["language"];
      readonly sha256: string;
      readonly byteCount: number;
      readonly casUri: string;
    };
    readonly profile: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: {
        readonly algorithm: "sha256";
        readonly digest: string;
      };
    };
    readonly analysis: {
      readonly analyzer: { readonly id: string; readonly version: string };
      readonly policy: {
        readonly profile: string;
        readonly status: "passed" | "rejected";
      };
      readonly sha256: string;
      readonly byteCount: number;
      readonly casUri: string;
    };
  };
}

export class TechnicalSourceCaptureProfileNotRegisteredError extends Error {
  constructor(
    readonly profileId: string,
    readonly profileVersion?: string,
  ) {
    super(
      profileVersion === undefined
        ? `No technical source-analysis profile is registered for ${profileId}.`
        : `No technical source-analysis profile is registered for ${profileId}@${profileVersion}.`,
    );
    this.name = "TechnicalSourceCaptureProfileNotRegisteredError";
  }
}

export interface TechnicalSourceAnalysisCapture {
  requireCaptureProfile(profileId: string): TechnicalSourceCaptureProfile;
  persist(input: {
    readonly profileId: string;
    readonly sourceId: string;
    readonly sourceText: string;
    readonly projectSource: TechnicalProjectSourceAnchor;
  }): Promise<PersistedTechnicalSourceAnalysis>;
  reopenLocator(
    value: unknown,
  ): Promise<ReopenedTechnicalSourceAnalysisLocator>;
}
