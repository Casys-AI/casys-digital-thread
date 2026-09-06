import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("planning Workbench is a native project-path surface, not an empty evidence viewer", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/planning-workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function PlanningWorkbench");
  assertStringIncludes(source, "Living project brief");
  assertStringIncludes(source, "ProjectBriefElicitation");
  assertStringIncludes(source, "Project path");
  assertStringIncludes(source, "What the path contains");
  assertStringIncludes(source, "Documentary baseline not created yet");
  assertStringIncludes(source, "baseline.message");
  assertStringIncludes(source, "Review the path with your agent");
  assertStringIncludes(source, "BaselineRunActivity");
  assertStringIncludes(source, 'status === "planned"');
  assertStringIncludes(source, 'return "Planned"');

  const threadWorkbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(threadWorkbench, "shouldAcceptPlanningActivityUpdate");
  assertStringIncludes(
    threadWorkbench,
    'if (workbench?.surface !== "planning") return;',
  );
  assertStringIncludes(threadWorkbench, 'setActiveView("overview")');
  assertStringIncludes(threadWorkbench, "setActiveDeepLink(undefined)");
  assertStringIncludes(
    threadWorkbench,
    'globalThis.history.replaceState(null, "", overviewHash);',
  );
  assertStringIncludes(threadWorkbench, "activeView={planningActiveView}");

  const navigation = await Deno.readTextFile(
    new URL("./src/project/navigation.tsx", import.meta.url),
  );
  const unavailableNavigation = navigation.slice(
    navigation.indexOf("{unavailable"),
    navigation.indexOf("\n          : (", navigation.indexOf("{unavailable")),
  );
  assertStringIncludes(unavailableNavigation, 'aria-disabled="true"');
  assertEquals(unavailableNavigation.includes("href="), false);
  assertEquals(unavailableNavigation.includes("onClick="), false);

  const activity = await Deno.readTextFile(
    new URL("./src/project/baseline-run-activity.tsx", import.meta.url),
  );
  assertStringIncludes(activity, "First baseline run");
  assertStringIncludes(activity, "Live activity");
  assertStringIncludes(activity, "statusHistory");

  for (
    const forbiddenEvidenceSurface of [
      "ThreadGraph",
      "ComponentWorkspace",
      "RecordInspectorPanel",
      "thread.graph",
      "thread.components",
      "ThreadGraph",
      "RecordInspectorPanel",
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
