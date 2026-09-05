import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../domain/kernel/deterministic-json.ts";
import { assertProposalMatchesOperationGrammar } from "../orchestration/operations/proposal-validation.ts";
import {
  assertUncertainWriterBasisReleaseDecisionSeal,
  assertUncertainWriterBasisReleaseProposal,
  isUncertainWriterBasisReleaseDecision,
  uncertainWriterBasisReleaseBaseSnapshot,
} from "../domain/record/uncertain-writer-basis-release.ts";
import { getRegisteredEngineeringOperation } from "../orchestration/operations/registry.ts";
import type { ProjectRunExecutor } from "../application/ports/in/project-run-executor.ts";
import type { EngineeringProjectCommandService } from "../application/use-cases/project/engineering-project-command-service.ts";
import type { ResolvedRunPlanReader } from "../domain/project/resolved-run-plan-sealer.ts";
import {
  type ResolvedOperationPlanV2,
  sameResolvedOperationPlanRef,
} from "../domain/compile/rop/resolved-operation-plan-v2.ts";
import type {
  EngineeringBasisRef,
  EngineeringGateClaim,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringProjectStartingPoint,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkOwner,
} from "../domain/project/engineering-project.ts";
import {
  type AgentRunJoinThreadSnapshot,
  assembleAgentRunRequirementJoins,
  runNeedsThreadProjection,
} from "../domain/project/agent-run-requirement-join.ts";
import type {
  ContentFingerprint,
  ThreadEntityKind,
} from "../domain/thread/thread-snapshot.ts";
import {
  COMMON_MUTATION_PROPERTIES,
  FINGERPRINT_SCHEMA,
  GATE_CLAIM_SCHEMA,
  mutationSchema,
  OBJECT_OUTPUT_SCHEMA,
  OPERATION_REF_SCHEMA,
  PROJECT_EXECUTION_ANNOTATIONS,
  PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
  PROJECT_ID,
  PROJECT_MUTATION_ANNOTATIONS,
  READ_ONLY_ANNOTATIONS,
  THREAD_ENTITY_KINDS,
  THREAD_SNAPSHOT_REF_SCHEMA,
} from "./project-control/mcp-tool-schemas.ts";
import {
  type ProjectTechnicalCompilationToolDependencies,
  registerProjectTechnicalCompilationTools,
} from "./project-control/technical-compilation-tools.ts";
import {
  type ProjectModelicaReviewToolDependencies,
  registerProjectModelicaReviewTools,
} from "./project-control/modelica-review-tools.ts";
import {
  type ProjectCrossDomainImpactReviewToolDependencies,
  registerProjectCrossDomainImpactReviewTools,
} from "./project-control/impact-review-tools.ts";
import {
  type ProjectArchitectureSysmlToolDependencies,
  registerProjectArchitectureSysmlTools,
} from "./project-control/architecture-sysml-tools.ts";
import {
  type ProjectBriefCompilationToolDependencies,
  registerProjectBriefCompilationTools,
} from "./project-control/brief-compilation-tools.ts";
import {
  type ProjectVectorCorrectionToolDependencies,
  registerProjectVectorCorrectionTools,
} from "./project-control/vector-correction-tools.ts";
import {
  type ProjectFeaReviewToolDependencies,
  registerProjectFeaReviewTools,
} from "./project-control/fea-review-tools.ts";
import {
  type ProjectSensitivityReviewToolDependencies,
  registerProjectSensitivityReviewTools,
} from "./project-control/sensitivity-review-tools.ts";
import {
  type ProjectDemoLoopToolDependencies,
  registerProjectDemoLoopTools,
} from "./project-control/demo-loop-tools.ts";
import {
  type ProjectLedDriverSourceToolDependencies,
  registerProjectLedDriverSourceTools,
} from "./project-control/led-driver-source-tools.ts";
import {
  type ProjectSpiceReviewToolDependencies,
  registerProjectSpiceReviewTools,
} from "./project-control/spice-review-tools.ts";
import {
  type ProjectResourceCaptureToolDependencies,
  registerProjectResourceCaptureTools,
} from "./project-control/resource-capture-tools.ts";
import {
  type ProjectSourceWorkspaceToolDependencies,
  registerProjectSourceWorkspaceTools,
} from "./project-control/project-source-workspace-tools.ts";
import {
  type ProjectProductNavigationToolDependencies,
  registerProjectProductNavigationTools,
} from "./project-control/product-navigation-tools.ts";
import {
  type ProjectCadPlacementToolDependencies,
  registerProjectCadPlacementTools,
} from "./project-control/cad-placement-tools.ts";
import {
  type ProjectGeometryModuleExportToolDependencies,
  registerProjectGeometryModuleExportTools,
} from "./project-control/geometry-module-export-tools.ts";
import {
  type ProjectAssemblyIntegrityReviewToolDependencies,
  registerProjectAssemblyIntegrityReviewTools,
} from "./project-control/assembly-integrity-review-tools.ts";
import {
  type ProjectAssemblyIntegrityEvaluationReviewToolDependencies,
  registerProjectAssemblyIntegrityEvaluationReviewTools,
} from "./project-control/assembly-integrity-evaluation-review-tools.ts";
import {
  type ProjectAssemblyIntegrityCloseoutReviewToolDependencies,
  registerProjectAssemblyIntegrityCloseoutReviewTools,
} from "./project-control/assembly-integrity-closeout-review-tools.ts";
import {
  type ProjectPrescribedKinematicsReviewToolDependencies,
  registerProjectPrescribedKinematicsReviewTools,
} from "./project-control/prescribed-kinematics-review-tools.ts";
import {
  autoConfirms,
  INTERACTIVE_PROJECT_APPROVAL_MODE,
  localYoloRationale,
  type ProjectApprovalMode,
} from "./project-approval-mode.ts";

