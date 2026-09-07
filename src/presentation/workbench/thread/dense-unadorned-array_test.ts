import { assertEquals } from "@std/assert";
import { isDenseUnadornedArray } from "./dense-unadorned-array.ts";
import { isDenseUnadornedArray as viewerSessionsDenseArray } from "./viewer-sessions.ts";

Deno.test("viewer hierarchy and session boundaries share the same dense-array predicate without a runtime cycle", () => {
  const sparse = ["first", "second"];
  delete sparse[1];
  const adorned = ["only"] as string[] & { extra?: string };
  adorned.extra = "not admitted";

  assertEquals(isDenseUnadornedArray(["first", "second"]), true);
  assertEquals(isDenseUnadornedArray(sparse), false);
  assertEquals(isDenseUnadornedArray(adorned), false);
  // Compatibility export for existing adapter consumers preserves the predicate.
  assertEquals(viewerSessionsDenseArray(["first", "second"]), true);
});
