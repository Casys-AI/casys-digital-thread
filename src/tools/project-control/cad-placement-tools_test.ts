import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectCadPlacementTools } from "./cad-placement-tools.ts";

Deno.test("CAD placement tools register capture independently", () => {
  const absent = new CapturingApp();
  registerProjectCadPlacementTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_cad_placement_capture"), false);

  const captureOnly = new CapturingApp();
  registerProjectCadPlacementTools(captureOnly as unknown as McpApp, {
    cadPlacementCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(captureOnly.toolNames(), ["project_cad_placement_capture"]);
});

Deno.test("project_cad_placement_capture names only the exact attachment head", () => {
  const app = new CapturingApp();
  registerProjectCadPlacementTools(app as unknown as McpApp, {
    cadPlacementCapture: {
      capture: () => Promise.reject(new Error("not called")),
    },
  });
  const input = app.tool("project_cad_placement_capture").inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties).sort(), [
    "attachmentId",
    "attachmentRevision",
    "projectId",
    "workspaceRevision",
  ]);
  assertEquals(input.required, [
    "projectId",
    "workspaceRevision",
    "attachmentId",
    "attachmentRevision",
  ]);
  assertEquals("fileId" in input.properties, false);
  assertEquals("sourceText" in input.properties, false);
  assertEquals("resourceRef" in input.properties, false);

  const output = app.tool("project_cad_placement_capture").outputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(output.additionalProperties, false);
  assertEquals(output.required, ["schemaVersion", "status", "grants"]);
  assertEquals(output.properties.grants, { const: "none" });
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  registerTool(
    tool: MCPTool,
    _handler: (args: Record<string, unknown>) => unknown,
  ) {
    this.#tools.set(tool.name, tool);
  }
  hasTool(name: string) {
    return this.#tools.has(name);
  }
  toolNames() {
    return [...this.#tools.keys()];
  }
  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    if (tool === undefined) throw new Error(`Expected ${name} to be registered.`);
    return tool;
  }
}
