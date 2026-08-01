import { assertEquals } from "@std/assert";
import { COFFEE_MACHINE_PROJECT_FIXTURE } from "./src/project/fixture.ts";
import { buildProjectBrief, projectStatusLabel } from "./src/project/model.ts";
import { isEngineeringProjectSnapshot } from "./src/project/contract.ts";

Deno.test("project brief derives factual gates and operator attention", () => {
  const brief = buildProjectBrief(COFFEE_MACHINE_PROJECT_FIXTURE);

  assertEquals(brief.completedPhases, 3);
  assertEquals(brief.phases.length, 6);
  assertEquals(brief.status, "attention-required");
  assertEquals(projectStatusLabel(brief.status), "Decision required");
  assertEquals(brief.activeRuns[0]?.status, "waiting-for-decision");
  assertEquals(brief.pendingDecisions[0]?.id, "decision-mechanical-inputs");
  assertEquals(brief.openBlockers[0]?.id, "blocker-mechanical-inputs");
});

Deno.test("browser project contract rejects a half-defined input anchor", () => {
  const valid = structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE);
  assertEquals(isEngineeringProjectSnapshot(valid), true);

  const invalid = JSON.parse(JSON.stringify(valid)) as {
    decisions: Array<Record<string, unknown>>;
  };
  invalid.decisions[0]!.baseSnapshot = valid.threadSnapshots[0];
  assertEquals(isEngineeringProjectSnapshot(invalid), false);
});

Deno.test("project brief keeps a rejected decision actionable", () => {
  const rejected = {
    ...structuredClone(COFFEE_MACHINE_PROJECT_FIXTURE),
    decisions: COFFEE_MACHINE_PROJECT_FIXTURE.decisions.map((decision, index) =>
      index === 0 ? { ...decision, status: "rejected" as const } : decision
    ),
  };

  const brief = buildProjectBrief(rejected);

  assertEquals(brief.pendingDecisions[0]?.id, rejected.decisions[0]!.id);
  assertEquals(brief.pendingDecisions[0]?.status, "rejected");
});
