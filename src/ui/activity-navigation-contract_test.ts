import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

Deno.test("Activity row selection expands locally without opening Verification", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const feed = await Deno.readTextFile(
    new URL("./src/thread/feed.tsx", import.meta.url),
  );

  assertMatch(
    workbench,
    /const selectActivityNode = \([\s\S]*?origin === "feed"[\s\S]*?setLineageFocus\(undefined\);[\s\S]*?setGraphSelection\(undefined\);[\s\S]*?selectGraphNode\(node, \{\s*pauseLive: true,\s*inspect: false,\s*\}\);/,
  );
  assertStringIncludes(workbench, "onSelectNode={selectActivityNode}");
  assertStringIncludes(feed, 'onClick={() => onSelectNode(node, "feed")}');
  assertStringIncludes(feed, "aria-expanded={active}");
  assertStringIncludes(feed, "{active && lineage && (");
});

Deno.test("Activity opens Verification only through its explicit evidence actions", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const feed = await Deno.readTextFile(
    new URL("./src/thread/feed.tsx", import.meta.url),
  );

  assertStringIncludes(
    workbench,
    "onOpenEvidenceAnchored={openEvidenceAnchored}",
  );
  assertStringIncludes(feed, "Open evidence canvas");
  assertEquals(feed.includes('role="link"'), false);
  assertEquals(feed.includes("Lineage →"), false);
});
