/**
 * Inward port for a read-only LED-driver human-source review.
 *
 * The caller supplies one opaque capture reference. The review reopens draft
 * CAS and hoists declared unknowns as `unresolved`. It writes no project or
 * Thread state and grants no seal, run or ngspice authority.
 */

import type { LedDriverSourceCaptureReview } from "../../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";

export interface ProjectLedDriverSourceReviewCommand {
  readonly sourceRef: Readonly<Record<string, unknown>>;
}

export interface ProjectLedDriverSourceReviewUseCase {
  execute(value: unknown): Promise<LedDriverSourceCaptureReview>;
}
