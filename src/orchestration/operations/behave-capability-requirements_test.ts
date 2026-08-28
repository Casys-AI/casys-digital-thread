import { assert, assertEquals } from "@std/assert";
import { engineeringOperationRegistry } from "./registry.ts";
import { BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS } from "./behave-capability-requirements.ts";

Deno.test("Behave capability demand is exact, registered and provider-selection-free", () => {
  const catalog = BEHAVE_FOUNDATION_CAPABILITY_REQUIREMENTS;
  assertEquals(catalog.schemaVersion, "capability-requirement-catalog-candidate/0.1");
  assertEquals(
    catalog.entries.map((entry) => `${entry.operation.id}@${entry.operation.version}`),
    [
      "architecture.seed-syson-model@2",
      "model.write-architecture@1",
      "model.write-requirements@1",
      "design.write-geometry@1",
      "verify.run-fea-static-proof@3",
    ],
  );
  assertEquals(
    catalog.entries.at(-1)?.capabilities.map((capability) => capability.id),
    [
      "mechanics.solve-static-structural",
      "model.evaluate-requirement",
    ],
  );
  assertEquals(
    catalog.entries.find((entry) => entry.operation.id === "design.write-geometry")
      ?.capabilities[0]?.use,
    "preparation",
  );

  for (const entry of catalog.entries) {
    assert(
      engineeringOperationRegistry.get(entry.operation),
      `${entry.operation.id}@${entry.operation.version} must stay registered`,
    );
  }
  assertEquals(
    new Set(
      catalog.entries.map((entry) =>
        `${entry.operation.id}@${entry.operation.version}`
      ),
    ).size,
    catalog.entries.length,
  );

  const encoded = JSON.stringify(catalog);
  for (const forbidden of ['"provider"', '"tool"', '"args"', '"image"', '"endpoint"']) {
    assertEquals(
      encoded.includes(forbidden),
      false,
      `catalog must not contain ${forbidden}`,
    );
  }
  assertEquals(Object.isFrozen(catalog), true);
  assertEquals(Object.isFrozen(catalog.entries[0]), true);
});
