/**
 * Code-owned cache-preparation recipes for non-persistent first-party
 * materials.  The registry is deliberately independent from launch groups:
 * it selects only an exact local cache recipe after the capability planner has
 * already selected the material.
 */

import type {
  AtomicCapabilityRuntimeMaterial,
  AtomicCapabilityRuntimeUnit,
  CapabilityRuntimeCatalog,
} from "../../application/control-plane/read-model/capability-runtime-catalog.ts";
import type { CapabilityRuntimeCachePreparationRecipeRegistry } from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";
import type { AdmittedSpiceExecutionProfile } from "../../application/ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import { validateCapabilityRuntimeCatalog } from "./capability-runtime-catalog.ts";
import {
  type GeometryModuleAssemblyExecutionProfile,
  validateGeometryModuleAssemblyExecutionProfile,
} from "../cad/module-assembly/fixed-geometry-module-assembly-profile.ts";
import {
  validateAdmittedSpiceExecutionProfile,
} from "../electrical/spice/admitted/execution-profile-catalog.ts";
import {
  LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
} from "../electrical/spice/admitted/local-image-references.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";
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
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID =
  "cache.ngspice.01-source" as const;
export const FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID =
  "cache.ngspice.02-runtime" as const;

export const FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID =
  "cache.geometry-module.01-source" as const;
export const FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID =
  "cache.geometry-module.02-runtime" as const;

const CACHE_SOURCE_PROFILE_SCHEMA =
  "first-party-capability-runtime-cache-source-profile/1.0" as const;
const CACHE_SOURCE_PROFILE_VERSION = "1.0.0" as const;

