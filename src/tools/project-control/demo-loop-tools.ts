import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectSensitivityBaseEvaluationReviewUseCase } from "../../application/ports/in/sensitivity/base-evaluation/project-sensitivity-base-evaluation-review.ts";
import { OBJECT_OUTPUT_SCHEMA, READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

export interface ProjectDemoLoopToolDependencies {
  sensitivityBaseEvaluationReview?: ProjectSensitivityBaseEvaluationReviewUseCase;
}

export function registerProjectDemoLoopTools(
  app: McpApp,
  dependencies: ProjectDemoLoopToolDependencies,
): void {
  if (dependencies.sensitivityBaseEvaluationReview) {
    const review = dependencies.sensitivityBaseEvaluationReview;
    app.registerTool(sensitivityBaseEvaluationReviewTool, async (args) => {
      const result = await review.execute(args);
      const content = result.status === "ready-for-review"
        ? "Study-base observations join the Thread requirements. Queue verify.evaluate-sensitivity-base@1 bound to this studyCapture. No metric mapping was invented."
        : `Study-base evaluation review is unresolved (${result.error.code}). ${result.error.recovery}`;
      return {
        content,
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
}

const ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const BASIS = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: ID,
    revision: { type: "integer", minimum: 1 },
    subjectId: ID,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const sensitivityBaseEvaluationReviewTool: MCPTool = {
  name: "project_sensitivity_base_evaluation_review",
  description:
    "Check that each sensitivity-study metric joins exactly one Thread requirement and its sensitivity-base observation. Ready means verify.evaluate-sensitivity-base@1 can be queued. Unresolved stays UNLINKED. This writes no Thread state and invents no metric mapping.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: ID,
      basis: BASIS,
      studyArtifactId: ID,
    },
    required: ["projectId", "basis", "studyArtifactId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
