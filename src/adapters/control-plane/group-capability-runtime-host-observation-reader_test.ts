import { assertEquals, assertRejects } from "@std/assert";
import { capabilityRuntimeCatalogMaterialsForRequirements } from "../../application/control-plane/capability-runtime-catalog-materials.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { GroupCapabilityRuntimeHostObservationReader } from "./group-capability-runtime-host-observation-reader.ts";

const HOST = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("group host observation takes the injected daemon platform rather than process architecture", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  let observedPlatform = false;
  const reader = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    {
      observe: (materials) =>
        Promise.resolve(
          new Map(materials.map((material) => [
            `${material.unitId}\u0000${material.materialId}`,
            {
              material: "installed" as const,
              runtime: "inactive" as const,
            },
          ])),
        ),
    },
    { read: () => Promise.resolve(HOST) },
    {
      observePlatform: () => {
        observedPlatform = true;
        return Promise.resolve("linux/amd64" as const);
      },
    },
  );

  const observation = await reader.read();
  assertEquals(observedPlatform, true);
  assertEquals(observation.platform, "linux/amd64");
  assertEquals(observation.identityFingerprint, HOST);
});

Deno.test("scoped group host observation inspects only demanded materials", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const requested = capabilityRuntimeCatalogMaterialsForRequirements(catalog, [{
    id: "model.author-system",
    version: "1",
    use: "execution",
    minimumQualification: "qualified",
  }, {
    id: "geometry.observe-assembly-integrity",
    version: "1",
    use: "execution",
    minimumQualification: "qualified",
  }]);
  const observedKeys: string[] = [];
  const reader = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    {
      observe: (materials) => {
        observedKeys.push(
          ...materials.map(capabilityRuntimeMaterialKey),
        );
        return Promise.resolve(new Map());
      },
    },
    { read: () => Promise.resolve(HOST) },
    { observePlatform: () => Promise.resolve("linux/amd64" as const) },
  );

  await reader.read({ materials: requested });
  assertEquals(
    observedKeys.includes("casys.calculix-worker\u0000calculix-worker-image"),
    false,
  );
  assertEquals(
    observedKeys.some((key) => key.startsWith("casys.syson-stack\u0000")),
    true,
  );
});

Deno.test("unscoped group host observation remains the explicit full catalogue", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const observedKeys: string[] = [];
  const reader = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    {
      observe: (materials) => {
        observedKeys.push(
          ...materials.map(capabilityRuntimeMaterialKey),
        );
        return Promise.resolve(new Map());
      },
    },
    { read: () => Promise.resolve(HOST) },
    { observePlatform: () => Promise.resolve("linux/amd64" as const) },
  );

  await reader.read();
  assertEquals(
    observedKeys.includes("casys.calculix-worker\u0000calculix-worker-image"),
    true,
  );
});

Deno.test("group host observation fails closed when the daemon platform is unavailable", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const reader = new GroupCapabilityRuntimeHostObservationReader(
    catalog,
    { observe: () => Promise.resolve(new Map()) },
    { read: () => Promise.resolve(HOST) },
    {
      observePlatform: () =>
        Promise.reject(new Error("daemon observation unavailable")),
    },
  );

  await assertRejects(() => reader.read(), Error, "daemon observation unavailable");
});
