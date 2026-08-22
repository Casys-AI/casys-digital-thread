/**
 * Inward port for capturing one exact agent-authored impact manifest body.
 *
 * The MCP surface may supply only unchanged JSON text of
 * `cross-domain-impact-manifest/1.0` without its computed fingerprint.
 * Canonicalization, embedded and CAS fingerprints, and draft persistence
 * stay behind this provider-free port.
 *
 * The use case returns a review envelope. The later seal review accepts
 * only `review.reference`, never the whole review or sourceText. This
 * writes no project or Thread state and grants no MRTR, evaluation, or
 * provider authority.
 */

import type { CrossDomainImpactManifestCaptureReview } from "../../../../domain/impact/cross-domain-impact-manifest-capture-review.ts";

export const CROSS_DOMAIN_IMPACT_MANIFEST_CAPTURE_SOURCE_MAX_CHARS = 262_144;

export interface ProjectCrossDomainImpactManifestCaptureCommand {
  readonly sourceText: string;
}

export interface ProjectCrossDomainImpactManifestCaptureUseCase {
  capture(
    command: ProjectCrossDomainImpactManifestCaptureCommand,
  ): Promise<CrossDomainImpactManifestCaptureReview>;
}
