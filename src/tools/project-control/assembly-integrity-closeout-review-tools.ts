import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectAssemblyIntegrityEvaluationCloseoutReviewUseCase } from "../../application/ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-closeout-review.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectAssemblyIntegrityCloseoutReviewToolDependencies {
  /** Provider-free public preparation of one human L5 assembly closeout. */
  assemblyIntegrityEvaluationCloseoutReview?:
    ProjectAssemblyIntegrityEvaluationCloseoutReviewUseCase;
}

/** Register the projectId-only public review; it owns no consequence or gate. */
export function registerProjectAssemblyIntegrityCloseoutReviewTools(
  app: McpApp,
  dependencies: ProjectAssemblyIntegrityCloseoutReviewToolDependencies,
): void {
  if (!dependencies.assemblyIntegrityEvaluationCloseoutReview) return;
  const review = dependencies.assemblyIntegrityEvaluationCloseoutReview;
  app.registerTool(
    projectAssemblyIntegrityEvaluationCloseoutReviewTool,
    async (args) => {
      const result = await review.execute(args);
      const content = result.status === "resolved"
        ? result.selected.acceptanceEligibility
          ? "Resolved one fresh exact assembly-integrity L4 branch. The server derived the two human L5 grammars; accept is present only because all five literal criteria are pass. Paste the chosen branch's next.append.arguments, then next.propose.arguments. Both envelopes are complete except issuedAt: deno task mcp:call fills it; a direct client must add issuedAt. propose.expectedRevision is the project revision after that successful append. The review selected no provider, SysON request, tolerance, verdict, safety conclusion, certification, or human disposition, and wrote no project or Thread state."
          : "Resolved one fresh exact assembly-integrity L4 branch. At least one literal L4 criterion is not pass, so the review returns only the bounded human reject grammar. Paste reject.next.append.arguments, then next.propose.arguments. Both envelopes are complete except issuedAt: deno task mcp:call fills it; a direct client must add issuedAt. propose.expectedRevision is the project revision after that successful append. Reject grants no correction, CAD, FEA, provider, SysON, safety, or certification authority; no project or Thread state changed."
        : result.status === "unavailable"
        ? "Unavailable: the unique fresh current assembly-integrity L4 branch or exact persisted evidence cannot be reopened. No human closeout parameters were generated."
        : "Unresolved: assembly-integrity closeout evidence is ambiguous, noncanonical, stale, or has divergent provenance. No human closeout parameters were generated.";
      return {
        content,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );
}

const projectAssemblyIntegrityEvaluationCloseoutReviewTool: MCPTool = {
  name: "project_assembly_integrity_evaluation_closeout_review",
  description:
    "Read-only review of one human L5 assembly-integrity closeout. The caller names only projectId. The server selects the unique current fresh L4 result, exact custom capture, ordered module/STEP/observation inputs, producer run, and literal limitations, then derives a freshness-bound next.append and a complete next.propose except issuedAt on each returned consequence. deno task mcp:call fills issuedAt; a direct client must add it. propose.expectedRevision is the post-append project revision. Accept appears only when assembly-import, occurrence-coverage, placement-recross, brep-validity, and pairwise-intersection are each literal pass. Reject cannot satisfy a gate and grants no remediation. No provider, SysON, tolerance, caller verdict, safety conclusion, certification, project, or Thread write occurs.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
