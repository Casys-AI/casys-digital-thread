import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectRequirementsRecaptureReviewTools } from "./requirements-recapture-review-tools.ts";

Deno.test("requirements recapture review tool registers only with its exact read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectRequirementsRecaptureReviewTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_requirements_recapture_review"), false);

  const present = new CapturingApp();
  registerProjectRequirementsRecaptureReviewTools(present as unknown as McpApp, {
    requirementsRecaptureReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.toolNames(), ["project_requirements_recapture_review"]);
});

Deno.test("project_requirements_recapture_review accepts projectId and optional targetElementId", () => {
  const app = new CapturingApp();
  registerProjectRequirementsRecaptureReviewTools(app as unknown as McpApp, {
    requirementsRecaptureReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const tool = app.tool("project_requirements_recapture_review");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties), ["projectId", "targetElementId"]);
  assertEquals(input.required, ["projectId"]);
  for (
    const forbidden of [
      "provider",
      "runtime",
      "sourceText",
      "editingContextId",
      "elementId",
      "latest",
    ]
  ) {
    assertEquals(forbidden in input.properties, false);
  }
  assertStringIncludes(tool.description, "model.recapture-requirements@1");
  assertStringIncludes(tool.description, "targetElementId");
  assertStringIncludes(tool.description, "does not call SysON");
});

Deno.test("project_requirements_recapture_review forwards projectId and targetElementId", async () => {
  const app = new CapturingApp();
  const calls: Record<string, unknown>[] = [];
  registerProjectRequirementsRecaptureReviewTools(app as unknown as McpApp, {
    requirementsRecaptureReview: {
      execute: (args) => {
        calls.push(args as Record<string, unknown>);
        return Promise.resolve({
          status: "unresolved" as const,
          diagnostics: [{
            code: "predecessor-absent" as const,
            message: "none",
          }],
        });
      },
    },
  });
  const args = {
    projectId: "project-id01",
    targetElementId: "part-definition:camera-mount",
  };
  const response = await app.handler("project_requirements_recapture_review")(
    args,
  ) as { structuredContent: { status?: unknown } };
  assertEquals(calls, [args]);
  assertEquals(response.structuredContent.status, "unresolved");
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => unknown) {
    this.#tools.set(tool.name, tool);
    this.#handlers.set(tool.name, handler);
  }

  hasTool(name: string): boolean {
    return this.#tools.has(name);
  }

  toolNames(): string[] {
    return [...this.#tools.keys()];
  }

  tool(name: string): MCPTool {
    const tool = this.#tools.get(name);
    if (!tool) throw new Error(`missing tool ${name}`);
    return tool;
  }

  handler(name: string): (args: Record<string, unknown>) => unknown {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`missing handler ${name}`);
    return handler;
  }
}
