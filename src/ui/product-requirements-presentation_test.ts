import { assertStringIncludes } from "@std/assert";

Deno.test("Product requirements keep compact exact identities in a scrollable matrix", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/product-requirements-matrix.tsx", import.meta.url),
  );

  assertStringIncludes(source, "compactTechnicalIdentifier(row.id)");
  assertStringIncludes(source, 'title={row.id} aria-hidden="true"');
  assertStringIncludes(source, "Requirement identifier: {row.id}");
  assertStringIncludes(source, "RequirementChevron");
  assertStringIncludes(source, "hover:bg-muted/45");
  assertStringIncludes(source, "overflow-x-auto");
  assertStringIncludes(source, "min-w-[1120px]");
  assertStringIncludes(
    source,
    "No requirements are recorded in this exact Thread snapshot.",
  );
  assertStringIncludes(
    source,
    "SysML parts and attributes are not inferred as requirements.",
  );
});
