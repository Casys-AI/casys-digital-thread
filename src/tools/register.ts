import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ControlPlane } from "../domain/control-plane.ts";

export const CONSOLE_RESOURCE_URI = "ui://casys-digital-thread/console";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const OBJECT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: true,
} as const;

export function registerControlPlaneTools(
  app: McpApp,
  controlPlane: ControlPlane,
): void {
  app.registerTool(consoleSnapshotTool, async () => {
    const snapshot = await controlPlane.snapshot();
    const counts = snapshot.fleet.counts;
    return {
      content:
        `Fleet ${snapshot.fleet.status}: ${counts.healthy}/${counts.total} healthy, ${counts.drift} with drift. Console mode: ${snapshot.mode}.`,
      structuredContent: snapshot,
    };
  });

  app.registerTool(serverDetailTool, async (args) => {
    const id = requiredString(args.id, "id");
    const server = await controlPlane.serverDetail(id);
    return {
      content:
        `${server.desired.displayName}: ${server.observed.status}, drift ${server.drift.status}.`,
      structuredContent: server,
    };
  });

  app.registerTool(runListTool, async () => {
    const items = await controlPlane.runList();
    return {
      content: `${items.length} engineering run(s) available.`,
      structuredContent: { items },
    };
  });

  app.registerTool(runDetailTool, async (args) => {
    const id = requiredString(args.id, "id");
    const run = await controlPlane.runDetail(id);
    return {
      content:
        `${run.name}: execution ${run.status}; requirement verdict ${run.verdictStatus}. Source: ${run.source}.`,
      structuredContent: run,
    };
  });

  app.registerAppOnlyTool(consoleRefreshTool, async () => {
    const snapshot = await controlPlane.snapshot({ refresh: true });
    return {
      content: "Console snapshot refreshed.",
      structuredContent: snapshot,
    };
  });
}

const consoleSnapshotTool: MCPTool = {
  name: "console_snapshot",
  description:
    "Read the complete Casys digital-thread console snapshot: desired versus observed MCP fleet, run summaries, and workbench panels.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
  _meta: {
    ui: {
      resourceUri: CONSOLE_RESOURCE_URI,
    },
  },
};

const serverDetailTool: MCPTool = {
  name: "console_server_detail",
  description:
    "Read desired state, live observation, Docker/image evidence, security posture, and drift for one MCP server.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Stable server id from console_snapshot.fleet.servers.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

const runListTool: MCPTool = {
  name: "console_run_list",
  description:
    "List available engineering runs with separate execution and requirement-verdict states.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: {
    ...READ_ONLY_ANNOTATIONS,
    openWorldHint: false,
  },
};

const runDetailTool: MCPTool = {
  name: "console_run_detail",
  description:
    "Read execution stages, observations, requirement verdict state, and hashed evidence artifacts for one engineering run.",
  inputSchema: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Stable run id from console_run_list.",
      },
    },
    required: ["id"],
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: {
    ...READ_ONLY_ANNOTATIONS,
    openWorldHint: false,
  },
};

const consoleRefreshTool: MCPTool = {
  name: "console_refresh",
  description:
    "Refresh the console's read-only probes. This tool is visible only to the MCP App.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  return value;
}
