import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { RegisteredProjectRunExecutor } from "../adapters/registered-project-run-executor.ts";
import type { EngineeringProjectCommandService } from "../domain/engineering-project-command-service.ts";
import type {
  EngineeringBasisRef,
  EngineeringOperationInputBinding,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringProjectStartingPoint,
  EngineeringThreadSnapshotRef,
  EngineeringWorkOwner,
} from "../domain/engineering-project.ts";
import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/**
 * These commands mutate only the durable EngineeringProject aggregate. They do
 * not directly execute an external engineering tool and are not safe for
 * speculative or automatic retries without their durable command id.
 */
const PROJECT_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

/** Same-command retries resume the server-owned local execution safely. */
const PROJECT_EXECUTION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

/** Signed elicitation request state makes same-command retries safe. */
const PROJECT_HUMAN_CONFIRMATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

const COMMAND_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description:
    "Stable command id. Reuse it verbatim, with identical arguments, when retrying an uncertain call.",
} as const;

const PROJECT_ID = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description: "Engineering project identity from project_snapshot.",
} as const;

const EXPECTED_REVISION = {
  type: "integer",
  minimum: 1,
  description:
    "Optimistic EngineeringProject revision from the latest project_snapshot.",
} as const;

const ISSUED_AT = {
  type: "string",
  description:
    "Stable ISO timestamp for this command. Preserve it together with commandId on retry.",
} as const;

const OPERATION_BINDING_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    source: {
      oneOf: [
        {
          type: "object",
          properties: { kind: { const: "approved-brief" } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "project-answer" },
            answerId: { type: "string", minLength: 1 },
          },
          required: ["kind", "answerId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { const: "approved-discovery" } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "discovery-answer" },
            answerId: { type: "string", minLength: 1 },
          },
          required: ["kind", "answerId"],
          additionalProperties: false,
        },
      ],
    },
  },
  required: ["name", "source"],
  additionalProperties: false,
} as const;

const OPERATION_REF_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    version: { type: "string", minLength: 1 },
    bindings: {
      type: "array",
      items: OPERATION_BINDING_SCHEMA,
    },
  },
  required: ["id", "version", "bindings"],
  additionalProperties: false,
} as const;

const COMMON_MUTATION_PROPERTIES = {
  commandId: COMMAND_ID,
  projectId: PROJECT_ID,
  expectedRevision: EXPECTED_REVISION,
  issuedAt: ISSUED_AT,
} as const;

