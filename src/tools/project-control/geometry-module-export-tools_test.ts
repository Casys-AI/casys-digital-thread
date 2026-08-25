import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectGeometryModuleExportTools } from "./geometry-module-export-tools.ts";

Deno.test("geometry-module export tools register only when the use case is composed", () => {
  const absent = new CapturingApp();
  registerProjectGeometryModuleExportTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_geometry_module_export"), false);

  const present = new CapturingApp();
  registerProjectGeometryModuleExportTools(present as unknown as McpApp, {
    geometryModuleExport: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.toolNames(), ["project_geometry_module_export"]);
});

Deno.test("project_geometry_module_export names only the closed public command and teaches the next step", () => {
  const app = new CapturingApp();
  registerProjectGeometryModuleExportTools(app as unknown as McpApp, {
    geometryModuleExport: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const tool = app.tool("project_geometry_module_export");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties).sort(), [
    "basis",
    "partDefinitionElementId",
    "placementAnalysis",
    "projectId",
  ]);
  assertEquals(input.required, [
    "projectId",
    "basis",
    "partDefinitionElementId",
    "placementAnalysis",
  ]);
  assertEquals("workspaceRevision" in input.properties, false);
  assertEquals("sourceText" in input.properties, false);
  assertEquals("manifest" in input.properties, false);
  assertEquals("children" in input.properties, false);
  assertEquals("provider" in input.properties, false);
  assertEquals("profile" in input.properties, false);
  assertEquals("runtime" in input.properties, false);
  assertEquals(
    "pattern" in
      (input.properties.partDefinitionElementId as Record<string, unknown>),
    false,
  );
  assertStringIncludes(tool.description, "design.write-geometry@1");
  assertStringIncludes(tool.description, "decisionParameters");
  assertStringIncludes(tool.description, "workspaceRevision");
  assertStringIncludes(tool.description, "source text");
  assertStringIncludes(tool.description, "manifests");
  assertStringIncludes(tool.description, "grants none");
});

Deno.test("project_geometry_module_export returns grants none from the use case", async () => {
  const app = new CapturingApp();
  registerProjectGeometryModuleExportTools(app as unknown as McpApp, {
    geometryModuleExport: {
      execute: () =>
        Promise.resolve({
          draftDigest: "a".repeat(64),
          target: {
            partDefinitionElementId: "sysml.part.assembly",
            label: "Assembly",
            files: [],
          },
          decisionParameters: [],
          grants: "none",
        }),
    },
  });
  const response = await app.handler("project_geometry_module_export")({
    projectId: "project.module",
  }) as { structuredContent: { grants?: unknown } };
  assertEquals(response.structuredContent.grants, "none");
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<
    string,
    (args: Record<string, unknown>) => unknown
  >();

  registerTool(
    tool: MCPTool,
    handler: (args: Record<string, unknown>) => unknown,
  ) {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
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

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (handler === undefined) {
      throw new Error(`Expected ${name} handler to be registered.`);
    }
    return handler;
  }
}