export interface EngineeringProjectSnapshotReader {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface ProjectControlToolDependencies
  extends
    ProjectTechnicalCompilationToolDependencies,
    ProjectModelicaReviewToolDependencies,
    ProjectCrossDomainImpactReviewToolDependencies,
    ProjectArchitectureSysmlToolDependencies,
    ProjectBriefCompilationToolDependencies,
    ProjectVectorCorrectionToolDependencies,
    ProjectFeaReviewToolDependencies,
    ProjectSensitivityReviewToolDependencies,
    ProjectDemoLoopToolDependencies,
    ProjectLedDriverSourceToolDependencies,
    ProjectSpiceReviewToolDependencies,
    ProjectResourceCaptureToolDependencies,
    ProjectSourceWorkspaceToolDependencies,
    ProjectProductNavigationToolDependencies,
    ProjectCadPlacementToolDependencies,
    ProjectGeometryModuleExportToolDependencies,
    ProjectAssemblyIntegrityReviewToolDependencies,
    ProjectAssemblyIntegrityEvaluationReviewToolDependencies,
    ProjectAssemblyIntegrityCloseoutReviewToolDependencies,
    ProjectPrescribedKinematicsReviewToolDependencies {
  projects: EngineeringProjectSnapshotReader;
  commands: EngineeringProjectCommandService;
  /** Optional so focused read-only tests need not construct a trusted executor. */
  runExecutor?: ProjectRunExecutor;
  /** Reads only server-stamped resolved operation plans from the local CAS. */
  runPlanReader?: ResolvedRunPlanReader;
  /**
   * Exact Thread reread for MCP presentation. Used only to hoist `join` from
   * Thread `evaluations[]` onto completed requirement-join runs.
   */
  threadSnapshots?: {
    get(snapshotId: string): Promise<AgentRunJoinThreadSnapshot | undefined>;
  };
  /** Explicit startup policy; omission preserves signed MRTR elicitation. */
  approvalMode?: ProjectApprovalMode;
}

export function registerProjectControlTools(
  app: McpApp,
  dependencies: ProjectControlToolDependencies,
): void {
  app.registerTool(projectSnapshotTool, async (args) => {
    const projectId = requiredString(args.projectId, "projectId");
    const snapshot = await requiredProject(dependencies.projects, projectId);
    return await projectResult(
      `Project ${snapshot.project.name} is at revision ${snapshot.revision}.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  });

  if (dependencies.runPlanReader) {
    const runPlanReader = dependencies.runPlanReader;
    app.registerTool(projectAgentRunPlanGetTool, async (args) => {
      const projectId = requiredString(args.projectId, "projectId");
      const runId = requiredString(args.runId, "runId");
      const project = await requiredProject(dependencies.projects, projectId);
      const run = project.agentRuns.find((candidate) => candidate.id === runId);
      if (!run) {
        throw new TypeError(`Agent run ${runId} is not part of project ${projectId}.`);
      }
      if (!run.resolvedOperationPlan) {
        throw new TypeError(
          `Agent run ${runId} has no resolved-operation-plan/2.0 reference. Historical and @1 runs remain planless.`,
        );
      }
      const plan = await runPlanReader.read(run.resolvedOperationPlan);
      await assertReadPlanMatchesRun(project, runId, plan, dependencies.projects);
      return {
        content:
          `Resolved operation plan ${run.resolvedOperationPlan.planId} for run ${runId} ` +
          "was reread from its server-stamped CAS reference and cross-checked against " +
          "the project, run, queue receipt and MRTR basis. This is inspection only: " +
          "technical source, qualification and provider verification remains the future @2 executor boundary.",
        structuredContent: {
          projectId: project.project.id,
          projectRevision: project.revision,
          runId,
          reference: run.resolvedOperationPlan,
          plan,
        },
      };
    });
  }

  registerProjectTechnicalCompilationTools(app, dependencies);
  registerProjectModelicaReviewTools(app, dependencies);
  registerProjectCrossDomainImpactReviewTools(app, dependencies);
  registerProjectArchitectureSysmlTools(app, dependencies);
  registerProjectBriefCompilationTools(app, dependencies);
  registerProjectVectorCorrectionTools(app, dependencies);
  registerProjectFeaReviewTools(app, dependencies);
  registerProjectSensitivityReviewTools(app, dependencies);
  registerProjectDemoLoopTools(app, dependencies);
  registerProjectLedDriverSourceTools(app, dependencies);
  registerProjectSpiceReviewTools(app, dependencies);
  registerProjectResourceCaptureTools(app, dependencies);
  registerProjectSourceWorkspaceTools(app, dependencies);
  registerProjectProductNavigationTools(app, dependencies);
  registerProjectCadPlacementTools(app, dependencies);
  registerProjectGeometryModuleExportTools(app, dependencies);
  registerProjectAssemblyIntegrityReviewTools(app, dependencies);
  registerProjectAssemblyIntegrityEvaluationReviewTools(app, dependencies);
  registerProjectAssemblyIntegrityCloseoutReviewTools(app, dependencies);
  registerProjectPrescribedKinematicsReviewTools(app, dependencies);

  app.registerTool(projectPlanPublishTool, async (args, context) => {
    const common = commonMutation(args);
    const snapshot = await dependencies.commands.publishPlan(agentOrigin(context), {
      ...common,
      startingPoint: planStartingPoint(args.startingPoint),
      phases: planPhases(args.phases),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return await projectResult(
      `The agent-published project path is recorded at revision ${snapshot.revision}. It is planning state only: no engineering operation was executed.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  });

  app.registerTool(projectChangeAppendTool, async (args, context) => {
    const common = commonMutation(args);
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const baseSnapshot = declaredProjectHead(current);
    assertDeclaredProjectHead(
      threadSnapshotReference(args.baseSnapshot, "baseSnapshot"),
      baseSnapshot,
    );
    const snapshot = await dependencies.commands.appendChange(agentOrigin(context), {
      ...common,
      baseSnapshot,
      phases: planPhases(args.phases, { allowEmpty: true }),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return await projectResult(
      `The agent-appended project change is recorded at revision ${snapshot.revision}. It adds only reviewed work anchored to the exact current thread snapshot; no engineering operation was executed.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  });

  if (dependencies.runExecutor) {
    app.registerTool(projectAgentRunExecuteTool, async (args, context) => {
      const common = commonMutation(args);
      const runId = requiredString(args.runId, "runId");
      const current = await requiredProjectRevision(
        dependencies.projects,
        common.projectId,
        common.expectedRevision,
      );
      /**
       * A human-only operation cannot borrow the agent's origin. Interactive
       * mode hands dispatch to the operator's elicitation. Local YOLO uses
       * the persisted human origin and still calls the same executor; the
       * executor gate remains the authority. Everything else keeps the agent
       * origin unchanged.
       */
      if (humanOnlyRunOperation(current, runId)) {
        const approvalMode = dependencies.approvalMode ??
          INTERACTIVE_PROJECT_APPROVAL_MODE;
        if (autoConfirms(approvalMode, "human-only-execute")) {
          const snapshot = await dependencies.runExecutor!.execute(
            approvalMode.origin,
            { ...common, runId },
          );
          return await projectResult(
            `YOLO local startup opt-in executed human-only run ${runId} through its registered server-owned executor at project revision ${snapshot.revision} under the persisted local-yolo human origin. No inputResponses or retryVerified value was fabricated.`,
            snapshot,
          );
        }
        const confirmation = humanRunExecutionConfirmationResponse(context);
        if (confirmation === undefined) {
          return humanRunExecutionConfirmationRequest(current, runId);
        }
        if (!confirmation) {
          return await projectResult(
            `Human-only agent run ${runId} was not executed. No project state changed; continue the paired conversation.`,
            current,
          );
        }
        const snapshot = await dependencies.runExecutor!.execute(
          elicitedHumanOrigin(context),
          { ...common, runId },
        );
        return await projectResult(
          `The paired MCP host reported human execution of run ${runId} through elicitation at project revision ${snapshot.revision}. The operation is human-only; no agent origin was accepted.`,
          snapshot,
        );
      }
      const snapshot = await dependencies.runExecutor!.execute(
        agentOrigin(context),
        { ...common, runId },
      );
      return await projectResult(
        `Agent run ${runId} completed through its registered server-owned executor at project revision ${snapshot.revision}.`,
        snapshot,
      );
    });
  }

  app.registerTool(projectAgentRunQueueTool, async (args, context) => {
    const common = commonMutation(args);
    const workItemId = requiredString(args.workItemId, "workItemId");
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const workItem = requiredQueueWorkItem(current, workItemId);
    const snapshot = await dependencies.commands.queueRun(agentOrigin(context), {
      ...common,
      runId: `run:${common.commandId}`,
      workItemId,
      summary: queueRunSummary(workItem),
      ...queueExecutionBasis(current, workItem),
    });
    return await projectResult(
      `Agent queued the reviewed operation ${workItem.operation!.id}@${
        workItem.operation!.version
      } for work item ${workItemId} at project revision ${snapshot.revision}. The server derived the run id, summary and exact basis; no provider or arbitrary execution input was accepted.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  });

  app.registerTool(projectAgentRunCancelTool, async (args, context) => {
    return await handleQueuedRunCancellation(args, context, dependencies);
  });

  app.registerTool(projectDecisionProposeTool, async (args, context) => {
    const common = commonMutation(args);
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const decisionId = requiredString(args.decisionId, "decisionId");
    const proposal = decisionProposal(args.proposal);
    /**
     * Reject an unparsable proposal here rather than at preview or execution:
     * the agent is the caller, so it is the only party that can fix the keys,
     * and nothing should reach a human reviewer that the operation could not
     * read back.
     */
    assertProposalMatchesOperationGrammar(
      current.workItems
        .filter((item) => item.decisionIds.includes(decisionId))
        .flatMap((item) => item.operation ? [item.operation] : []),
      proposal.parameters,
    );
    const isBasisRelease = isUncertainWriterBasisReleaseDecision(
      current,
      decisionId,
    );
    if (isBasisRelease) {
      assertUncertainWriterBasisReleaseProposal(
        current,
        decisionId,
        proposal.parameters,
      );
    }
    const snapshot = await dependencies.commands.proposeDecision(
      agentOrigin(context),
      {
        ...common,
        decisionId,
        proposal,
        baseSnapshot: isBasisRelease
          ? uncertainWriterBasisReleaseBaseSnapshot(current, decisionId)
          : declaredProjectHead(current),
      },
    );
    return await projectResult(
      `Decision ${decisionId} now has an agent proposal at project revision ${snapshot.revision}; human approval is still required.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  });

  app.registerTool(projectDecisionApproveTool, async (args, context) => {
    return await handleDecisionElicitation(
      "approve",
      args,
      context,
      dependencies,
    );
  });

  app.registerTool(projectDecisionRejectTool, async (args, context) => {
    return await handleDecisionElicitation(
      "reject",
      args,
      context,
      dependencies,
    );
  });

  app.registerTool(
    projectWorkItemAbandonTool,
    async (args, context) => {
      return await handleWorkItemAbandonment(args, context, dependencies);
    },
  );
}

const projectSnapshotTool: MCPTool = {
  name: "project_snapshot",
  description:
    "Read the durable EngineeringProject application state: work, decisions, approvals, agent runs, blockers, exact thread references, and command receipts. structuredContent remains the unmodified EngineeringProjectSnapshot. This does not probe or execute engineering tools. Human decisions stay in the paired conversation through the existing signed MRTR tools.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

/**
 * Shared planned-work-item contract for `project_plan_publish` and
 * `project_change_append`. A successor may name an exact predecessor revision;
 * callers never supply `activityId`. The decoder must accept the same keys.
 */
const PLANNED_WORK_ITEM_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    phaseId: { type: "string", minLength: 1 },
    owner: { type: "string", enum: ["human", "agent", "shared"] },
    dependsOnWorkItemIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    decisionIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
    predecessorRevisionId: { type: "string", minLength: 1 },
    operation: OPERATION_REF_SCHEMA,
    gateClaims: { type: "array", items: GATE_CLAIM_SCHEMA },
  },
  required: [
    "id",
    "phaseId",
    "owner",
    "dependsOnWorkItemIds",
    "decisionIds",
    "operation",
  ],
  additionalProperties: false,
};

const projectPlanPublishTool: MCPTool = {
  name: "project_plan_publish",
  description:
    "Publish or revise an unexecuted engineering path from this project's exact human-approved canonical brief. Each work item must cite a reviewed registered operation and state-reference bindings; its displayed title, description and kind are derived from that reviewed operation. This never calls a provider, approves a decision, queues work, or creates technical evidence.",
  inputSchema: mutationSchema({
    startingPoint: {
      type: "string",
      enum: ["idea-or-spec", "existing-cad", "existing-product"],
    },
    phases: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
        },
        required: ["id", "name", "description"],
        additionalProperties: false,
      },
    },
    workItems: {
      type: "array",
      minItems: 1,
      items: PLANNED_WORK_ITEM_SCHEMA,
    },
    requiredDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
        },
        required: ["id", "phaseId", "title", "question"],
        additionalProperties: false,
      },
    },
  }, ["startingPoint", "phases", "workItems", "requiredDecisions"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const projectChangeAppendTool: MCPTool = {
  name: "project_change_append",
  description:
    "Append the next bounded, reviewed engineering change after an existing exact ThreadSnapshot. The supplied baseSnapshot must exactly equal the project's current declared thread head; each work item must cite a reviewed registered operation and state-reference bindings. architecture.seed-syson-model@2 must list the unique baseline.from-approved-brief@1 work item in dependsOnWorkItemIds. New work may join a newly declared phase or append membership onto an existing phase. This never replaces an existing phase, work item, decision, run or evidence record; it never calls a provider, approves a decision, queues work, or creates technical evidence. It cannot pre-plan later work whose basis does not yet exist.",
  inputSchema: mutationSchema({
    baseSnapshot: THREAD_SNAPSHOT_REF_SCHEMA,
    phases: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          description: { type: "string", minLength: 1 },
        },
        required: ["id", "name", "description"],
        additionalProperties: false,
      },
    },
    workItems: {
      type: "array",
      minItems: 1,
      items: PLANNED_WORK_ITEM_SCHEMA,
    },
    requiredDecisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", minLength: 1 },
          phaseId: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          question: { type: "string", minLength: 1 },
        },
        required: ["id", "phaseId", "title", "question"],
        additionalProperties: false,
      },
    },
  }, ["baseSnapshot", "phases", "workItems", "requiredDecisions"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const projectDecisionProposeTool: MCPTool = {
  name: "project_decision_propose",
  description:
    "Record an agent-authored concrete proposal for one required engineering decision. This never approves the proposal; approval or rejection requires the paired host's human-facing MCP elicitation flow.",
  inputSchema: {
    type: "object",
    properties: {
      ...COMMON_MUTATION_PROPERTIES,
      decisionId: { type: "string", minLength: 1 },
      proposal: {
        type: "object",
        properties: {
          summary: { type: "string", minLength: 1 },
          parameters: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                key: { type: "string", minLength: 1 },
                label: { type: "string", minLength: 1 },
                value: { type: ["string", "number", "boolean"] },
                unit: { type: "string", minLength: 1 },
              },
              required: ["key", "label", "value"],
              additionalProperties: false,
            },
          },
        },
        required: ["summary", "parameters"],
        additionalProperties: false,
      },
    },
    required: [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      "decisionId",
      "proposal",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_MUTATION_ANNOTATIONS,
};

const projectDecisionApproveTool: MCPTool = {
  name: "project_decision_approve",
  description:
    "Ask the paired MCP host to present one exact proposed decision for confirmation. In the default interactive mode, the first call requests elicitation and only a signed accepted retry records approval. An explicit loopback-only --yolo startup opt-in instead records the positive approval through the same command service with the persisted local-yolo human origin; it never fabricates elicitation responses. Rejection remains interactive.",
  inputSchema: mutationSchema({
    decisionId: { type: "string", minLength: 1 },
    inputFingerprint: FINGERPRINT_SCHEMA,
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Concise record of why this proposal reflects the paired conversation; it is shown to the human before confirmation.",
    },
  }, ["decisionId", "inputFingerprint", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectDecisionRejectTool: MCPTool = {
  name: "project_decision_reject",
  description:
    "Ask the paired MCP host to present one exact proposed decision and rejection rationale for confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records rejection. The signature protects retry integrity, not user identity; the host is responsible for presenting the request to the person. The agent cannot call the underlying human-authority mutation directly.",
  inputSchema: mutationSchema({
    decisionId: { type: "string", minLength: 1 },
    inputFingerprint: FINGERPRINT_SCHEMA,
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "The correction or reason to preserve if the human confirms the rejection.",
    },
  }, ["decisionId", "inputFingerprint", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectAgentRunQueueTool: MCPTool = {
  name: "project_agent_run_queue",
  description:
    "Queue one ready reviewed work item for the agent. The caller supplies only the durable command context and work item id. The server derives the run id, summary and exact approved-brief or thread-snapshot basis from project truth; it accepts no provider, tool arguments, paths, files, result payload or technical evidence.",
  inputSchema: mutationSchema({
    workItemId: { type: "string", minLength: 1 },
  }, ["workItemId"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_EXECUTION_ANNOTATIONS,
};

const projectAgentRunPlanGetTool: MCPTool = {
  name: "project_agent_run_plan_get",
  description:
    "Read the resolved-operation-plan/2.0 referenced by one existing project agent run and cross-check its local project/run/queue/MRTR seals. It does not reopen technical sources, qualified methods or providers. The caller supplies only projectId and runId; no CAS URI, digest, provider, tool arguments, files, queueing, claim, or execution input is accepted.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: PROJECT_ID,
      runId: { type: "string", minLength: 1 },
    },
    required: ["projectId", "runId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const projectAgentRunCancelTool: MCPTool = {
  name: "project_agent_run_cancel",
  description:
    "Ask the paired MCP host to present cancellation of one exact queued agent run for human confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records the human cancellation. An explicit loopback-only --yolo startup opt-in auto-cancels that same queued, unclaimed run through the command service with the persisted local-yolo human origin; it never fabricates elicitation responses. A cancelled queued run has not been claimed or executed, and returns its work item to its derived idle state.",
  inputSchema: mutationSchema({
    runId: { type: "string", minLength: 1 },
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Reason preserved in the human cancellation record and shown before confirmation.",
    },
  }, ["runId", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

const projectAgentRunExecuteTool: MCPTool = {
  name: "project_agent_run_execute",
  description:
    "Execute one agent-queued run through its exact server-owned registered executor. The call accepts no provider, tool arguments, files or result payload. Registered work may record the canonical project brief as a documentary baseline or run an explicitly reviewed engineering operation; it cannot add arbitrary evidence or compliance claims. A human-only queued run still requires signed MCP elicitation in the default interactive mode. An explicit loopback-only --yolo startup opt-in executes that same reviewed queued run through the same executor with the persisted local-yolo human origin; it never fabricates elicitation responses and never uses an agent origin. Reuse the same commandId unchanged to resume an interrupted call safely.",
  inputSchema: mutationSchema({
    runId: { type: "string", minLength: 1 },
  }, ["runId"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_EXECUTION_ANNOTATIONS,
};

/**
 * Human-only governed abandonment for work items that never acquired a run.
 *
 * WHY HUMAN-ONLY — abandoning a work item and its pending decisions is an
 * irreversible editorial act on the project plan. Interactive mode confirms
 * the exact target set and rationale through MCP elicitation. An explicit
 * loopback-only --yolo startup opt-in records that same positive confirmation
 * through EngineeringProjectCommandService with the persisted local-yolo
 * human origin; it never fabricates inputResponses. No provider, agent run,
 * or ThreadSnapshot is created: the change is project-state-only.
 */
const projectWorkItemAbandonTool: MCPTool = {
  name: "project_work_item_abandon",
  description:
    "Ask the paired MCP host to confirm the abandonment of one or more work items and their pending decisions. " +
    "Each work item must be in `ready` or `waiting-for-decision` status with no associated runs and no evidence refs. " +
    "Each decision must be in `required` or `proposed` status (not `approved`). " +
    "In the default interactive mode, the first call requests elicitation and only a signed accepted retry records abandonment. " +
    "An explicit loopback-only --yolo startup opt-in instead records the same positive abandonment through the command service with the persisted local-yolo human origin; it never fabricates elicitation responses. " +
    "On confirmation the service marks each target as `abandoned` and revokes any pending approval for a proposed decision. " +
    "No agent run, provider call, or ThreadSnapshot is created. " +
    "Abandoned entities remain in history but are excluded from active views.",
  inputSchema: mutationSchema({
    workItemIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      minItems: 1,
      description: "One or more work item IDs to abandon (minimum 1).",
    },
    decisionIds: {
      type: "array",
      items: { type: "string", minLength: 1 },
      description:
        "Decision IDs to abandon alongside the work items. May be empty; each must be in required or proposed status.",
    },
    rationale: {
      type: "string",
      minLength: 1,
      description:
        "Human-recorded reason for abandoning these work items and decisions.",
    },
  }, ["workItemIds", "decisionIds", "rationale"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS,
};

async function handleDecisionElicitation(
  action: "approve" | "reject",
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const common = commonMutation(args);
  const decisionId = requiredString(args.decisionId, "decisionId");
  const inputFingerprint = fingerprintInput(args.inputFingerprint, "inputFingerprint");
  const rationale = requiredString(args.rationale, "rationale");
  const current = await requiredProposedDecision(
    dependencies.projects,
    common.projectId,
    common.expectedRevision,
    decisionId,
    inputFingerprint,
  );
  if (isUncertainWriterBasisReleaseDecision(current, decisionId)) {
    await assertUncertainWriterBasisReleaseDecisionSeal(current, decisionId);
  }
  const approvalMode = dependencies.approvalMode ??
    INTERACTIVE_PROJECT_APPROVAL_MODE;
  if (action === "approve" && autoConfirms(approvalMode, "decision-approve")) {
    const snapshot = await dependencies.commands.approveDecision(
      approvalMode.origin,
      {
        ...common,
        decisionId,
        inputFingerprint,
        rationale: localYoloRationale(
          `positive MRTR decision ${decisionId}`,
          rationale,
        ),
      },
    );
    return await projectResult(
      `YOLO local startup opt-in auto-approved decision ${decisionId} at project revision ${snapshot.revision}. No inputResponses or retryVerified value was fabricated.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  }
  const confirmation = decisionConfirmationResponse(context);
  if (confirmation === undefined) {
    return decisionConfirmationRequest(current, decisionId, action, rationale);
  }
  if (!confirmation) {
    return await projectResult(
      `Decision ${decisionId} was not ${
        action === "approve" ? "approved" : "rejected"
      }. No project state changed; continue the paired conversation.`,
      current,
      dependencies.threadSnapshots,
    );
  }
  const snapshot = action === "approve"
    ? await dependencies.commands.approveDecision(elicitedHumanOrigin(context), {
      ...common,
      decisionId,
      inputFingerprint,
      rationale,
    })
    : await dependencies.commands.rejectDecision(elicitedHumanOrigin(context), {
      ...common,
      decisionId,
      inputFingerprint,
      rationale,
    });
  return await projectResult(
    `The paired MCP host reported ${
      action === "approve" ? "approval" : "rejection"
    } of decision ${decisionId} through elicitation at project revision ${snapshot.revision}.`,
    snapshot,
    dependencies.threadSnapshots,
  );
}

async function handleQueuedRunCancellation(
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const common = commonMutation(args);
  const runId = requiredString(args.runId, "runId");
  const rationale = requiredString(args.rationale, "rationale");
  const current = await requiredQueuedRun(
    dependencies.projects,
    common.projectId,
    common.expectedRevision,
    runId,
  );
  const approvalMode = dependencies.approvalMode ??
    INTERACTIVE_PROJECT_APPROVAL_MODE;
  if (autoConfirms(approvalMode, "queued-run-cancel")) {
    const snapshot = await dependencies.commands.cancelQueuedRun(
      approvalMode.origin,
      {
        ...common,
        runId,
        rationale: localYoloRationale(
          `queued-run cancellation ${runId}`,
          rationale,
        ),
      },
    );
    return await projectResult(
      `YOLO local startup opt-in auto-cancelled queued agent run ${runId} at project revision ${snapshot.revision}. No MCP elicitation response was fabricated, and no agent claim or execution was recorded.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  }
  const confirmation = runCancellationConfirmationResponse(context);
  if (confirmation === undefined) {
    return runCancellationConfirmationRequest(current, runId, rationale);
  }
  if (!confirmation) {
    return await projectResult(
      `Queued agent run ${runId} was not cancelled. No project state changed; continue the paired conversation.`,
      current,
      dependencies.threadSnapshots,
    );
  }
  const snapshot = await dependencies.commands.cancelQueuedRun(
    elicitedHumanOrigin(context),
    { ...common, runId, rationale },
  );
  return await projectResult(
    `The paired MCP host reported human cancellation of queued agent run ${runId} through elicitation at project revision ${snapshot.revision}. No agent claim or execution was recorded.`,
    snapshot,
    dependencies.threadSnapshots,
  );
}

async function handleWorkItemAbandonment(
  args: Record<string, unknown>,
  context: ToolHandlerContext | undefined,
  dependencies: ProjectControlToolDependencies,
) {
  const common = commonMutation(args);
  const rawWorkItemIds = Array.isArray(args.workItemIds) ? args.workItemIds : [];
  if (rawWorkItemIds.length === 0) {
    throw new TypeError("workItemIds: at least one work item ID is required.");
  }
  const workItemIds = rawWorkItemIds.map((id, i) =>
    requiredString(id, `workItemIds[${i}]`)
  );
  const rawDecisionIds = Array.isArray(args.decisionIds) ? args.decisionIds : [];
  const decisionIds = rawDecisionIds.map((id: unknown, i) =>
    requiredString(id, `decisionIds[${i}]`)
  );
  const rationale = requiredString(args.rationale, "rationale");
  const current = await requiredProjectRevision(
    dependencies.projects,
    common.projectId,
    common.expectedRevision,
  );
  const itemCount = workItemIds.length;
  const decisionCount = decisionIds.length;
  const abandonedSummary = `${itemCount} work item${itemCount === 1 ? "" : "s"}` +
    (decisionCount > 0
      ? ` and ${decisionCount} decision${decisionCount === 1 ? "" : "s"}`
      : "");
  const approvalMode = dependencies.approvalMode ??
    INTERACTIVE_PROJECT_APPROVAL_MODE;
  if (autoConfirms(approvalMode, "work-item-abandon")) {
    const snapshot = await dependencies.commands.abandonWorkItems(
      approvalMode.origin,
      {
        ...common,
        workItemIds,
        decisionIds,
        rationale: localYoloRationale(
          `positive work-item abandonment ${workItemIds.join(", ")}`,
          rationale,
        ),
      },
    );
    return await projectResult(
      `YOLO local startup opt-in auto-abandoned ${abandonedSummary} at project revision ${snapshot.revision}. No inputResponses or retryVerified value was fabricated. No agent run, provider call, or ThreadSnapshot was created.`,
      snapshot,
      dependencies.threadSnapshots,
    );
  }
  const confirmation = workItemAbandonmentConfirmationResponse(context);
  if (confirmation === undefined) {
    return workItemAbandonmentConfirmationRequest(
      current,
      workItemIds,
      decisionIds,
      rationale,
    );
  }
  if (!confirmation) {
    return await projectResult(
      `Work item abandonment was declined. No project state changed; continue the paired conversation.`,
      current,
      dependencies.threadSnapshots,
    );
  }
  const snapshot = await dependencies.commands.abandonWorkItems(
    elicitedHumanOrigin(context),
    { ...common, workItemIds, decisionIds, rationale },
  );
  return await projectResult(
    `The paired MCP host recorded human abandonment of ${abandonedSummary}` +
      ` at project revision ${snapshot.revision}. No agent run, provider call, or ThreadSnapshot was created.`,
    snapshot,
    dependencies.threadSnapshots,
  );
}

function workItemAbandonmentConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  workItemIds: readonly string[],
  decisionIds: readonly string[],
  rationale: string,
) {
  const itemTitles = workItemIds.map((id) => {
    const item = snapshot.workItems.find((candidate) => candidate.id === id);
    return item ? `"${item.title}" (${id})` : id;
  }).join(", ");
  const decisionPart = decisionIds.length > 0
    ? ` and decision${decisionIds.length === 1 ? "" : "s"} ${
      decisionIds.map((id) => {
        const d = snapshot.decisions.find((candidate) => candidate.id === id);
        return d ? `"${d.title}" (${id})` : id;
      }).join(", ")
    }`
    : "";
  return {
    resultType: "input_required",
    inputRequests: {
      work_item_abandonment_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `Abandon work item${
              workItemIds.length === 1 ? "" : "s"
            } ${itemTitles}${decisionPart}? ` +
            `Each target must have no associated runs and no evidence. ` +
            `This records only project history: no agent run, provider call, or ThreadSnapshot will be created. ` +
            `Abandoned entities remain in history but are excluded from active views. ` +
            `Recorded rationale: ${rationale}. Confirm this exact abandonment, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm work item abandonment",
                description:
                  "I confirm the listed work items and decisions should be marked as abandoned and excluded from active views.",
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function workItemAbandonmentConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Work item abandonment requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.work_item_abandonment_confirmation,
    "inputResponses.work_item_abandonment_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.work_item_abandonment_confirmation",
  );
  const action = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.work_item_abandonment_confirmation.action",
  );
  if (action !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.work_item_abandonment_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.work_item_abandonment_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.work_item_abandonment_confirmation.content.confirmed",
  );
}

/**
 * True when the run's reviewed operation is declared human-only in the registry.
 *
 * A run whose work item or operation cannot be resolved is not treated as
 * human-only: the executor refuses it on its own terms, and inventing an
 * elicitation for an unresolvable run would ask the operator to confirm
 * something this surface cannot describe.
 */
function humanOnlyRunOperation(
  snapshot: EngineeringProjectSnapshot,
  runId: string,
): boolean {
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId);
  if (run === undefined) return false;
  const operation = snapshot.workItems.find(
    (item) => item.id === run.workItemId,
  )?.operation;
  if (operation === undefined) return false;
  return getRegisteredEngineeringOperation(operation)?.mustOrigin === "human";
}

function humanRunExecutionConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  runId: string,
) {
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId)!;
  const operation = snapshot.workItems.find(
    (item) => item.id === run.workItemId,
  )!.operation!;
  return {
    resultType: "input_required",
    inputRequests: {
      human_run_execution_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `Execute run “${run.id}” for work item “${run.workItemId}” yourself? Its operation ${operation.id}@${operation.version} is human-only: it records a judgement no agent may make on your behalf, and it will run under your origin. Confirm this exact execution, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm human-only run execution",
                description:
                  "I confirm I am executing this human-only operation myself, on my own judgement.",
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function humanRunExecutionConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Human-only run execution requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.human_run_execution_confirmation,
    "inputResponses.human_run_execution_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.human_run_execution_confirmation",
  );
  const responseAction = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.human_run_execution_confirmation.action",
  );
  if (responseAction !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.human_run_execution_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.human_run_execution_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.human_run_execution_confirmation.content.confirmed",
  );
}

function runCancellationConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  runId: string,
  rationale: string,
) {
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId)!;
  return {
    resultType: "input_required",
    inputRequests: {
      run_cancellation_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `Cancel queued agent run “${run.id}” for work item “${run.workItemId}”? It has not been claimed or executed. Recorded rationale: ${rationale}. Confirm this exact cancellation, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: "Confirm queued-run cancellation",
                description:
                  "I confirm this queued run should be cancelled before any agent claim or execution.",
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function runCancellationConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Queued-run cancellation requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.run_cancellation_confirmation,
    "inputResponses.run_cancellation_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.run_cancellation_confirmation",
  );
  const responseAction = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.run_cancellation_confirmation.action",
  );
  if (responseAction !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.run_cancellation_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.run_cancellation_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.run_cancellation_confirmation.content.confirmed",
  );
}

function decisionConfirmationRequest(
  snapshot: EngineeringProjectSnapshot,
  decisionId: string,
  action: "approve" | "reject",
  rationale: string,
) {
  const decision = snapshot.decisions.find((candidate) => candidate.id === decisionId)!;
  const proposal = decision.proposal!;
  const disposition = action === "approve" ? "approve" : "reject";
  const parameters = deterministicJson(proposal.parameters);
  /**
   * WHY THE EVIDENCE REFS ARE SPELLED OUT — the approval cryptographically
   * seals the server-stamped inputEvidenceRefs, and executors (e.g.
   * record.archive-lineage@1) refuse to run unless the approved refs equal
   * their bindings exactly. If the elicitation only showed summary and
   * parameters, two proposals targeting different entities could read
   * identically, and the human would seal an exact choice they never saw.
   *
   * WHY CANONICAL JSON — the ref fields are only constrained to be non-empty,
   * so any hand-rolled separator could be forged by an ID that embeds it,
   * letting two different target sets render the same message. JSON escaping
   * makes the rendering injective. The refs are rendered from the decision,
   * never from agent input.
   */
  const evidenceRefs = decision.inputEvidenceRefs.length > 0
    ? deterministicJson(decision.inputEvidenceRefs)
    : "";
  return {
    resultType: "input_required",
    inputRequests: {
      decision_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `The agent proposes to ${disposition} “${decision.title}”. Proposal: ${proposal.summary}. Exact parameters: ${parameters}${
              evidenceRefs ? `. Exact evidence targets: ${evidenceRefs}` : ""
            }. Recorded rationale: ${rationale}. Confirm this exact ${disposition} action, or decline and continue the conversation.`,
          requestedSchema: {
            type: "object",
            properties: {
              confirmed: {
                type: "boolean",
                title: `Confirm decision ${disposition}`,
                description:
                  `I confirm that the displayed proposal and rationale should be ${
                    action === "approve" ? "approved" : "recorded as rejected"
                  }.`,
              },
            },
            required: ["confirmed"],
            additionalProperties: false,
          },
        },
      },
    },
  };
}

function decisionConfirmationResponse(
  context?: ToolHandlerContext,
): boolean | undefined {
  if (context?.inputResponses === undefined) return undefined;
  if (context.retryVerified !== true) {
    throw new TypeError(
      "Decision confirmation requires an MCP retry with verified signed request state.",
    );
  }
  const response = exactRecord(
    context.inputResponses.decision_confirmation,
    "inputResponses.decision_confirmation",
  );
  exactKeys(
    response,
    ["action"],
    ["content"],
    "inputResponses.decision_confirmation",
  );
  const responseAction = oneOf(
    response.action,
    ["accept", "decline", "cancel"] as const,
    "inputResponses.decision_confirmation.action",
  );
  if (responseAction !== "accept") return false;
  const content = exactRecord(
    response.content,
    "inputResponses.decision_confirmation.content",
  );
  exactKeys(
    content,
    ["confirmed"],
    [],
    "inputResponses.decision_confirmation.content",
  );
  return requiredBoolean(
    content.confirmed,
    "inputResponses.decision_confirmation.content.confirmed",
  );
}

async function requiredProposedDecision(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  expectedRevision: number,
  decisionId: string,
  inputFingerprint: ContentFingerprint,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await requiredProjectRevision(store, projectId, expectedRevision);
  const decision = snapshot.decisions.find((candidate) => candidate.id === decisionId);
  if (
    !decision || decision.status !== "proposed" || !decision.proposal ||
    !decision.inputFingerprint ||
    decision.inputFingerprint.algorithm !== inputFingerprint.algorithm ||
    decision.inputFingerprint.digest !== inputFingerprint.digest
  ) {
    throw new TypeError(
      `Decision ${decisionId} is not the exact proposed decision at project revision ${expectedRevision}.`,
    );
  }
  return snapshot;
}

async function requiredQueuedRun(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  expectedRevision: number,
  runId: string,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await requiredProjectRevision(store, projectId, expectedRevision);
  const run = snapshot.agentRuns.find((candidate) => candidate.id === runId);
  if (
    !run || run.status !== "queued" || run.startedAt || run.completedAt ||
    run.claimedAt || run.claimedBy || run.waitingForDecisionIds ||
    run.resultSnapshot || run.failure || run.cancellation ||
    run.evidenceRefs.length !== 0
  ) {
    throw new TypeError(
      `Agent run ${runId} is not an unclaimed queued run at project revision ${expectedRevision}.`,
    );
  }
  return snapshot;
}

function requiredQueueWorkItem(
  project: EngineeringProjectSnapshot,
  workItemId: string,
) {
  const workItem = project.workItems.find((candidate) => candidate.id === workItemId);
  if (!workItem || !workItem.operation) {
    throw new TypeError(
      `Work item ${workItemId} has no registered operation to queue.`,
    );
  }
  return workItem;
}

function queueRunSummary(
  workItem: ReturnType<typeof requiredQueueWorkItem>,
): string {
  return `Execute reviewed operation ${workItem.operation!.id}@${
    workItem.operation!.version
  } for ${workItem.title}.`;
}

function queueExecutionBasis(
  project: EngineeringProjectSnapshot,
  workItem: ReturnType<typeof requiredQueueWorkItem>,
): { readonly basis: EngineeringBasisRef } {
  if (project.threadSnapshots.length === 0) {
    const expectedInitialOperation = "baseline.from-approved-brief";
    if (
      !project.plan ||
      workItem.operation!.id !== expectedInitialOperation ||
      workItem.operation!.version !== "1"
    ) {
      throw new TypeError(
        `Before a documentary baseline exists, this project can queue only ${expectedInitialOperation}@1.`,
      );
    }
    return { basis: structuredClone(project.plan.basis) };
  }
  return {
    basis: {
      kind: "thread-snapshot",
      ...declaredProjectHead(project),
    },
  };
}

function commonMutation(args: Record<string, unknown>) {
  return {
    commandId: requiredString(args.commandId, "commandId"),
    projectId: requiredString(args.projectId, "projectId"),
    expectedRevision: positiveInteger(args.expectedRevision, "expectedRevision"),
    issuedAt: isoDateTime(args.issuedAt, "issuedAt"),
  };
}

function agentOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  if (subject) return { kind: "agent" as const, actorId: subject };
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  return {
    kind: "agent" as const,
    actorId: name
      ? `mcp:${name}${version ? `@${version}` : ""}`
      : "mcp:unidentified-client",
  };
}

/**
 * Domain authority asserted by the paired MCP host after accepted elicitation.
 * Signed requestState proves retry integrity, not the person's identity; the
 * host and its transport authentication remain the trust boundary.
 */
function elicitedHumanOrigin(context?: ToolHandlerContext) {
  const subject = context?.authInfo?.subject?.trim();
  const name = context?.clientInfo?.name?.trim();
  const version = context?.clientInfo?.version?.trim();
  const channel = subject ||
    (name ? `${name}${version ? `@${version}` : ""}` : "client");
  return {
    kind: "human" as const,
    actorId: `mcp-elicitation:${channel}`,
  };
}

async function requiredProject(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await store.get(projectId);
  if (!snapshot) throw new TypeError(`Engineering project not found: ${projectId}.`);
  return snapshot;
}

/**
 * Inspection replays only project-local seals. It deliberately does not
 * reopen ThreadSnapshot artefacts, qualified-method manifests or providers;
 * that technical verification remains with the future registered @2 executor.
 */
async function assertReadPlanMatchesRun(
  project: EngineeringProjectSnapshot,
  runId: string,
  plan: ResolvedOperationPlanV2,
  projects: EngineeringProjectSnapshotReader,
): Promise<void> {
  const run = project.agentRuns.find((candidate) => candidate.id === runId);
  if (
    !run || !run.resolvedOperationPlan ||
    plan.run.projectId !== project.project.id ||
    plan.run.runId !== run.id ||
    plan.run.workItemId !== run.workItemId ||
    !run.inputFingerprint ||
    !fingerprintsEqual(plan.run.inputFingerprint, run.inputFingerprint)
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact inspected run.",
    );
  }
  if (
    run.basis?.kind !== "thread-snapshot" ||
    plan.basis.snapshotId !== run.basis.snapshotId ||
    plan.basis.revision !== run.basis.revision ||
    plan.basis.subjectId !== run.basis.subjectId
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the run ThreadSnapshot basis.",
    );
  }
  const queueCommandId = run.statusHistory?.[0]?.commandId;
  const queueReceipt = queueCommandId
    ? project.commandReceipts?.find((receipt) =>
      receipt.type === "agent-run.queue" && receipt.commandId === queueCommandId
    )
    : undefined;
  if (
    !queueReceipt?.queuedRun ||
    !sameResolvedOperationPlanRef(
      run.resolvedOperationPlan,
      queueReceipt.queuedRun.resolvedOperationPlan,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan is not cross-bound by the exact queue receipt.",
    );
  }
  const queueBasis = plan.run.queueBasisProject;
  const queuedProject = await projects.getRevision(
    project.project.id,
    queueBasis.revision,
  );
  if (
    !queuedProject || queuedProject.id !== queueBasis.snapshotId ||
    !fingerprintsEqual(await sha256Fingerprint(queuedProject), queueBasis.fingerprint)
  ) {
    throw new TypeError(
      "Resolved operation plan queue basis project is missing or changed.",
    );
  }
  const workItem = queuedProject.workItems.find((item) => item.id === run.workItemId);
  if (
    !workItem?.operation || plan.workItem.id !== workItem.id ||
    plan.workItem.operation.id !== workItem.operation.id ||
    plan.workItem.operation.version !== workItem.operation.version ||
    !fingerprintsEqual(
      plan.workItem.operationFingerprint,
      await sha256Fingerprint(workItem.operation),
    )
  ) {
    throw new TypeError(
      "Resolved operation plan does not bind the exact queued work item.",
    );
  }
  const decision = queuedProject.decisions.find((item) =>
    item.id === plan.authorization.mrtr.decisionId
  );
  const approval = queuedProject.approvals.find((item) =>
    item.id === plan.authorization.mrtr.approvalId
  );
  if (
    !workItem.decisionIds.includes(plan.authorization.mrtr.decisionId) ||
    decision?.status !== "approved" || !decision.inputFingerprint ||
    decision.approvalIds.at(-1) !== approval?.id ||
    !fingerprintsEqual(
      decision.inputFingerprint,
      plan.authorization.mrtr.decisionInputFingerprint,
    ) ||
    !approval || approval.status !== "approved" ||
    !fingerprintsEqual(
      await sha256Fingerprint(approval),
      plan.authorization.mrtr.approvalFingerprint,
    )
  ) {
    throw new TypeError(
      "Resolved operation plan MRTR approval no longer matches its queued project basis.",
    );
  }
}

