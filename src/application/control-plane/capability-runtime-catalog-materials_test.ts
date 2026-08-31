import { assertEquals } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "../../adapters/control-plane/first-party-capability-binding-catalog.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeCatalogMaterialsForRequirements } from "./capability-runtime-catalog-materials.ts";

Deno.test("catalogue materials for SysON and assembly omit the CalculiX worker", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const materials = capabilityRuntimeCatalogMaterialsForRequirements(catalog, [
    {
      id: "model.author-system",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
    },
    {
      id: "geometry.observe-assembly-integrity",
      version: "1",
      use: "execution",
      minimumQualification: "qualified",
    },
  ]);
  const keys = materials.map(capabilityRuntimeMaterialKey);
  assertEquals(
    keys.some((key) => key.startsWith("casys.syson-stack\u0000")),
    true,
  );
  assertEquals(
    keys.some((key) => key.startsWith("casys.mcp-build123d-observation\u0000")),
    true,
  );
  assertEquals(
    keys.includes("casys.calculix-worker\u0000calculix-worker-image"),
    false,
  );
});

Deno.test("catalogue materials for an empty demand stay empty", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  assertEquals(capabilityRuntimeCatalogMaterialsForRequirements(catalog, []), []);
});
