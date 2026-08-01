import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Decision Center keeps explicit human controls and read-only truth in its component contract", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );

  assertStringIncludes(source, "Decision Center");
  assertStringIncludes(source, "Read-only project surface");
  assertStringIncludes(source, "Self-declared · not authenticated");
  assertStringIncludes(source, "no value is assumed");
  assertStringIncludes(source, 'type: "decision.propose"');
  assertStringIncludes(source, 'type: "agent-run.queue"');
  assertStringIncludes(source, "Approve exact proposal");
  assertStringIncludes(source, "Reject proposal");
  assertStringIncludes(source, "Record revised proposal");
  assertStringIncludes(source, 'decision.status === "rejected"');
  assertEquals(source.includes('type: "agent-run.start"'), false);
  assertEquals(source.includes('type: "agent-run.complete"'), false);
});