async function requiredProjectRevision(
  store: EngineeringProjectSnapshotReader,
  projectId: string,
  revision: number,
): Promise<EngineeringProjectSnapshot> {
  const snapshot = await store.getRevision(projectId, revision);
  if (!snapshot) {
    throw new TypeError(
      `Engineering project revision not found: ${projectId}@${revision}.`,
    );
  }
  return snapshot;
}

function declaredProjectHead(
  project: EngineeringProjectSnapshot,
): EngineeringThreadSnapshotRef {
  const reference =
    [...project.threadSnapshots].sort((left, right) =>
      right.revision - left.revision ||
      right.snapshotId.localeCompare(left.snapshotId)
    )[0];
  if (!reference) {
    throw new TypeError(
      `Engineering project ${project.project.id} has no exact thread snapshot.`,
    );
  }
  return structuredClone(reference);
}

function threadSnapshotReference(
  value: unknown,
  name: string,
): EngineeringThreadSnapshotRef {
  const record = exactRecord(value, name);
  exactKeys(record, ["snapshotId", "revision", "subjectId"], [], name);
  const snapshotId = requiredString(record.snapshotId, `${name}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${name}.snapshotId cannot use the latest alias`);
  }
  return {
    snapshotId,
    revision: positiveInteger(record.revision, `${name}.revision`),
    subjectId: requiredString(record.subjectId, `${name}.subjectId`),
  };
}

