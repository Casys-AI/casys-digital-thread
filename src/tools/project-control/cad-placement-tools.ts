import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectCadPlacementCaptureUseCase } from "../../application/ports/in/cad/placement/project-cad-placement-capture.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
} from "../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA,
  captureReviewContent,
} from "../../domain/cad/placement/cad-placement-capture-review.ts";
import { PROJECT_ID } from "./mcp-tool-schemas.ts";

export interface ProjectCadPlacementToolDependencies {
  /** Provider-free draft-CAS capture of exact cad-immediate-placement-source/1.0. */
  cadPlacementCapture?: ProjectCadPlacementCaptureUseCase;
}

export function registerProjectCadPlacementTools(
  app: McpApp,
  dependencies: ProjectCadPlacementToolDependencies,
): void {
  if (!dependencies.cadPlacementCapture) return;
  const capture = dependencies.cadPlacementCapture;
  app.registerTool(projectCadPlacementCaptureTool, async (args) => {
    const review = await capture.capture(args);
    return {
      content: captureReviewContent(review),
      structuredContent: review as unknown as Record<string, unknown>,
    };
  });
}

const PLACEMENT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const FINGERPRINT_SCHEMA = {
  type: "object",
  properties: {
    algorithm: { const: "sha256" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["algorithm", "digest"],
  additionalProperties: false,
} as const;

const LOCATOR_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA },
    kind: { const: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND },
    fingerprint: FINGERPRINT_SCHEMA,
    byteCount: { type: "integer", minimum: 0 },
    casUri: {
      type: "string",
      pattern: "^casys://cad-placement-analysis-capture/sha256/[a-f0-9]{64}$",
    },
  },
  required: ["schemaVersion", "kind", "fingerprint", "byteCount", "casUri"],
  additionalProperties: false,
} as const;

const DRAFT_CAS_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const projectCadPlacementCaptureTool: MCPTool = {
  name: "project_cad_placement_capture",
  description:
    "Capture one exact workspace cad-placement-source file after recrossing every active same-file design-source@1 PartUsage attachment. Name only projectId, workspaceRevision, attachmentId and attachmentRevision. The named attachmentRevision must be the unique active head. Immediate owner usages, attachment targets and JSON entries must be exactly equal; typed_by is recrossed from the architecture navigation index. Missing or extra mappings stay unresolved and are never filled from array order or labels. Only a fully resolved recross returns an opaque cad-placement-analysis-capture locator. Pass result.reference only. fileId, sourceText, transforms, provider, runtime and MRTR are refused. This writes no EngineeringProject or Thread state and grants none.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      workspaceRevision: { type: "integer", minimum: 1 },
      attachmentId: PLACEMENT_ID_SCHEMA,
      attachmentRevision: { type: "integer", minimum: 1 },
    },
    required: ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      schemaVersion: { const: CAD_PLACEMENT_CAPTURE_REVIEW_SCHEMA },
      status: { enum: ["resolved", "unresolved"] },
      reference: LOCATOR_SCHEMA,
      owner: {
        type: "object",
        properties: {
          elementKind: { const: "PartDefinition" },
          elementId: PLACEMENT_ID_SCHEMA,
        },
        required: ["elementKind", "elementId"],
        additionalProperties: false,
      },
      usageCount: { type: "integer", minimum: 1 },
      gaps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", minLength: 1 },
            relation: {
              enum: ["owner", "placement", "attachment", "typed_by", "architecture"],
            },
            recovery: { type: "string", minLength: 1 },
          },
          required: ["name", "relation", "recovery"],
          additionalProperties: false,
        },
      },
      grants: { const: "none" },
    },
    required: ["schemaVersion", "status", "grants"],
    additionalProperties: false,
  },
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};
