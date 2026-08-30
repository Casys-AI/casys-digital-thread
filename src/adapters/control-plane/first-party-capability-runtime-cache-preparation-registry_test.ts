import { assertEquals, assertRejects } from "@std/assert";
import {
  type CapabilityRuntimeCatalog,
  fingerprintAtomicCapabilityRuntimeUnit,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";
import { FixedAdmittedSpiceExecutionProfileCatalog } from "../electrical/spice/admitted/execution-profile-catalog.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "../electrical/spice/admitted/local-image-references.ts";
import { createLocalGeometryModuleAssemblyServerOptions } from "../cad/module-assembly/first-party-geometry-module-assembly.ts";
import { FixedGeometryModuleAssemblyProfileCatalog } from "../cad/module-assembly/fixed-geometry-module-assembly-profile.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry,
  createFirstPartyGeometryModuleCachePreparationRecipes,
  FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";
import type { CapabilityRuntimeCachePreparationRequestedMaterial } from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";

const FINGERPRINT = { algorithm: "sha256" as const, digest: "a".repeat(64) };

Deno.test("first-party cache registry retains disjoint atomic ngspice source and runtime recipes", async () => {
  const registry =
    await createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      admittedSpiceRuntimeProfile: await admittedSpiceRuntimeProfile(),
    });
  const recipes = registry.recipes();

  assertEquals(recipes.map((recipe) => recipe.id), [
    FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
    FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  ]);
  assertEquals(recipes.map((recipe) => recipe.scope.materials.length), [1, 1]);
  const [source, runtime] = recipes;
  if (!source || !runtime) throw new Error("first-party SPICE recipes are absent");
  assertEquals(
    source.scope.materials[0]?.imageReference,
    LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  );
  assertEquals(
    runtime.scope.materials[0]?.imageReference,
    LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  );
  assertEquals(source.scope.materials[0]?.profile.id, "ngspice-docker-source-cache");
  assertEquals(
    source.scope.materials[0]?.profile.id === runtime.scope.materials[0]?.profile.id,
    false,
  );
  assertEquals(
    source.scope.materials[0]?.profile.fingerprint ===
      runtime.scope.materials[0]?.profile.fingerprint,
    false,
  );

  const plan = await registry.plan(requested(recipes));
  assertEquals(plan.recipes.map((recipe) => recipe.id), [
    FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
    FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  ]);
  assertEquals(plan.unavailable, []);
});

Deno.test("geometry cache recipe builder remains unavailable until source and runtime are in one adopted catalogue unit", async () => {
  await assertRejects(
    async () =>
      createFirstPartyGeometryModuleCachePreparationRecipes({
        catalog: await catalogWithoutGeometrySource(),
        runtimeProfile: await geometryRuntimeProfile(),
      }),
    TypeError,
    "one exact geometry-module assembler Docker source material",
  );
});

Deno.test("geometry cache recipe builder derives atomic source and runtime identities from an adopted catalogue", async () => {
  const recipes = await createFirstPartyGeometryModuleCachePreparationRecipes({
    catalog: await catalogWithGeometrySource(),
    runtimeProfile: await geometryRuntimeProfile(),
  });

  assertEquals(recipes.map((recipe) => recipe.id), [
    FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
    FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
  ]);
  assertEquals(recipes.map((recipe) => recipe.scope.materials.length), [1, 1]);
  const [source, runtime] = recipes;
  if (!source || !runtime) throw new Error("geometry cache recipes are absent");
  assertEquals(
    source.scope.materials[0]?.imageReference,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  );
  assertEquals(
    source.scope.materials[0]?.material.unitId,
    runtime.scope.materials[0]?.material.unitId,
  );
  assertEquals(
    source.scope.materials[0]?.profile.id === runtime.scope.materials[0]?.profile.id,
    false,
  );
});

async function admittedSpiceRuntimeProfile() {
  return await new FixedAdmittedSpiceExecutionProfileCatalog({
    imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
    policy: {
      id: "spice-cache-preparation-test-policy",
      version: "1.0.0",
      fingerprint: FINGERPRINT,
    },
    limits: {
      maxWallTimeMs: 30_000,
      maxCpuTimeMs: 25_000,
      maxMemoryBytes: 512 * 1_048_576,
      maxProcesses: 16,
      maxStdoutBytes: 65_536,
      maxStderrBytes: 65_536,
      maxOutputFileBytes: 262_144,
      maxOutputTotalBytes: 524_288,
    },
  }).initial();
}

async function geometryRuntimeProfile() {
  const options = await createLocalGeometryModuleAssemblyServerOptions();
  return await new FixedGeometryModuleAssemblyProfileCatalog(options.profile).initial();
}

async function catalogWithGeometrySource(): Promise<CapabilityRuntimeCatalog> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const geometry = catalog.units.find((unit) =>
    unit.id === "casys.geometry-module-assembler-worker"
  );
  if (!geometry) throw new Error("geometry module unit is absent");
  const runtime = geometry.materials.find((material) =>
    material.id === "geometry-module-assembler-worker-image"
  );
  if (!runtime) throw new Error("geometry runtime material is absent");
  const source = {
    ...runtime,
    id: "geometry-module-assembler-docker-source-image",
    kind: "oci-image" as const,
    imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
    lifecycle: "cache" as const,
    effects: {
      ...runtime.effects,
      services: [],
    },
  };
  const materials = [
    source,
    ...geometry.materials.filter((material) =>
      material.imageReference !==
        LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE
    ),
  ] as const;
  const amendedGeometry = {
    ...geometry,
    materials,
    manifestFingerprint: await fingerprintAtomicCapabilityRuntimeUnit({
      id: geometry.id,
      version: geometry.version,
      materials,
    }),
  };
  return {
    ...catalog,
    units: catalog.units.map((unit) =>
      unit.id === geometry.id ? amendedGeometry : unit
    ),
  };
}

async function catalogWithoutGeometrySource(): Promise<CapabilityRuntimeCatalog> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const geometry = catalog.units.find((unit) =>
    unit.id === "casys.geometry-module-assembler-worker"
  );
  if (!geometry) throw new Error("geometry module unit is absent");
  const materials = geometry.materials.filter((material) =>
    material.imageReference !==
      LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE
  );
  if (materials.length === 0) throw new Error("geometry runtime material is absent");
  const amendedGeometry = {
    ...geometry,
    materials,
    manifestFingerprint: await fingerprintAtomicCapabilityRuntimeUnit({
      id: geometry.id,
      version: geometry.version,
      materials,
    }),
  };
  return {
    ...catalog,
    units: catalog.units.map((unit) =>
      unit.id === geometry.id ? amendedGeometry : unit
    ),
  };
}

function requested(
  recipes: readonly {
    readonly scope: {
      readonly materials: readonly {
        readonly material:
          CapabilityRuntimeCachePreparationRequestedMaterial["material"];
        readonly imageReference: string;
        readonly lifecycle: "ephemeral" | "cache";
      }[];
    };
  }[],
): readonly CapabilityRuntimeCachePreparationRequestedMaterial[] {
  return recipes.flatMap((recipe) =>
    recipe.scope.materials.map((material) => ({
      material: material.material,
      imageReference: material.imageReference,
      lifecycle: material.lifecycle,
    }))
  ).toSorted((left, right) =>
    JSON.stringify(left.material).localeCompare(JSON.stringify(right.material))
  );
}
