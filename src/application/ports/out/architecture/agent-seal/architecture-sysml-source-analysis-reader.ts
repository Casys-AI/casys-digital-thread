/**
 * Outward reader for a previously captured agent-authored architecture SysML
 * source. Application code reopens exact CAS identities; it never parses or
 * chooses a frontend.
 */

import type { SourceAnalysisBundle } from "../../../../../domain/compile/source/source-analysis.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

export interface ReopenedArchitectureSysmlSourceAnalysis {
  readonly reference: {
    readonly source: {
      readonly id: string;
      readonly sha256: string;
      readonly byteCount: number;
      readonly casUri: string;
    };
    readonly profile: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
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
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
}

export interface ArchitectureSysmlSourceAnalysisReader {
  reopen(value: unknown): Promise<ReopenedArchitectureSysmlSourceAnalysis>;
}
