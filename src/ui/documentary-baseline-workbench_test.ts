import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("documentary baseline Workbench is a quiet provenance record, not an evidence dashboard", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/documentary-baseline-workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function DocumentaryBaselineWorkbench");
  assertStringIncludes(source, "DURABLE STARTING RECORD");
  assertStringIncludes(source, "WHAT THIS DOES NOT PROVE");
  assertStringIncludes(source, "Exact documentary record");
  assertStringIncludes(source, "No SysML model or CAD geometry is recorded.");

  for (
    const forbiddenEvidenceViewer of [
      "ThreadGraph",
      "ThreadFeed",
      "ComponentWorkspace",
      "ToolInspectorPanel",
      "thread.graph",
      "thread.components",
      "callTool(",
    ]
  ) {
    assertEquals(
      source.includes(forbiddenEvidenceViewer),
      false,
      forbiddenEvidenceViewer,
    );
  }

  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(workbench, "DocumentaryBaselineWorkbench");
  assertStringIncludes(workbench, 'workbench.surface === "documentary"');
});
