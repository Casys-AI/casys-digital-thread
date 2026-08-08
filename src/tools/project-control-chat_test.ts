import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import type {
  McpApp,
  MCPTool,
  ToolHandler,
  ToolHandlerContext,
} from "@casys/mcp-server";
import type { EngineeringProjectCommandService } from "../domain/project/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./project-control.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };
const COMMON = {
  commandId: "chat-command-1",
  projectId: "chat-first-project",
  expectedRevision: 4,
  issuedAt: "2026-08-03T12:00:00.000Z",
};

Deno.test("project_agent_run_queue derives its server-owned run command from one ready work item", async () => {
  const snapshot = projectSnapshot();
  const app = new CapturingApp();
  const calls: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      queueRun: (origin, command) => {
        calls.push({ origin, command: command as unknown as Record<string, unknown> });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const handler = app.handler("project_agent_run_queue");
  const result = await handler(
    { ...COMMON, workItemId: "establish-baseline" },
    clientContext(),
  ) as Record<string, unknown>;

  assertStringIncludes(result.content as string, "server derived the run id");
  assertEquals(calls, [{
    origin: { kind: "agent", actorId: "mcp:paired-chat@1" },
    command: {
      ...COMMON,
      runId: "run:chat-command-1",
      workItemId: "establish-baseline",
      summary:
        "Execute reviewed operation baseline.from-approved-brief@1 for Establish the engineering baseline.",
      basis: snapshot.plan!.basis,
    },
  }]);

  const tool = app.tool("project_agent_run_queue");
  const schema = tool.inputSchema as Record<string, unknown>;
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "mcpUrl",
      "runId",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must be server-owned`,
    );
  }
});

Deno.test("project_change_append anchors an append-only change to the exact current thread head", async () => {
  const head = {
    snapshotId: "chat-first-thread:r1",
    revision: 1,
    subjectId: "chat-first-subject",
  };
  const snapshot = projectSnapshot({ threadSnapshots: [head] });
  const app = new CapturingApp();
  const calls: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      appendChange: (origin, command) => {
        calls.push({ origin, command: command as unknown as Record<string, unknown> });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const change = {
    ...COMMON,
    commandId: "chat-change-append-1",
    baseSnapshot: head,
    phases: [{
      id: "architecture",
      name: "System architecture",
      description: "Create the first reviewable SysON system architecture.",
    }],
    workItems: [{
      id: "seed-syson-model",
      phaseId: "architecture",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "architecture.seed-syson-model",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  };
  const result = await app.handler("project_change_append")(
    change,
    clientContext(),
  ) as Record<
    string,
    unknown
  >;

  assertStringIncludes(result.content as string, "adds only reviewed work");
  assertEquals(calls, [{
    origin: { kind: "agent", actorId: "mcp:paired-chat@1" },
    command: {
      ...change,
      baseSnapshot: head,
    },
  }]);
  const tool = app.tool("project_change_append");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "baseSnapshot",
    "commandId",
    "expectedRevision",
    "issuedAt",
    "phases",
    "projectId",
    "requiredDecisions",
    "workItems",
  ]);
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "mcpUrl",
      "runId",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must not be accepted by the append-only change tool`,
    );
  }

  await assertRejects(
    async () => {
      await app.handler("project_change_append")({
        ...change,
        baseSnapshot: { ...head, revision: 2 },
      }, clientContext());
    },
    TypeError,
    "exactly equal the current project thread head",
  );
  assertEquals(calls.length, 1);
});

