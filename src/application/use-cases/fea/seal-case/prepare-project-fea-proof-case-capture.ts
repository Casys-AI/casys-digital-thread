/**
 * Provider-free draft-CAS capture of one mechanical proof-case source.
 *
 * The use case parses exact JSON, persists canonical bytes, rereads them, and
 * returns the capture review. It writes no EngineeringProject or Thread state.
 */

import { assembleFeaProofCaseSourceCaptureReview } from "../../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import { exactRecord } from "../../../../domain/kernel/case-validation.ts";
import { JSON_SOURCE_ACCEPTED_MIME_TYPES } from "../../../../domain/resource/agent-resource-reference.ts";
import { parseAgentResourceReference } from "../../../../domain/resource/agent-resource-reference.ts";
import type {
  ProjectFeaProofCaseCaptureCommand,
  ProjectFeaProofCaseCaptureUseCase,
} from "../../../ports/in/fea/seal-case/project-fea-proof-case-capture.ts";
import type { FeaProofCaseSourceCaptureReader } from "../../../ports/out/fea/seal-case/fea-proof-case-source-capture-reader.ts";
import type { FeaProofCaseSourceCaptureReview } from "../../../../domain/fea/seal-case/fea-proof-case-source-capture.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../../resource/reopen-agent-resource.ts";

export type ProjectFeaProofCaseCaptureErrorCode =
  | "invalid_request"
  | "source_capture_failed";

export class ProjectFeaProofCaseCaptureError extends Error {
  constructor(
    readonly code: ProjectFeaProofCaseCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectFeaProofCaseCaptureError";
  }
}

export interface PrepareProjectFeaProofCaseCaptureDependencies {
  readonly captures: FeaProofCaseSourceCaptureReader;
  readonly resources: ReopenAgentResource;
}

export class PrepareProjectFeaProofCaseCapture
  implements ProjectFeaProofCaseCaptureUseCase {
  readonly #captures: FeaProofCaseSourceCaptureReader;
  readonly #resources: ReopenAgentResource;

  constructor(dependencies: PrepareProjectFeaProofCaseCaptureDependencies) {
    this.#captures = dependencies.captures;
    this.#resources = dependencies.resources;
  }

  async capture(
    value: ProjectFeaProofCaseCaptureCommand,
  ): Promise<FeaProofCaseSourceCaptureReview> {
    let command: ProjectFeaProofCaseCaptureCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw new ProjectFeaProofCaseCaptureError(
        "invalid_request",
        "The FEA proof-case source capture request failed exact validation.",
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
      return assembleFeaProofCaseSourceCaptureReview({
        fingerprint: stored.reference.fingerprint,
        source: stored.source,
      });
    } catch (cause) {
      if (cause instanceof ProjectFeaProofCaseCaptureError) throw cause;
      if (cause instanceof AgentResourceReopenError) throw cause;
      throw new ProjectFeaProofCaseCaptureError(
        "source_capture_failed",
        "The mechanical proof-case source could not be captured and reread.",
        cause,
      );
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectFeaProofCaseCaptureCommand {
  const input = exactRecord(value, ["resourceRef"], "$feaProofCaseCapture");
  return {
    resourceRef: parseAgentResourceReference(
      input.resourceRef,
      "$feaProofCaseCapture.resourceRef",
    ),
  };
}
