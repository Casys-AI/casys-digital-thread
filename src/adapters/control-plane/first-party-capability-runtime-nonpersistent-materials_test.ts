import { assertEquals } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { createFirstPartyNonpersistentMicrosandboxExpectations } from "./first-party-capability-runtime-nonpersistent-materials.ts";
import { capabilityRuntimeNonpersistentRemovalBackend } from "../../application/control-plane/capability-runtime-nonpersistent-removal-backend.ts";

Deno.test("first-party catalogue non-persistent materials resolve to docker or microsandbox cache backends", async () => {
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
  const spiceSource = catalog.units.find((unit) => unit.id === "casys.spice-worker")
    ?.materials.find((material) => material.id === "ngspice-docker-source-image");
  assertEquals(
    spiceSource && capabilityRuntimeNonpersistentRemovalBackend(spiceSource),
    "docker-cache",
  );
  const calculix = catalog.units.find((unit) => unit.id === "casys.calculix-worker")
    ?.materials.find((material) => material.id === "calculix-worker-image");
  assertEquals(
    calculix && capabilityRuntimeNonpersistentRemovalBackend(calculix),
    "microsandbox-cache",
  );
});
