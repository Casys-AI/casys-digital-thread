import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectGeometryModuleExportUseCase } from "../../application/ports/in/cad/canonical/project-geometry-module-export.ts";
import {
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN,
} from "../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
} from "./mcp-tool-schemas.ts";

export interface ProjectGeometryModuleExportToolDependencies {
  /**
   * Isolated module-assembler export of one composite PartDefinition as a
   * geometry-module draft. Absent when the assembler runtime is not composed.
   */
  geometryModuleExport?: ProjectGeometryModuleExportUseCase;
}

export function registerProjectGeometryModuleExportTools(
  app: McpApp,
  dependencies: ProjectGeometryModuleExportToolDependencies,
): void {
  if (!dependencies.geometryModuleExport) return;
  const exportModule = dependencies.geometryModuleExport;
  app.registerTool(projectGeometryModuleExportTool, async (args) => {
    const result = await exportModule.execute(args);
    return {
      content:
        `Geometry-module export for PartDefinition ${result.target.partDefinitionElementId} completed as a review-only draft ${result.draftDigest}. The server recrossed the exact current Thread, placement analysis and unique active child geometry; callers supplied no source text, manifest, child refs, transforms, provider, profile or runtime. The result is not Thread state and grants none. Construct a later design.write-geometry@1 proposal only from the returned decisionParameters.`,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const MODULE_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const OPAQUE_ELEMENT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
} as const;

const THREAD_BASIS_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: MODULE_ID_SCHEMA,
    revision: { type: "integer", minimum: 1 },
    subjectId: MODULE_ID_SCHEMA,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const PLACEMENT_LOCATOR_SCHEMA = {
  type: "object",
  properties: {
    schemaVersion: { const: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_SCHEMA },
    kind: { const: CAD_PLACEMENT_ANALYSIS_CAPTURE_LOCATOR_KIND },
    fingerprint: FINGERPRINT_SCHEMA,
    byteCount: { type: "integer", minimum: 0 },
    casUri: {
      type: "string",
      pattern: CAD_PLACEMENT_ANALYSIS_CAPTURE_URI_PATTERN.source,
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

const projectGeometryModuleExportTool: MCPTool = {
  name: "project_geometry_module_export",
  description:
    "Reopen the exact current Thread architecture, part-definitions structure, placement analysis and unique active child geometry, then assemble one review-only geometry-module draft through the server-owned module-assembler profile. Name only projectId, exact EngineeringThreadSnapshotBasis, exact composite partDefinitionElementId and exact CadPlacementAnalysisCaptureLocator. workspaceRevision, source text, manifests, child refs/assets/transforms, provider, profile, runtime, tool, image, formats, labels and aliases are refused. The current fresh Thread basis must equal the named basis. The result is a bounded draft identity, target files and decisionParameters with grants none. Construct a later design.write-geometry@1 proposal only from the returned decisionParameters. This writes no Thread state and does not self-approve.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: THREAD_BASIS_SCHEMA,
      partDefinitionElementId: OPAQUE_ELEMENT_ID_SCHEMA,
      placementAnalysis: PLACEMENT_LOCATOR_SCHEMA,
    },
    required: [
      "projectId",
      "basis",
      "partDefinitionElementId",
      "placementAnalysis",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: DRAFT_CAS_WRITE_ANNOTATIONS,
};
