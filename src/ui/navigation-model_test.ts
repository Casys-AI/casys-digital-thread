import { assertEquals } from "@std/assert";
import {
  DEFAULT_PRODUCT_FACET,
  DEFAULT_PROJECT_VIEW,
  hasDistinctProjectObjectiveStatement,
  parseProjectLocationHash,
  parseProjectViewHash,
  PRODUCT_FACETS,
  productFacetHash,
  productFacetLabel,
  PROJECT_VIEWS,
  projectDeepLinkDomId,
  projectDeepLinkHash,
  projectViewHash,
  projectViewLabel,
  shouldScrollProjectDeepLink,
} from "./src/project/navigation-model.ts";

Deno.test("objective supporting copy is hidden when it only repeats the title", () => {
  assertEquals(
    hasDistinctProjectObjectiveStatement(
      "A compact engineering lamp",
      "  A compact engineering\nlamp. ",
    ),
    false,
  );
  assertEquals(
    hasDistinctProjectObjectiveStatement(
      "A compact engineering lamp",
      "Designed for an individual work surface.",
    ),
    true,
  );
});

Deno.test("An absent fragment opens the cockpit on its default space", () => {
  assertEquals(parseProjectViewHash(""), DEFAULT_PROJECT_VIEW);
});

Deno.test("a live snapshot update cannot repeat an already consumed deep-link scroll", () => {
  const target = "review/geometry" as const;
  assertEquals(shouldScrollProjectDeepLink(undefined, target), true);
  const consumedKey = projectDeepLinkHash(target);
  assertEquals(shouldScrollProjectDeepLink(consumedKey, target), false);
  assertEquals(
    shouldScrollProjectDeepLink(consumedKey, "review/requirements"),
    true,
  );
});

Deno.test("An unknown fragment never leaves the cockpit on an empty space", () => {
  assertEquals(parseProjectViewHash("#evidence"), DEFAULT_PROJECT_VIEW);
  assertEquals(parseProjectViewHash("#../../etc/passwd"), DEFAULT_PROJECT_VIEW);
  assertEquals(parseProjectViewHash("#"), DEFAULT_PROJECT_VIEW);
});

Deno.test("Every space round-trips through its fragment", () => {
  for (const view of PROJECT_VIEWS) {
    assertEquals(parseProjectViewHash(projectViewHash(view.id)), view.id);
  }
});

Deno.test("A fragment is read with or without its leading hash", () => {
  assertEquals(parseProjectViewHash("verification"), "verification");
  assertEquals(parseProjectViewHash("#verification"), "verification");
});

Deno.test("Every space carries a label and a description for wayfinding", () => {
  for (const view of PROJECT_VIEWS) {
    assertEquals(projectViewLabel(view.id), view.label);
    assertEquals(view.description.length > 0, true);
  }
});

Deno.test("The five spaces stay distinct and stable", () => {
  assertEquals(PROJECT_VIEWS.length, 5);
  assertEquals(
    PROJECT_VIEWS.map((view) => view.id),
    ["overview", "work", "product", "verification", "operations"],
  );
  assertEquals(new Set(PROJECT_VIEWS.map((view) => view.label)).size, 5);
});

Deno.test("review deep links round-trip through a fixed fail-closed vocabulary", () => {
  const targets = [
    "review/brief",
    "review/architecture",
    "review/requirements",
    "review/geometry",
  ] as const;
  for (const target of targets) {
    const location = parseProjectLocationHash(projectDeepLinkHash(target));
    assertEquals(location.target, target);
    assertEquals(projectDeepLinkDomId(target).length > 0, true);
  }
  assertEquals(parseProjectLocationHash("#work/review/brief"), {
    view: "work",
    target: "review/brief",
  });
  assertEquals(projectDeepLinkDomId("review/brief"), "review-brief");
  assertEquals(parseProjectLocationHash("#work/review/requestState"), {
    view: DEFAULT_PROJECT_VIEW,
  });
});

Deno.test("Product facets round-trip through a fail-closed fragment", () => {
  assertEquals(parseProjectLocationHash("#product"), {
    view: "product",
    productFacet: DEFAULT_PRODUCT_FACET,
  });
  for (const facet of PRODUCT_FACETS) {
    assertEquals(parseProjectLocationHash(productFacetHash(facet.id)), {
      view: "product",
      productFacet: facet.id,
    });
    assertEquals(productFacetLabel(facet.id), facet.label);
  }
  assertEquals(parseProjectLocationHash("#product/not-a-facet"), {
    view: "product",
    productFacet: DEFAULT_PRODUCT_FACET,
  });
  assertEquals(parseProjectViewHash("#product/requirements"), "product");
});
