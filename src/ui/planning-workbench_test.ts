import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("planning Workbench is a native project-path surface, not an empty evidence viewer", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/planning-workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function PlanningWorkbench");
  assertStringIncludes(source, "ENGINEERING OBJECTIVE");
  assertStringIncludes(source, "PROJECT PATH");
  assertStringIncludes(source, "What the path contains");
  assertStringIncludes(source, "Technical baseline not created yet");
  assertStringIncludes(source, "planning.technicalBaseline.message");
  assertStringIncludes(source, "Review the path with your agent");

  for (
    const forbiddenEvidenceSurface of [
      "ThreadGraph",
      "ComponentWorkspace",
      "ToolInspectorPanel",
      "thread.graph",
      "thread.components",
    ]
  ) {
    assertEquals(
      source.includes(forbiddenEvidenceSurface),
      false,
      forbiddenEvidenceSurface,
    );
  }
});
