import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("discovery preview remains a single calm live review surface", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/discovery-preview.tsx", import.meta.url),
  );

  assertStringIncludes(source, "Opening your project conversation");
  assertStringIncludes(source, "Restoring live updates");
  assertStringIncludes(source, "Project framing is temporarily unavailable");
  assertStringIncludes(source, "<DiscoveryWorkbench");
  assertStringIncludes(source, "onAnswer={answerQuestion}");
  assertStringIncludes(source, "onReviewBrief={reviewBrief}");
  assertStringIncludes(source, "expectedRevision: current.revision");

  assertEquals(source.includes("iframe"), false);
  assertEquals(source.includes("ThreadGraph"), false);
  assertEquals(source.includes("MetricGrid"), false);
  assertEquals(source.includes("inputFingerprint.digest"), false);
});