Deno.test("project decision approval and rejection require a verified human elicitation retry", async () => {
  const snapshot = projectSnapshot({ withDecision: true });
  const app = new CapturingApp();
  const approved: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  const rejected: Array<{ origin: unknown; command: Record<string, unknown> }> = [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      approveDecision: (origin, command) => {
        approved.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
      rejectDecision: (origin, command) => {
        rejected.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const args = {
    ...COMMON,
    decisionId: "airframe-material",
    inputFingerprint: FINGERPRINT,
    rationale: "The person accepted this trade-off in the paired conversation.",
  };
  const approve = app.handler("project_decision_approve");
  const first = await approve(args, clientContext()) as Record<string, unknown>;
  assertEquals(first.resultType, "input_required");
  const request = (first.inputRequests as Record<string, unknown>)
    .decision_confirmation as Record<string, unknown>;
  assertEquals(request.method, "elicitation/create");
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    "Composite airframe",
  );
  assertEquals(approved, []);

  await assertRejects(
    async () => {
      await approve(args, {
        ...clientContext(),
        retryVerified: false,
        inputResponses: {
          decision_confirmation: { action: "accept", content: { confirmed: true } },
        },
      });
    },
    TypeError,
    "verified signed request state",
  );
  assertEquals(approved, []);

  const accepted = await approve(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      decision_confirmation: { action: "accept", content: { confirmed: true } },
    },
  }) as Record<string, unknown>;
  assertStringIncludes(
    accepted.content as string,
    "paired MCP host reported approval",
  );
  assertEquals(approved, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: {
      ...args,
      inputFingerprint: FINGERPRINT,
    },
  }]);

  const reject = app.handler("project_decision_reject");
  const rejectedFirst = await reject(args, clientContext()) as Record<string, unknown>;
  assertEquals(rejectedFirst.resultType, "input_required");
  await reject(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      decision_confirmation: { action: "accept", content: { confirmed: true } },
    },
  });
  assertEquals(rejected, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: {
      ...args,
      inputFingerprint: FINGERPRINT,
    },
  }]);
});

