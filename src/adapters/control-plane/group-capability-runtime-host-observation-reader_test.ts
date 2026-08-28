import { assertEquals, assertRejects } from "@std/assert";
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
              qualification: "qualified" as const,
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
