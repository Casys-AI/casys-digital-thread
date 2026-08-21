/**
 * Provider-free draft-CAS capture of one LED-driver human source.
 *
 * The use case invokes hash-before-parse CAS capture, rereads the stored
 * bytes, and returns the capture review. It writes no EngineeringProject
 * or Thread state and grants no seal, run or D1.
 */

import { assembleLedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
import type {
  ProjectLedDriverSourceCaptureCommand,
  ProjectLedDriverSourceCaptureUseCase,
} from "../../../ports/in/electrical/led-driver/project-led-driver-source-capture.ts";
import type { LedDriverSourceCaptureReader } from "../../../ports/out/electrical/led-driver-source-capture-reader.ts";
import type { LedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";

export type ProjectLedDriverSourceCaptureErrorCode =
  | "invalid_request"
  | "source_capture_failed";

export class ProjectLedDriverSourceCaptureError extends Error {
  constructor(
    readonly code: ProjectLedDriverSourceCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectLedDriverSourceCaptureError";
  }
}

export interface PrepareProjectLedDriverSourceCaptureDependencies {
  readonly captures: LedDriverSourceCaptureReader;
}

export class PrepareProjectLedDriverSourceCapture
  implements ProjectLedDriverSourceCaptureUseCase {
  readonly #captures: LedDriverSourceCaptureReader;

  constructor(dependencies: PrepareProjectLedDriverSourceCaptureDependencies) {
    this.#captures = dependencies.captures;
  }

  async capture(
    value: ProjectLedDriverSourceCaptureCommand,
  ): Promise<LedDriverSourceCaptureReview> {
    let command: ProjectLedDriverSourceCaptureCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw new ProjectLedDriverSourceCaptureError(
        "invalid_request",
        "The LED-driver source capture request failed exact validation.",
        cause,
      );
    }
    try {
      const reference = await this.#captures.capture(command.sourceText);
      const reopened = await this.#captures.reopen(reference);
      return assembleLedDriverSourceCaptureReview(reopened.reference);
    } catch (cause) {
      if (cause instanceof ProjectLedDriverSourceCaptureError) throw cause;
      throw new ProjectLedDriverSourceCaptureError(
        "source_capture_failed",
        "The LED-driver human source could not be captured and reread.",
        cause,
      );
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectLedDriverSourceCaptureCommand {
  const input = exactRecord(value, ["sourceText"], "$ledDriverSourceCapture");
  if (typeof input.sourceText !== "string" || input.sourceText.length === 0) {
    throw new TypeError(
      "$ledDriverSourceCapture.sourceText must be a non-empty string.",
    );
  }
  return { sourceText: input.sourceText };
}
