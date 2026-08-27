/**
 * Provider-free review of one captured LED-driver human source.
 *
 * The use case reopens draft CAS and returns the capture review. It writes
 * no EngineeringProject or Thread state and grants no seal or run.
 */

import { assembleLedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
import type {
  ProjectLedDriverSourceReviewCommand,
  ProjectLedDriverSourceReviewUseCase,
} from "../../../ports/in/electrical/led-driver/project-led-driver-source-review.ts";
import type { LedDriverSourceCaptureReader } from "../../../ports/out/electrical/led-driver-source-capture-reader.ts";
import type { LedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";

export type ProjectLedDriverSourceReviewErrorCode =
  | "invalid_request"
  | "capture_resolution_failed";

export class ProjectLedDriverSourceReviewError extends Error {
  constructor(
    readonly code: ProjectLedDriverSourceReviewErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectLedDriverSourceReviewError";
  }
}

export interface PrepareProjectLedDriverSourceReviewDependencies {
  readonly captures: LedDriverSourceCaptureReader;
}

export class PrepareProjectLedDriverSourceReview
  implements ProjectLedDriverSourceReviewUseCase {
  readonly #captures: LedDriverSourceCaptureReader;

  constructor(dependencies: PrepareProjectLedDriverSourceReviewDependencies) {
    this.#captures = dependencies.captures;
  }

  async execute(value: unknown): Promise<LedDriverSourceCaptureReview> {
    let command: ProjectLedDriverSourceReviewCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw new ProjectLedDriverSourceReviewError(
        "invalid_request",
        "The LED-driver source review request failed exact validation.",
        cause,
      );
    }
    try {
      const reopened = await this.#captures.reopen(command.sourceRef);
      return assembleLedDriverSourceCaptureReview(reopened.reference);
    } catch (cause) {
      if (cause instanceof ProjectLedDriverSourceReviewError) throw cause;
      throw new ProjectLedDriverSourceReviewError(
        "capture_resolution_failed",
        "The LED-driver source capture reference could not be reopened.",
        cause,
      );
    }
  }
}

function parseCommand(value: unknown): ProjectLedDriverSourceReviewCommand {
  const input = exactRecord(value, ["sourceRef"], "$ledDriverSourceReview");
  const sourceRef = exactRecord(
    input.sourceRef,
    [
      "schemaVersion",
      "kind",
      "identity",
      "provenance",
      "source",
      "circuit",
      "testCondition",
      "unknowns",
    ],
    "$ledDriverSourceReview.sourceRef",
  );
  return { sourceRef };
}
