/**
 * Inward port for capturing one exact agent-authored LED-driver human source.
 *
 * The MCP surface may supply only a full AgentResourceReference from
 * `project_resource_capture`. Hashing, parse, CAS persistence, and replay
 * stay behind this provider-free port.
 *
 * The use case returns a review envelope. The review surface accepts only
 * `review.reference`, never the whole review. This writes no project or
 * Thread state and grants no D1, provider, tool or ngspice authority.
 */

import type { LedDriverSourceCaptureReview } from "../../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import type { AgentResourceReference } from "../../../../../domain/resource/agent-resource-capture.ts";

export interface ProjectLedDriverSourceCaptureCommand {
  readonly resourceRef: AgentResourceReference;
}

export interface ProjectLedDriverSourceCaptureUseCase {
  capture(
    command: ProjectLedDriverSourceCaptureCommand,
  ): Promise<LedDriverSourceCaptureReview>;
}
