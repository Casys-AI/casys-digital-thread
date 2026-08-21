/**
 * Inward port for capturing one exact agent-authored LED-driver human source.
 *
 * The MCP surface may supply only unchanged UTF-8
 * `led-driver-human-source/1.0` JSON text. Hashing, parse, CAS persistence,
 * and replay stay behind this provider-free port.
 *
 * The use case returns a review envelope. The review surface accepts only
 * `review.reference`, never the whole review. This writes no project or
 * Thread state and grants no D1, provider, tool or ngspice authority.
 */

import type { LedDriverSourceCaptureReview } from "../../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";

export interface ProjectLedDriverSourceCaptureCommand {
  readonly sourceText: string;
}

export interface ProjectLedDriverSourceCaptureUseCase {
  capture(
    command: ProjectLedDriverSourceCaptureCommand,
  ): Promise<LedDriverSourceCaptureReview>;
}
