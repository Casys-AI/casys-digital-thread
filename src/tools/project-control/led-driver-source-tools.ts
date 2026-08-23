import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectLedDriverSourceCaptureCommand,
  ProjectLedDriverSourceCaptureUseCase,
} from "../../application/ports/in/electrical/led-driver/project-led-driver-source-capture.ts";
import type { ProjectLedDriverSourceReviewUseCase } from "../../application/ports/in/electrical/led-driver/project-led-driver-source-review.ts";
import { captureReviewContent } from "../../domain/electrical/led-driver/led-driver-source-capture-review.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectLedDriverSourceToolDependencies {
  /** Provider-free draft-CAS capture of exact LED-driver human-source text. */
  ledDriverSourceCapture?: ProjectLedDriverSourceCaptureUseCase;
  /** Provider-free reopen of one LED-driver human-source capture. */
  ledDriverSourceReview?: ProjectLedDriverSourceReviewUseCase;
}

/** Register the LED-driver source capture and review when each use case is composed. */
export function registerProjectLedDriverSourceTools(
  app: McpApp,
  dependencies: ProjectLedDriverSourceToolDependencies,
): void {
  if (dependencies.ledDriverSourceCapture) {
    const capture = dependencies.ledDriverSourceCapture;
    app.registerTool(projectLedDriverSourceCaptureTool, async (args) => {
      const review = await capture.capture(ledDriverSourceCaptureCommand(args));
      return {
        content: captureReviewContent(review),
        structuredContent: review as unknown as Record<string, unknown>,
      };
    });
  }
  if (!dependencies.ledDriverSourceReview) return;
  const review = dependencies.ledDriverSourceReview;
  app.registerTool(projectLedDriverSourceReviewTool, async (args) => {
    const result = await review.execute(args);
    return {
      content: captureReviewContent(result),
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const SHA256_SCHEMA = {
  type: "string",
  pattern: "^[a-f0-9]{64}$",
} as const;

const NAMED_REF_SCHEMA = {
  type: "object",
  properties: {
    id: ID_SCHEMA,
    name: { type: "string", minLength: 1 },
  },
  required: ["id", "name"],
  additionalProperties: false,
} as const;

const SOURCE_CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "led-driver-source-capture/1.0" },
    kind: { const: "led-driver-source" },
    identity: {
      type: "object",
      properties: {
        id: ID_SCHEMA,
        revision: { type: "integer", minimum: 1 },
      },
      required: ["id", "revision"],
      additionalProperties: false,
    },
    provenance: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["human", "document", "expert"] },
        authorId: ID_SCHEMA,
        reference: { type: "string", minLength: 1 },
      },
      required: ["kind", "authorId", "reference"],
      additionalProperties: false,
    },
    source: {
      type: "object",
      properties: {
        sha256: SHA256_SCHEMA,
        byteCount: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        casUri: {
          type: "string",
          pattern: "^casys://[a-z0-9][a-z0-9.-]{0,62}/sha256/[a-f0-9]{64}$",
        },
        mediaType: { const: "application/json" },
      },
      required: ["sha256", "byteCount", "casUri", "mediaType"],
      additionalProperties: false,
    },
    circuit: NAMED_REF_SCHEMA,
    testCondition: NAMED_REF_SCHEMA,
    unknowns: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: ID_SCHEMA,
          status: { const: "unresolved" },
          name: { type: "string", minLength: 1 },
        },
        required: ["id", "status", "name"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "schemaVersion",
    "kind",
    "identity",
    "provenance",
    "source",
    "circuit",
    "testCondition",
    "unknowns",
  ],
  additionalProperties: false,
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "led-driver-source-capture-review/1.0" },
    status: { type: "string", enum: ["captured", "unresolved"] },
    reference: SOURCE_CAPTURE_REFERENCE_SCHEMA,
    circuit: NAMED_REF_SCHEMA,
    testCondition: NAMED_REF_SCHEMA,
    unknowns: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["unresolved", "none"] },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: ID_SCHEMA,
              status: { const: "unresolved" },
              name: { type: "string", minLength: 1 },
            },
            required: ["id", "status", "name"],
            additionalProperties: false,
          },
        },
      },
      required: ["status", "items"],
      additionalProperties: false,
    },
    grants: { const: "none" },
  },
  required: [
    "schemaVersion",
    "status",
    "reference",
    "circuit",
    "testCondition",
    "unknowns",
    "grants",
  ],
  additionalProperties: false,
} as const;

const projectLedDriverSourceCaptureTool: MCPTool = {
  name: "project_led_driver_source_capture",
  description:
    "Capture exact agent-authored led-driver-human-source/1.0 UTF-8 JSON bytes in immutable draft CAS. First call project_resource_capture, then supply that full resourceRef. The server reopens exact UTF-8, hashes before parse, and rereads the stored bytes. Named circuit, test condition and declared unknowns are recorded; unknowns stay unresolved. Pass result.reference, never this whole review object, to project_led_driver_source_review. Language, analyzer, D1, provider, tool and ngspice arguments remain server-owned or absent. This writes no EngineeringProject or Thread state, creates no MRTR decision, and performs no technical execution.",
  inputSchema: {
    type: "object",
    properties: {
      resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: ["resourceRef"],
    additionalProperties: false,
  },
  outputSchema: LED_DRIVER_SOURCE_CAPTURE_REVIEW_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectLedDriverSourceReviewTool: MCPTool = {
  name: "project_led_driver_source_review",
  description:
    "Reopen one captured LED-driver human-source fiche from draft CAS and return the read-only review. The caller supplies only the opaque led-driver-source-capture/1.0 locator from project_led_driver_source_capture result.reference; never pass the capture review envelope or sourceText. Named circuit, test condition and declared unknowns are recorded; unknowns stay unresolved. This writes no EngineeringProject or Thread state and grants no seal, run, D1 choice, provider, tool or ngspice authority.",
  inputSchema: {
    type: "object",
    properties: {
      sourceRef: SOURCE_CAPTURE_REFERENCE_SCHEMA,
    },
    required: ["sourceRef"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

function ledDriverSourceCaptureCommand(
  value: Record<string, unknown>,
): ProjectLedDriverSourceCaptureCommand {
  const extras = Object.keys(value).filter((key) => key !== "resourceRef");
  if (extras.length > 0) {
    throw new TypeError(
      `ledDriverSourceCapture has unsupported field(s): ${extras.join(", ")}`,
    );
  }
  return {
    resourceRef: parseAgentResourceReference(
      value.resourceRef,
      "$ledDriverSourceCapture.resourceRef",
    ),
  };
}
