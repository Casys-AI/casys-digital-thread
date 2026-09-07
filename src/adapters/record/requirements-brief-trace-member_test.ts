import { assertEquals } from "@std/assert";
import { requirementsBriefTraceMemberMatchesProposal } from "./requirements-brief-trace-member.ts";

const proposed = {
  name: "Maximum arm displacement",
  metric: "arm_max_displacement",
  operator: "<=" as const,
  limit: { value: 2, unit: "mm" },
};

Deno.test("legacy native member id remains independent from its canonical metric", () => {
  assertEquals(
    requirementsBriefTraceMemberMatchesProposal({
      id: "legacy-requirement-uuid:7f31",
      ...proposed,
    }, proposed),
    true,
  );
});

for (
  const changed of [
    { ...proposed, name: "Changed name" },
    { ...proposed, metric: "arm_max_stress" },
    { ...proposed, operator: ">=" as const },
    { ...proposed, limit: { value: 3, unit: "mm" } },
    { ...proposed, limit: { value: 2, unit: "m" } },
  ]
) {
  Deno.test(`selected member rejects changed ${JSON.stringify(changed)}`, () => {
    assertEquals(
      requirementsBriefTraceMemberMatchesProposal({
        id: "legacy-requirement-uuid:7f31",
        ...proposed,
      }, changed),
      false,
    );
  });
}
