import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("agent run journal binds each status chip to the same run title", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("Full run journal");
  const end = source.indexOf("declared fleet", start);
  const journal = source.slice(start, end);

  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  assertStringIncludes(journal, "aria-label={agentRunJournalItemName(");
  assertStringIncludes(journal, 'aria-hidden="true"');
  assertStringIncludes(journal, "variant={recordStatusVariant(");
  assertStringIncludes(journal, "run.status");
  assertStringIncludes(journal, "{sentenceLabel(run.status)}");
  assertEquals(
    /AgentRunLifecycle[\s\S]*<Badge/.test(journal),
    false,
    "status chip must not follow the run body into the next list item",
  );
  assertEquals(
    journal.includes("cancelled") && journal.includes('"Failed"'),
    false,
    "a cancelled run must stay cancelled, not be invented as failed",
  );
});

Deno.test("agent run journal item names keep cancelled and failed literal", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const helperStart = source.indexOf("export function agentRunJournalItemName");
  const helperEnd = source.indexOf("function sentenceLabel", helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assertEquals(helperStart >= 0, true);
  assertEquals(helperEnd > helperStart, true);
  assertStringIncludes(helper, "return `${title} · ${sentenceLabel(status)}`");
  assertEquals(helper.includes('"Failed"'), false);
  assertEquals(helper.includes('"Cancelled"'), false);
});
