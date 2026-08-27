import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { CockpitFocusStore } from "../application/ports/out/project/cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import {
  COCKPIT_FOCUS_SCHEMA_VERSION,
  type CockpitFocusTarget,
} from "../domain/project/cockpit-focus.ts";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const OBJECT_OUTPUT_SCHEMA = { type: "object", additionalProperties: true } as const;

export interface CockpitFocusToolDependencies {
  readonly focus: CockpitFocusStore;
  readonly projects: {
    get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  };
}

/**
 * Conversation-owned focus for the read-only project cockpit. It does
 * not alter framing, planning, evidence, or human authority; it merely
 * records which already durable record each BFF should follow.
 */
export function registerCockpitFocusTools(
  app: McpApp,
  dependencies: CockpitFocusToolDependencies,
): void {
  app.registerTool(cockpitFocusSnapshotTool, async (args) => {
    const workspaceId = requiredString(args.workspaceId, "workspaceId");
    const snapshot = await dependencies.focus.get(workspaceId);
    return {
      content: snapshot
        ? `Cockpit workspace ${workspaceId} follows ${
          targetLabel(snapshot.target)
        } at focus revision ${snapshot.revision}.`
        : `Cockpit workspace ${workspaceId} has no agent-selected focus yet.`,
      structuredContent: { workspaceId, focus: snapshot },
    };
  });

  app.registerTool(cockpitFocusSetTool, async (args, context) => {
    const workspaceId = requiredString(args.workspaceId, "workspaceId");
    const target = targetInput(args.target);
    await requiredTarget(target, dependencies);
    const expectedRevision = args.expectedRevision === undefined
      ? (await dependencies.focus.get(workspaceId))?.revision ?? 0
      : nonNegativeInteger(args.expectedRevision, "expectedRevision");
    const selectedAt = isoDateTime(args.issuedAt, "issuedAt");
    const snapshot = await dependencies.focus.select({
      schemaVersion: COCKPIT_FOCUS_SCHEMA_VERSION,
      workspaceId,
      revision: expectedRevision + 1,
      commandId: requiredString(args.commandId, "commandId"),
      selectedAt,
      selectedBy: agentOrigin(context),
      target,
      ...(expectedRevision === 0 ? {} : { previous: { revision: expectedRevision } }),
    }, expectedRevision);
    return {
      content: `Cockpit workspace ${workspaceId} now follows ${
        targetLabel(target)
      }. This only changes the read-only cockpit focus; it did not create or change a project, execute a tool, or produce evidence.`,
      structuredContent: snapshot,
    };
  });
}

const cockpitFocusSnapshotTool: MCPTool = {
  name: "cockpit_focus_snapshot",
  description:
    "Read the agent-selected durable project followed by one cockpit workspace. It is UI routing state, not engineering evidence.",
  inputSchema: {
    type: "object",
    properties: { workspaceId: workspaceIdSchema() },
    required: ["workspaceId"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const cockpitFocusSetTool: MCPTool = {
  name: "cockpit_focus_set",
  description:
    "Select the already durable project that the read-only cockpit workspace follows. A project is selectable from its first framing revision. This cannot mutate project truth or execute providers.",
  inputSchema: {
    type: "object",
    properties: {
      commandId: {
        type: "string",
        minLength: 1,
        maxLength: 160,
        description:
          "Stable id reused verbatim if this exact focus command is retried.",
      },
      workspaceId: workspaceIdSchema(),
      expectedRevision: {
        type: "integer",
        minimum: 0,
        description:
          "Optimistic cockpit focus revision. Omit to use the current cockpit focus revision. Use 0 only when cockpit_focus_snapshot reports no focus. Pass an explicit integer for optimistic concurrency when you have one.",
      },
      issuedAt: {
        type: "string",
        description: "Stable ISO timestamp preserved with commandId on retry.",
      },
      target: {
        type: "object",
        properties: {
          kind: { const: "project" },
          projectId: { type: "string", minLength: 1, maxLength: 160 },
        },
        required: ["kind", "projectId"],
        additionalProperties: false,
      },
    },
    required: [
      "commandId",
      "workspaceId",
      "issuedAt",
      "target",
    ],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: MUTATION_ANNOTATIONS,
};

function workspaceIdSchema() {
  return {
    type: "string",
    minLength: 1,
    maxLength: 160,
    description: "Stable cockpit workspace identity, for example primary.",
  } as const;
}

function targetInput(value: unknown): CockpitFocusTarget {
  if (!isRecord(value)) throw new TypeError("target must be an object.");
  if (value.kind === "project") {
    return {
      kind: "project",
      projectId: requiredString(value.projectId, "target.projectId"),
    };
  }
  throw new TypeError("target.kind must be project.");
}

async function requiredTarget(
  target: CockpitFocusTarget,
  dependencies: CockpitFocusToolDependencies,
): Promise<void> {
  if (await dependencies.projects.get(target.projectId)) return;
  throw new TypeError(`Engineering project ${target.projectId} was not found.`);
}

function agentOrigin(context: ToolHandlerContext | undefined): {
  kind: "agent";
  actorId: string;
} {
  const name = context?.clientInfo?.name?.trim() || "unknown-client";
  const version = context?.clientInfo?.version?.trim() || "unknown";
  return { kind: "agent", actorId: `mcp:${name}@${version}` };
}

function targetLabel(target: CockpitFocusTarget): string {
  return `engineering project ${target.projectId}`;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer.`);
  }
  return value as number;
}

function isoDateTime(value: unknown, name: string): string {
  const text = requiredString(value, name);
  if (Number.isNaN(Date.parse(text))) {
    throw new TypeError(`${name} must be an ISO date-time.`);
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
