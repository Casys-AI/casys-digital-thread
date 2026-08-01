import { ErpNextToolsClient, FrappeAPIError } from "@casys/mcp-erpnext";
import {
  MCP_APP_MIME_TYPE,
  McpApp,
  type MCPTool,
  type ToolHandler,
} from "@casys/mcp-server";
import {
  BOM_SURFACE_RESOURCE_URI,
  BOM_SURFACE_TOOL,
  BOM_SURFACE_TOOL_NAME,
  createBomSurfaceHandler,
} from "./mod.ts";

const DEFAULT_PORT = 3017;

async function main(): Promise<void> {
  const http = Deno.args.includes("--http");
  const port = numberArg("--port", DEFAULT_PORT);
  const hostname = stringArg("--hostname", "127.0.0.1");
  const erpnext = new ErpNextToolsClient({ categories: ["manufacturing"] });
  const server = new McpApp({
    name: "mcp-erpnext-components",
    version: "0.1.0",
    transport: "stateless",
    maxConcurrent: 6,
    backpressureStrategy: "queue",
    validateSchema: true,
    logger: (message) => console.error(`[mcp-erpnext-components] ${message}`),
    toolErrorMapper: (error) => {
      if (error instanceof FrappeAPIError) return error.message;
      if (error instanceof Error) return error.message;
      return String(error);
    },
  });

  server.registerTools(
    [BOM_SURFACE_TOOL as unknown as MCPTool],
    new Map<string, ToolHandler>([[
      BOM_SURFACE_TOOL_NAME,
      createBomSurfaceHandler(erpnext),
    ]]),
  );

  const viewerUrl = new URL("./ui/dist/bom-surface/index.html", import.meta.url);
  server.registerResource(
    {
      uri: BOM_SURFACE_RESOURCE_URI,
      name: "ERPNext BOM components",
      description: "Component-only Preact surface for ERPNext BOM evidence.",
      mimeType: MCP_APP_MIME_TYPE,
    },
    async () => ({
      uri: BOM_SURFACE_RESOURCE_URI,
      mimeType: MCP_APP_MIME_TYPE,
      text: await Deno.readTextFile(viewerUrl),
    }),
  );

  if (http) {
    await server.startHttp({
      port,
      hostname,
      cors: true,
      onListen: ({ hostname, port }) => {
        console.error(
          `[mcp-erpnext-components] HTTP on http://${hostname}:${port}`,
        );
      },
    });
    return;
  }
  await server.start();
}

function stringArg(name: string, fallback: string): string {
  const value = Deno.args.find((arg) => arg.startsWith(`${name}=`));
  return value?.slice(name.length + 1) || fallback;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(stringArg(name, String(fallback)));
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : fallback;
}

main().catch((error) => {
  console.error("[mcp-erpnext-components] Fatal error", error);
  Deno.exit(1);
});
