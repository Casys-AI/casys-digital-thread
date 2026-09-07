import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectRequirementsRecaptureReviewUseCase } from "../../application/ports/in/architecture/requirements/project-requirements-recapture-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectRequirementsRecaptureReviewToolDependencies {
  readonly requirementsRecaptureReview?: ProjectRequirementsRecaptureReviewUseCase;
}

export function registerProjectRequirementsRecaptureReviewTools(
  app: McpApp,
  dependencies: ProjectRequirementsRecaptureReviewToolDependencies,
): void {
  if (!dependencies.requirementsRecaptureReview) return;
  const review = dependencies.requirementsRecaptureReview;
  app.registerTool(projectRequirementsRecaptureReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? `Requirements recapture review is resolved against the unique current Thread tip, current architecture and unique active predecessor. Construct a later ${result.operation.id}@${result.operation.version} proposal only from the returned decisionParameters; if none are present, do not invent them. The server keeps legacy untraced captures on @1 and preserves traced brief origins on @2; neither version confirms that an old criterion still satisfies a newer brief. This wrote no EngineeringProject or Thread state, called no SysON, and granted no MRTR authority.`
      : "Requirements recapture review is unresolved: the diagnostics name the exact current-basis, predecessor or target the server could not uniquely recross, and no decisionParameters are returned. Do not invent the proposal.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const TARGET_ELEMENT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
  description:
    "Exact product-navigation PartDefinition element id. Selects among sealed requirements families. It is not a caller-selected native provider target.",
} as const;

const projectRequirementsRecaptureReviewTool: MCPTool = {
  name: "project_requirements_recapture_review",
  description:
    "Compile a closed requirements recapture MRTR from the unique current Thread tip, its exact architecture and the unique active requirements predecessor for one already captured PartDefinition family. The server returns model.recapture-requirements@1 for untraced captures 3/4, or model.recapture-requirements@2 for traced captures 5/6, retaining the exact historical brief origin without inventing or discarding it. Use the returned operation and decisionParameters unchanged. Name only projectId, and targetElementId when several captured families exist. Provider ids, sourceText, runtime, profile and SysON arguments are refused. The server reopens sealed captures only and does not call SysON. This writes no EngineeringProject or Thread state and grants no MRTR or dispatch authority.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      targetElementId: TARGET_ELEMENT_ID,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
