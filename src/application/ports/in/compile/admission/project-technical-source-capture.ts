/**
 * Inward port for capturing one exact agent-authored technical source.
 *
 * The MCP surface may select only a server-registered capture profile and
 * supply source identity plus a full AgentResourceReference from
 * `project_resource_capture`. Profile resolution, parsing, CAS persistence,
 * and replay stay behind this provider-free port.
 *
 * The use case returns a review envelope. Compilation preview accepts only
 * `review.reference`, never the whole review.
 */

import type { TechnicalSourceCaptureReview } from "../../../../../domain/compile/admission/technical-source-capture-review.ts";
import type { AgentResourceReference } from "../../../../../domain/resource/agent-resource-capture.ts";

export interface ProjectTechnicalSourceCaptureCommand {
  readonly profileId: string;
  readonly sourceId: string;
  readonly resourceRef: AgentResourceReference;
}

export interface ProjectTechnicalSourceCaptureUseCase {
  capture(
    command: ProjectTechnicalSourceCaptureCommand,
  ): Promise<TechnicalSourceCaptureReview>;
}
