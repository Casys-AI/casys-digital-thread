import type { McpApp, MCPTool } from "@casys/mcp-server";
import type { ControlPlane } from "../application/control-plane/control-plane.ts";

/** Retired human MCP App URI. The server must not register this resource. */
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

/**
 * Register ops `console_*` tools for the control-plane application service.
 * Not a human page: `preview:browser` refuses and this must not register
 * `CONSOLE_RESOURCE_URI`.
 */
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
      content: `${run.name}: ${
        runStatusSummary(run.status)
      }; comparison verdict ${run.verdictStatus}. Source: ${run.source}.`,
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
    "Read the Casys digital-thread operational snapshot: desired versus observed MCP fleet and run summaries.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
  },
  outputSchema: OBJECT_OUTPUT_SCHEMA,
  annotations: READ_ONLY_ANNOTATIONS,
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
    "List available engineering runs with separate execution and comparison-verdict states.",
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
    "Read execution stages, observations, comparison verdict state, and hashed evidence artifacts for one engineering run.",
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
    "Refresh the control-plane's read-only probes. App-only leftover; no shipped App calls it.",
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

function runStatusSummary(status: string): string {
  return status === "documentary"
    ? "documentary record (no dispatch attested)"
    : `execution ${status}`;
}
