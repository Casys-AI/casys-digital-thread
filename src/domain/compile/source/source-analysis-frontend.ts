/**
 * Port for a parser-backed frontend that converts one exact native source into
 * source-local facts. Implementations are pure: they neither persist a source
 * nor call a provider. The caller supplies source text, never a claimed digest;
 * the frontend computes the fingerprint from the exact UTF-8 bytes itself.
 */

import type {
  SourceAnalysisBundle,
  SourceAnalysisLanguage,
  SourceAnalysisSourceRole,
} from "./source-analysis.ts";

export interface SourceAnalysisFrontendInput {
  /** Server-assigned semantic identity for this one source occurrence. */
  readonly sourceId: string;
  readonly role: SourceAnalysisSourceRole;
  readonly language: SourceAnalysisLanguage;
  /** Exact native text whose UTF-8 bytes are fingerprinted by the frontend. */
  readonly sourceText: string;
}

/**
 * A language-specific, provider-independent source-analysis frontend.
 *
 * A frontend may report unsupported syntax as diagnostics, but it may not
 * invent a relation, grant authority, read storage, or dispatch an MCP tool.
 */
export interface SourceAnalysisFrontend {
  analyze(input: SourceAnalysisFrontendInput): Promise<SourceAnalysisBundle>;
}
