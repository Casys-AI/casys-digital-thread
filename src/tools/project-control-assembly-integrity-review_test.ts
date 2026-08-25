import { assertEquals } from "@std/assert";
import type { McpApp, MCPTool } from "@casys/mcp-server";
import {
  type ProjectControlToolDependencies,
  registerProjectControlTools,
} from "./project-control.ts";

Deno.test("project-control exposes assembly-integrity review only when its read-only dependency is composed", () => {
  const absent = new CapturingApp();
  registerProjectControlTools(
    absent as unknown as McpApp,
    dependencies({}) as ProjectControlToolDependencies,
  );
  assertEquals(absent.hasTool("project_assembly_integrity_review"), false);

  const present = new CapturingApp();
  registerProjectControlTools(
    present as unknown as McpApp,
    dependencies({
      assemblyIntegrityReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
    }) as ProjectControlToolDependencies,
  );
  assertEquals(present.hasTool("project_assembly_integrity_review"), true);
});

Deno.test("project-control exposes the L4 assembly-integrity review only when composed", () => {
  const absent = new CapturingApp();
  registerProjectControlTools(
    absent as unknown as McpApp,
    dependencies({}) as ProjectControlToolDependencies,
  );
  assertEquals(
    absent.hasTool("project_assembly_integrity_evaluation_review"),
    false,
  );

  const present = new CapturingApp();
  registerProjectControlTools(
    present as unknown as McpApp,
    dependencies({
      assemblyIntegrityEvaluationReview: {
        execute: () => Promise.reject(new Error("not called")),
      },
    }) as ProjectControlToolDependencies,
  );
  assertEquals(
    present.hasTool("project_assembly_integrity_evaluation_review"),
    true,
  );
});

function dependencies(
  optional: Record<string, unknown>,
): ProjectControlToolDependencies {
  return {
    projects: { get: () => Promise.resolve(undefined) },
    commands: {},
    ...optional,
  } as unknown as ProjectControlToolDependencies;
}

class CapturingApp {
  readonly #tools = new Map<string, MCPTool>();

  registerTool(tool: MCPTool, _handler: (args: Record<string, unknown>) => unknown) {
    this.#tools.set(tool.name, tool);
  }

  hasTool(name: string) {
    return this.#tools.has(name);
  }
}
