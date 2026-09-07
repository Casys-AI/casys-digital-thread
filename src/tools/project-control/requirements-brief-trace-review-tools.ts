import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectRequirementsBriefTraceReviewUseCase } from "../../application/ports/in/architecture/requirements/project-requirements-brief-trace-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectRequirementsBriefTraceReviewToolDependencies {
  readonly requirementsBriefTraceReview?: ProjectRequirementsBriefTraceReviewUseCase;
}

export function registerProjectRequirementsBriefTraceReviewTools(
  app: McpApp,
  dependencies: ProjectRequirementsBriefTraceReviewToolDependencies,
): void {
  const review = dependencies.requirementsBriefTraceReview;
  if (!review) return;
  app.registerTool(projectRequirementsBriefTraceReviewTool, async (args) => {
    const result = await review.execute(args);
    return {
      content: result.status === "resolved"
        ? "The retrospective documentary trace review is resolved. Use only the returned operation, inputEvidenceRefs, brief basis and decisionParameters for a later MRTR. Bind each returned inputEvidenceRef as a claimInput thread-entity binding, and add the approvedBrief binding. Existing requirement identities, values and units were reopened unchanged by the server. This declares correspondence to the named brief clauses; it is not original creation provenance, semantic equivalence, satisfaction, or a physical proof. No Project/Thread write, SysON call or approval occurred."
        : "The retrospective documentary trace review is unresolved; no decisionParameters are returned. Do not invent a link, requirement value, provider payload or approval.",
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;
const projectRequirementsBriefTraceReviewTool: MCPTool = {
  name: "project_requirements_brief_trace_review",
  description:
    "Prepare a read-only MRTR for record.seal-requirements-brief-trace@1: create or revise an explicit documentary claim between one captured canonical requirement and one approved brief clause. Name only projectId, the captured containerComponent, containerSourceItemId, requirementId and sourceItemId. The server selects the unique active capture (3.0 through 6.0), reopens its name, metric, operator, threshold and unit unchanged, and resolves the exact previous claim version when present. Use returned decisionParameters and inputEvidenceRefs unchanged. No scalar values, native targets, SysML, provider/tool/runtime arguments or brief text are accepted. No native edit, satisfaction, semantic equivalence or physical proof is implied. Missing/ambiguous sources, stale predecessors and no-op duplicate claims are refused.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      containerComponent: ID,
      containerSourceItemId: ID,
      requirementId: ID,
      sourceItemId: ID,
    },
    required: [
      "projectId",
      "containerComponent",
      "containerSourceItemId",
      "requirementId",
      "sourceItemId",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
