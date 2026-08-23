import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Overview thread selection opens locally and a second click closes it", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );

  const selectionStart = source.indexOf("function nextOverviewHeroSelection(");
  const selectionEnd = source.indexOf("function HeroNode(", selectionStart);
  const selection = source.slice(selectionStart, selectionEnd);
  assertEquals(selectionStart >= 0, true);
  assertEquals(selectionEnd > selectionStart, true);
  assertStringIncludes(
    selection,
    "return current === requested ? undefined : requested;",
  );
});

Deno.test("Overview thread keeps navigation explicit and keyboard accessible", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const svgStart = source.indexOf("<svg");
  const svgEnd = source.indexOf("</svg>", svgStart);
  const svg = source.slice(svgStart, svgEnd);

  assertEquals(svgStart >= 0, true);
  assertEquals(svgEnd > svgStart, true);
  assertEquals(svg.includes("onClick={onOpenEvidence}"), false);
  assertStringIncludes(source, 'role="group"');
  assertStringIncludes(source, 'role="button"');
  assertStringIncludes(source, "tabIndex={0}");
  assertStringIncludes(source, "aria-expanded={selected}");
  assertStringIncludes(source, 'event.key !== "Enter"');
  assertStringIncludes(source, 'event.key !== " "');
  assertStringIncludes(source, "Open in Verification →");
  assertStringIncludes(source, "onOpenEvidence(selected.node.ref)");
});

Deno.test("Overview product facet callbacks do not also run their fallback", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(source, "const openProductFacet");
  assertEquals(source.includes('?.("requirements") ??'), false);
  assertEquals(source.includes('?.("structure") ??'), false);
});
