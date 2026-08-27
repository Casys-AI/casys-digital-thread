import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { registerProjectSourceWorkspaceTools } from "./project-source-workspace-tools.ts";
import { PROJECT_SOURCE_WORKSPACE_BOUNDS } from "../../domain/project-source-workspace/types.ts";

Deno.test("source workspace tools are absent until the use case is composed", () => {
  const app = capturingApp();
  registerProjectSourceWorkspaceTools(app as unknown as McpApp, {});
  assertEquals(app.names, []);
});

Deno.test("source workspace tools register closed schemas without path, provider or runtime authority", async () => {
  const app = capturingApp();
  let listedQuery: unknown;
  registerProjectSourceWorkspaceTools(app as unknown as McpApp, {
    sourceWorkspace: {
      putModule: () => Promise.resolve({ grants: "none" }),
      putFile: () => Promise.resolve({ grants: "none" }),
      removeFile: () => Promise.resolve({ grants: "none" }),
      putAttachment: () => Promise.resolve({ grants: "none" }),
      recrossAttachments: () =>
        Promise.resolve({
          workspaceRevision: 4,
          attachments: [{ attachmentId: "att-rail" }],
          grants: "none",
        }),
      detachAttachment: () => Promise.resolve({ grants: "none" }),
      snapshot: () => Promise.resolve({ grants: "none" }),
      tree: () => Promise.resolve({ grants: "none" }),
      search: () => Promise.resolve({ grants: "none" }),
      readAttachment: () => Promise.resolve({ grants: "none" }),
      listAttachments: (value: unknown) => {
        listedQuery = value;
        return Promise.resolve({
          workspaceRevision: 6,
          entries: [],
          nextCursor: null,
          grants: "none",
        });
      },
      readFile: (value: unknown) => {
        const query = value as { fileRevision: number };
        if (query.fileRevision === 2) {
          return Promise.resolve({
            workspaceRevision: 3,
            derivedPath: null,
            record: { kind: "tombstone" },
            grants: "none",
          });
        }
        return Promise.resolve({
          workspaceRevision: 3,
          derivedPath: "/mech/rail.py",
          record: {
            kind: "content",
            resourceRef: { uri: "casys://agent-resource-capture/sha256/a" },
          },
          grants: "none",
        });
      },
    } as never,
  });
  assertEquals(app.names.toSorted(), [
    "project_source_attachment_detach",
    "project_source_attachment_list",
    "project_source_attachment_put",
    "project_source_attachment_read",
    "project_source_attachment_recross",
    "project_source_file_put",
    "project_source_file_read",
    "project_source_file_remove",
    "project_source_module_put",
    "project_source_search",
    "project_source_tree",
    "project_source_workspace_snapshot",
  ]);
  for (
    const name of [
      "project_source_workspace_snapshot",
      "project_source_tree",
      "project_source_search",
      "project_source_file_read",
      "project_source_attachment_read",
      "project_source_attachment_list",
    ]
  ) {
    assertEquals(app.tool(name).annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  for (
    const name of [
      "project_source_module_put",
      "project_source_file_put",
      "project_source_file_remove",
      "project_source_attachment_put",
      "project_source_attachment_recross",
      "project_source_attachment_detach",
    ]
  ) {
    assertEquals(app.tool(name).annotations, {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  }
  const filePut = app.tool("project_source_file_put");
  const schema = filePut.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(schema.additionalProperties, false);
  assertEquals("path" in schema.properties, false);
  assertEquals("sourceText" in schema.properties, false);
  assertEquals("provider" in schema.properties, false);
  assertEquals("runtime" in schema.properties, false);
  assertEquals("image" in schema.properties, false);
  assertEquals("tool" in schema.properties, false);
  assertEquals("capture" in schema.properties, false);
  assertEquals("captureRequest" in schema.properties, true);
  assertEquals(schema.required.includes("resourceRef"), true);
  assertEquals("workspaceRevision" in schema.properties, false);
  const tree = app.tool("project_source_tree").inputSchema as {
    required: string[];
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  assertEquals(tree.additionalProperties, false);
  assertEquals(tree.required, ["projectId", "workspaceRevision"]);
  assertEquals(
    (tree.properties.cursor as { maxLength: number }).maxLength,
    PROJECT_SOURCE_WORKSPACE_BOUNDS.maxCursorLength,
  );
  const search = app.tool("project_source_search").inputSchema as {
    required: string[];
    properties: Record<string, unknown>;
    additionalProperties: boolean;
  };
  assertEquals(search.additionalProperties, false);
  assertEquals(search.required, ["projectId", "workspaceRevision"]);
  assertEquals("captureProfileId" in search.properties, false);
  assertEquals("profileId" in search.properties, true);
  assertEquals(
    (search.properties.pathPrefix as { maxLength: number }).maxLength,
    PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDerivedPathLength,
  );
  assertEquals(
    (search.properties.pathPrefix as { pattern: string }).pattern,
    "^/",
  );
  const snapshotOut = app.tool("project_source_workspace_snapshot").outputSchema as {
    properties: { grants: { const: string } };
    additionalProperties: boolean;
  };
  assertEquals(snapshotOut.properties.grants.const, "none");
  const attachmentPut = app.tool("project_source_attachment_put");
  const attachmentSchema = attachmentPut.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(attachmentSchema.additionalProperties, false);
  assertEquals("path" in attachmentSchema.properties, false);
  assertEquals("provider" in attachmentSchema.properties, false);
  assertEquals("runtime" in attachmentSchema.properties, false);
  assertEquals("latest" in attachmentSchema.properties, false);
  assertEquals(attachmentSchema.required.includes("declaredAgainst"), true);
  const attachmentRecross = app.tool("project_source_attachment_recross");
  const recrossSchema = attachmentRecross.inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(recrossSchema.additionalProperties, false);
  assertEquals(
    recrossSchema.required,
    ["projectId", "mutationId", "expectedWorkspaceRevision", "attachments"],
  );
  assertEquals("fileId" in recrossSchema.properties, false);
  assertEquals("role" in recrossSchema.properties, false);
  assertEquals("target" in recrossSchema.properties, false);
  assertEquals("declaredAgainst" in recrossSchema.properties, false);
  const recrossItems = recrossSchema.properties.attachments as {
    minItems: number;
    maxItems: number;
    items: { additionalProperties: boolean; required: string[] };
  };
  assertEquals(recrossItems.minItems, 1);
  assertEquals(
    recrossItems.maxItems,
    PROJECT_SOURCE_WORKSPACE_BOUNDS.maxAttachmentRecrossItems,
  );
  assertEquals(recrossItems.items.additionalProperties, false);
  assertEquals(
    recrossItems.items.required,
    ["attachmentId", "activeAttachmentRevision"],
  );
  const recrossOutput = attachmentRecross.outputSchema as {
    additionalProperties: boolean;
    required: string[];
  };
  assertEquals(recrossOutput.additionalProperties, false);
  assertEquals(recrossOutput.required.includes("workspaceEventFingerprint"), true);
  const recrossed = await app.handler("project_source_attachment_recross")({
    projectId: "p",
    mutationId: "recross-1",
    expectedWorkspaceRevision: 3,
    attachments: [{ attachmentId: "att-rail", activeAttachmentRevision: 1 }],
  }) as { content: string };
  assertStringIncludes(recrossed.content, "server derived");
  const list = app.tool("project_source_attachment_list").inputSchema as {
    additionalProperties: boolean;
    required: string[];
    properties: Record<string, unknown>;
  };
  assertEquals(list.additionalProperties, false);
  assertEquals(list.required, ["projectId", "workspaceRevision"]);
  assertEquals("fileId" in list.properties, true);
  assertEquals("target" in list.properties, true);
  assertEquals(list.required.includes("fileId"), false);
  assertEquals(list.required.includes("target"), false);
  assertStringIncludes(
    app.tool("project_source_attachment_list").description,
    "Zero or one filter",
  );
  assertStringIncludes(
    app.tool("project_source_attachment_list").description,
    "Both fail closed",
  );
  const listed = await app.handler("project_source_attachment_list")({
    projectId: "p",
    workspaceRevision: 6,
  }) as { content: string };
  assertEquals(listedQuery, { projectId: "p", workspaceRevision: 6 });
  assertStringIncludes(listed.content, "workspace revision 6");
  assertStringIncludes(listed.content, "0 active heads");
  for (
    const name of [
      "project_source_tree",
      "project_source_search",
      "project_source_file_read",
      "project_source_attachment_read",
      "project_source_attachment_list",
    ]
  ) {
    const output = app.tool(name).outputSchema as {
      additionalProperties: boolean;
      required: string[];
    };
    assertEquals(output.additionalProperties, false);
    assertEquals(output.required.includes("grants"), true);
  }
  const fileReadOut = app.tool("project_source_file_read").outputSchema as {
    properties: {
      record: { oneOf: Array<{ properties: { kind: { const: string } } }> };
    };
  };
  assertEquals(
    fileReadOut.properties.record.oneOf.map((item) => item.properties.kind.const)
      .toSorted(),
    ["content", "tombstone"],
  );
  const content = await app.handler("project_source_file_read")({
    fileId: "file-rail",
    fileRevision: 1,
  }) as { content: string };
  assertStringIncludes(content.content, "resources/read");
  const tombstone = await app.handler("project_source_file_read")({
    fileId: "file-rail",
    fileRevision: 2,
  }) as { content: string };
  assertStringIncludes(tombstone.content, "Tombstone");
  assertEquals(tombstone.content.includes("Read bytes through"), false);
});

function capturingApp() {
  const names: string[] = [];
  const tools = new Map<string, MCPTool>();
  const handlers = new Map<string, ToolHandler>();
  return {
    names,
    registerTool(tool: MCPTool, handler: ToolHandler): void {
      names.push(tool.name);
      tools.set(tool.name, tool);
      handlers.set(tool.name, handler);
    },
    tool(name: string): MCPTool {
      return tools.get(name)!;
    },
    handler(name: string): ToolHandler {
      return handlers.get(name)!;
    },
  };
}
