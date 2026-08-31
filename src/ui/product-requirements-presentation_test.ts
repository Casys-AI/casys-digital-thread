import { assertStringIncludes } from "@std/assert";

Deno.test("Product requirements keep exact identities in an adaptive matrix", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/project/product-requirements-matrix.tsx", import.meta.url),
  );

  assertStringIncludes(source, "compactTechnicalIdentifier(row.id)");
  assertStringIncludes(source, 'title={row.id} aria-hidden="true"');
  assertStringIncludes(source, "Requirement identifier: {row.id}");
  assertStringIncludes(source, "RequirementChevron");
  assertStringIncludes(source, "hover:bg-muted/45");
  assertStringIncludes(source, "requirements-matrix-grid");
  assertStringIncludes(source, "requirements-compact-details");
  assertStringIncludes(source, "RECORDED MARGIN");
  assertStringIncludes(
    source,
    "No requirements are recorded in this exact Thread snapshot.",
  );
  assertStringIncludes(
    source,
    "SysML parts",
  );
  assertStringIncludes(source, "not inferred as requirements.");
});
