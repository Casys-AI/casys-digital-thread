/**
 * Inward port for one mutating MCP resource-ingress capture.
 *
 * The caller supplies a name, MIME type, and exactly one of text or blob.
 * The server hashes exact bytes, persists draft CAS, rereads them, and may
 * interpret a closed known schema. Grants none.
 */

import type { AgentResourceCaptureReview } from "../../../../domain/resource/agent-resource-capture.ts";

export interface ProjectResourceCaptureUseCase {
  capture(value: unknown): Promise<AgentResourceCaptureReview>;
}
