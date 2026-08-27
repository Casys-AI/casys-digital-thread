import { assertEquals } from "@std/assert";
import type { McpApp } from "@casys/mcp-server";
import { registerProjectDemoLoopTools } from "./demo-loop-tools.ts";

class CapturingApp {
  readonly tools: Array<{ name: string }> = [];
  registerTool(tool: { name: string }) {
    this.tools.push(tool);
  }
  hasTool(name: string) {
    return this.tools.some((tool) => tool.name === name);
  }
}

Deno.test("demo-loop review tools register only when their use cases are composed", () => {
  const absent = new CapturingApp();
  registerProjectDemoLoopTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_sensitivity_base_evaluation_review"), false);
  assertEquals(absent.hasTool("project_corrected_admission_review"), false);

  const present = new CapturingApp();
  registerProjectDemoLoopTools(present as unknown as McpApp, {
    sensitivityBaseEvaluationReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.hasTool("project_sensitivity_base_evaluation_review"), true);
  assertEquals(present.hasTool("project_corrected_admission_review"), false);
});
