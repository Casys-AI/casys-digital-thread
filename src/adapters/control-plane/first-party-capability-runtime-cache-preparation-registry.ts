/**
 * Code-owned cache-preparation recipes for first-party microvm-image materials.
 *
 * One recipe is one catalogued Microsandbox target. Docker source/build is
 * internal acquisition material, never a second planner/UI recipe.
 */

import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeCachePreparationRecipeRegistry } from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";
import { validateCapabilityRuntimeCatalog } from "./capability-runtime-catalog.ts";
import {
  createCapabilityRuntimeCachePreparationRecipe,
  planCapabilityRuntimeCachePreparationRecipes,
  validateCapabilityRuntimeCachePreparationRequestedMaterials,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import type {
  CapabilityRuntimeCachePreparationProfile,
  CapabilityRuntimeCachePreparationRecipe,
  CapabilityRuntimeCachePreparationRecipePlan,
  CapabilityRuntimeCachePreparationRequestedMaterial,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
} from "./first-party-microsandbox-image-bootstrap.ts";

export {
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
};

const CACHE_BOOTSTRAP_PROFILE_SCHEMA =
  "first-party-microsandbox-image-bootstrap-profile/1.0" as const;
const CACHE_BOOTSTRAP_PROFILE_VERSION = "1.0.0" as const;

export interface FirstPartyCapabilityRuntimeCachePreparationRegistryOptions {
  /** Current validated local catalogue, never caller-provided material data. */
  readonly catalog: CapabilityRuntimeCatalog;
}

/** Immutable first-party registry; it has no registration or mutation API. */
export class FirstPartyCapabilityRuntimeCachePreparationRecipeRegistry
  implements CapabilityRuntimeCachePreparationRecipeRegistry {
  readonly #recipes: readonly CapabilityRuntimeCachePreparationRecipe[];

  constructor(recipes: readonly CapabilityRuntimeCachePreparationRecipe[]) {
    this.#recipes = Object.freeze(recipes.map((recipe) => structuredClone(recipe)));
  }

  plan(
    materials: readonly CapabilityRuntimeCachePreparationRequestedMaterial[],
  ): Promise<CapabilityRuntimeCachePreparationRecipePlan> {
    const requested = validateCapabilityRuntimeCachePreparationRequestedMaterials(
      materials,
    );
    return Promise.resolve(structuredClone(
      planCapabilityRuntimeCachePreparationRecipes({
        requested,
        recipes: this.#recipes,
      }),
    ));
  }

  /** Internal composition may inspect this closed set without widening it. */
  recipes(): readonly CapabilityRuntimeCachePreparationRecipe[] {
    return structuredClone(this.#recipes);
  }
}

export async function createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry(
  options: FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
): Promise<FirstPartyCapabilityRuntimeCachePreparationRecipeRegistry> {
  const catalog = await validateCapabilityRuntimeCatalog(options.catalog);
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(catalog);
  const recipes = await Promise.all(
    descriptors.map((descriptor) => atomicRecipe(descriptor)),
  );
  return new FirstPartyCapabilityRuntimeCachePreparationRecipeRegistry(recipes);
}

async function atomicRecipe(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
): Promise<CapabilityRuntimeCachePreparationRecipe> {
  return await createCapabilityRuntimeCachePreparationRecipe({
    schemaVersion: "capability-runtime-cache-preparation-recipe/1.0",
    id: descriptor.recipeId,
    version: "1.0.0",
    scope: {
      materials: [{
        material: {
          unitId: descriptor.unitId,
          materialId: descriptor.materialId,
          imageDigest: imageDigest(descriptor.targetImageReference),
        },
        imageReference: descriptor.targetImageReference,
        lifecycle: "ephemeral",
        profile: await bootstrapCacheProfile(descriptor),
      }],
    },
  });
}

async function bootstrapCacheProfile(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
): Promise<CapabilityRuntimeCachePreparationProfile> {
  return Object.freeze({
    id: descriptor.recipeId,
    version: CACHE_BOOTSTRAP_PROFILE_VERSION,
    fingerprint: await sha256Fingerprint(
      firstPartyMicrosandboxBootstrapCacheProfileBody(descriptor),
    ),
  });
}

/**
 * Cache-preparation fingerprint body. `buildRecipe` is included only when
 * the acquisition source is `trusted-dockerfile`, because that recipe is
 * then the fallback acquisition method. An `oci-digest` source fingerprints
 * the stable physical id, exact OCI source, and target only.
 */
export function firstPartyMicrosandboxBootstrapCacheProfileBody(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
) {
  return {
    schemaVersion: CACHE_BOOTSTRAP_PROFILE_SCHEMA,
    id: descriptor.recipeId,
    version: CACHE_BOOTSTRAP_PROFILE_VERSION,
    material: {
      unitId: descriptor.unitId,
      materialId: descriptor.materialId,
      imageReference: descriptor.targetImageReference,
      kind: "microvm-image" as const,
      lifecycle: "ephemeral" as const,
    },
    bootstrap: bootstrapAcquisitionFingerprint(descriptor),
  };
}

function bootstrapAcquisitionFingerprint(
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
) {
  const source = descriptor.source;
  const identity = {
    physicalImageId: descriptor.physicalImageId,
    source,
    targetImageReference: descriptor.targetImageReference,
  };
  if (source.kind === "trusted-dockerfile") {
    return {
      ...identity,
      buildRecipe: descriptor.buildRecipe,
    };
  }
  return identity;
}

function imageDigest(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new TypeError("First-party cache image is not digest-pinned.");
  return reference.slice(index + marker.length);
}
