import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Discovery Workbench is a calm read-only conversation record", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/discovery-workbench.tsx", import.meta.url),
  );

  for (
    const expected of [
      "PAIRED CONVERSATION · NEXT QUESTION",
      "Talk with the agent; review the shared record here.",
      "ANSWER WITH YOUR AGENT",
      "Why this matters",
      "AGENT RECOMMENDATION",
      "START WITH THIS REPLY",
      "Possible directions to discuss",
      "Draft engineering brief",
      "Discuss corrections, priorities and confirmation with the agent.",
    ]
  ) {
    assertStringIncludes(source, expected);
  }

  for (
    const removedControl of [
      "Correct from cockpit",
      "Request revision",
      "Approve brief",
      "Start engineering project",
      "onReviewBrief",
      "onCreateEngineeringProject",
      "onAnswer",
      "inputFingerprint: discovery.review.inputFingerprint",
      "<Button",
      "fetch(",
    ]
  ) {
    assertEquals(source.includes(removedControl), false, removedControl);
  }

  assertEquals(source.includes("MetricGrid"), false);
  assertEquals(source.includes("ThreadGraph"), false);
  assertEquals(source.includes("ProjectNavigation"), false);
  assertEquals(source.includes("<textarea"), false);
});

Deno.test("Discovery compliance remains progressive and inside the folded brief", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/discovery-workbench.tsx", import.meta.url),
  );
  const questionStart = source.indexOf("function ActiveDiscoveryQuestion");
  const briefStart = source.indexOf("function DiscoveryBriefDisclosure");
  const questionSource = source.slice(questionStart, briefStart);
  const briefSource = source.slice(briefStart);

  assertEquals(questionStart > 0, true);
  assertEquals(briefStart > 0, true);
  assertStringIncludes(briefSource, "brief.intendedMarkets");
  assertStringIncludes(briefSource, "brief.manufacturingJurisdictions");
  assertStringIncludes(briefSource, "brief.operatingJurisdictions");
  assertStringIncludes(briefSource, "brief.complianceTargets");
  assertStringIncludes(briefSource, "brief.verificationPlan");
  assertEquals(questionSource.includes("complianceTargets"), false);
  assertEquals(questionSource.includes("verificationPlan"), false);
});
