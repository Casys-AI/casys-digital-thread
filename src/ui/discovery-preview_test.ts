import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("discovery preview is a single live read-only dossier", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/discovery-preview.tsx", import.meta.url),
  );

  assertStringIncludes(source, "Opening your project conversation");
  assertStringIncludes(source, "Restoring live updates");
  assertStringIncludes(source, "Project framing is temporarily unavailable");
  assertStringIncludes(source, "<DiscoveryWorkbench discovery={snapshot} />");
  assertStringIncludes(
    source,
    "client.subscribe(acceptSnapshot, setStreamStatus)",
  );

  for (
    const removedControl of [
      "onAnswer=",
      "onReviewBrief=",
      "onCreateEngineeringProject=",
      "client.command(",
      "client.handoff(",
      "createProjectDiscoveryCommandRequest",
      "createProjectDiscoveryHandoffRequest",
      "actorId",
      "POST",
    ]
  ) {
    assertEquals(source.includes(removedControl), false, removedControl);
  }

  assertEquals(source.includes("iframe"), false);
  assertEquals(source.includes("ThreadGraph"), false);
  assertEquals(source.includes("MetricGrid"), false);
  assertEquals(source.includes("window.location"), false);
  assertEquals(source.includes("inputFingerprint.digest"), false);
});
