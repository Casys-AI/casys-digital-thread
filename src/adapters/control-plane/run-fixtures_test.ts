import { assertEquals, assertThrows } from "@std/assert";
import { RunFixtureError, validateRunFixture } from "./run-fixtures.ts";

Deno.test("run fixtures accept a documentary demo with documentary and comparison stages", () => {
  const run = validateRunFixture(documentaryDemo(), "fixture");

  assertEquals(run.status, "documentary");
  assertEquals(run.verdictStatus, "not_evaluated");
  assertEquals(run.stages.map((stage) => stage.basis), [
    "documentary",
    "comparison",
  ]);
});

Deno.test("run fixtures fail closed for unknown run status and stage basis literals", () => {
  const invalidStatus = documentaryDemo();
  invalidStatus.status = "complete";
  assertThrows(
    () => validateRunFixture(invalidStatus, "fixture"),
    RunFixtureError,
    "fixture.status must be a known run status",
  );

  const invalidBasis = documentaryDemo();
  (invalidBasis.stages as Array<Record<string, unknown>>)[0].basis = "claimed";
  assertThrows(
    () => validateRunFixture(invalidBasis, "fixture"),
    RunFixtureError,
    "fixture.stages[0].basis must be execution, documentary, or comparison",
  );
});

Deno.test("demo fixtures cannot claim execution or a requirement verdict", () => {
  const executionClaim = documentaryDemo();
  const stage = (executionClaim.stages as Array<Record<string, unknown>>)[0];
  stage.basis = "execution";
  stage.status = "succeeded";
  assertThrows(
    () => validateRunFixture(executionClaim, "fixture"),
    RunFixtureError,
    "fixture.stages[0].basis must not claim execution for a demo fixture",
  );

  const evaluatedDemo = documentaryDemo();
  evaluatedDemo.verdictStatus = "passed";
  assertThrows(
    () => validateRunFixture(evaluatedDemo, "fixture"),
    RunFixtureError,
    "fixture.verdictStatus must be not_evaluated when fixture.source is demo",
  );
});

function documentaryDemo(): Record<string, unknown> {
  return {
    id: "fixture-demo",
    name: "Fixture demo",
    subject: "Fixture subject",
    status: "documentary",
    verdictStatus: "not_evaluated",
    source: "demo",
    passedRequirements: 0,
    failedRequirements: 0,
    unresolvedRequirements: 0,
    description: "Checked-in fixture material with no dispatch attested.",
    stages: [
      {
        id: "record",
        title: "Documented record",
        serverId: "fixture",
        tool: "documentary-record",
        basis: "documentary",
        status: "documentary",
        summary: "Checked-in material only.",
        inputs: {},
        outputs: {},
      },
      {
        id: "comparison",
        title: "Recorded comparison",
        serverId: "fixture",
        tool: "recorded-comparison",
        basis: "comparison",
        status: "not_evaluated",
        summary: "No requirement verdict is claimed.",
        inputs: {},
        outputs: {},
      },
    ],
    measurements: [],
    provenance: [],
    warnings: [],
    requirements: [],
    evidence: [],
  };
}
