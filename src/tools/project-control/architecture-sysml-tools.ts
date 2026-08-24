import type { McpApp, MCPTool } from "@casys/mcp-server";
import type {
  ProjectArchitectureSysmlPreviewUseCase,
} from "../../application/ports/in/architecture/agent-seal/project-architecture-sysml-preview.ts";
import type {
  ProjectArchitectureSysmlSourceCaptureUseCase,
} from "../../application/ports/in/architecture/agent-seal/project-architecture-sysml-source-capture.ts";
import { exactRecord } from "../../domain/kernel/case-validation.ts";
import { parseAgentResourceReference } from "../../domain/resource/agent-resource-reference.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
} from "./mcp-tool-schemas.ts";

export interface ProjectArchitectureSysmlToolDependencies {
  architectureSysmlSourceCapture?: ProjectArchitectureSysmlSourceCaptureUseCase;
  architectureSysmlPreview?: ProjectArchitectureSysmlPreviewUseCase;
}

/** Register the provider-free agent-authored architecture SysML surfaces. */
export function registerProjectArchitectureSysmlTools(
  app: McpApp,
  dependencies: ProjectArchitectureSysmlToolDependencies,
): void {
  if (dependencies.architectureSysmlSourceCapture) {
    const capture = dependencies.architectureSysmlSourceCapture;
    app.registerTool(projectArchitectureSysmlSourceCaptureTool, async (args) => {
      const command = captureCommand(args);
      const reference = await capture.capture(command);
      return {
        content:
          `Architecture SysML source ${command.sourceId} was captured as exact UTF-8 bytes, analysed under server-registered profile ${command.profileId}, and reread from draft CAS. Preserve the returned reference verbatim. This creates no EngineeringProject or Thread state, no MRTR decision, and no SysON insertion.`,
        structuredContent: reference as Readonly<Record<string, unknown>>,
      };
    });
  }

  if (dependencies.architectureSysmlPreview) {
    const preview = dependencies.architectureSysmlPreview;
    app.registerTool(projectArchitectureSysmlPreviewTool, async (args) => {
      const result = await preview.execute(args);
      const content = result.status === "ready-for-review"
        ? "Architecture SysML preview is ready for review. Unresolved constructs are first-class and are included even when empty. The result is not Thread state. Construct a later model.seal-architecture-sysml@1 proposal only from decisionParameters when they are present."
        : `Architecture SysML preview is ${result.status}. Unresolved constructs are first-class and are never omitted. The result is diagnostic only and creates no EngineeringProject or Thread state.`;
      return {
        content,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
}

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const VERSION_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const SOURCE_CAPTURE_REFERENCE_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: "architecture-sysml-source-analysis-capture/1.0" },
    kind: { const: "architecture-sysml-source-analysis" },
    profile: {
      type: "object",
      properties: {
        id: ID_SCHEMA,
        version: VERSION_SCHEMA,
        fingerprint: FINGERPRINT_SCHEMA,
      },
      required: ["id", "version", "fingerprint"],
      additionalProperties: false,
    },
    source: {
      type: "object",
      properties: {
        id: ID_SCHEMA,
        role: { const: "sysml-model" },
        language: { const: "sysml-v2" },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        byteCount: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        casUri: {
          type: "string",
          pattern: "^casys://[a-z0-9][a-z0-9.-]{0,62}/sha256/[a-f0-9]{64}$",
        },
      },
      required: ["id", "role", "language", "sha256", "byteCount", "casUri"],
      additionalProperties: false,
    },
    analysis: {
      type: "object",
      properties: {
        analyzer: {
          type: "object",
          properties: {
            id: ID_SCHEMA,
            version: VERSION_SCHEMA,
          },
          required: ["id", "version"],
          additionalProperties: false,
        },
        policy: {
          type: "object",
          properties: {
            profile: ID_SCHEMA,
            status: { type: "string", enum: ["passed", "rejected"] },
          },
          required: ["profile", "status"],
          additionalProperties: false,
        },
        sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        byteCount: {
          type: "integer",
          minimum: 0,
          maximum: Number.MAX_SAFE_INTEGER,
        },
        casUri: {
          type: "string",
          pattern: "^casys://[a-z0-9][a-z0-9.-]{0,62}/sha256/[a-f0-9]{64}$",
        },
      },
      required: ["analyzer", "policy", "sha256", "byteCount", "casUri"],
      additionalProperties: false,
    },
  },
  required: ["schemaVersion", "kind", "profile", "source", "analysis"],
  additionalProperties: false,
} as const;

const projectArchitectureSysmlSourceCaptureTool: MCPTool = {
  name: "project_architecture_sysml_source_capture",
  description:
    "Capture exact agent-authored architecture SysML UTF-8 bytes and their server-owned closed-subset analysis in immutable draft CAS. First call project_resource_capture, then supply that full resourceRef plus the registered profile id sysml-architecture-closed-subset-v1 and a source id. Language, tokenizer, parser and policy remain server-owned. This is not sysml-source-capture/1.0, does not insert into SysON, and does not use model.write-architecture@1. Preserve the returned reference verbatim for project_architecture_sysml_preview.",
  inputSchema: {
    type: "object",
    properties: {
      profileId: ID_SCHEMA,
      sourceId: ID_SCHEMA,
      resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: ["profileId", "sourceId", "resourceRef"],
    additionalProperties: false,
  },
  outputSchema: SOURCE_CAPTURE_REFERENCE_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

const projectArchitectureSysmlPreviewTool: MCPTool = {
  name: "project_architecture_sysml_preview",
  description:
    "Tokenize, parse and analyse one captured architecture SysML closed-subset source without writing Thread state. Supply the opaque architecture-sysml-source-analysis-capture/1.0 reference from project_architecture_sysml_source_capture. Unresolved constructs are first-class and are never omitted. A ready captured result may include decisionParameters for a later model.seal-architecture-sysml@1 proposal. This does not call SysON and does not reuse compile.seal-admission@3.",
  inputSchema: {
    type: "object",
    properties: {
      sourceRef: SOURCE_CAPTURE_REFERENCE_SCHEMA,
    },
    required: ["sourceRef"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};

function captureCommand(args: Record<string, unknown>): {
  readonly profileId: string;
  readonly sourceId: string;
  readonly resourceRef: ReturnType<typeof parseAgentResourceReference>;
} {
  const root = exactRecord(
    args,
    ["profileId", "sourceId", "resourceRef"],
    "$architectureSysmlCapture",
  );
  if (typeof root.profileId !== "string" || typeof root.sourceId !== "string") {
    throw new TypeError(
      "Architecture SysML capture requires profileId, sourceId, and resourceRef.",
    );
  }
  return {
    profileId: root.profileId,
    sourceId: root.sourceId,
    resourceRef: parseAgentResourceReference(
      root.resourceRef,
      "$architectureSysmlCapture.resourceRef",
    ),
  };
}
