/** Read-only review tools for the prescribed-kinematics vertical. */

import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ProjectPrescribedKinematicsCaseReviewUseCase } from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-case-review.ts";
import type {
  ProjectPrescribedKinematicsNextHopReviewUseCase,
} from "../../application/ports/in/mechanics/prescribed-kinematics/project-prescribed-kinematics-next-hop-review.ts";
import {
  AGENT_RESOURCE_REFERENCE_SCHEMA,
} from "../../domain/resource/agent-resource-reference.ts";
import {
  OBJECT_OUTPUT_SCHEMA,
  PROJECT_ID,
  READ_ONLY_ANNOTATIONS,
} from "./mcp-tool-schemas.ts";

export interface ProjectPrescribedKinematicsReviewToolDependencies {
  /** Omitted when the exact workspace/architecture recross is not composed. */
  readonly prescribedKinematicsCaseReview?:
    ProjectPrescribedKinematicsCaseReviewUseCase;
  /** Provider-free review of the already registered method, L4 and L5 hops. */
  readonly prescribedKinematicsNextHopReview?:
    ProjectPrescribedKinematicsNextHopReviewUseCase;
}

export function registerProjectPrescribedKinematicsReviewTools(
  app: McpApp,
  dependencies: ProjectPrescribedKinematicsReviewToolDependencies,
): void {
  if (dependencies.prescribedKinematicsCaseReview) {
    const review = dependencies.prescribedKinematicsCaseReview;
    app.registerTool(projectPrescribedKinematicsCaseReviewTool, async (args) => {
      const result = await review.review(args);
      return {
        content: result.status === "resolved"
          ? "Resolved the exact current same-file mechanism-source@1 closure, declared-against SysML recross, and architecture producer dependency for a prescribed-kinematics case. Paste next.append.arguments into project_change_append and next.propose.arguments into project_decision_propose; both envelopes are complete except issuedAt. This review is read-only: no Chrono client, provider, runtime, Thread write, MRTR approval, L3 observation, L4 evaluation, or L5 decision occurred."
          : result.status === "unavailable"
          ? "Unavailable: the named exact workspace or architecture evidence could not be reopened. No case, MRTR parameters, provider dispatch, or Thread write was produced."
          : "Unresolved: the mechanism closure or exact immediate PartUsage recross is incomplete. No case, MRTR parameters, provider dispatch, or Thread write was produced.",
        structuredContent: result as unknown as Record<string, unknown>,
      };
    });
  }
  if (!dependencies.prescribedKinematicsNextHopReview) return;
  const review = dependencies.prescribedKinematicsNextHopReview;
  app.registerTool(
    projectPrescribedKinematicsRunReviewTool,
    async (args) =>
      nextHopResult(
        await review.review("run", args),
        "run",
      ),
  );
  app.registerTool(
    projectPrescribedKinematicsMethodReviewTool,
    async (args) =>
      nextHopResult(
        await review.review("method", args),
        "method",
      ),
  );
  app.registerTool(
    projectPrescribedKinematicsEvaluationReviewTool,
    async (args) =>
      nextHopResult(
        await review.review("evaluation", args),
        "evaluation",
      ),
  );
  app.registerTool(
    projectPrescribedKinematicsCloseoutReviewTool,
    async (args) =>
      nextHopResult(
        await review.review("closeout", args),
        "closeout",
      ),
  );
}

