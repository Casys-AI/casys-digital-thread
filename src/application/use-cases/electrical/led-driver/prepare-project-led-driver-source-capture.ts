/**
 * Provider-free draft-CAS capture of one LED-driver human source.
 *
 * The use case invokes hash-before-parse CAS capture, rereads the stored
 * bytes, and returns the capture review. It writes no EngineeringProject
 * or Thread state and grants no seal, run or D1.
 */

import { assembleLedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../../domain/resource/agent-resource-reference.ts";
import { parseAgentResourceReference } from "../../../../domain/resource/agent-resource-reference.ts";
import type {
  ProjectLedDriverSourceCaptureCommand,
  ProjectLedDriverSourceCaptureUseCase,
} from "../../../ports/in/electrical/led-driver/project-led-driver-source-capture.ts";
import type { LedDriverSourceCaptureReader } from "../../../ports/out/electrical/led-driver-source-capture-reader.ts";
import type { LedDriverSourceCaptureReview } from "../../../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../../resource/reopen-agent-resource.ts";

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
  readonly resources: ReopenAgentResource;
}

export class PrepareProjectLedDriverSourceCapture
  implements ProjectLedDriverSourceCaptureUseCase {
  readonly #captures: LedDriverSourceCaptureReader;
  readonly #resources: ReopenAgentResource;

  constructor(dependencies: PrepareProjectLedDriverSourceCaptureDependencies) {
    this.#captures = dependencies.captures;
    this.#resources = dependencies.resources;
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
      const reopened = await this.#resources.reopenUtf8Text(command.resourceRef, {
        acceptedMimeTypes: JSON_SOURCE_ACCEPTED_MIME_TYPES,
        maxBytes: 262_144,
      });
      const reference = await this.#captures.capture(reopened.text);
      const stored = await this.#captures.reopen(reference);
      return assembleLedDriverSourceCaptureReview(stored.reference);
    } catch (cause) {
      if (cause instanceof ProjectLedDriverSourceCaptureError) throw cause;
      if (cause instanceof AgentResourceReopenError) throw cause;
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
  const input = exactRecord(value, ["resourceRef"], "$ledDriverSourceCapture");
  return {
    resourceRef: parseAgentResourceReference(
      input.resourceRef,
      "$ledDriverSourceCapture.resourceRef",
    ),
  };
}
