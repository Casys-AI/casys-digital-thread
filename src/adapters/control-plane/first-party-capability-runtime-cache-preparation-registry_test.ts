import { assertEquals, assertRejects } from "@std/assert";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import { LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE } from "../electrical/spice/admitted/local-image-references.ts";
import {
  LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";
import { LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE } from "../fea/isolated-v3/local-calculix-isolated-execution-options.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { CapabilityRuntimeCachePreparationRequestedMaterial } from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import {
  createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry,
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  firstPartyMicrosandboxBootstrapCacheProfileBody,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
  type FirstPartyOciDigestSource,
} from "./first-party-microsandbox-image-bootstrap.ts";

Deno.test("first-party cache registry enrolls one recipe per catalogued microvm-image", async () => {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const registry =
    await createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry({
      catalog,
    });
  const recipes = registry.recipes();
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);

  assertEquals(
    recipes.map((recipe) => recipe.id).toSorted(),
    [
      FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
      FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
      FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
      FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
      FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
    ].toSorted(),
  );
  assertEquals(recipes.every((recipe) => recipe.scope.materials.length === 1), true);
  assertEquals(
    recipes.map((recipe) => recipe.scope.materials[0]?.lifecycle),
    recipes.map(() => "ephemeral"),
  );
  assertEquals(
    recipes.some((recipe) =>
      recipe.scope.materials[0]?.material.materialId.endsWith("docker-source-image")
    ),
    false,
  );

  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  assertEquals(
    byId.get(FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID)?.scope.materials[0]
      ?.imageReference,
    pinnedOciImageReference(LOCAL_BUILD123D_EXECUTION_IMAGE_REFERENCE, "$test"),
  );
  assertEquals(
    byId.get(FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID)?.scope.materials[0]
      ?.imageReference,
    LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  );
  assertEquals(
    byId.get(FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID)?.scope.materials[0]?.imageReference,
    pinnedOciImageReference(LOCAL_CALCULIX_EXECUTION_IMAGE_REFERENCE, "$test"),
  );
  assertEquals(
    byId.get(FIRST_PARTY_MODELICA_CACHE_RECIPE_ID)?.scope.materials[0]
      ?.imageReference,
    pinnedOciImageReference(LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE, "$test"),
  );
  assertEquals(
    byId.get(FIRST_PARTY_MODELICA_CACHE_RECIPE_ID)?.scope.materials[0]
      ?.material,
    {
      unitId: "casys.modelica-worker",
      materialId: "modelica-worker-image",
      imageDigest: LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE.slice(
        LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE.lastIndexOf("@sha256:") + 8,
      ),
    },
  );
  assertEquals(
    byId.get(FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID)?.scope.materials[0]?.imageReference,
    pinnedOciImageReference(LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE, "$test"),
  );

  const modelica = descriptors.filter((descriptor) =>
    descriptor.recipeId === FIRST_PARTY_MODELICA_CACHE_RECIPE_ID
  );
  assertEquals(modelica.length, 1);
  assertEquals(modelica[0]?.unitId, "casys.modelica-worker");
  assertEquals(modelica[0]?.materialId, "modelica-worker-image");
  assertEquals(modelica[0]?.physicalImageId, "modelica-microsandbox-worker");

  const plan = await registry.plan(requested(recipes));
  assertEquals(plan.recipes.map((recipe) => recipe.id), [
    FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
    FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
    FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
    FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
    FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  ]);
  assertEquals(plan.unavailable, []);
});

Deno.test("first-party cache registry refuses a catalogue missing a microvm-image", async () => {
  await assertRejects(
    async () =>
      await createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry({
        catalog: await catalogWithoutNgspiceRuntime(),
      }),
    Error,
    "do not cover the catalogue",
  );
});

Deno.test(
  "oci-digest cache profile ignores a retained build recipe change",
  async () => {
    const catalog = await createFirstPartyCapabilityRuntimeCatalog();
    const ngspice = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog)
      .find((descriptor) =>
        descriptor.recipeId === FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID
      );
    if (!ngspice) throw new Error("ngspice bootstrap descriptor is absent");
    const source: FirstPartyOciDigestSource = {
      kind: "oci-digest",
      reference: ngspice.targetImageReference,
    };
    const acquiredByDigest: FirstPartyMicrosandboxImageBootstrapDescriptor = {
      ...ngspice,
      source,
    };
    const retainedRecipeChanged: FirstPartyMicrosandboxImageBootstrapDescriptor = {
      ...acquiredByDigest,
      buildRecipe: {
        ...acquiredByDigest.buildRecipe,
        dockerfile: "images/calculix-microsandbox-worker/Dockerfile",
      },
    };
    const original = firstPartyMicrosandboxBootstrapCacheProfileBody(
      acquiredByDigest,
    );
    const changed = firstPartyMicrosandboxBootstrapCacheProfileBody(
      retainedRecipeChanged,
    );
    assertEquals("buildRecipe" in original.bootstrap, false);
    assertEquals(original, changed);
    assertEquals(await sha256Fingerprint(original), await sha256Fingerprint(changed));
  },
);

Deno.test("first-party cache registry options cannot select an image or profile", () => {
  const keys = Object.keys({
    catalog: null,
  } as unknown as Record<string, unknown>);
  assertEquals(keys, ["catalog"]);
});

async function catalogWithoutNgspiceRuntime(): Promise<CapabilityRuntimeCatalog> {
  const catalog = await createFirstPartyCapabilityRuntimeCatalog();
  const spice = catalog.units.find((unit) => unit.id === "casys.spice-worker");
  if (!spice) throw new Error("spice unit is absent");
  return {
    ...catalog,
    units: catalog.units.filter((unit) => unit.id !== spice.id),
    bindings: catalog.bindings.filter((binding) => !binding.unitIds.includes(spice.id)),
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
    `${left.material.unitId}\u0000${left.material.materialId}`.localeCompare(
      `${right.material.unitId}\u0000${right.material.materialId}`,
    )
  );
}
