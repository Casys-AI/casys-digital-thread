import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectResourceCaptureUseCase } from "../../application/ports/in/resource/project-resource-capture.ts";
import type { AgentResourceExposure } from "../../application/ports/out/resource/agent-resource-exposure.ts";
import type { AgentResourceCaptureReview } from "../../domain/resource/agent-resource-capture.ts";
import {
  AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA,
  AGENT_RESOURCE_MAX_BYTES,
} from "../../domain/resource/agent-resource-envelope.ts";
import { AGENT_RESOURCE_REFERENCE_SCHEMA } from "../../domain/resource/agent-resource-reference.ts";

export interface ProjectResourceCaptureToolDependencies {
  readonly resourceCapture?: ProjectResourceCaptureUseCase;
  readonly resourceExposure?: AgentResourceExposure;
}

export function registerProjectResourceCaptureTools(
  app: McpApp,
  dependencies: ProjectResourceCaptureToolDependencies,
): void {
  if (!dependencies.resourceCapture) return;
  const capture = dependencies.resourceCapture;
  const exposure = dependencies.resourceExposure;
  app.registerTool(projectResourceCaptureTool, async (args) => {
    const review = await capture.capture(args);
    if (exposure) await exposure.expose(review.reference);
    return {
      content: [
        {
          type: "text",
          text: captureSummary(review),
        },
        {
          type: "resource_link",
          uri: review.reference.uri,
          name: review.reference.name,
          mimeType: review.reference.mimeType,
          size: review.reference.byteCount,
        },
      ],
      structuredContent: review as unknown as Record<string, unknown>,
    };
  });
}

const FINGERPRINT_SCHEMA = AGENT_RESOURCE_REFERENCE_SCHEMA.properties.fingerprint;

const REFERENCE_SCHEMA = AGENT_RESOURCE_REFERENCE_SCHEMA;

const INTERPRETATION_SCHEMA = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["typed", "raw", "unresolved"] },
    schemaVersion: { type: ["string", "null"] },
    typed: {
      type: "object",
      properties: {
        schemaVersion: { type: "string", minLength: 1 },
        fingerprint: FINGERPRINT_SCHEMA,
        uri: { type: "string", minLength: 1 },
      },
      required: ["schemaVersion", "fingerprint", "uri"],
      additionalProperties: false,
    },
    diagnostics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: {
            type: "string",
            enum: ["known-schema-invalid", "interpretation-failed"],
          },
          message: { type: "string", minLength: 1 },
        },
        required: ["code", "message"],
        additionalProperties: false,
      },
    },
  },
  required: ["status", "schemaVersion"],
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: AGENT_RESOURCE_CAPTURE_REVIEW_SCHEMA },
    status: { type: "string", enum: ["captured", "unresolved"] },
    grants: { const: "none" },
    reference: REFERENCE_SCHEMA,
    interpretation: INTERPRETATION_SCHEMA,
  },
  required: [
    "schemaVersion",
    "status",
    "grants",
    "reference",
    "interpretation",
  ],
  additionalProperties: false,
} as const;

const projectResourceCaptureTool: MCPTool = {
  name: "project_resource_capture",
  description:
    "Capture one small agent-authored file as an MCP resource in draft CAS. Supply name, a nonempty MIME type, and exactly one of UTF-8 text or canonical padded standard-base64 blob. The server hashes exact bytes, persists them, rereads them, and exposes resources/read. Known JSON schemaVersion modelica-thermal-method-sheet/1.0 or electrical-observation-method-sheet/1.0 is interpreted through the existing typed store; an invalid known schema stays unresolved without a typed reference; unknown files remain raw. Grants none. No path, provider, runtime, project, caller-chosen CAS URI, fingerprint or MRTR. This writes no EngineeringProject or Thread state and does not admit or execute isolated source.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        description: "Display name for the captured resource. Not a filesystem path.",
      },
      mimeType: {
        type: "string",
        minLength: 1,
        maxLength: 256,
        description: "Nonempty MIME type of the payload.",
      },
      text: {
        type: "string",
        minLength: 1,
        maxLength: AGENT_RESOURCE_MAX_BYTES,
        description: "UTF-8 payload. Mutually exclusive with blob.",
      },
      blob: {
        type: "string",
        minLength: 1,
        description:
          "Canonical padded standard-base64 payload. Mutually exclusive with text.",
      },
    },
    required: ["name", "mimeType"],
    additionalProperties: false,
  },
  outputSchema: OUTPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function captureSummary(review: AgentResourceCaptureReview): string {
  if (review.interpretation.status === "typed") {
    return `Agent resource captured. Typed ${review.interpretation.schemaVersion} fingerprint is ready for the existing domain-specific seal review. Pass interpretation.typed.fingerprint only; grants none. This wrote no EngineeringProject or Thread state.`;
  }
  if (review.status === "unresolved") {
    return `Agent resource bytes were stored, but the declared known schema is unresolved and no typed reference was produced. Grants none. This wrote no EngineeringProject or Thread state.`;
  }
  return `Agent resource captured as a raw MCP resource. No typed interpretation and grants none. This wrote no EngineeringProject or Thread state and does not admit isolated execution.`;
}
