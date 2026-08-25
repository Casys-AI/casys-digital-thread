import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectAssemblyIntegrityEvaluationReviewUseCase } from "../../application/ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectAssemblyIntegrityEvaluationReviewToolDependencies {
  /** Optional because the L4 review exists only with the exact L3 composition. */
  readonly assemblyIntegrityEvaluationReview?:
    ProjectAssemblyIntegrityEvaluationReviewUseCase;
}

/** Register the project-only L4 review when its exact L3 recross is composed. */
export function registerProjectAssemblyIntegrityEvaluationReviewTools(
  app: McpApp,
  dependencies: ProjectAssemblyIntegrityEvaluationReviewToolDependencies,
): void {
  const review = dependencies.assemblyIntegrityEvaluationReview;
  if (!review) return;
  app.registerTool(projectAssemblyIntegrityEvaluationReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? "Resolved one pending current-tip L4 assembly-integrity work item and its exact fresh L3 evidence. Paste next.propose.arguments to prepare the human MRTR decision. This review is read-only: it did not call a provider, evaluate a caller-selected outcome, write a project or Thread record, or satisfy a gate."
      : result.status === "unavailable"
      ? "Unavailable: the unique current L4 work, approved Brief basis, or exact L3 evidence could not be reopened. No admission, proposal, capture, verdict, or gate satisfaction was produced."
      : "Unresolved: the exact L3 evidence, canonical module, STEP, input bundle, or normalized observation did not recross. No admission, proposal, capture, verdict, or gate satisfaction was produced.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const projectAssemblyIntegrityEvaluationReviewTool: MCPTool = {
  name: "project_assembly_integrity_evaluation_review",
  description:
    "Prepare verify.evaluate-assembly-integrity@1 from only projectId. The server selects the unique waiting-for-decision L4 work appended on the exact current Thread tip under the current approved Brief basis, then recrosses its required fresh L3 observation, canonical module, STEP, input bundle and code-owned method. provider, tool, profile, runtime, tolerance, factual values, criteria, verdict, gate id, latest and aliases are refused. This review is read-only: it produces no L4 capture, no provider call, no project/Thread write, and no gate satisfaction. After human approval, queue and execute the registered operation separately.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
