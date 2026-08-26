import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { registerProjectProductNavigationTools } from "./product-navigation-tools.ts";
import {
  PRODUCT_EXPLORE_SCHEMA,
  PRODUCT_INSPECT_SCHEMA,
  PRODUCT_SEARCH_SCHEMA,
  PRODUCT_SOURCE_CLOSURE_SCHEMA,
} from "../../application/ports/in/product-navigation/product-navigation-read-model.ts";
import type { ProductNavigationUseCase } from "../../application/ports/in/product-navigation/product-navigation.ts";

const OLD_TOOLS = [
  "project_product_navigation_authoring_attachments",
  "project_product_navigation_children",
  "project_product_navigation_context",
  "project_product_navigation_neighborhood",
  "project_product_navigation_path",
  "project_product_navigation_roots",
  "project_product_navigation_search",
  "project_product_source_closure",
] as const;

Deno.test("product navigation tools are absent until the use case is composed", () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {});
  assertEquals(app.names, []);
});

Deno.test("product navigation tools are the four closed AX reads and refuse latest", () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {
    productNavigation: stubUseCase(),
  });
  assertEquals(app.names.toSorted(), [
    "project_product_explore",
    "project_product_inspect",
    "project_product_search",
    "project_source_closure",
  ]);
  for (const retired of OLD_TOOLS) {
    assertEquals(app.names.includes(retired), false);
  }
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
    const output = app.tool(name).outputSchema as {
      additionalProperties: boolean;
      required: string[];
    };
    assertEquals(output.additionalProperties, false);
  }
  const explore = app.tool("project_product_explore").inputSchema as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(explore.required, ["projectId"]);
  assertEquals("expectedBasis" in explore.properties, true);
  assertEquals("selection" in explore.properties, true);
  const inspect = app.tool("project_product_inspect").inputSchema as {
    required: string[];
    properties: { expectedBasis: { required: string[] } };
  };
  assertEquals(inspect.required, ["projectId", "expectedBasis", "selection"]);
  assertEquals(
    inspect.properties.expectedBasis.required.includes("threadSubjectId"),
    true,
  );
  const basis = inspect.properties.expectedBasis as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals("threadSubjectId" in basis.properties, true);
  const inspectOutput = app.tool("project_product_inspect").outputSchema as {
    properties: {
      applicableActions: {
        items: {
          oneOf: Array<{
            oneOf?: Array<{
              required: string[];
              properties: {
                code?: { const?: string };
                recoveryAction?: {
                  properties: {
                    tool: { const: string };
                    arguments: { required: string[]; additionalProperties: boolean };
                    callerSupplied: {
                      items: { const: string };
                      minItems: number;
                      maxItems: number;
                    };
                  };
                  additionalProperties: boolean;
                };
              };
              additionalProperties: boolean;
            }>;
          }>;
        };
      };
    };
  };
  const blockedSchemas = inspectOutput.properties.applicableActions.items.oneOf[1]
    .oneOf!;
  const differentBasis = blockedSchemas.find((schema) =>
    schema.properties.code?.const === "action.different-basis"
  )!;
  assertEquals(differentBasis.required, [
    "status",
    "kind",
    "code",
    "recovery",
    "recoveryAction",
  ]);
  const recoveryAction = differentBasis.properties.recoveryAction!;
  assertEquals(
    recoveryAction.properties.tool.const,
    "project_source_attachment_recross",
  );
  assertEquals(recoveryAction.properties.arguments.required, [
    "projectId",
    "expectedWorkspaceRevision",
    "attachments",
  ]);
  assertEquals(recoveryAction.properties.arguments.additionalProperties, false);
  assertEquals(recoveryAction.properties.callerSupplied.items.const, "mutationId");
  assertEquals(recoveryAction.properties.callerSupplied.minItems, 1);
  assertEquals(recoveryAction.properties.callerSupplied.maxItems, 1);
  assertEquals(recoveryAction.additionalProperties, false);
  const occurrencePath = (
    app.tool("project_product_explore").inputSchema as {
      properties: {
        selection: { properties: { path: { maxItems?: number } } };
      };
    }
  ).properties.selection.properties.path;
  assertEquals(occurrencePath.maxItems, undefined);
  const closure = app.tool("project_source_closure").inputSchema as {
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(closure.required, [
    "projectId",
    "expectedBasis",
    "selection",
    "workspaceRevision",
    "attachmentId",
    "attachmentRevision",
  ]);
  assertEquals("fileId" in closure.properties, false);
  const search = app.tool("project_product_search").inputSchema as {
    required: string[];
  };
  assertEquals(search.required, ["projectId", "query"]);
});

Deno.test("product explore tool forwards the use case structured result", async () => {
  const app = capturingApp();
  registerProjectProductNavigationTools(app as unknown as McpApp, {
    productNavigation: {
      ...stubUseCase(),
      explore: (query) => {
        assertEquals(query.projectId, "project.slider");
        return Promise.resolve({
          schemaVersion: PRODUCT_EXPLORE_SCHEMA,
          status: "observed",
          basis: sampleBasis(),
          diagnostics: [],
          focus: {
            element: { elementKind: "PartDefinition", elementId: "def-system" },
            label: "Slider",
            expandable: true,
          },
          breadcrumbs: [],
          children: [],
          nextCursor: null,
          grants: "none",
        });
      },
    },
  });
  const result = await app.handle("project_product_explore", {
    projectId: "project.slider",
  }) as {
    content: string;
    structuredContent: { status: string; focus: { element: { elementId: string } } };
  };
  assertEquals(result.structuredContent.status, "observed");
  assertEquals(result.structuredContent.focus.element.elementId, "def-system");
  assertEquals(result.content.includes("{"), false);
});

function stubUseCase(): ProductNavigationUseCase {
  return {
    explore: () =>
      Promise.resolve({
        schemaVersion: PRODUCT_EXPLORE_SCHEMA,
        status: "unavailable",
        diagnostics: [],
        breadcrumbs: [],
        children: [],
        nextCursor: null,
        grants: "none",
      }),
    search: () =>
      Promise.resolve({
        schemaVersion: PRODUCT_SEARCH_SCHEMA,
        status: "unavailable",
        diagnostics: [],
        matches: [],
        nextCursor: null,
        grants: "none",
      }),
    inspect: () =>
      Promise.resolve({
        schemaVersion: PRODUCT_INSPECT_SCHEMA,
        status: "unavailable",
        diagnostics: [],
        authoringAttachments: { attachments: [], nextCursor: null },
        occurrences: { occurrences: [], nextCursor: null },
        applicableActions: [],
        grants: "none",
      }),
    sourceClosure: () =>
      Promise.resolve({
        schemaVersion: PRODUCT_SOURCE_CLOSURE_SCHEMA,
        status: "unavailable",
        diagnostics: [],
        entries: [],
        fileCount: 0,
        edgeCount: 0,
        nextCursor: null,
        grants: "none",
      }),
    projection: () =>
      Promise.resolve({
        schemaVersion: "product-navigation-query/2.0",
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
  };
}

function sampleBasis() {
  return {
    projectId: "project.slider",
    threadSnapshotId: "thread:slider:r4",
    threadRevision: 4,
    threadSubjectId: "subject.slider",
    architectureArtifactId: "architecture-" + "1".repeat(64),
    architectureFingerprint: `sha256:${"1".repeat(64)}`,
    captureSchema: "architecture-capture/4.0" as const,
  };
}

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
