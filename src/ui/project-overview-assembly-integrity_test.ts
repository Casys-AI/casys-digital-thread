import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("overview keeps assembly integrity as a dedicated recorded L4 tile", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const start = source.indexOf("function AssemblyIntegrityVerdictTile");
  const end = source.indexOf("/**", start + 1);
  const tile = source.slice(start, end);

  assertEquals(start >= 0 && end > start, true);
  assertStringIncludes(tile, 'data-verdict-family="assembly-integrity"');
  assertStringIncludes(tile, "Recorded L4 evaluation");
  assertStringIncludes(tile, "value.verdict");
  assertStringIncludes(tile, "Not safety, clearance, motion, load or fabrication.");
  assertEquals(tile.includes("buildRequirementMatrix"), false);
  assertStringIncludes(source, "function recordedAssemblyIntegrityL4");
  assertStringIncludes(source, "chain.evaluation.aggregateVerdict");
});
