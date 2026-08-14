import { assertEquals } from "@std/assert";
import type { SourceAnalysisBundle } from "../../domain/analysis/source-analysis.ts";
import { registerProjectArchitectureSysmlTools } from "./architecture-sysml-tools.ts";

Deno.test("architecture SysML tools are absent until both seams are composed", () => {
  const absent = fakeApp();
  registerProjectArchitectureSysmlTools(absent as never, {});
  assertEquals(absent.hasTool("project_architecture_sysml_source_capture"), false);
  assertEquals(absent.hasTool("project_architecture_sysml_preview"), false);
});

Deno.test("architecture SysML tools register capture and preview independently", () => {
  const app = fakeApp();
  registerProjectArchitectureSysmlTools(app as never, {
    architectureSysmlSourceCapture: {
      capture: () => Promise.resolve({ captured: true }),
    },
    architectureSysmlPreview: {
      execute: () =>
        Promise.resolve({
          status: "ready-for-review",
          analysis: {} as SourceAnalysisBundle,
          unresolvedConstructs: [],
        }),
    },
  });
  assertEquals(app.names.sort(), [
    "project_architecture_sysml_preview",
    "project_architecture_sysml_source_capture",
  ]);
});

function fakeApp() {
  const names: string[] = [];
  return {
    names,
    hasTool(name: string): boolean {
      return names.includes(name);
    },
    registerTool(tool: { name: string }, _handler: unknown): void {
      names.push(tool.name);
    },
  };
}
