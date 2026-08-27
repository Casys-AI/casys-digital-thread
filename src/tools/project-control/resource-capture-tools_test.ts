import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool, ToolHandler } from "@casys/mcp-server";
import { registerProjectResourceCaptureTools } from "./resource-capture-tools.ts";
import type { AgentResourceCaptureReview } from "../../domain/resource/agent-resource-capture.ts";

const REVIEW: AgentResourceCaptureReview = {
  schemaVersion: "agent-resource-capture-review/1.0",
  status: "captured",
  grants: "none",
  reference: {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${"a".repeat(64)}`,
    name: "notes.json",
    mimeType: "application/json",
    representation: "text",
    byteCount: 2,
    fingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
  },
  interpretation: { status: "raw", schemaVersion: null },
};

Deno.test("project_resource_capture schema forbids path, source bytes fields and authority", () => {
  const app = new CapturingApp();
  registerProjectResourceCaptureTools(app as unknown as McpApp, {
    resourceCapture: { capture: () => Promise.resolve(REVIEW) },
  });
  const tool = app.tool("project_resource_capture");
  const schema = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: boolean;
  };
  assertEquals(schema.additionalProperties, false);
  assertEquals(schema.required, ["name", "mimeType"]);
  assertEquals(
    Object.keys(schema.properties).toSorted(),
    ["blob", "mimeType", "name", "text"],
  );
  assertEquals("path" in schema.properties, false);
  assertEquals("sourceText" in schema.properties, false);
  assertEquals("projectId" in schema.properties, false);
  assertEquals("fingerprint" in schema.properties, false);
  assertEquals(tool.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  const output = tool.outputSchema as { properties: Record<string, unknown> };
  assertEquals((output.properties.grants as { const: string }).const, "none");
});

Deno.test("project_resource_capture returns a resource_link after a text summary", async () => {
  const app = new CapturingApp();
  const exposed: string[] = [];
  registerProjectResourceCaptureTools(app as unknown as McpApp, {
    resourceCapture: { capture: () => Promise.resolve(REVIEW) },
    resourceExposure: {
      expose: (reference) => {
        exposed.push(reference.uri);
        return Promise.resolve();
      },
      restore: () => Promise.resolve(),
    },
  });
  const result = await app.handler("project_resource_capture")({
    name: "notes.json",
    mimeType: "application/json",
    text: "{}",
  }) as {
    content: Array<Record<string, unknown>>;
    structuredContent: AgentResourceCaptureReview;
  };
  assertEquals(result.content[0]?.type, "text");
  assertStringIncludes(String(result.content[0]?.text), "raw MCP resource");
  assertEquals(result.content[1], {
    type: "resource_link",
    uri: REVIEW.reference.uri,
    name: "notes.json",
    mimeType: "application/json",
    size: 2,
  });
  assertEquals(result.structuredContent.grants, "none");
  assertEquals(exposed, [REVIEW.reference.uri]);
  assert(result.structuredContent.interpretation.typed === undefined);
});

class CapturingApp {
  readonly #tools = new Map<string, { tool: MCPTool; handler: ToolHandler }>();

  registerTool(tool: MCPTool, handler: ToolHandler): void {
    this.#tools.set(tool.name, { tool, handler });
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  tool(name: string): MCPTool {
    return this.#tools.get(name)!.tool;
  }

  handler(name: string): ToolHandler {
    return this.#tools.get(name)!.handler;
  }
}
