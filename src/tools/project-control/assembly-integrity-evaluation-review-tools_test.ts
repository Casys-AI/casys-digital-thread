import { assertEquals, assertStringIncludes } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import { registerProjectAssemblyIntegrityEvaluationReviewTools } from "./assembly-integrity-evaluation-review-tools.ts";

Deno.test("L4 assembly-integrity review tool registers only with its exact read-only use case", () => {
  const absent = new CapturingApp();
  registerProjectAssemblyIntegrityEvaluationReviewTools(
    absent as unknown as McpApp,
    {},
  );
  assertEquals(absent.hasTool("project_assembly_integrity_evaluation_review"), false);

  const present = new CapturingApp();
  registerProjectAssemblyIntegrityEvaluationReviewTools(present as unknown as McpApp, {
    assemblyIntegrityEvaluationReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.toolNames(), ["project_assembly_integrity_evaluation_review"]);
});

Deno.test("project_assembly_integrity_evaluation_review accepts projectId only", () => {
  const app = new CapturingApp();
  registerProjectAssemblyIntegrityEvaluationReviewTools(app as unknown as McpApp, {
    assemblyIntegrityEvaluationReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  const tool = app.tool("project_assembly_integrity_evaluation_review");
  const input = tool.inputSchema as {
    properties: Record<string, unknown>;
    required: unknown;
    additionalProperties: unknown;
  };
  assertEquals(input.additionalProperties, false);
  assertEquals(Object.keys(input.properties), ["projectId"]);
  assertEquals(input.required, ["projectId"]);
  for (
    const forbidden of [
      "provider",
      "tool",
      "profile",
      "runtime",
      "tolerance",
      "facts",
      "criteria",
      "verdict",
      "gateId",
      "latest",
    ]
  ) {
    assertEquals(forbidden in input.properties, false);
  }
  assertStringIncludes(tool.description, "verify.evaluate-assembly-integrity@1");
  assertStringIncludes(tool.description, "read-only");
  assertStringIncludes(tool.description, "no gate satisfaction");
});

Deno.test("project_assembly_integrity_evaluation_review forwards only projectId", async () => {
  const app = new CapturingApp();
  const calls: Record<string, unknown>[] = [];
  registerProjectAssemblyIntegrityEvaluationReviewTools(app as unknown as McpApp, {
    assemblyIntegrityEvaluationReview: {
      execute: (args) => {
        calls.push(args as Record<string, unknown>);
        return Promise.resolve({
          status: "unavailable" as const,
          projectId: "project-assembly",
          diagnostics: [],
          grants: "none" as const,
        });
      },
    },
  });
  const args = { projectId: "project-assembly" };
  const response = await app.handler("project_assembly_integrity_evaluation_review")(
    args,
  ) as {
    structuredContent: { grants?: unknown };
  };
  assertEquals(calls, [args]);
  assertEquals(response.structuredContent.grants, "none");
});

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();
  readonly #handlers = new Map<string, (args: Record<string, unknown>) => unknown>();

  registerTool(tool: MCPTool, handler: (args: Record<string, unknown>) => unknown) {
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
    if (!tool) throw new Error(`Expected ${name} to be registered.`);
    return tool;
  }

  handler(name: string) {
    const handler = this.#handlers.get(name);
    if (!handler) throw new Error(`Expected ${name} handler to be registered.`);
    return handler;
  }
}
