import { assertEquals } from "@std/assert";
import type { SourceAnalysisBundle } from "../../domain/compile/source/source-analysis.ts";
import { registerProjectArchitectureSysmlTools } from "./architecture-sysml-tools.ts";

Deno.test("architecture SysML tools are absent until both seams are composed", () => {
  const absent = fakeApp();
  registerProjectArchitectureSysmlTools(absent as never, {});
  assertEquals(absent.hasTool("project_architecture_sysml_source_capture"), false);
  assertEquals(absent.hasTool("project_architecture_sysml_preview"), false);
});

Deno.test("architecture SysML capture requires resourceRef and preview requires sourceRef", () => {
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
          sourceRef: {},
        }),
    },
  });
  const capture = app.tool("project_architecture_sysml_source_capture");
  const captureInput = capture.inputSchema as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assertEquals(
    Object.keys(captureInput.properties).sort(),
    ["profileId", "resourceRef", "sourceId"],
  );
  assertEquals(captureInput.required, ["profileId", "sourceId", "resourceRef"]);
  assertEquals("sourceText" in captureInput.properties, false);
  const preview = app.tool("project_architecture_sysml_preview");
  const previewInput = preview.inputSchema as {
    properties: Record<string, unknown>;
    required: string[];
  };
  assertEquals(Object.keys(previewInput.properties), ["sourceRef"]);
  assertEquals(previewInput.required, ["sourceRef"]);
  assertEquals("sourceText" in previewInput.properties, false);
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
          sourceRef: {},
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
  const tools = new Map<string, { name: string; inputSchema: unknown }>();
  return {
    names,
    hasTool(name: string): boolean {
      return names.includes(name);
    },
    tool(name: string) {
      return tools.get(name)!;
    },
    registerTool(
      tool: { name: string; inputSchema: unknown },
      _handler: unknown,
    ): void {
      names.push(tool.name);
      tools.set(tool.name, tool);
    },
  };
}
