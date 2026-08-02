import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Discovery Workbench stays a calm one-question review surface", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/discovery-workbench.tsx", import.meta.url),
  );

  assertStringIncludes(source, "PAIRED CONVERSATION · NEXT QUESTION");
  assertStringIncludes(
    source,
    "Talk with the agent; review the shared record here.",
  );
  assertStringIncludes(source, "ANSWER WITH YOUR AGENT");
  assertStringIncludes(source, "Why this matters");
  assertStringIncludes(source, "AGENT RECOMMENDATION");
  assertStringIncludes(source, "Possible directions to discuss");
  assertStringIncludes(source, "I don&rsquo;t know yet");
  assertStringIncludes(source, "Correct from cockpit");
  assertStringIncludes(
    source,
    '<details class="discovery-cockpit-correction">',
  );
  assertStringIncludes(source, "Draft engineering brief");
  assertStringIncludes(source, '<details class="discovery-brief"');
  assertStringIncludes(source, "Request revision");
  assertStringIncludes(source, "Approve brief");
  assertStringIncludes(
    source,
    "inputFingerprint: discovery.review.inputFingerprint",
  );

  assertEquals(source.includes("MetricGrid"), false);
  assertEquals(source.includes("ThreadGraph"), false);
  assertEquals(source.includes("ProjectNavigation"), false);
  assertEquals(source.includes("inputFingerprint.digest"), false);
  assertEquals(source.includes("shortHash"), false);
  assertEquals(source.includes("fetch("), false);
  assertEquals(source.includes("discovery.questions.map"), false);
  assertEquals(source.includes("Question ${"), false);
  assertEquals(source.includes("<progress"), false);

  const correctionStart = source.indexOf(
    '<details class="discovery-cockpit-correction">',
  );
  const directControlsStart = source.indexOf(
    '<fieldset class="discovery-options"',
  );
  const directionsStart = source.indexOf('class="discovery-option-context"');

  assertEquals(correctionStart > 0, true);
  assertEquals(directionsStart > 0, true);
  assertEquals(directControlsStart > correctionStart, true);
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
