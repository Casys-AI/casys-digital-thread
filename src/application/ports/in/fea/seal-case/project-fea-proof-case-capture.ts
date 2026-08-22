/**
 * Inward port for capturing one exact agent-authored mechanical proof-case source.
 *
 * The MCP surface may supply only unchanged JSON text. Hashing, parse, CAS
 * persistence, and replay stay behind this provider-free port.
 *
 * This writes no project or Thread state and grants no MRTR or execution
 * authority.
 */

import type { FeaProofCaseSourceCaptureReview } from "../../../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";

export interface ProjectFeaProofCaseCaptureCommand {
  readonly sourceText: string;
}

export interface ProjectFeaProofCaseCaptureUseCase {
  capture(
    command: ProjectFeaProofCaseCaptureCommand,
  ): Promise<FeaProofCaseSourceCaptureReview>;
}