function assertDeclaredProjectHead(
  declared: EngineeringThreadSnapshotRef,
  expected: EngineeringThreadSnapshotRef,
): void {
  if (
    declared.snapshotId !== expected.snapshotId ||
    declared.revision !== expected.revision ||
    declared.subjectId !== expected.subjectId
  ) {
    throw new TypeError(
      `baseSnapshot must exactly equal the current project thread head ${expected.snapshotId}@${expected.revision}.`,
    );
  }
}

async function projectResult(
  content: string,
  snapshot: EngineeringProjectSnapshot,
  threadSnapshots?: ProjectControlToolDependencies["threadSnapshots"],
) {
  return {
    content,
    structuredContent: await presentProjectSnapshot(
      snapshot,
      threadSnapshots,
    ) as unknown as Record<string, unknown>,
  };
}

async function presentProjectSnapshot(
  snapshot: EngineeringProjectSnapshot,
  threadSnapshots?: ProjectControlToolDependencies["threadSnapshots"],
): Promise<EngineeringProjectSnapshot> {
  if (!threadSnapshots) return snapshot;
  const workById = new Map(
    snapshot.workItems.map((item) => [item.id, item] as const),
  );
  const needed = new Set(
    snapshot.agentRuns
      .filter((run) =>
        run.resultSnapshot &&
        runNeedsThreadProjection(run, workById.get(run.workItemId))
      )
      .map((run) => run.resultSnapshot!.snapshotId),
  );
  if (needed.size === 0) return snapshot;
  const threads = new Map<string, AgentRunJoinThreadSnapshot>();
  for (const snapshotId of needed) {
    const thread = await threadSnapshots.get(snapshotId);
    if (thread) threads.set(snapshotId, thread);
  }
  return assembleAgentRunRequirementJoins(snapshot, threads);
}

