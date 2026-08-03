import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Decision Center projects discussion records without browser commands", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function DecisionCenter");
  assertStringIncludes(source, 'surface="inbox"');
  assertStringIncludes(source, "export function ReviewNotifications");
  assertStringIncludes(source, '"inbox" | "activity"');
  assertStringIncludes(source, "The feed carries the engineering story.");
  assertStringIncludes(source, "discuss the decision with the agent");
  assertStringIncludes(source, "Inspect specification");
  assertStringIncludes(
    source,
    "The cockpit will update when the shared project record changes.",
  );

  for (
    const removedCommand of [
      "ProjectOperatorCommand",
      "OperatorCommandCapabilities",
      "ProjectCommandFeedback",
      "onCommand",
      "onActorIdChange",
      "decision.approve",
      "decision.reject",
      "agent-run.queue",
      "Authorize recorded scope",
      "Request revised recommendation",
      "REVIEWER IDENTITY",
    ]
  ) {
    assertEquals(source.includes(removedCommand), false, removedCommand);
  }
});

Deno.test("Workbench keeps navigation but has no human command wiring", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "const openDecisionActivity");
  assertStringIncludes(source, "const openDecisionSpecification");
  assertStringIncludes(source, 'setActiveComponentProvider("syson")');
  assertStringIncludes(source, "<ReviewNotifications");
  assertStringIncludes(source, 'surface="activity"');

  for (
    const removedCommand of [
      "executeProjectCommand",
      "executePlanningCommand",
      "createProjectCommandRequest",
      "ProjectCommandConflictError",
      "operatorId",
      "agent-run.queue",
      "onPrepareAction",
    ]
  ) {
    assertEquals(source.includes(removedCommand), false, removedCommand);
  }
});
