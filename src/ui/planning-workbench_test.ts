import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("planning Workbench is a native project-path surface, not an empty evidence viewer", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/planning-workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function PlanningWorkbench");
  assertStringIncludes(source, "ENGINEERING OBJECTIVE");
  assertStringIncludes(source, "PROJECT PATH");
  assertStringIncludes(source, "What the path contains");
  assertStringIncludes(source, "Documentary baseline not created yet");
  assertStringIncludes(source, "baseline.message");
  assertStringIncludes(source, "Review the path with your agent");
  assertStringIncludes(source, "BaselineRunActivity");

  const threadWorkbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(threadWorkbench, "shouldAcceptPlanningActivityUpdate");

  const activity = await Deno.readTextFile(
    new URL("./src/project/baseline-run-activity.tsx", import.meta.url),
  );
  assertStringIncludes(activity, "FIRST BASELINE RUN");
  assertStringIncludes(activity, "LIVE ACTIVITY");
  assertStringIncludes(activity, "statusHistory");

  for (
    const forbiddenEvidenceSurface of [
      "ThreadGraph",
      "ComponentWorkspace",
      "ToolInspectorPanel",
      "thread.graph",
      "thread.components",
      "ThreadGraph",
      "ToolInspectorPanel",
      "structuredContent",
      "callTool(",
    ]
  ) {
    assertEquals(
      source.includes(forbiddenEvidenceSurface),
      false,
      forbiddenEvidenceSurface,
    );
    assertEquals(
      activity.includes(forbiddenEvidenceSurface),
      false,
      `activity ${forbiddenEvidenceSurface}`,
    );
  }
});