export interface FirstPartyCapabilityRuntimeCachePreparationRegistryOptions {
  /** Current validated local catalogue, never caller-provided material data. */
  readonly catalog: CapabilityRuntimeCatalog;
  /**
   * The profile from the actually composed admitted-SPICE worker.  A
   * profile-only catalogue is not sufficient to enroll the runtime recipe.
   */
  readonly admittedSpiceRuntimeProfile?: AdmittedSpiceExecutionProfile;
  /**
   * The profile resolved by the actually composed geometry-module assembler.
   * Catalogue metadata alone cannot attest its local Microsandbox contract.
   */
  readonly geometryModuleAssemblyRuntimeProfile?:
    GeometryModuleAssemblyExecutionProfile;
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

/**
 * The adopted non-persistent first-party lane. Each Docker source cache and
 * its distinct Microsandbox runtime remains one separately journalled atomic
 * recipe; a Docker digest is never passed as a runtime pin.
 */
export async function createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry(
  options: FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
): Promise<FirstPartyCapabilityRuntimeCachePreparationRecipeRegistry> {
  const [spice, geometry] = await Promise.all([
    options.admittedSpiceRuntimeProfile === undefined
      ? Promise.resolve([])
      : createFirstPartyAdmittedSpiceCachePreparationRecipes({
        catalog: options.catalog,
        admittedSpiceRuntimeProfile: options.admittedSpiceRuntimeProfile,
      }),
    options.geometryModuleAssemblyRuntimeProfile === undefined
      ? Promise.resolve([])
      : createFirstPartyGeometryModuleCachePreparationRecipes({
        catalog: options.catalog,
        runtimeProfile: options.geometryModuleAssemblyRuntimeProfile,
      }),
  ]);
  if (spice.length === 0 && geometry.length === 0) {
    throw new TypeError(
      "First-party cache preparation requires one actually composed executable lane.",
    );
  }
  return new FirstPartyCapabilityRuntimeCachePreparationRecipeRegistry(
    [...spice, ...geometry],
  );
}

export async function createFirstPartyAdmittedSpiceCachePreparationRecipes(
  options: FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
): Promise<readonly CapabilityRuntimeCachePreparationRecipe[]> {
  const [catalog, runtimeProfile] = await Promise.all([
    validateCapabilityRuntimeCatalog(options.catalog),
    validateAdmittedSpiceExecutionProfile(options.admittedSpiceRuntimeProfile),
  ]);
  const source = requireExactMaterial(catalog, {
    unitId: "casys.spice-worker",
    materialId: "ngspice-docker-source-image",
    kind: "oci-image",
    lifecycle: "cache",
    imageReference: LOCAL_ADMITTED_SPICE_DOCKER_SOURCE_IMAGE_REFERENCE,
  });
  const runtime = requireExactMaterial(catalog, {
    unitId: "casys.spice-worker",
    materialId: "ngspice-runtime-image",
    kind: "microvm-image",
    lifecycle: "ephemeral",
    imageReference: LOCAL_ADMITTED_SPICE_EXECUTION_IMAGE_REFERENCE,
  });
  if (
    runtime.material.imageReference !== runtimeProfile.runtimeBackend.imageReference
  ) {
    throw new TypeError(
      "The admitted-SPICE cache runtime profile does not attest the catalogued runtime image.",
    );
  }
  const runtimeDigest = imageDigest(runtime.material.imageReference);
  if (runtimeProfile.runtimeBackend.imageDigest.digest !== runtimeDigest) {
    throw new TypeError(
      "The admitted-SPICE cache runtime profile does not attest the catalogued runtime digest.",
    );
  }
  const sourceProfile = await sourceCacheProfile({
    id: "ngspice-docker-source-cache",
    unitId: source.unit.id,
    material: source.material,
  });
  const runtimeCacheProfile = executionCacheProfile(runtimeProfile);
  return Object.freeze([
    await atomicRecipe({
      id: FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
      unitId: source.unit.id,
      material: source.material,
      profile: sourceProfile,
    }),
    await atomicRecipe({
      id: FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
      unitId: runtime.unit.id,
      material: runtime.material,
      profile: runtimeCacheProfile,
    }),
  ]);
}

/** Derives the adopted geometry source and runtime recipes from one exact unit. */
export async function createFirstPartyGeometryModuleCachePreparationRecipes(
  input: {
    readonly catalog: CapabilityRuntimeCatalog;
    readonly runtimeProfile: GeometryModuleAssemblyExecutionProfile;
  },
): Promise<readonly CapabilityRuntimeCachePreparationRecipe[]> {
  const [catalog, runtimeProfile] = await Promise.all([
    validateCapabilityRuntimeCatalog(input.catalog),
    validateGeometryModuleAssemblyExecutionProfile(input.runtimeProfile),
  ]);
  const source = requireExactMaterial(catalog, {
    unitId: "casys.geometry-module-assembler-worker",
    unitVersion: "1.1.0",
    materialId: "geometry-module-assembler-docker-source-image",
    kind: "oci-image",
    lifecycle: "cache",
    imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
  });
  const runtime = requireExactMaterial(catalog, {
    unitId: "casys.geometry-module-assembler-worker",
    unitVersion: "1.1.0",
    materialId: "geometry-module-assembler-worker-image",
    kind: "microvm-image",
    lifecycle: "ephemeral",
    imageReference: LOCAL_GEOMETRY_MODULE_ASSEMBLY_IMAGE_REFERENCE,
  });
  if (
    runtimeProfile.imageReference !== runtime.material.imageReference ||
    runtimeProfile.runtimeBackend.imageReference !== runtime.material.imageReference ||
    runtimeProfile.runtimeBackend.imageDigest.digest !==
      imageDigest(runtime.material.imageReference)
  ) {
    throw new TypeError(
      "The geometry-module cache runtime profile does not attest the catalogued runtime image.",
    );
  }
  return Object.freeze([
    await atomicRecipe({
      id: FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
      unitId: source.unit.id,
      material: source.material,
      profile: await sourceCacheProfile({
        id: "geometry-module-assembler-docker-source-cache",
        unitId: source.unit.id,
        material: source.material,
      }),
    }),
    await atomicRecipe({
      id: FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
      unitId: runtime.unit.id,
      material: runtime.material,
      profile: executionCacheProfile(runtimeProfile),
    }),
  ]);
}

function requireExactMaterial(
  catalog: CapabilityRuntimeCatalog,
  expected: {
    readonly unitId: string;
    readonly unitVersion?: string;
    readonly materialId: string;
    readonly kind: AtomicCapabilityRuntimeMaterial["kind"];
    readonly lifecycle: AtomicCapabilityRuntimeMaterial["lifecycle"];
    readonly imageReference: string;
  },
): {
  readonly unit: AtomicCapabilityRuntimeUnit;
  readonly material: AtomicCapabilityRuntimeMaterial;
} {
  const unit = catalog.units.find((candidate) => candidate.id === expected.unitId);
  const material = unit?.materials.find((candidate) =>
    candidate.id === expected.materialId
  );
  if (
    !unit ||
    (expected.unitVersion !== undefined && unit.version !== expected.unitVersion) ||
    !material ||
    material.kind !== expected.kind ||
    material.lifecycle !== expected.lifecycle ||
    material.imageReference !== expected.imageReference || material.launchGroup !== null
  ) {
    throw new TypeError(
      `The first-party cache registry lacks exact ${expected.unitId}/${expected.materialId} material authority.`,
    );
  }
  return { unit, material };
}

async function atomicRecipe(input: {
  readonly id: string;
  readonly unitId: string;
  readonly material: AtomicCapabilityRuntimeMaterial;
  readonly profile: CapabilityRuntimeCachePreparationProfile;
}): Promise<CapabilityRuntimeCachePreparationRecipe> {
  if (input.material.lifecycle === "persistent") {
    throw new TypeError("First-party cache recipes cannot name persistent material.");
  }
  const lifecycle = input.material.lifecycle;
  return await createCapabilityRuntimeCachePreparationRecipe({
    schemaVersion: "capability-runtime-cache-preparation-recipe/1.0",
    id: input.id,
    version: "1.0.0",
    scope: {
      materials: [{
        material: {
          unitId: input.unitId,
          materialId: input.material.id,
          imageDigest: imageDigest(input.material.imageReference),
        },
        imageReference: input.material.imageReference,
        lifecycle,
        profile: input.profile,
      }],
    },
  });
}

async function sourceCacheProfile(input: {
  readonly id: string;
  readonly unitId: string;
  readonly material: AtomicCapabilityRuntimeMaterial;
}): Promise<CapabilityRuntimeCachePreparationProfile> {
  const body = {
    schemaVersion: CACHE_SOURCE_PROFILE_SCHEMA,
    id: input.id,
    version: CACHE_SOURCE_PROFILE_VERSION,
    material: {
      unitId: input.unitId,
      materialId: input.material.id,
      imageReference: input.material.imageReference,
      kind: input.material.kind,
      lifecycle: input.material.lifecycle,
    },
  };
  return Object.freeze({
    id: input.id,
    version: CACHE_SOURCE_PROFILE_VERSION,
    fingerprint: await sha256Fingerprint(body),
  });
}

function executionCacheProfile(value: {
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly profileFingerprint: ContentFingerprint;
}): CapabilityRuntimeCachePreparationProfile {
  return Object.freeze({
    id: value.executionProfile.id,
    version: value.executionProfile.version,
    fingerprint: structuredClone(value.profileFingerprint),
  });
}

function imageDigest(reference: string): string {
  const marker = "@sha256:";
  const index = reference.lastIndexOf(marker);
  if (index < 0) throw new TypeError("First-party cache image is not digest-pinned.");
  return reference.slice(index + marker.length);
}
