import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectVectorCorrectionReviewUseCase } from "../../application/ports/in/sensitivity/vector-correction/project-vector-correction-review.ts";
import { OBJECT_OUTPUT_SCHEMA, READ_ONLY_ANNOTATIONS } from "./mcp-tool-schemas.ts";

export interface ProjectVectorCorrectionToolDependencies {
  /** Provider-free preparation of one vector-correction document review. */
  vectorCorrectionReview?: ProjectVectorCorrectionReviewUseCase;
}

export function registerProjectVectorCorrectionTools(
  app: McpApp,
  dependencies: ProjectVectorCorrectionToolDependencies,
): void {
  if (!dependencies.vectorCorrectionReview) return;
  const review = dependencies.vectorCorrectionReview;
  app.registerTool(projectVectorCorrectionReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "ready-for-review"
      ? "Vector-correction review is ready. Construct a later design.apply-vector-correction@1 proposal only from the returned decisionParameters. This wrote no EngineeringProject or Thread state and granted no CAD, SysON, or provider authority."
      : `Vector-correction review is unresolved (${result.error.code}). No decisionParameters were returned. ${result.error.recovery}`;
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const VECTOR_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
} as const;

const projectVectorCorrectionReviewTool: MCPTool = {
  name: "project_vector_correction_review",
  description:
    "Prepare the exact human-review identity and canonical MRTR parameters for one later vector-correction document seal. The caller names only the exact project, Thread basis, failing evaluation id, and study-capture artifact id. This provider-free read mutates no EngineeringProject or Thread state and grants no CAD, SysON, or provider authority. The proposal is not an execution admission.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: VECTOR_ID_SCHEMA,
      basis: {
        type: "object",
        properties: {
          kind: { const: "thread-snapshot" },
          snapshotId: VECTOR_ID_SCHEMA,
          revision: { type: "integer", minimum: 1 },
          subjectId: VECTOR_ID_SCHEMA,
        },
        required: ["kind", "snapshotId", "revision", "subjectId"],
        additionalProperties: false,
      },
      evaluationId: VECTOR_ID_SCHEMA,
      studyArtifactId: VECTOR_ID_SCHEMA,
    },
    required: ["projectId", "basis", "evaluationId", "studyArtifactId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
