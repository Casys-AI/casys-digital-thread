import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  type OverviewThreadHullBox,
  separateOverviewThreadHulls,
} from "./src/project/overview-thread-hull-physics.ts";

function box(key: string, x: number, y: number, width = 100, height = 100) {
  return { key, x, y, width, height };
}

function assertSeparated(hulls: readonly OverviewThreadHullBox[], gap = 48) {
  for (const [index, left] of hulls.entries()) {
    for (const right of hulls.slice(index + 1)) {
      assert(
        left.x >= right.x + right.width + gap ||
          right.x >= left.x + left.width + gap ||
          left.y >= right.y + right.height + gap ||
          right.y >= left.y + left.height + gap,
        `${left.key} overlaps ${right.key}`,
      );
    }
  }
}

Deno.test("hull physics preserves clear positions and every exact identity", () => {
  const original = [box("a", -500, 250), box("b", 900, -250)];
  const result = separateOverviewThreadHulls(original);
  assertEquals(result, original);
  assertEquals(result[0], original[0]);
  assertSeparated(result);
});

Deno.test("hull physics fixes the resized hull and pushes a crowded chain", () => {
  const original = [box("a", 0, 0, 360), box("b", 140, 0), box("c", 280, 0)];
  const preserved = structuredClone(original);
  const result = separateOverviewThreadHulls(original, { fixedKey: "a" });
  assertEquals(result[0], original[0]);
  assertEquals(original, preserved);
  assertEquals(result.map((item) => item.key), ["a", "b", "c"]);
  assertSeparated(result);
  assertEquals(separateOverviewThreadHulls(result, { fixedKey: "a" }), result);
});

Deno.test("hull physics chooses the nearest free axial position", () => {
  const result = separateOverviewThreadHulls([
    box("fixed", 0, 0),
    box("neighbor", 80, 10),
  ], { fixedKey: "fixed", gap: 10 });
  assertEquals(result[1], box("neighbor", 110, 10));
  assertSeparated(result, 10);
});

Deno.test("hull physics resolves coincident boxes deterministically across input order", () => {
  const original = [box("a", 0, 0), box("b", 0, 0), box("c", 0, 0)];
  const options = { fixedKey: "b", gap: 12 };
  const sorted = (hulls: readonly OverviewThreadHullBox[]) =>
    hulls.toSorted((a, b) => a.key.localeCompare(b.key));
  const first = separateOverviewThreadHulls(original, options);
  assertEquals(
    sorted(first),
    sorted(separateOverviewThreadHulls(original.toReversed(), options)),
  );
  assertEquals(first.find((hull) => hull.key === "b"), original[1]);
  assertSeparated(first, 12);
});

Deno.test("hull physics leaves unrelated hulls still when a neighbor needs room", () => {
  const original = [
    box("near", 80, 10),
    box("far", -7000, 7000),
    box("fixed", 0, 0),
  ];
  const result = separateOverviewThreadHulls(original, { fixedKey: "fixed" });
  assertEquals(result[1], original[1]);
  assertEquals(result[2], original[2]);
  assertSeparated(result);
});

Deno.test("hull physics completely separates a dense board and settles on replay", () => {
  const original = Array.from(
    { length: 160 },
    (_, i) =>
      box(
        `hull-${i}`,
        (i % 16) * 40,
        Math.floor(i / 16) * 35,
        80 + i % 3 * 8,
        60,
      ),
  );
  const result = separateOverviewThreadHulls(original, { fixedKey: "hull-75" });
  assertSeparated(result);
  assertEquals(
    separateOverviewThreadHulls(result, { fixedKey: "hull-75" }),
    result,
  );
  assertEquals(result.length, original.length);
});

Deno.test("hull physics rejects invalid presentation geometry and duplicate keys", () => {
  assertThrows(
    () => separateOverviewThreadHulls([box("a", NaN, 0)]),
    RangeError,
  );
  assertThrows(
    () => separateOverviewThreadHulls([box("a", 0, 0, 0)]),
    RangeError,
  );
  assertThrows(
    () => separateOverviewThreadHulls([box("a", 0, 0), box("a", 1, 1)]),
    TypeError,
  );
  assertThrows(() => separateOverviewThreadHulls([], { gap: -1 }), RangeError);
});
