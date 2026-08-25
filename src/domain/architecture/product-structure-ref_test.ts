import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  parseProductStructureElementRef,
  parseProductStructureOccurrenceRef,
  productStructureElementRef,
  productStructureElementRefsEqual,
  productStructureOccurrenceRef,
  productStructureOccurrenceRefsEqual,
} from "./product-structure-ref.ts";

Deno.test("product structure element ref freezes an exact PartDefinition or PartUsage identity", () => {
  const definition = productStructureElementRef("PartDefinition", "def-system");
  const usage = parseProductStructureElementRef({
    elementKind: "PartUsage",
    elementId: "usage-left",
  }, "$element");
  assertEquals(definition, {
    elementKind: "PartDefinition",
    elementId: "def-system",
  });
  assertEquals(usage.elementKind, "PartUsage");
  assert(Object.isFrozen(definition));
  assert(Object.isFrozen(usage));
  assertEquals(
    productStructureElementRefsEqual(definition, {
      elementKind: "PartDefinition",
      elementId: "def-system",
    }),
    true,
  );
  assertEquals(
    productStructureElementRefsEqual(definition, usage),
    false,
  );
});

Deno.test("product structure element ref refuses latest, extra keys and unknown kinds", () => {
  assertThrows(
    () => productStructureElementRef("PartDefinition", "latest"),
    TypeError,
    "latest",
  );
  assertThrows(
    () =>
      parseProductStructureElementRef({
        elementKind: "PartDefinition",
        elementId: "def-system",
        label: "Slider",
      }, "$element"),
    TypeError,
    "unsupported field",
  );
  assertThrows(
    () =>
      parseProductStructureElementRef({
        elementKind: "part-definition",
        elementId: "def-system",
      }, "$element"),
    TypeError,
    "PartDefinition or PartUsage",
  );
});

Deno.test("the product root is a PartDefinition element, never an empty-path occurrence", () => {
  assertThrows(
    () =>
      productStructureOccurrenceRef({
        element: productStructureElementRef("PartDefinition", "def-system"),
        path: [],
      }),
    TypeError,
    "never an occurrence",
  );
});

Deno.test("PartUsage occurrence path is nonempty and ends with its elementId", () => {
  const occurrence = parseProductStructureOccurrenceRef({
    element: { elementKind: "PartUsage", elementId: "usage-pad" },
    path: ["usage-left", "usage-pad"],
  }, "$occurrence");
  assertEquals(occurrence.element.elementId, "usage-pad");
  assertEquals(occurrence.path, ["usage-left", "usage-pad"]);
  assert(Object.isFrozen(occurrence));
  assert(Object.isFrozen(occurrence.path));
  assertEquals(
    productStructureOccurrenceRefsEqual(occurrence, {
      element: { elementKind: "PartUsage", elementId: "usage-pad" },
      path: ["usage-left", "usage-pad"],
    }),
    true,
  );
  assertThrows(
    () =>
      productStructureOccurrenceRef({
        element: { elementKind: "PartUsage", elementId: "usage-left" },
        path: [],
      }),
    TypeError,
    "nonempty",
  );
  assertThrows(
    () =>
      productStructureOccurrenceRef({
        element: { elementKind: "PartUsage", elementId: "usage-left" },
        path: ["usage-right"],
      }),
    TypeError,
    "end with its elementId",
  );
});

Deno.test("a PartUsage occurrence path may exceed 32 segments", () => {
  const path = [
    ...Array.from({ length: 39 }, (_item, index) => `usage-${index + 1}`),
    "usage-leaf",
  ];
  const occurrence = productStructureOccurrenceRef({
    element: { elementKind: "PartUsage", elementId: "usage-leaf" },
    path,
  });
  assertEquals(occurrence.path.length, 40);
  assertEquals(occurrence.path[39], "usage-leaf");
});

Deno.test("a PartDefinition is an element, not a fabricated occurrence", () => {
  assertThrows(
    () =>
      productStructureOccurrenceRef({
        element: { elementKind: "PartDefinition", elementId: "def-rail" },
        path: ["usage-left"],
      }),
    TypeError,
    "never an occurrence",
  );
});
