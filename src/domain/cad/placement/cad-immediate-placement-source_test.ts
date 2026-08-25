import { assertEquals, assertThrows } from "@std/assert";
import {
  CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
  canonicalizeCadImmediatePlacementSource,
  validateCadImmediatePlacementSource,
} from "./cad-immediate-placement-source.ts";

function sourceFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA,
    unitSystem: "mm",
    placementConvention: "right-handed-mm-extrinsic-xyz-degrees",
    placements: [{
      usageElementId: "usage-right",
      partDefinitionElementId: "def-rail",
      placement: {
        translationMm: [10, 0, 0],
        rotationDeg: [0, 0, 90],
      },
    }, {
      usageElementId: "usage-left",
      partDefinitionElementId: "def-rail",
      placement: {
        translationMm: [0, 0, 0],
        rotationDeg: [0, 0, 0],
      },
    }],
    ...overrides,
  };
}

Deno.test("cad-immediate-placement-source/1.0 is closed, unique by usage, and order-independent", () => {
  const source = validateCadImmediatePlacementSource(sourceFixture());
  assertEquals(source.schemaVersion, CAD_IMMEDIATE_PLACEMENT_SOURCE_SCHEMA);
  assertEquals(source.placements.map((entry) => entry.usageElementId), [
    "usage-left",
    "usage-right",
  ]);
  assertEquals(source.placements[0]?.partDefinitionElementId, "def-rail");
  assertEquals(source.placements[1]?.placement.translationMm, [10, 0, 0]);
});

Deno.test("cad-immediate-placement-source canonicalizer is exact and replay-stable", () => {
  const shuffled = sourceFixture();
  const first = canonicalizeCadImmediatePlacementSource(shuffled);
  const second = canonicalizeCadImmediatePlacementSource(JSON.parse(first.text));
  assertEquals(second.text, first.text);
  assertEquals(second.source.placements[0]?.usageElementId, "usage-left");
});

Deno.test("cad-immediate-placement-source refuses labels, providers, runtimes and extra keys", () => {
  for (
    const [key, value] of [
      ["label", "assembly"],
      ["provider", "build123d"],
      ["runtime", "latest"],
      ["verdict", "pass"],
      ["geometry", {}],
      ["mrtr", {}],
    ] as const
  ) {
    assertThrows(
      () => validateCadImmediatePlacementSource(sourceFixture({ [key]: value })),
      TypeError,
      "unsupported field",
    );
  }
  assertThrows(
    () => validateCadImmediatePlacementSource(sourceFixture({ extra: true })),
    TypeError,
    "unsupported field extra",
  );
});

Deno.test("cad-immediate-placement-source refuses duplicate usages, latest aliases and non-finite vectors", () => {
  assertThrows(
    () =>
      validateCadImmediatePlacementSource(sourceFixture({
        placements: [],
      })),
    TypeError,
    "at least one entry",
  );
  assertThrows(
    () =>
      validateCadImmediatePlacementSource(sourceFixture({
        placements: [
          sourceFixture().placements[0],
          sourceFixture().placements[0],
        ],
      })),
    TypeError,
    "must not contain duplicates",
  );
  assertThrows(
    () =>
      validateCadImmediatePlacementSource(sourceFixture({
        placements: [{
          usageElementId: "latest",
          partDefinitionElementId: "def-rail",
          placement: { translationMm: [0, 0, 0], rotationDeg: [0, 0, 0] },
        }],
      })),
    TypeError,
    "latest",
  );
  assertThrows(
    () =>
      validateCadImmediatePlacementSource(sourceFixture({
        placements: [{
          usageElementId: "usage-left",
          partDefinitionElementId: "def-rail",
          placement: {
            translationMm: [0, Number.POSITIVE_INFINITY, 0],
            rotationDeg: [0, 0, 0],
          },
        }],
      })),
    TypeError,
    "finite number",
  );
});
