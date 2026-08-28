/** Read-only review tools for the prescribed-kinematics vertical. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectPrescribedKinematicsCaseCaptureUseCase } from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-capture.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectPrescribedKinematicsReviewToolDependencies {
  /** Omitted when the exact workspace/architecture recross is not composed. */
  readonly prescribedKinematicsCaseReview?:
    ProjectPrescribedKinematicsCaseCaptureUseCase;
}

export function registerProjectPrescribedKinematicsReviewTools(
  app: McpApp,
  dependencies: ProjectPrescribedKinematicsReviewToolDependencies,
): void {
  if (!dependencies.prescribedKinematicsCaseReview) return;
  app.registerTool(projectPrescribedKinematicsCaseReviewTool, async (args) => {
    const result = await dependencies.prescribedKinematicsCaseReview!.capture(args);
    return {
      content: result.status === "resolved"
        ? "Resolved the exact same-file mechanism-source@1 closure and declared-against SysML recross for a prescribed-kinematics case. This review is read-only: no Chrono client, provider, runtime, Thread write, MRTR approval, L3 observation, L4 evaluation, or L5 decision occurred."
        : result.status === "unavailable"
        ? "Unavailable: the named exact workspace or architecture evidence could not be reopened. No case, MRTR parameters, provider dispatch, or Thread write was produced."
        : "Unresolved: the mechanism closure or exact immediate PartUsage recross is incomplete. No case, MRTR parameters, provider dispatch, or Thread write was produced.",
      structuredContent: result as unknown as Record<string, unknown>,
    };
  });
}

const EXACT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$",
  not: { const: "latest" },
} as const;

const projectPrescribedKinematicsCaseReviewTool: MCPTool = {
  name: "project_prescribed_kinematics_case_review",
  description:
    "Prepare the provider-free verify.seal-prescribed-kinematics-case@1 review from only projectId, workspaceRevision, attachmentId, and attachmentRevision. The server reopens every active same-file mechanism-source@1 PartUsage attachment, exact JSON resource bytes, and the declared architecture-capture/4.0, then requires the assembly PartUsage typed_by identity and exact immediate body set. provider, image, tool, args, runtime, STEP names, labels, inferred bodies, dynamics, forces, collision, and safety are refused. This read-only review performs no Thread write, MRTR approval, Chrono call, L3 run, L4 evaluation, or L5 decision.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      workspaceRevision: { type: "integer", minimum: 1 },
      attachmentId: EXACT_ID,
      attachmentRevision: { type: "integer", minimum: 1 },
    },
    required: ["projectId", "workspaceRevision", "attachmentId", "attachmentRevision"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
