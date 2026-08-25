import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectAssemblyIntegrityReviewUseCase } from "../../application/ports/in/cad/assembly-integrity/project-assembly-integrity-review.ts";
import {
  FINGERPRINT_SCHEMA,
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectAssemblyIntegrityReviewToolDependencies {
  /**
   * Read-only exact-basis/primary-module review. Its absence keeps this tool
   * unregistered; no provider or observer executor is composed here.
   */
  assemblyIntegrityReview?: ProjectAssemblyIntegrityReviewUseCase;
}

/** Register the review surface only when its semantic resolver is composed. */
export function registerProjectAssemblyIntegrityReviewTools(
  app: McpApp,
  dependencies: ProjectAssemblyIntegrityReviewToolDependencies,
): void {
  if (!dependencies.assemblyIntegrityReview) return;
  const review = dependencies.assemblyIntegrityReview;
  app.registerTool(projectAssemblyIntegrityReviewTool, async (args) => {
    const result = await review.execute(args);
    const content = result.status === "resolved"
      ? "Resolved the exact current Thread basis and unique primary geometry-module identity for a factual assembly-integrity observation. Paste next.append.arguments when present, then next.propose.arguments. This review is read-only: no observation ran, no provider was called, no project or Thread state was written, and no verdict was produced. After human approval, queue and execute the registered operation separately."
      : result.status === "unavailable"
      ? "Unavailable: the exact current Thread basis or primary geometry module could not be reopened. No admission, decisionParameters, append, proposal, observation, or verdict was produced."
      : "Unresolved: the named exact basis or geometry module was not the current unique primary identity. No admission, decisionParameters, append, proposal, observation, or verdict was produced.";
    return {
      content,
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const EXACT_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const THREAD_BASIS_SCHEMA = {
  type: "object",
  properties: {
    kind: { const: "thread-snapshot" },
    snapshotId: {
      ...EXACT_ID_SCHEMA,
      description: "Exact Thread snapshot id. latest is refused.",
    },
    revision: { type: "integer", minimum: 1 },
    subjectId: EXACT_ID_SCHEMA,
  },
  required: ["kind", "snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const GEOMETRY_MODULE_SCHEMA = {
  type: "object",
  properties: {
    artifactId: {
      type: "string",
      pattern: "^geometry-[a-f0-9]{64}$",
      description:
        "Exact canonical geometry-module capture artifact id from this review; aliases are refused.",
    },
    fingerprint: FINGERPRINT_SCHEMA,
  },
  required: ["artifactId", "fingerprint"],
  additionalProperties: false,
} as const;

const projectAssemblyIntegrityReviewTool: MCPTool = {
  name: "project_assembly_integrity_review",
  description:
    "Prepare the factual verify.observe-assembly-integrity@1 review from only projectId, an exact current EngineeringThreadSnapshotBasis, and the exact primary geometryModule { artifactId, fingerprint } returned by review. The server recrosses current Thread/module state and selects the signed observation profile, method and exact configured runtime, returning decisionParameters only after that recross. provider, tool, profile, runtime, children, transform, tolerance, result, verdict, latest and aliases are refused. This review is read-only: it emits no observer request, execution, project/Thread write, or product verdict. After human approval, queue and execute the registered operation separately.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      basis: THREAD_BASIS_SCHEMA,
      geometryModule: GEOMETRY_MODULE_SCHEMA,
    },
    required: ["projectId", "basis", "geometryModule"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