export interface EngineeringProjectSnapshotReader {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface ProjectControlToolDependencies {
  projects: EngineeringProjectSnapshotReader;
  commands: EngineeringProjectCommandService;
  /** Optional so focused read-only tests need not construct a trusted executor. */
  runExecutor?: Pick<RegisteredProjectRunExecutor, "execute">;
}

export function registerProjectControlTools(
  app: McpApp,
  dependencies: ProjectControlToolDependencies,
): void {
  app.registerTool(projectSnapshotTool, async (args) => {
    const projectId = requiredString(args.projectId, "projectId");
    const snapshot = await requiredProject(dependencies.projects, projectId);
    return projectResult(
      `Project ${snapshot.project.name} is at revision ${snapshot.revision}.`,
      snapshot,
    );
  });

  app.registerTool(projectPlanPublishTool, async (args, context) => {
    const common = commonMutation(args);
    const snapshot = await dependencies.commands.publishPlan(agentOrigin(context), {
      ...common,
      startingPoint: planStartingPoint(args.startingPoint),
      phases: planPhases(args.phases),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return projectResult(
      `The agent-published project path is recorded at revision ${snapshot.revision}. It is planning state only: no engineering operation was executed.`,
      snapshot,
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
      phases: planPhases(args.phases),
      workItems: planWorkItems(args.workItems),
      requiredDecisions: planDecisions(args.requiredDecisions),
    });
    return projectResult(
      `The agent-appended project change is recorded at revision ${snapshot.revision}. It adds only reviewed work anchored to the exact current thread snapshot; no engineering operation was executed.`,
      snapshot,
    );
  });

  if (dependencies.runExecutor) {
    app.registerTool(projectAgentRunExecuteTool, async (args, context) => {
      const common = commonMutation(args);
      const runId = requiredString(args.runId, "runId");
      const snapshot = await dependencies.runExecutor!.execute(
        agentOrigin(context),
        { ...common, runId },
      );
      return projectResult(
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
    return projectResult(
      `Agent queued the reviewed operation ${workItem.operation!.id}@${
        workItem.operation!.version
      } for work item ${workItemId} at project revision ${snapshot.revision}. The server derived the run id, summary and exact basis; no provider or arbitrary execution input was accepted.`,
      snapshot,
    );
  });

  app.registerTool(projectDecisionProposeTool, async (args, context) => {
    const common = commonMutation(args);
    const current = await requiredProjectRevision(
      dependencies.projects,
      common.projectId,
      common.expectedRevision,
    );
    const snapshot = await dependencies.commands.proposeDecision(
      agentOrigin(context),
      {
        ...common,
        decisionId: requiredString(args.decisionId, "decisionId"),
        proposal: decisionProposal(args.proposal),
        baseSnapshot: declaredProjectHead(current),
      },
    );
    return projectResult(
      `Decision ${
        requiredString(args.decisionId, "decisionId")
      } now has an agent proposal at project revision ${snapshot.revision}; human approval is still required.`,
      snapshot,
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
}

const projectSnapshotTool: MCPTool = {
  name: "project_snapshot",
  description:
    "Read the durable EngineeringProject application state: work, decisions, approvals, agent runs, blockers, exact thread references, and command receipts. This does not probe or execute engineering tools.",
  inputSchema: {
    type: "object",
    properties: { projectId: PROJECT_ID },
    required: ["projectId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
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
      items: {
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
          operation: OPERATION_REF_SCHEMA,
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
      },
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

const THREAD_SNAPSHOT_REF_SCHEMA = {
  type: "object",
  properties: {
    snapshotId: { type: "string", minLength: 1 },
    revision: { type: "integer", minimum: 1 },
    subjectId: { type: "string", minLength: 1 },
  },
  required: ["snapshotId", "revision", "subjectId"],
  additionalProperties: false,
} as const;

const projectChangeAppendTool: MCPTool = {
  name: "project_change_append",
  description:
    "Append the next bounded, reviewed engineering change after an existing exact ThreadSnapshot. The supplied baseSnapshot must exactly equal the project's current declared thread head; each work item must cite a reviewed registered operation and state-reference bindings. This never revises an existing phase, work item, decision, run or evidence record; it never calls a provider, approves a decision, queues work, or creates technical evidence. It cannot pre-plan later work whose basis does not yet exist.",
  inputSchema: mutationSchema({
    baseSnapshot: THREAD_SNAPSHOT_REF_SCHEMA,
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
      items: {
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
          operation: OPERATION_REF_SCHEMA,
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
      },
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

const FINGERPRINT_SCHEMA = {
  type: "object",
  properties: {
    algorithm: { const: "sha256" },
    digest: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
  required: ["algorithm", "digest"],
  additionalProperties: false,
} as const;

const projectDecisionApproveTool: MCPTool = {
  name: "project_decision_approve",
  description:
    "Ask the paired MCP host to present one exact proposed decision for confirmation. The first call requests elicitation; only a signed retry whose request state verifies and whose response is accepted records approval. The signature protects retry integrity, not user identity; the host is responsible for presenting the request to the person. The agent cannot call the underlying human-authority mutation directly.",
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

const projectAgentRunExecuteTool: MCPTool = {
  name: "project_agent_run_execute",
  description:
    "Execute one agent-queued run through its exact server-owned registered executor. The call accepts no provider, tool arguments, files or result payload. Registered work may record the canonical project brief as a documentary baseline or run an explicitly reviewed engineering operation; it cannot add arbitrary evidence or compliance claims. Reuse the same commandId unchanged to resume an interrupted call safely.",
  inputSchema: mutationSchema({
    runId: { type: "string", minLength: 1 },
  }, ["runId"]),
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: PROJECT_EXECUTION_ANNOTATIONS,
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
  const confirmation = decisionConfirmationResponse(context);
  if (confirmation === undefined) {
    return decisionConfirmationRequest(current, decisionId, action, rationale);
  }
  if (!confirmation) {
    return projectResult(
      `Decision ${decisionId} was not ${
        action === "approve" ? "approved" : "rejected"
      }. No project state changed; continue the paired conversation.`,
      current,
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
  return projectResult(
    `The paired MCP host reported ${
      action === "approve" ? "approval" : "rejection"
    } of decision ${decisionId} through elicitation at project revision ${snapshot.revision}.`,
    snapshot,
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
  const parameters = proposal.parameters.map((parameter) =>
    `${parameter.label}: ${String(parameter.value)}${
      parameter.unit ? ` ${parameter.unit}` : ""
    }`
  ).join("; ");
  return {
    resultType: "input_required",
    inputRequests: {
      decision_confirmation: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message:
            `The agent proposes to ${disposition} “${decision.title}”. Proposal: ${proposal.summary}${
              parameters ? `. Parameters: ${parameters}` : ""
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

function requiredQueueWorkItem(
  project: EngineeringProjectSnapshot,
  workItemId: string,
) {
  if (project.schemaVersion === "1.0") {
    throw new TypeError(
      "project_agent_run_queue does not execute historical V1 work.",
    );
  }
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
    const expectedInitialOperation = project.schemaVersion === "3.0"
      ? "baseline.from-approved-brief"
      : "baseline.from-approved-discovery";
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

function mutationSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: "object",
    properties: { ...COMMON_MUTATION_PROPERTIES, ...properties },
    required: [
      "commandId",
      "projectId",
      "expectedRevision",
      "issuedAt",
      ...required,
    ],
    additionalProperties: false,
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

function projectResult(content: string, snapshot: EngineeringProjectSnapshot) {
  return {
    content,
    structuredContent: snapshot as unknown as Record<string, unknown>,
  };
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

function planPhases(value: unknown): Array<{
  id: string;
  name: string;
  description: string;
}> {
  if (!Array.isArray(value) || value.length === 0) {
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
      [],
      path,
    );
    return {
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
    case "approved-discovery":
      exactKeys(source, ["kind"], [], `${path}.source`);
      return { name, source: { kind } };
    case "discovery-answer":
      exactKeys(source, ["kind", "answerId"], [], `${path}.source`);
      return {
        name,
        source: {
          kind,
          answerId: requiredString(source.answerId, `${path}.source.answerId`),
        },
      };
    default:
      throw new TypeError(
        `${path}.source.kind must be approved-brief, project-answer, approved-discovery or discovery-answer`,
      );
  }
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