function decisionProposal(value: unknown): {
  summary: string;
  parameters: Array<{
    key: string;
    label: string;
    value: string | number | boolean;
    unit?: string;
  }>;
} {
  const record = exactRecord(value, "proposal");
  exactKeys(record, ["summary", "parameters"], [], "proposal");
  if (!Array.isArray(record.parameters)) {
    throw new TypeError("proposal.parameters must be an array");
  }
  return {
    summary: requiredString(record.summary, "proposal.summary"),
    parameters: record.parameters.map((item, index) => {
      const parameter = exactRecord(item, `proposal.parameters[${index}]`);
      exactKeys(
        parameter,
        ["key", "label", "value"],
        ["unit"],
        `proposal.parameters[${index}]`,
      );
      const result: {
        key: string;
        label: string;
        value: string | number | boolean;
        unit?: string;
      } = {
        key: requiredString(parameter.key, `proposal.parameters[${index}].key`),
        label: requiredString(
          parameter.label,
          `proposal.parameters[${index}].label`,
        ),
        value: scalar(parameter.value, `proposal.parameters[${index}].value`),
      };
      if (parameter.unit !== undefined) {
        if (typeof result.value !== "number") {
          throw new TypeError(
            `proposal.parameters[${index}].unit is only valid for a numeric value`,
          );
        }
        result.unit = requiredString(
          parameter.unit,
          `proposal.parameters[${index}].unit`,
        );
      }
      return result;
    }),
  };
}

