import { assertEquals } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "./first-party-capability-runtime-nonpersistent-materials.ts";

Deno.test("first-party catalogue runtime materials resolve only to Microsandbox cache backends", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const expectations = createFirstPartyNonpersistentMicrosandboxExpectations(catalog);
  const ephemeral = catalog.units.flatMap((unit) =>
    unit.materials.filter((material) =>
      material.launchGroup === null && material.kind === "microvm-image"
    ).map((material) => `${unit.id}/${material.id}`)
  ).toSorted();
  assertEquals(
    expectations.map((entry) => `${entry.material.unitId}/${entry.material.materialId}`)
      .toSorted(),
    ephemeral,
  );
  assertEquals(
    catalog.units.flatMap((unit) =>
      unit.materials.filter((material) => material.lifecycle === "cache")
    ),
    [],
  );
});
