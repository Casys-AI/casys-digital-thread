/**
 * Local production composition for post-brief cache preparation.
 *
 * The only mutation is an exact, journalled Microsandbox import under the
 * already shared host-mutation lock. No caller may nominate an image, source,
 * runtime, path, or command.
 */

import { CapabilityRuntimeCachePreparationCoordinator } from "../../application/control-plane/capability-runtime-cache-preparation-coordinator.ts";
import type {
  CapabilityRuntimeCachePreparationAcquirer,
  CapabilityRuntimeCachePreparationJournal,
  CapabilityRuntimeCachePreparationObserver,
} from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";
import type { CapabilityRuntimeHostMutationLock } from "../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { CapabilityRuntimeCachePreparationRecipe } from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { LocalMicrosandboxCapabilityRuntimeCache } from "./microsandbox-capability-runtime-cache.ts";
import {
  acquireFirstPartyMicrosandboxImage,
  createFirstPartyMicrosandboxImageAcquisitionSession,
  createLocalFirstPartyMicrosandboxImageAcquisitionPorts,
  type FirstPartyMicrosandboxImageAcquisitionPorts,
} from "./first-party-microsandbox-image-acquisition.ts";
import {
  createFirstPartyMicrosandboxImageBootstrapDescriptors,
  type FirstPartyMicrosandboxImageBootstrapDescriptor,
} from "./first-party-microsandbox-image-bootstrap.ts";
import {
  createLocalMicrosandboxSdk,
  type MicrosandboxSdk,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "./file-capability-runtime-cache-preparation-journal.ts";
import {
  createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry,
  type FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";

/**
 * Test-only seam for the closed first-party recipe set. Recipes come from the
 * registry, never from an MCP/project caller, so this interface cannot select
 * an image, provider, command, or argument.
 */
export interface LocalCapabilityRuntimeCachePreparationActions {
  observe(recipe: CapabilityRuntimeCachePreparationRecipe): Promise<boolean>;
  acquire(recipe: CapabilityRuntimeCachePreparationRecipe): Promise<void>;
}

export interface LocalCapabilityRuntimeCachePreparationCompositionOptions
  extends FirstPartyCapabilityRuntimeCachePreparationRegistryOptions {
  /** The same host mutation mutex used by H1 material acquisition and JIT. */
  readonly lock: CapabilityRuntimeHostMutationLock;
  /** Durable journal location; defaults to the current isolated microVM-preparation root. */
  readonly journalDirectory?: string;
  /** Internal injection seam for focused tests; never an MCP/project surface. */
  readonly journal?: CapabilityRuntimeCachePreparationJournal;
  /** Internal injection seam for focused tests; all live actions are fixed by default. */
  readonly actions?: LocalCapabilityRuntimeCachePreparationActions;
  /**
   * Internal injection seam. Live default is `createLocalMicrosandboxSdk`.
   * Composition must not call it until an observation or acquisition needs it.
   */
  readonly createSdk?: () => Promise<MicrosandboxSdk>;
  readonly now?: () => string;
}

export interface LocalCapabilityRuntimeCachePreparationComposition {
  readonly cachePreparer: CapabilityRuntimeCachePreparationCoordinator;
  readonly journal: CapabilityRuntimeCachePreparationJournal;
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
}

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
  const descriptors = createFirstPartyMicrosandboxImageBootstrapDescriptors(
    options.catalog,
  );
  const actions = options.actions ??
    createLocalFirstPartyCapabilityRuntimeCachePreparationActions(
      recipes,
      descriptors,
      { createSdk: options.createSdk },
    );
  const ports = createFirstPartyCapabilityRuntimeCachePreparationPorts({
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

export function createFirstPartyCapabilityRuntimeCachePreparationPorts(input: {
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
  readonly actions: LocalCapabilityRuntimeCachePreparationActions;
}): {
  readonly observer: CapabilityRuntimeCachePreparationObserver;
  readonly acquirer: CapabilityRuntimeCachePreparationAcquirer;
} {
  const observer: CapabilityRuntimeCachePreparationObserver = {
    async observe({ recipe }) {
      if (!matchesAnyRecipe(recipe, input.recipes)) {
        throw new TypeError(
          "Cache preparation observer received an unregistered recipe.",
        );
      }
      return { status: await input.actions.observe(recipe) ? "exact" : "not-exact" };
    },
  };
  const acquirer: CapabilityRuntimeCachePreparationAcquirer = {
    async acquire({ recipe }) {
      if (!matchesAnyRecipe(recipe, input.recipes)) {
        throw new TypeError(
          "Cache preparation acquirer received an unregistered recipe.",
        );
      }
      await input.actions.acquire(recipe);
    },
  };
  return Object.freeze({
    observer: Object.freeze(observer),
    acquirer: Object.freeze(acquirer),
  });
}

export function createLocalFirstPartyCapabilityRuntimeCachePreparationActions(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
  descriptors: readonly FirstPartyMicrosandboxImageBootstrapDescriptor[],
  options: {
    readonly acquisitionPorts?: FirstPartyMicrosandboxImageAcquisitionPorts;
    readonly createSdk?: () => Promise<MicrosandboxSdk>;
  } = {},
): LocalCapabilityRuntimeCachePreparationActions {
  const byRecipeId = new Map(
    descriptors.map((descriptor) => [descriptor.recipeId, descriptor]),
  );
  if (byRecipeId.size !== recipes.length) {
    throw new TypeError(
      "First-party cache recipes and bootstrap descriptors are not the same closed set.",
    );
  }
  const createSdk = options.createSdk ?? createLocalMicrosandboxSdk;
  const cache = new LocalMicrosandboxCapabilityRuntimeCache(
    createSdk,
    recipes.map((recipe) => {
      const material = exactlyOneScopeMaterial(recipe);
      const descriptor = byRecipeId.get(recipe.id);
      if (!descriptor || !sameRecipeIdentity(recipe, descriptor)) {
        throw new TypeError(
          `First-party cache recipe ${recipe.id} has no matching bootstrap descriptor.`,
        );
      }
      return {
        material: {
          unitId: material.material.unitId,
          materialId: material.material.materialId,
        },
        image: descriptor.target,
        allowedExecutionProfileFingerprints: Object.freeze([
          material.profile.fingerprint,
        ]),
      };
    }),
  );
  const session = createFirstPartyMicrosandboxImageAcquisitionSession();
  let portsPromise: Promise<FirstPartyMicrosandboxImageAcquisitionPorts> | undefined;
  const requireAcquisitionPorts = (): Promise<
    FirstPartyMicrosandboxImageAcquisitionPorts
  > => {
    if (options.acquisitionPorts) {
      return Promise.resolve(options.acquisitionPorts);
    }
    portsPromise ??= createLocalFirstPartyMicrosandboxImageAcquisitionPorts(createSdk);
    return portsPromise;
  };
  return Object.freeze({
    async observe(
      recipe: CapabilityRuntimeCachePreparationRecipe,
    ): Promise<boolean> {
      const material = exactlyOneScopeMaterial(registeredRecipe(recipe, recipes));
      return await exactMicrosandboxCacheObservation(cache, material);
    },
    async acquire(
      recipe: CapabilityRuntimeCachePreparationRecipe,
    ): Promise<void> {
      const registered = registeredRecipe(recipe, recipes);
      const descriptor = byRecipeId.get(registered.id);
      if (!descriptor) {
        throw new TypeError("Cache preparation action cannot acquire this recipe.");
      }
      await acquireFirstPartyMicrosandboxImage({
        descriptor,
        ports: await requireAcquisitionPorts(),
        session,
      });
    },
  });
}

function registeredRecipe(
  recipe: CapabilityRuntimeCachePreparationRecipe,
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
): CapabilityRuntimeCachePreparationRecipe {
  const match = recipes.find((candidate) => sameRecipe(recipe, candidate));
  if (!match) {
    throw new TypeError("Cache preparation action received an unregistered recipe.");
  }
  return match;
}

function sameRecipeIdentity(
  recipe: CapabilityRuntimeCachePreparationRecipe,
  descriptor: FirstPartyMicrosandboxImageBootstrapDescriptor,
): boolean {
  const material = exactlyOneScopeMaterial(recipe);
  return recipe.id === descriptor.recipeId &&
    material.material.unitId === descriptor.unitId &&
    material.material.materialId === descriptor.materialId &&
    material.imageReference === descriptor.targetImageReference;
}

function exactlyOneScopeMaterial(recipe: CapabilityRuntimeCachePreparationRecipe) {
  const [material] = recipe.scope.materials;
  if (!material || recipe.scope.materials.length !== 1) {
    throw new TypeError(`First-party cache recipe ${recipe.id} must be atomic.`);
  }
  return material;
}

function sameRecipe(
  left: CapabilityRuntimeCachePreparationRecipe,
  right: CapabilityRuntimeCachePreparationRecipe,
): boolean {
  return deterministicJson(left) === deterministicJson(right);
}

function matchesAnyRecipe(
  recipe: CapabilityRuntimeCachePreparationRecipe,
  candidates: readonly CapabilityRuntimeCachePreparationRecipe[],
): boolean {
  return candidates.some((candidate) => sameRecipe(recipe, candidate));
}

async function exactMicrosandboxCacheObservation(
  cache: LocalMicrosandboxCapabilityRuntimeCache,
  material: CapabilityRuntimeCachePreparationRecipe["scope"]["materials"][number],
): Promise<boolean> {
  try {
    await cache.ensureExactCached({
      material: material.material,
      imageReference: material.imageReference,
      executionProfileFingerprint: material.profile.fingerprint,
    });
    return true;
  } catch {
    return false;
  }
}