function fingerprintInput(value: unknown, name: string): ContentFingerprint {
  const record = exactRecord(value, name);
  exactKeys(record, ["algorithm", "digest"], [], name);
  if (record.algorithm !== "sha256") {
    throw new TypeError(`${name}.algorithm must be sha256`);
  }
  if (typeof record.digest !== "string" || !/^[a-f0-9]{64}$/.test(record.digest)) {
    throw new TypeError(`${name}.digest must be 64 lowercase hex characters`);
  }
  return { algorithm: "sha256", digest: record.digest };
}

function planStartingPoint(value: unknown): EngineeringProjectStartingPoint {
  return oneOf(
    value,
    ["idea-or-spec", "existing-cad", "existing-product"] as const,
    "startingPoint",
  );
}

function planPhases(
  value: unknown,
  options: { allowEmpty?: boolean } = {},
): Array<{
  id: string;
  name: string;
  description: string;
}> {
  if (!Array.isArray(value) || (value.length === 0 && !options.allowEmpty)) {
    throw new TypeError("phases must be a non-empty array");
  }
  return value.map((item, index) => {
    const path = `phases[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(record, ["id", "name", "description"], [], path);
    return {
      id: requiredString(record.id, `${path}.id`),
      name: requiredString(record.name, `${path}.name`),
      description: requiredString(record.description, `${path}.description`),
    };
  });
}

function planWorkItems(value: unknown): Array<{
  id: string;
  phaseId: string;
  owner: EngineeringWorkOwner;
  dependsOnWorkItemIds: string[];
  decisionIds: string[];
  operation: EngineeringOperationRef;
  predecessorRevisionId?: string;
  gateClaims?: EngineeringGateClaim[];
}> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("workItems must be a non-empty array");
  }
  return value.map((item, index) => {
    const path = `workItems[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(
      record,
      [
        "id",
        "phaseId",
        "owner",
        "dependsOnWorkItemIds",
        "decisionIds",
        "operation",
      ],
      ["gateClaims", "predecessorRevisionId"],
      path,
    );
    const planned: {
      id: string;
      phaseId: string;
      owner: EngineeringWorkOwner;
      dependsOnWorkItemIds: string[];
      decisionIds: string[];
      operation: EngineeringOperationRef;
      predecessorRevisionId?: string;
      gateClaims?: EngineeringGateClaim[];
    } = {
      id: requiredString(record.id, `${path}.id`),
      phaseId: requiredString(record.phaseId, `${path}.phaseId`),
      owner: oneOf(
        record.owner,
        ["human", "agent", "shared"] as const,
        `${path}.owner`,
      ),
      dependsOnWorkItemIds: stringList(
        record.dependsOnWorkItemIds,
        `${path}.dependsOnWorkItemIds`,
      ),
      decisionIds: stringList(record.decisionIds, `${path}.decisionIds`),
      operation: planOperation(record.operation, `${path}.operation`),
    };
    if (record.predecessorRevisionId !== undefined) {
      planned.predecessorRevisionId = requiredString(
        record.predecessorRevisionId,
        `${path}.predecessorRevisionId`,
      );
    }
    if (record.gateClaims !== undefined) {
      planned.gateClaims = gateClaims(record.gateClaims, `${path}.gateClaims`);
    }
    return planned;
  });
}

function gateClaims(value: unknown, path: string): EngineeringGateClaim[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value.map((value, index) => {
    const claimPath = `${path}[${index}]`;
    const record = exactRecord(value, claimPath);
    exactKeys(record, ["gateItemId", "role", "status"], [], claimPath);
    return {
      gateItemId: requiredString(record.gateItemId, `${claimPath}.gateItemId`),
      role: oneOf(
        record.role,
        ["contributes-to", "satisfies"] as const,
        `${claimPath}.role`,
      ),
      status: oneOf(
        record.status,
        ["current", "impact-unresolved", "invalidated", "carried-forward"] as const,
        `${claimPath}.status`,
      ),
    };
  });
}

function planDecisions(value: unknown): Array<{
  id: string;
  phaseId: string;
  title: string;
  question: string;
}> {
  if (!Array.isArray(value)) throw new TypeError("requiredDecisions must be an array");
  return value.map((item, index) => {
    const path = `requiredDecisions[${index}]`;
    const record = exactRecord(item, path);
    exactKeys(record, ["id", "phaseId", "title", "question"], [], path);
    return {
      id: requiredString(record.id, `${path}.id`),
      phaseId: requiredString(record.phaseId, `${path}.phaseId`),
      title: requiredString(record.title, `${path}.title`),
      question: requiredString(record.question, `${path}.question`),
    };
  });
}

function planOperation(value: unknown, path: string): EngineeringOperationRef {
  const record = exactRecord(value, path);
  exactKeys(record, ["id", "version", "bindings"], [], path);
  if (!Array.isArray(record.bindings)) {
    throw new TypeError(`${path}.bindings must be an array`);
  }
  return {
    id: requiredString(record.id, `${path}.id`),
    version: requiredString(record.version, `${path}.version`),
    bindings: record.bindings.map((binding, index) =>
      planOperationBinding(binding, `${path}.bindings[${index}]`)
    ),
  };
}

function planOperationBinding(
  value: unknown,
  path: string,
): EngineeringOperationInputBinding {
  const record = exactRecord(value, path);
  exactKeys(record, ["name", "source"], [], path);
  const name = requiredString(record.name, `${path}.name`);
  const source = exactRecord(record.source, `${path}.source`);
  const kind = requiredString(source.kind, `${path}.source.kind`);
  switch (kind) {
    case "approved-brief":
      exactKeys(source, ["kind"], [], `${path}.source`);
      return { name, source: { kind } };
    case "project-answer":
      exactKeys(source, ["kind", "answerId"], [], `${path}.source`);
      return {
        name,
        source: {
          kind,
          answerId: requiredString(source.answerId, `${path}.source.answerId`),
        },
      };
    case "thread-entity":
      exactKeys(source, ["kind", "reference"], [], `${path}.source`);
      return {
        name,
        source: {
          kind,
          reference: threadEntityReference(
            source.reference,
            `${path}.source.reference`,
          ),
        },
      };
    default:
      throw new TypeError(
        `${path}.source.kind must be approved-brief, project-answer or thread-entity`,
      );
  }
}

function threadEntityReference(
  value: unknown,
  name: string,
): EngineeringThreadEntityRef {
  const record = exactRecord(value, name);
  exactKeys(record, ["snapshotId", "snapshotRevision", "kind", "id"], [], name);
  const kind = requiredString(record.kind, `${name}.kind`);
  if (!THREAD_ENTITY_KINDS.includes(kind as ThreadEntityKind)) {
    throw new TypeError(`${name}.kind must be a ThreadSnapshot entity kind`);
  }
  return {
    snapshotId: requiredString(record.snapshotId, `${name}.snapshotId`),
    snapshotRevision: positiveInteger(
      record.snapshotRevision,
      `${name}.snapshotRevision`,
    ),
    kind: kind as ThreadEntityKind,
    id: requiredString(record.id, `${name}.id`),
  };
}

function stringList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function exactRecord(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  name: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const extras = Object.keys(value).filter((key) => !allowed.has(key));
  if (extras.length > 0) {
    throw new TypeError(`${name} has unsupported field(s): ${extras.join(", ")}`);
  }
  const missing = required.filter((key) => !(key in value));
  if (missing.length > 0) {
    throw new TypeError(`${name} is missing field(s): ${missing.join(", ")}`);
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function positiveInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return value as number;
}

function isoDateTime(value: unknown, name: string): string {
  const result = requiredString(value, name);
  const parsed = parseIsoDateTime(result);
  if (parsed === undefined) {
    throw new TypeError(`${name} must be an ISO date-time`);
  }
  return new Date(parsed).toISOString();
}

function parseIsoDateTime(value: string): number | undefined {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value)
  ) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function scalar(value: unknown, name: string): string | number | boolean {
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "boolean"
  ) throw new TypeError(`${name} must be a string, finite number or boolean`);
  if (typeof value === "string" && value.trim() === "") {
    throw new TypeError(`${name} must not be empty`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new TypeError(`${name} must be finite`);
  }
  return value;
}

function requiredBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
  return value;
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  name: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new TypeError(`${name} must be one of ${choices.join(", ")}`);
  }
  return value as T[number];
}
