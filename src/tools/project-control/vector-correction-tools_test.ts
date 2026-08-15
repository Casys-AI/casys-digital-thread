import { assertEquals } from "@std/assert";
import type { McpApp } from "@casys/mcp-server";
import { registerProjectVectorCorrectionTools } from "./vector-correction-tools.ts";

class CapturingApp {
  readonly tools: Array<{ name: string }> = [];
  registerTool(tool: { name: string }) {
    this.tools.push(tool);
  }
  hasTool(name: string) {
    return this.tools.some((tool) => tool.name === name);
  }
}

Deno.test("project_vector_correction_review is registered only when the review use case is composed", () => {
  const absent = new CapturingApp();
  registerProjectVectorCorrectionTools(absent as unknown as McpApp, {});
  assertEquals(absent.hasTool("project_vector_correction_review"), false);

  const present = new CapturingApp();
  registerProjectVectorCorrectionTools(present as unknown as McpApp, {
    vectorCorrectionReview: {
      execute: () => Promise.reject(new Error("not called")),
    },
  });
  assertEquals(present.hasTool("project_vector_correction_review"), true);
});
