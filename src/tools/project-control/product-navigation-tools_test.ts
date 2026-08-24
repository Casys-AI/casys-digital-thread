import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { registerProjectProductNavigationTools } from "./product-navigation-tools.ts";
import { PRODUCT_NAVIGATION_QUERY_SCHEMA } from "../../application/ports/in/product-navigation/product-navigation-read-model.ts";

Deno.test("product navigation tools are absent until the use case is composed", () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {});
  assertEquals(app.names, []);
});

Deno.test("product navigation tools are read-only and refuse latest in their schemas", () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {
    productNavigation: {
      roots: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          roots: [],
        }),
      children: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          parent: {
            kind: "part-definition",
            id: "x",
            label: "x",
            definitionId: "x",
            path: [],
            expandable: false,
          },
          children: [],
        }),
      path: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          nodes: [],
        }),
      search: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          matches: [],
        }),
      neighborhood: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          node: {
            kind: "part-definition",
            id: "x",
            label: "x",
            definitionId: "x",
            path: [],
            expandable: false,
          },
          siblings: [],
          children: [],
        }),
      context: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          node: {
            kind: "part-definition",
            id: "x",
            label: "x",
            definitionId: "x",
            path: [],
            expandable: false,
          },
          attachments: {
            sources: [],
            geometry: [],
            physics: [],
            requirements: [],
          },
        }),
      sourceClosure: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          files: [],
          edges: [],
        }),
      projection: () =>
        Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "unavailable",
          roots: [],
          children: [],
          attachments: {
            sources: [],
            geometry: [],
            physics: [],
            requirements: [],
          },
        }),
    },
  });
  assertEquals(app.names.toSorted(), [
    "project_product_navigation_children",
    "project_product_navigation_context",
    "project_product_navigation_neighborhood",
    "project_product_navigation_path",
    "project_product_navigation_roots",
    "project_product_navigation_search",
    "project_product_source_closure",
  ]);
  const pathSchema = app.tool("project_product_navigation_path")
    .inputSchema as {
      required: string[];
      additionalProperties: boolean;
      properties: { usagePath: { items: { not: { const: string } } } };
    };
  assertEquals(pathSchema.required, ["projectId", "usagePath"]);
  assertEquals(pathSchema.additionalProperties, false);
  assertEquals(pathSchema.properties.usagePath.items.not, { const: "latest" });
  for (const name of app.names) {
    assertEquals(app.tool(name).annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    const schema = app.tool(name).inputSchema as {
      additionalProperties: boolean;
      properties: Record<string, unknown> & {
        projectId: { not: { const: string } };
      };
    };
    assertEquals(schema.properties.projectId.not, { const: "latest" });
    assertEquals(schema.additionalProperties, false);
    assertEquals("snapshotId" in schema.properties, false);
    assertEquals("provider" in schema.properties, false);
    assertEquals("runtime" in schema.properties, false);
  }
});

Deno.test("product navigation roots tool forwards the use case structured result", async () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {
    productNavigation: {
      roots: (query) => {
        assertEquals(query.projectId, "project.slider");
        return Promise.resolve({
          schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
          status: "observed",
          basis: {
            projectId: "project.slider",
            threadSnapshotId: "thread:slider:r4",
            threadRevision: 4,
            architectureArtifactId: "architecture-" + "1".repeat(64),
            architectureFingerprint: `sha256:${"1".repeat(64)}`,
            captureSchema: "architecture-capture/4.0",
          },
          roots: [{
            kind: "part-definition",
            id: "def-system",
            label: "Slider",
            definitionId: "def-system",
            path: [],
            expandable: true,
          }],
        });
      },
      children: () => Promise.reject(new Error("must not children")),
      path: () => Promise.reject(new Error("must not path")),
      search: () => Promise.reject(new Error("must not search")),
      neighborhood: () => Promise.reject(new Error("must not neighborhood")),
      context: () => Promise.reject(new Error("must not context")),
      sourceClosure: () => Promise.reject(new Error("must not closure")),
      projection: () => Promise.reject(new Error("must not projection")),
    },
  });
  const result = await app.handle("project_product_navigation_roots", {
    projectId: "project.slider",
  }) as {
    structuredContent: { status: string; roots: { id: string }[] };
  };
  assertEquals(result.structuredContent.status, "observed");
  assertEquals(result.structuredContent.roots[0]?.id, "def-system");
});

function capturingApp() {
  const names: string[] = [];
  const tools = new Map<string, MCPTool>();
  const handlers = new Map<string, ToolHandler>();
  return {
    names,
    tool: (name: string) => tools.get(name)!,
    registerTool(tool: MCPTool, handler: ToolHandler) {
      names.push(tool.name);
      tools.set(tool.name, tool);
      handlers.set(tool.name, handler);
    },
    handle(name: string, args: Record<string, unknown>) {
      return handlers.get(name)!(args, {} as never);
    },
  };
}
