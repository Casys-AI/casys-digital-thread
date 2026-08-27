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

Deno.test("work ribbon separates agent preparation from human review", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("export function ProjectWorkRibbon");
  const end = source.indexOf("function AgentNowRibbon", start);
  const ribbon = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(ribbon, 'label: "Needs review"');
  assertStringIncludes(ribbon, 'label: "Agent preparing"');
  assertStringIncludes(ribbon, 'd?.status === "required"');
  assertStringIncludes(ribbon, 'd?.status === "rejected"');
});

Deno.test("operations leads with recorded execution and human confirmations", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("export function ProjectOperations");
  const end = source.indexOf("/** Read-only L5 evidence card", start);
  const operations = source.slice(start, end);

  const queue = operations.indexOf("<QueueCard");
  const confirmations = operations.indexOf("<MrtrCard");
  const closeout = operations.indexOf("<EvaluationCloseoutCard");
  const assemblyIntegrity = operations.indexOf("<AssemblyIntegrityCard");
  const systems = operations.indexOf("<ContributingSystemsCard");
  assertEquals(start >= 0 && end > start, true);
  assertEquals(queue >= 0 && queue < confirmations, true);
  assertEquals(
    confirmations < closeout && closeout < assemblyIntegrity &&
      assemblyIntegrity < systems,
    true,
  );
  assertStringIncludes(
    operations,
    "pendingHumanConfirmationDecisions(project)",
  );
  assertStringIncludes(operations, "agentPreparationDecisions(project)");
  assertEquals(operations.includes('status === "required"'), false);
  assertStringIncludes(operations, "Technical provenance");
  assertStringIncludes(operations, "They are not runtime health checks.");
});

Deno.test("operations keeps agent preparation outside concrete proposed MRTR decisions", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const preparationStart = source.indexOf("function AgentPreparationCard");
  const preparationEnd = source.indexOf("// MRTR card", preparationStart);
  const preparation = source.slice(preparationStart, preparationEnd);

  assertEquals(preparationStart >= 0 && preparationEnd > preparationStart, true);
  assertStringIncludes(preparation, "AGENT PROPOSAL PREPARATION");
  assertStringIncludes(preparation, 'decision.status === "rejected"');
  assertStringIncludes(preparation, "Only a later <strong>proposed</strong>");
  assertStringIncludes(preparation, "the MRTR card above");
});

Deno.test("operations systems expose literal recorded state without row commands", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("function ContributingSystemsCard");
  const end = source.indexOf("// MRTR card", start);
  const systems = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  for (
    const label of [
      "Requirement",
      "Recorded state",
      "Last evidence",
      "Required",
      "Optional",
      "Not declared",
      "No project record",
      "Fresh",
      "Running",
      "Failed",
      "Stale",
    ]
  ) {
    assertStringIncludes(systems, label);
  }
  assertEquals(systems.includes("onClick"), false);
  assertEquals(systems.includes("<button"), false);
  assertEquals(systems.includes("<a "), false);
  assertEquals(systems.includes("p50"), false);
  assertEquals(systems.includes("uptime"), false);
});

Deno.test("operations closeout keeps exact evidence identifiers behind details", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("function EvaluationCloseoutCard");
  const end = source.indexOf("// Contributing systems", start);
  const closeout = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(closeout, "<details");
  assertStringIncludes(
    closeout,
    "Review criteria, proof boundaries and evidence identifiers",
  );
  assertStringIncludes(closeout, "card.evidence.canonicalStep.id");
  assertStringIncludes(closeout, "card.evidence.sealedProof.id");
  assertStringIncludes(closeout, "card.evidence.executionEvidence.id");
  assertStringIncludes(closeout, "card.evidence.evaluationCapture.id");
});

Deno.test("assembly-integrity work card keeps L3 facts, L4 verdict and L5 formal gates separate", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("function AssemblyIntegrityCard");
  const end = source.indexOf("// Contributing systems", start);
  const card = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(card, "L3 · observed facts");
  assertStringIncludes(card, "No verdict");
  assertStringIncludes(card, "L4 · recorded evaluation");
  assertStringIncludes(card, "l4.aggregateVerdict");
  assertStringIncludes(card, "L5 · human disposition");
  assertStringIncludes(card, 'data-formal-gate="assembly-integrity"');
  assertStringIncludes(
    card.replace(/\s+/g, " "),
    "separate from the activity stage band",
  );
  assertStringIncludes(card, "Exact lineage and evidence identities");
  assertEquals(card.includes("onClick"), false);
  assertEquals(card.includes("<button"), false);
});

Deno.test("run timeline keeps historical attempts behind details on one activity row", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/work.tsx", import.meta.url),
  );
  const start = source.indexOf("function RunTimelineActivityRow");
  const end = source.indexOf("function workTitle", start);
  const row = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(row, "recordStatusVariant(row.status)");
  assertStringIncludes(row, "row.revisionCount > 1");
  assertStringIncludes(row, "row.attemptCount > 1");
  assertStringIncludes(row, "row.currentAttemptId");
  assertStringIncludes(row, "<details");
  assertEquals(row.includes('attempt.status === "failed"'), false);
  assertEquals(row.includes('attempt.status === "cancelled"'), false);
});

Deno.test("operations page heading describes recorded state rather than fleet health", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const start = source.indexOf("function operationsHeadline");
  const end = source.indexOf("function workspaceTitle", start);
  const heading = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(source, "Operations · recorded execution");
  assertStringIncludes(heading, 'run.status === "running"');
  assertStringIncludes(heading, 'run.status === "queued"');
  assertStringIncludes(heading, "pendingHumanConfirmationDecisions(project)");
  assertStringIncludes(heading, "agentPreparationDecisions(project)");
  assertStringIncludes(heading, "human confirmation");
  assertStringIncludes(heading, "agent proposal");
  assertEquals(heading.includes('status === "required"'), false);
  assertEquals(heading.includes("MCP surfaces"), false);
});
