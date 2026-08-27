/**
 * Provider-free draft CAS capture of one agent-authored MCP resource.
 *
 * Exact bytes are persisted and reread before interpretation. This writes no
 * EngineeringProject or Thread state and grants no MRTR or microVM path.
 */

import type { ProjectResourceCaptureUseCase } from "../../ports/in/resource/project-resource-capture.ts";
import type { AgentResourceStore } from "../../ports/out/resource/agent-resource-store.ts";
import type { ResourceInterpretationGateway } from "../../ports/out/resource/resource-interpretation-gateway.ts";
import {
  AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA,
  AgentResourceEnvelopeError,
  parseAgentResourceEnvelope,
} from "../../../domain/resource/agent-resource-envelope.ts";
import type { AgentResourceCaptureReview } from "../../../domain/resource/agent-resource-capture.ts";

export type ProjectResourceCaptureErrorCode =
  | "invalid_request"
  | "payload_xor"
  | "invalid_base64"
  | "source_size_limit_exceeded"
  | "source_capture_failed";

export class ProjectResourceCaptureError extends Error {
  constructor(
    readonly code: ProjectResourceCaptureErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectResourceCaptureError";
  }
}

export interface PrepareProjectResourceCaptureDependencies {
  readonly store: AgentResourceStore;
  readonly interpretation: ResourceInterpretationGateway;
}

export class PrepareProjectResourceCapture implements ProjectResourceCaptureUseCase {
  readonly #store: AgentResourceStore;
  readonly #interpretation: ResourceInterpretationGateway;

  constructor(dependencies: PrepareProjectResourceCaptureDependencies) {
    this.#store = dependencies.store;
    this.#interpretation = dependencies.interpretation;
  }

  async capture(value: unknown): Promise<AgentResourceCaptureReview> {
    let envelope;
    try {
      envelope = parseAgentResourceEnvelope(value);
    } catch (cause) {
      if (cause instanceof AgentResourceEnvelopeError) {
        throw new ProjectResourceCaptureError(cause.code, cause.message, cause);
      }
      throw new ProjectResourceCaptureError(
        "invalid_request",
        "The resource capture request failed exact validation.",
        cause,
      );
    }
    try {
      const stored = await this.#store.save(envelope);
      const interpretation = await this.#interpretation.interpret(stored.bytes);
      return {
        schemaVersion: AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA,
        status: interpretation.status === "unresolved" ? "unresolved" : "captured",
        grants: "none",
        reference: stored.reference,
        interpretation,
      };
    } catch (cause) {
      if (cause instanceof ProjectResourceCaptureError) throw cause;
      throw new ProjectResourceCaptureError(
        "source_capture_failed",
        "The agent resource could not be captured and reread.",
        cause,
      );
    }
  }
}