function nextHopResult(
  result: Awaited<
    ReturnType<ProjectPrescribedKinematicsNextHopReviewUseCase["review"]>
  >,
  stage: "run" | "method" | "evaluation" | "closeout",
) {
  const label = stage === "run"
    ? "L3 observation"
    : stage === "method"
    ? "method-seal"
    : stage === "evaluation"
    ? "L4 evaluation"
    : "human L5 closeout";
  const identitiesOnly = result.status === "resolved" &&
    result.selected.stage === "method" &&
    result.selected.mode === "preparation";
  return {
    content: result.status === "resolved"
      ? identitiesOnly
        ? "Resolved the exact current prescribed-kinematics method-sheet identities from L1 and L3. Copy methodSheet.caseFingerprint and methodSheet.observationFingerprint into the agent-authored method resource; do not substitute the outer evidence fingerprints. Recapture that resource and call this review again with methodResourceRef. The server then rereads canonical bytes and recrosses their criteria and fingerprints before returning next.append and next.propose. This review did not create a project change, MRTR proposal or approval, queue a run, call Chrono, evaluate L4, invent criteria, or make an L5 decision."
        : `Resolved one exact current prescribed-kinematics ${label} next hop. The structured next.append and next.propose envelopes are display-only preparation for the existing generic project commands; they remain complete except issuedAt. This review did not create a project change, MRTR proposal or approval, queue a run, call Chrono, evaluate L4, or make an L5 decision.`
      : result.status === "unavailable"
      ? `Unavailable: the exact current prescribed-kinematics evidence required for the ${label} next hop could not be reopened. No project change, MRTR proposal, approval, run, or Thread write occurred.`
      : `Unresolved: the current prescribed-kinematics evidence chain required for the ${label} next hop is incomplete, stale, or ambiguous. No project change, MRTR proposal, approval, run, or Thread write occurred.`,
    structuredContent: result as unknown as Record<string, unknown>,
  };
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
    "Prepare the provider-free verify.seal-prescribed-kinematics-case@1 review from only projectId, workspaceRevision, attachmentId, and attachmentRevision. The server reopens the exact same-file mechanism-source@1 assembly-context attachment and every body PartUsage attachment, exact JSON resource bytes, and the declared architecture-capture/4.0. A PartDefinition context is checked directly; an occurrence-specific PartUsage context is checked through its typed_by definition. Both require the exact immediate body set. A resolved review against the current project head also returns pasteable next.append and next.propose envelopes, complete except issuedAt, whose decision parameters are exactly those three workspace identities. provider, image, tool, args, runtime, STEP names, labels, inferred bodies, dynamics, forces, collision, and safety are refused. This read-only review performs no Thread write, MRTR approval, Chrono call, L3 run, L4 evaluation, or L5 decision.",
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

const projectPrescribedKinematicsRunReviewTool: MCPTool = {
  name: "project_prescribed_kinematics_run_review",
  description:
    "Read-only next-hop review for the existing verify.run-prescribed-kinematics@1 operation. The caller names only projectId. The server reopens the unique current fresh L1 case and derives a display-only append/propose route whose only decision parameter is that case's domain SHA-256. The agent must paste those envelopes; it must not invent a placeholder because project_decision_propose requires a parameter. No provider, image, endpoint, runtime, Chrono request, workspace identity, L4 result, L5 disposition, project write, Thread write, MRTR proposal, or approval occurs.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectPrescribedKinematicsMethodReviewTool: MCPTool = {
  name: "project_prescribed_kinematics_method_review",
  description:
    "Read-only preparation/review for the existing verify.seal-prescribed-kinematics-method@1 operation. With projectId alone, the server reopens the unique current fresh L1 case and L3 observation and returns mode preparation plus methodSheet.caseFingerprint (domain sealed-case SHA-256) and methodSheet.observationFingerprint (SHA-256 of the canonical normalized PrescribedKinematicsObservation). With an already captured methodResourceRef, it returns mode review only after reopening accepted UTF-8 bytes, requiring canonical method-sheet source JSON, and recrossing criteria and both domain fingerprints against that same L1/L3 evidence; that mode returns next.append / next.propose. Outer evidence fingerprints are not substitutes. The caller authors criteria; this review does not invent them or auto-approve. No provider, image, endpoint, runtime, Chrono request, L4 result, L5 disposition, project write, Thread write, MRTR proposal, or approval occurs.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      methodResourceRef: AGENT_RESOURCE_REFERENCE_SCHEMA,
    },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectPrescribedKinematicsEvaluationReviewTool: MCPTool = {
  name: "project_prescribed_kinematics_evaluation_review",
  description:
    "Read-only next-hop review for the existing verify.evaluate-prescribed-kinematics@1 operation. The caller names only projectId. The server reopens the unique current fresh L1 case, L3 observation, and sealed method, then derives a display-only append/propose route for the existing deterministic L4 evaluation. No provider, image, endpoint, runtime, Chrono request, tolerance, fact, requested verdict, project write, Thread write, MRTR proposal, or approval occurs.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectPrescribedKinematicsCloseoutReviewTool: MCPTool = {
  name: "project_prescribed_kinematics_evaluation_closeout_review",
  description:
    "Read-only next-hop review for the existing human decide.accept-prescribed-kinematics-evaluation@1 and decide.reject-prescribed-kinematics-evaluation@1 operations. The caller names only projectId. The server reopens the unique current fresh L1, L3, method, and L4 evidence and derives the existing human L5 branch or branches: accept only for a literal pass; reject always. No provider, image, endpoint, runtime, Chrono request, caller-selected verdict, project write, Thread write, MRTR proposal, approval, or L5 decision occurs.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};
