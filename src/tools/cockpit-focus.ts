import type { McpApp, MCPTool, ToolHandlerContext } from "@casys/mcp-server";
import type { CockpitFocusStore } from "../adapters/file-cockpit-focus-store.ts";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import type { ProjectDiscoverySnapshot } from "../domain/project-discovery.ts";
import {
  COCKPIT_FOCUS_SCHEMA_VERSION,
  type CockpitFocusTarget,
} from "../domain/cockpit-focus.ts";

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
  readonly discoveries: {
    get(discoveryId: string): Promise<ProjectDiscoverySnapshot | undefined>;
  };
}

/**
 * Conversation-owned focus for the two read-only cockpit projections. It does
 * not alter discovery, planning, evidence, or human authority; it merely
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
    const expectedRevision = nonNegativeInteger(
      args.expectedRevision,
      "expectedRevision",
    );
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
      }. This only changes the read-only cockpit focus; it did not create a project, change a discovery answer, execute a tool, or produce evidence.`,
      structuredContent: snapshot,
    };
  });
}

const cockpitFocusSnapshotTool: MCPTool = {
  name: "cockpit_focus_snapshot",
  description:
    "Read the agent-selected durable focus for one cockpit workspace. A focus points either to an existing project for the Engineering Workbench or to an existing discovery for the Discovery Workbench; it is not engineering evidence.",
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
    "Select the already durable project or discovery that the read-only cockpit workspace follows. Use project_discovery_* to start or resume discovery, then select that discovery; after an approved brief creates a project shell, select that project. This cannot mutate the selected engineering record or execute providers.",
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
          "Optimistic cockpit focus revision; use 0 only when cockpit_focus_snapshot reports no focus.",
      },
      issuedAt: {
        type: "string",
        description: "Stable ISO timestamp preserved with commandId on retry.",
      },
      target: {
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { const: "project" },
              projectId: { type: "string", minLength: 1, maxLength: 160 },
            },
            required: ["kind", "projectId"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              kind: { const: "discovery" },
              discoveryId: { type: "string", minLength: 1, maxLength: 160 },
            },
            required: ["kind", "discoveryId"],
            additionalProperties: false,
          },
        ],
      },
    },
    required: [
      "commandId",
      "workspaceId",
      "expectedRevision",
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
  if (value.kind === "discovery") {
    return {
      kind: "discovery",
      discoveryId: requiredString(value.discoveryId, "target.discoveryId"),
    };
  }
  throw new TypeError("target.kind must be project or discovery.");
}

async function requiredTarget(
  target: CockpitFocusTarget,
  dependencies: CockpitFocusToolDependencies,
): Promise<void> {
  if (target.kind === "project") {
    if (await dependencies.projects.get(target.projectId)) return;
    throw new TypeError(`Engineering project ${target.projectId} was not found.`);
  }
  if (await dependencies.discoveries.get(target.discoveryId)) return;
  throw new TypeError(`Project discovery ${target.discoveryId} was not found.`);
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
  return target.kind === "project"
    ? `engineering project ${target.projectId}`
    : `project discovery ${target.discoveryId}`;
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
