/**
 * Local production composition for post-brief cache preparation.
 *
 * It is deliberately narrower than H1/Compose: the only mutation is an
 * exact, journalled Microsandbox import under the already shared host-mutation
 * lock.  No caller may nominate an image, source, runtime, port or command.
 */

import { CapabilityRuntimeCachePreparationCoordinator } from "../../application/control-plane/capability-runtime-cache-preparation-coordinator.ts";
import type {
  CapabilityRuntimeCachePreparationAcquirer,
  CapabilityRuntimeCachePreparationJournal,
  CapabilityRuntimeCachePreparationObserver,
} from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";
import type { CapabilityRuntimeHostMutationLock } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type {
  CapabilityRuntimeCachePreparationRecipe,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  LocalMicrosandboxCapabilityRuntimeCache,
} from "./microsandbox-capability-runtime-cache.ts";
import {
  LocalNgspiceDockerSourceImageCache,
} from "../electrical/spice/admitted/ngspice-docker-source-image-cache.ts";
import {
  createLocalNgspiceMicrosandboxCachePorts,
  expectedNgspiceRuntimeImage,
  prepareAdmittedNgspiceMicrosandboxCache,
} from "../electrical/spice/admitted/microsandbox-cache-preparation.ts";
import {
  createLocalMicrosandboxSdk,
  microsandboxHostArchitecture,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "./file-capability-runtime-cache-preparation-journal.ts";
import {
  createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry,
  FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
  type FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";

export interface FirstPartyAdmittedSpiceCachePreparationActions {
  /** Read-only source-cache inspection under its exact Docker contract. */
  observeSource(): Promise<boolean>;
  /** Read-only runtime-cache inspection under its exact Microsandbox contract. */
  observeRuntime(): Promise<boolean>;
  /** Code-owned import of the reviewed source into the runtime cache. */
  acquireRuntime(): Promise<void>;
}

export interface LocalCapabilityRuntimeCachePreparationCompositionOptions
  extends FirstPartyCapabilityRuntimeCachePreparationRegistryOptions {
  /** The same host mutation mutex used by H1 material acquisition and JIT. */
  readonly lock: CapabilityRuntimeHostMutationLock;
  /** Durable journal location; defaults to the isolated cache-preparation root. */
  readonly journalDirectory?: string;
  /** Internal injection seam for focused tests; never an MCP/project surface. */
  readonly journal?: CapabilityRuntimeCachePreparationJournal;
  /** Internal injection seam for focused tests; all live actions are fixed by default. */
  readonly actions?: FirstPartyAdmittedSpiceCachePreparationActions;
  readonly now?: () => string;
}

export interface LocalCapabilityRuntimeCachePreparationComposition {
  readonly cachePreparer: CapabilityRuntimeCachePreparationCoordinator;
  readonly journal: CapabilityRuntimeCachePreparationJournal;
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
}

/**
 * Creates the production cache lane only when an actual admitted-SPICE runtime
 * profile is supplied by server composition.  It shares, rather than creates,
 * the H1 host mutation lock and persists every intent in a separate durable
 * cache journal.
 */
export async function createLocalCapabilityRuntimeCachePreparationComposition(
  options: LocalCapabilityRuntimeCachePreparationCompositionOptions,
): Promise<LocalCapabilityRuntimeCachePreparationComposition> {
  if (options.journal !== undefined && options.journalDirectory !== undefined) {
    throw new TypeError(
      "Cache preparation composition accepts either a journal or a journal directory.",
    );
  }
  const registry =
    await createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry(
      options,
    );
  const recipes = registry.recipes();
  const actions = options.actions ?? createLocalAdmittedSpiceCachePreparationActions(
    recipes,
  );
  const ports = createFirstPartyAdmittedSpiceCachePreparationPorts({
    recipes,
    actions,
  });
  const journal = options.journal ?? new FileCapabilityRuntimeCachePreparationJournal(
    options.journalDirectory,
  );
  return Object.freeze({
    cachePreparer: new CapabilityRuntimeCachePreparationCoordinator({
      lock: options.lock,
      journal,
      recipes: registry,
      observer: ports.observer,
      acquirer: ports.acquirer,
      now: options.now,
    }),
    journal,
    recipes: Object.freeze(recipes),
  });
}

/**
 * Strict recipe dispatcher shared by the local production composition and its
 * focused tests.  Source cache material has no acquisition operation: it can
 * only be observed and is never pulled or fabricated.  Runtime acquisition
 * remains the one reviewed Docker-save to Microsandbox-import sequence.
 */
export function createFirstPartyAdmittedSpiceCachePreparationPorts(input: {
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
  readonly actions: FirstPartyAdmittedSpiceCachePreparationActions;
}): {
  readonly observer: CapabilityRuntimeCachePreparationObserver;
  readonly acquirer: CapabilityRuntimeCachePreparationAcquirer;
} {
  const source = requiredRecipe(
    input.recipes,
    FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
  );
  const runtime = requiredRecipe(
    input.recipes,
    FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  );
  const observer: CapabilityRuntimeCachePreparationObserver = {
    async observe({ recipe }) {
      if (sameRecipe(recipe, source)) {
        return {
          status: await input.actions.observeSource() ? "exact" : "not-exact",
        };
      }
      if (sameRecipe(recipe, runtime)) {
        return {
          status: await input.actions.observeRuntime() ? "exact" : "not-exact",
        };
      }
      throw new TypeError(
        "Cache preparation observer received an unregistered recipe.",
      );
    },
  };
  const acquirer: CapabilityRuntimeCachePreparationAcquirer = {
    async acquire({ recipe }) {
      if (sameRecipe(recipe, source)) {
        throw new Error(
          "The exact Docker source cache is absent; cache preparation never pulls a source image.",
        );
      }
      if (!sameRecipe(recipe, runtime)) {
        throw new TypeError(
          "Cache preparation acquirer received an unregistered recipe.",
        );
      }
      await input.actions.acquireRuntime();
    },
  };
  return Object.freeze({
    observer: Object.freeze(observer),
    acquirer: Object.freeze(acquirer),
  });
}

/**
 * The live action set owns all host interaction.  It receives no caller data:
 * exact recipe validation happened before dispatch, source inspection is
 * read-only, and the existing ngspice operator owns the archive path/import.
 */
export function createLocalAdmittedSpiceCachePreparationActions(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
): FirstPartyAdmittedSpiceCachePreparationActions {
  const source = requiredRecipe(
    recipes,
    FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
  );
  const runtime = requiredRecipe(
    recipes,
    FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  );
  const sourceMaterial = exactlyOneScopeMaterial(source);
  const runtimeMaterial = exactlyOneScopeMaterial(runtime);
  const expectedRuntime = expectedNgspiceRuntimeImage(
    microsandboxHostArchitecture(),
  );
  if (
    runtimeMaterial.imageReference !== expectedRuntime.reference ||
    runtimeMaterial.material.imageDigest !==
      expectedRuntime.manifestDigest.slice("sha256:".length)
  ) {
    throw new TypeError(
      "The registered ngspice runtime cache recipe differs from the reviewed runtime manifest.",
    );
  }
  const sourceCache = new LocalNgspiceDockerSourceImageCache();
  const runtimeCache = new LocalMicrosandboxCapabilityRuntimeCache(
    createLocalMicrosandboxSdk,
    [{
      material: {
        unitId: runtimeMaterial.material.unitId,
        materialId: runtimeMaterial.material.materialId,
      },
      image: expectedRuntime,
      executionProfileFingerprint: runtimeMaterial.profile.fingerprint,
    }],
  );
  return Object.freeze({
    async observeSource(): Promise<boolean> {
      const observations = await sourceCache.observe([sourceMaterial.material]);
      return observations.get(materialKey(sourceMaterial.material))?.material ===
        "installed";
    },
    async observeRuntime(): Promise<boolean> {
      try {
        await runtimeCache.ensureExactCached({
          material: runtimeMaterial.material,
          imageReference: runtimeMaterial.imageReference,
          executionProfileFingerprint: runtimeMaterial.profile.fingerprint,
        });
        return true;
      } catch {
        return false;
      }
    },
    async acquireRuntime(): Promise<void> {
      await prepareAdmittedNgspiceMicrosandboxCache(
        await createLocalNgspiceMicrosandboxCachePorts(),
      );
    },
  });
}

function requiredRecipe(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
  id: string,
): CapabilityRuntimeCachePreparationRecipe {
  const matches = recipes.filter((recipe) => recipe.id === id);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new TypeError(`First-party cache recipe ${id} is not uniquely registered.`);
  }
  const recipe = matches[0];
  if (recipe.scope.materials.length !== 1) {
    throw new TypeError(`First-party cache recipe ${id} must be atomic.`);
  }
  return recipe;
}

function exactlyOneScopeMaterial(recipe: CapabilityRuntimeCachePreparationRecipe) {
  const [material] = recipe.scope.materials;
  if (!material) throw new TypeError(`First-party cache recipe ${recipe.id} is empty.`);
  return material;
}

function sameRecipe(
  left: CapabilityRuntimeCachePreparationRecipe,
  right: CapabilityRuntimeCachePreparationRecipe,
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}
