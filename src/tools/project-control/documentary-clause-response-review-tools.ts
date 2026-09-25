import type { McpApp, MCPTool } from "@casys/mcp-platform";
import type { ProjectDocumentaryClauseResponseReviewUseCase } from "../../application/ports/in/record/project-documentary-clause-response-review.ts";
import { AGENT_RESOURCE_REFERENCE_SCHEMA } from "../../domain/resource/agent-resource-reference.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectDocumentaryClauseResponseReviewToolDependencies {
  readonly documentaryClauseResponseReview?:
    ProjectDocumentaryClauseResponseReviewUseCase;
}

export function registerProjectDocumentaryClauseResponseReviewTools(
  app: McpApp,
  dependencies: ProjectDocumentaryClauseResponseReviewToolDependencies,
): void {
  const review = dependencies.documentaryClauseResponseReview;
  if (!review) return;
  app.registerTool(projectDocumentaryClauseResponseReviewTool, async (args) => {
    const result = await review.execute(args);
    return {
      content: result.status === "resolved"
        ? "The documentary clause-response review is resolved. Use only the returned operation, brief basis and decisionParameters for a later MRTR. Bind the approvedBrief binding. Recording this proposal is not human acceptance of its content, not a requirement, and not a verification pass. No Project/Thread write or approval occurred."
        : "The documentary clause-response review is unresolved; no decisionParameters are returned. Do not invent a source, requirement, pass, or approval.",
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

const SOURCE_REF = {
  type: "object",
  properties: {
    kind: { enum: ["agent-resource", "thread-artifact"] },
    resourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    artifactId: ID,
  },
  required: ["kind"],
  additionalProperties: false,
  allOf: [
    {
      if: {
        properties: { kind: { const: "agent-resource" } },
        required: ["kind"],
      },
      then: { required: ["resourceRef"], not: { required: ["artifactId"] } },
    },
    {
      if: {
        properties: { kind: { const: "thread-artifact" } },
        required: ["kind"],
      },
      then: { required: ["artifactId"], not: { required: ["resourceRef"] } },
    },
  ],
} as const;

const projectDocumentaryClauseResponseReviewTool: MCPTool = {
  name: "project_documentary_clause_response_review",
  description:
    "Prepare a read-only MRTR for record.seal-documentary-clause-response@1: persist one source-backed documentary answer to one current human-approved brief item without creating a requirement or pass. Name projectId, sourceItemId, bounded answer and scope, and exact sourceRefs (full agent-resource-capture/1.0 resourceRef from project_resource_capture, or a current-basis Thread artifactId). The server reopens the current approved brief/item and every named source; caller URL+digest pairs are refused. Use returned decisionParameters unchanged with one approvedBrief binding. Human MRTR authorizes recording the proposal, not accepting its content. Verification clauses still need their exact applicable proof. Missing/stale brief items, unknown sources, no-op duplicates and split heads are unresolved.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      sourceItemId: ID,
      answer: { type: "string", minLength: 1, maxLength: 4096 },
      scope: { type: "string", minLength: 1, maxLength: 512 },
      sourceRefs: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: SOURCE_REF,
      },
    },
    required: ["projectId", "sourceItemId", "answer", "scope", "sourceRefs"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