Deno.test("project queued-run cancellation requires a verified human elicitation retry", async () => {
  const snapshot = queuedRunSnapshot();
  const app = new CapturingApp();
  const cancellations: Array<{ origin: unknown; command: Record<string, unknown> }> =
    [];
  registerProjectControlTools(
    app as unknown as McpApp,
    dependencies(snapshot, {
      cancelQueuedRun: (origin, command) => {
        cancellations.push({
          origin,
          command: command as unknown as Record<string, unknown>,
        });
        return Promise.resolve(snapshot);
      },
    }),
  );

  const args = {
    ...COMMON,
    runId: "run:queued-before-cancellation",
    rationale: "The reviewed work was superseded before any agent claim.",
  };
  const cancel = app.handler("project_agent_run_cancel");
  const first = await cancel(args, clientContext()) as Record<string, unknown>;
  assertEquals(first.resultType, "input_required");
  const request = (first.inputRequests as Record<string, unknown>)
    .run_cancellation_confirmation as Record<string, unknown>;
  assertEquals(request.method, "elicitation/create");
  assertStringIncludes(
    (request.params as Record<string, unknown>).message as string,
    "has not been claimed or executed",
  );
  assertEquals(cancellations, []);

  await assertRejects(
    async () => {
      await cancel(args, {
        ...clientContext(),
        retryVerified: false,
        inputResponses: {
          run_cancellation_confirmation: {
            action: "accept",
            content: { confirmed: true },
          },
        },
      });
    },
    TypeError,
    "verified signed request state",
  );
  assertEquals(cancellations, []);

  const accepted = await cancel(args, {
    ...clientContext(),
    retryVerified: true,
    inputResponses: {
      run_cancellation_confirmation: {
        action: "accept",
        content: { confirmed: true },
      },
    },
  }) as Record<string, unknown>;
  assertStringIncludes(accepted.content as string, "human cancellation");
  assertEquals(cancellations, [{
    origin: { kind: "human", actorId: "mcp-elicitation:paired-chat@1" },
    command: args,
  }]);

  const tool = app.tool("project_agent_run_cancel");
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const schema = tool.inputSchema as Record<string, unknown>;
  assertEquals(Object.keys(schema.properties as Record<string, unknown>).sort(), [
    "commandId",
    "expectedRevision",
    "issuedAt",
    "projectId",
    "rationale",
    "runId",
  ]);
  const serialized = JSON.stringify(schema);
  for (
    const forbidden of [
      "provider",
      "toolName",
      "summary",
      "basis",
      "resultSnapshot",
      "evidenceRefs",
      "cancelledRun",
    ]
  ) {
    assertEquals(
      serialized.includes(forbidden),
      false,
      `${forbidden} must be server-owned`,
    );
  }
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, ToolHandler>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  handler(name: string): ToolHandler {
    const handler = this.#handlers.get(name);
    assert(handler, `Expected ${name} handler to be registered.`);
    return handler;
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    assert(tool, `Expected ${name} tool to be registered.`);
    return tool;
  }
}

function dependencies(
  snapshot: EngineeringProjectSnapshot,
  commandOverrides: Partial<EngineeringProjectCommandService> = {},
): ProjectControlToolDependencies {
  return {
    projects: {
      get: () => Promise.resolve(snapshot),
      getRevision: () => Promise.resolve(snapshot),
    },
    commands: {
      queueRun: () => Promise.resolve(snapshot),
      approveDecision: () => Promise.resolve(snapshot),
      rejectDecision: () => Promise.resolve(snapshot),
      ...commandOverrides,
    } as unknown as EngineeringProjectCommandService,
  };
}

function clientContext(): ToolHandlerContext {
  return {
    toolName: "test",
    clientInfo: { name: "paired-chat", version: "1" },
  };
}

function projectSnapshot(
  options: {
    withDecision?: boolean;
    threadSnapshots?: EngineeringProjectSnapshot["threadSnapshots"];
  } = {},
): EngineeringProjectSnapshot {
  return {
    schemaVersion: "3.0",
    id: "chat-first-project:project:r4",
    revision: 4,
    generatedAt: "2026-08-03T12:00:00.000Z",
    project: {
      id: "chat-first-project",
      name: "Chat-first project",
      subjectId: "chat-first-subject",
      objective: { title: "Objective", statement: "Test chat-first control." },
    },
    plan: {
      startingPoint: "idea-or-spec",
      basis: {
        kind: "approved-brief",
        projectId: "chat-first-project",
        projectSnapshotId: "chat-first-project:project:r3",
        projectRevision: 3,
        briefId: "brief-1",
        briefSnapshotId: "brief-1:r1",
        briefRevision: 1,
        approvedBriefFingerprint: FINGERPRINT,
      },
      publishedAt: "2026-08-03T11:59:00.000Z",
      publishedBy: { id: "agent:paired-chat", origin: "agent" },
    },
    threadSnapshots: options.threadSnapshots ?? [],
    phases: [],
    workItems: [{
      id: "establish-baseline",
      phaseId: "baseline",
      title: "Establish the engineering baseline",
      description: "Create the first bounded baseline.",
      kind: "define",
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
      status: "ready",
      owner: "agent",
      dependsOnWorkItemIds: [],
      evidenceRefs: [],
      decisionIds: [],
      blockerIds: [],
    }],
    agentRuns: [],
    decisions: options.withDecision
      ? [{
        id: "airframe-material",
        phaseId: "architecture",
        title: "Composite airframe",
        question: "Should the first demonstrator use a composite airframe?",
        status: "proposed",
        requestedAt: "2026-08-03T11:58:00.000Z",
        inputFingerprint: FINGERPRINT,
        inputEvidenceRefs: [],
        approvalIds: ["approval:airframe-material:proposal-1"],
        proposal: {
          summary: "Use a composite airframe for the first demonstrator.",
          parameters: [{
            key: "material",
            label: "Material",
            value: "Carbon composite",
          }],
          proposedAt: "2026-08-03T11:58:00.000Z",
          proposedBy: { id: "agent:paired-chat", origin: "agent" },
        },
      }]
      : [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  };
}

function queuedRunSnapshot(): EngineeringProjectSnapshot {
  const snapshot = projectSnapshot();
  return {
    ...snapshot,
    workItems: snapshot.workItems.map((item) => ({
      ...item,
      status: item.id === "establish-baseline" ? "in-progress" as const : item.status,
    })),
    agentRuns: [{
      id: "run:queued-before-cancellation",
      workItemId: "establish-baseline",
      status: "queued",
      summary: "Execute the reviewed documentary baseline.",
      queuedAt: "2026-08-03T12:00:00.000Z",
      basis: snapshot.plan!.basis,
      inputFingerprint: FINGERPRINT,
      evidenceRefs: [],
      statusHistory: [{
        commandId: "queue-before-cancellation",
        status: "queued",
        at: "2026-08-03T12:00:00.000Z",
        actor: { id: "mcp:paired-chat@1", origin: "agent" },
        summary: "Execute the reviewed documentary baseline.",
      }],
    }],
  };
}
