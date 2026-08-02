import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Decision Center is an inbox handoff, not a parallel technical workflow", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "export function DecisionCenter");
  assertStringIncludes(source, 'surface="inbox"');
  assertStringIncludes(source, "export function ReviewNotifications");
  assertStringIncludes(source, '"inbox" | "activity"');
  assertStringIncludes(source, "The feed carries the engineering story.");
  assertStringIncludes(source, "Open Activity to see the lineage and evidence");
  assertStringIncludes(
    source,
    "onOpenActivity?: (decisionId?: string) => void",
  );
  assertStringIncludes(
    source,
    "onOpenSpecification?: (decisionId: string) => void",
  );
  assertStringIncludes(source, "Inspect specification");
  assertStringIncludes(source, "Need a correction? Inspect the specification");

  for (
    const removedWorkflow of [
      "MANUAL FALLBACK RECORD",
      "Manual fallback",
      "Advanced recovery",
      "decision-manual-fallback",
      "decision-proposal-form",
      'type: "decision.propose"',
      "Record manual proposal",
      "Record manual revision",
      "Replace the prepared brief manually",
    ]
  ) {
    assertEquals(source.includes(removedWorkflow), false, removedWorkflow);
  }
});

Deno.test("only Activity can authorize or return an exact recorded recommendation", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "Review what changed");
  assertStringIncludes(source, "ReviewNotificationsSurface");
  assertStringIncludes(source, 'type: "decision.approve"');
  assertStringIncludes(source, "Authorized after review in Activity.");
  assertStringIncludes(source, 'intent: "decision.reject"');
  assertStringIncludes(source, 'type: "decision.reject"');
  assertStringIncludes(source, "Revision requested after Activity review.");
  assertStringIncludes(source, "Request revised recommendation");
  assertStringIncludes(
    source,
    "This recommendation is not bound to an exact input scope.",
  );
  assertStringIncludes(source, "Identify yourself to authorize a decision");
  assertStringIncludes(source, "Authorize recorded scope");
  assertEquals(source.includes("Optional review note"), false);
});

Deno.test("work authorization keeps the agent brief read-only and unreplaceable", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "item.description.trim() || item.title.trim()");
  assertStringIncludes(source, "Agent-prepared scope");
  assertStringIncludes(source, "Change the specification or ask the agent");
  assertStringIncludes(source, 'type: "agent-run.queue"');
  assertEquals(source.includes("replacementBrief"), false);
  assertEquals(source.includes("Replacement work brief"), false);
});

Deno.test("Workbench hands a review notification to current evidence and SysON", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const ribbon = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );

  assertStringIncludes(source, "const currentDecisionEvidence");
  assertStringIncludes(source, "const focusDecisionEvidence");
  assertStringIncludes(source, "const openDecisionActivity");
  assertStringIncludes(source, "const openDecisionSpecification");
  assertStringIncludes(source, "reference.snapshotId === snapshot.id");
  assertStringIncludes(source, 'setActiveComponentProvider("syson")');
  assertStringIncludes(
    source,
    '<ReviewNotifications\n                  surface="activity"',
  );
  assertEquals(source.includes("Open review desk"), false);
  assertStringIncludes(ribbon, '"REVIEW STATUS"');
  assertEquals(ribbon.includes("REVIEW DESK"), false);
});
