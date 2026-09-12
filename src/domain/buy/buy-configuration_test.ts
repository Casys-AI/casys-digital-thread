import { assertEquals, assertThrows } from "@std/assert";
import { validateBuyConfiguration } from "./buy-configuration.ts";
import { buyConfigurationFixture } from "./buy-fixtures.ts";
import { recrossBuyConfigurationCatalog } from "./buy-catalog-recross.ts";
import type { ThreadComponentCatalog } from "../thread/thread-component-catalog.ts";

Deno.test("validates a sourced buy-configuration/1.0", () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture());
  assertEquals(configuration.lines[0]?.quantity, "4");
  assertEquals(configuration.lines[0]?.item?.authority, "source-attested");
});

Deno.test("refuses an arbitrary JSON object as a BOM", () => {
  assertThrows(
    () => validateBuyConfiguration({ bomName: "BOM-1", items: [] }),
    TypeError,
    "unsupported field",
  );
});

Deno.test("catalogue erpnext:item is declared, not a mapping proof", () => {
  const catalog: ThreadComponentCatalog = {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: "project:reviewed-project-v1",
    rationale: "Fixture catalogue.",
    systemViews: { erpnext: { bomName: "BOM-BRACKET" } },
    components: [{
      id: "bracket",
      label: "Bracket",
      kind: "part",
      quantity: 2,
      bindings: [{
        provider: "erpnext",
        kind: "item",
        id: "BRACKET-001",
        label: "Bracket",
        evidenceArtifactId: "artifact.catalog",
      }],
    }],
  };
  const configuration = validateBuyConfiguration(buyConfigurationFixture({
    lines: [{
      ...buyConfigurationFixture().lines[0]!,
      item: { doctype: "Item", name: "BRACKET-001", authority: "catalog-declared" },
    }],
  }));
  const gaps = recrossBuyConfigurationCatalog(configuration, catalog);
  assertEquals(
    gaps.some((gap) => gap.code === "catalog-not-proof"),
    true,
  );
});

Deno.test("missing occurrence identity is an explicit gap, not a guessed line", () => {
  const configuration = validateBuyConfiguration(buyConfigurationFixture({
    lines: [{
      ...buyConfigurationFixture().lines[0]!,
      occurrences: [],
      gaps: [{
        code: "occurrence-unresolved",
        message: "No sourced occurrence.",
        lineId: "line.bracket",
      }],
    }],
  }));
  const gaps = recrossBuyConfigurationCatalog(configuration, undefined);
  assertEquals(
    gaps.some((gap) => gap.code === "occurrence-unresolved"),
    true,
  );
});
