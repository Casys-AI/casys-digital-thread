/**
 * Local production composition for post-brief cache preparation.
 *
 * It is deliberately narrower than H1/Compose: the only mutation is an
 * exact, journalled Microsandbox imports under the already shared host-mutation
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
  assertExactDockerGeometryModuleAssemblySourceImage,
  createLocalGeometryModuleAssemblyMicrosandboxCachePorts,
  expectedGeometryModuleAssemblyRuntimeImage,
  parseDockerGeometryModuleAssemblySourceInspection,
  prepareGeometryModuleAssemblyMicrosandboxCache,
} from "../cad/module-assembly/geometry-module-assembly-microsandbox-cache-preparation.ts";
import {
  createLocalMicrosandboxSdk,
  microsandboxHostArchitecture,
} from "../shared/execution/microsandbox-ephemeral-execution-backend.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "./file-capability-runtime-cache-preparation-journal.ts";
import {
  createFirstPartyCapabilityRuntimeCachePreparationRecipeRegistry,
  FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
  type FirstPartyCapabilityRuntimeCachePreparationRegistryOptions,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";
import {
  LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
} from "./first-party-capability-runtime-identities.ts";

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
  /** Durable journal location; defaults to the isolated cache-preparation root. */
  readonly journalDirectory?: string;
  /** Internal injection seam for focused tests; never an MCP/project surface. */
  readonly journal?: CapabilityRuntimeCachePreparationJournal;
  /** Internal injection seam for focused tests; all live actions are fixed by default. */
  readonly actions?: LocalCapabilityRuntimeCachePreparationActions;
  readonly now?: () => string;
}

export interface LocalCapabilityRuntimeCachePreparationComposition {
  readonly cachePreparer: CapabilityRuntimeCachePreparationCoordinator;
  readonly journal: CapabilityRuntimeCachePreparationJournal;
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
}

/**
 * Creates one production cache lane for every actual runtime profile supplied
 * by server composition. It shares, rather than creates, the H1 host mutation
 * lock and persists every intent in a separate durable cache journal.
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
  const actions = options.actions ??
    createLocalFirstPartyCapabilityRuntimeCachePreparationActions(
      recipes,
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

/**
 * Strict dispatcher shared by production composition and focused tests. Source
 * cache material has no acquisition operation: it can only be observed and is
 * never pulled or fabricated. Runtime acquisition remains one code-owned
 * Docker-save to Microsandbox-import sequence per registered worker.
 */
export function createFirstPartyCapabilityRuntimeCachePreparationPorts(input: {
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
  readonly actions: LocalCapabilityRuntimeCachePreparationActions;
}): {
  readonly observer: CapabilityRuntimeCachePreparationObserver;
  readonly acquirer: CapabilityRuntimeCachePreparationAcquirer;
} {
  const lanes = firstPartyCachePreparationRecipeLanes(input.recipes);
  const sources = lanes.map((lane) => lane.source);
  const runtimes = lanes.map((lane) => lane.runtime);
  const observer: CapabilityRuntimeCachePreparationObserver = {
    async observe({ recipe }) {
      if (!matchesAnyRecipe(recipe, [...sources, ...runtimes])) {
        throw new TypeError(
          "Cache preparation observer received an unregistered recipe.",
        );
      }
      return { status: await input.actions.observe(recipe) ? "exact" : "not-exact" };
    },
  };
  const acquirer: CapabilityRuntimeCachePreparationAcquirer = {
    async acquire({ recipe }) {
      if (matchesAnyRecipe(recipe, sources)) {
        throw new Error(
          "The exact Docker source cache is absent; cache preparation never pulls a source image.",
        );
      }
      if (!matchesAnyRecipe(recipe, runtimes)) {
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

/**
 * The live action set owns all host interaction. It receives no caller data:
 * exact recipe validation happened before dispatch; source inspection is
 * read-only; and each runtime acquisition delegates to its existing fixed
 * cache operator.
 */
export function createLocalFirstPartyCapabilityRuntimeCachePreparationActions(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
): LocalCapabilityRuntimeCachePreparationActions {
  const actionLanes: LocalCachePreparationActionLane[] = [];
  const ngspice = cachePreparationRecipeLane(recipes, {
    sourceId: FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
    runtimeId: FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
    label: "ngspice",
  });
  if (ngspice !== undefined) {
    const sourceMaterial = exactlyOneScopeMaterial(ngspice.source);
    const runtimeMaterial = exactlyOneScopeMaterial(ngspice.runtime);
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
    actionLanes.push({
      ...ngspice,
      async observeSource(): Promise<boolean> {
        const observations = await sourceCache.observe([sourceMaterial.material]);
        return observations.get(materialKey(sourceMaterial.material))?.material ===
          "installed";
      },
      observeRuntime: () =>
        exactMicrosandboxCacheObservation(runtimeCache, runtimeMaterial),
      acquireRuntime: async () => {
        await prepareAdmittedNgspiceMicrosandboxCache(
          await createLocalNgspiceMicrosandboxCachePorts(),
        );
      },
    });
  }
  const geometry = cachePreparationRecipeLane(recipes, {
    sourceId: FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
    runtimeId: FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
    label: "geometry-module assembler",
  });
  if (geometry !== undefined) {
    const runtimeMaterial = exactlyOneScopeMaterial(geometry.runtime);
    const expectedRuntime = expectedGeometryModuleAssemblyRuntimeImage();
    if (
      runtimeMaterial.imageReference !== expectedRuntime.reference ||
      runtimeMaterial.material.imageDigest !==
        expectedRuntime.manifestDigest.slice("sha256:".length)
    ) {
      throw new TypeError(
        "The registered geometry-module runtime cache recipe differs from the reviewed runtime manifest.",
      );
    }
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
    actionLanes.push({
      ...geometry,
      observeSource: observeLocalGeometryModuleAssemblyDockerSource,
      observeRuntime: () =>
        exactMicrosandboxCacheObservation(runtimeCache, runtimeMaterial),
      acquireRuntime: async () => {
        await prepareGeometryModuleAssemblyMicrosandboxCache(
          await createLocalGeometryModuleAssemblyMicrosandboxCachePorts(),
        );
      },
    });
  }
  if (actionLanes.length === 0) {
    throw new TypeError(
      "First-party cache preparation requires one actually composed executable lane.",
    );
  }
  return Object.freeze({
    async observe(
      recipe: CapabilityRuntimeCachePreparationRecipe,
    ): Promise<boolean> {
      const lane = actionLanes.find((candidate) =>
        sameRecipe(recipe, candidate.source) || sameRecipe(recipe, candidate.runtime)
      );
      if (lane?.source && sameRecipe(recipe, lane.source)) {
        return await lane.observeSource();
      }
      if (lane?.runtime && sameRecipe(recipe, lane.runtime)) {
        return await lane.observeRuntime();
      }
      throw new TypeError("Cache preparation action received an unregistered recipe.");
    },
    async acquire(
      recipe: CapabilityRuntimeCachePreparationRecipe,
    ): Promise<void> {
      const lane = actionLanes.find((candidate) =>
        sameRecipe(recipe, candidate.runtime)
      );
      if (lane !== undefined) return await lane.acquireRuntime();
      throw new TypeError("Cache preparation action cannot acquire this recipe.");
    },
  });
}

interface CachePreparationRecipeLane {
  readonly source: CapabilityRuntimeCachePreparationRecipe;
  readonly runtime: CapabilityRuntimeCachePreparationRecipe;
}

interface LocalCachePreparationActionLane extends CachePreparationRecipeLane {
  observeSource(): Promise<boolean>;
  observeRuntime(): Promise<boolean>;
  acquireRuntime(): Promise<void>;
}

function firstPartyCachePreparationRecipeLanes(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
): readonly CachePreparationRecipeLane[] {
  const lanes = [
    cachePreparationRecipeLane(recipes, {
      sourceId: FIRST_PARTY_NGSPICE_SOURCE_CACHE_RECIPE_ID,
      runtimeId: FIRST_PARTY_NGSPICE_RUNTIME_CACHE_RECIPE_ID,
      label: "ngspice",
    }),
    cachePreparationRecipeLane(recipes, {
      sourceId: FIRST_PARTY_GEOMETRY_MODULE_SOURCE_CACHE_RECIPE_ID,
      runtimeId: FIRST_PARTY_GEOMETRY_MODULE_RUNTIME_CACHE_RECIPE_ID,
      label: "geometry-module assembler",
    }),
  ].filter((lane): lane is CachePreparationRecipeLane => lane !== undefined);
  if (lanes.length === 0) {
    throw new TypeError(
      "First-party cache preparation requires one actually composed executable lane.",
    );
  }
  return Object.freeze(lanes);
}

function cachePreparationRecipeLane(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
  input: {
    readonly sourceId: string;
    readonly runtimeId: string;
    readonly label: string;
  },
): CachePreparationRecipeLane | undefined {
  const source = optionalAtomicRecipe(recipes, input.sourceId);
  const runtime = optionalAtomicRecipe(recipes, input.runtimeId);
  if (source === undefined && runtime === undefined) return undefined;
  if (source === undefined || runtime === undefined) {
    throw new TypeError(
      `First-party ${input.label} cache lane must retain its exact source and runtime recipes together.`,
    );
  }
  return Object.freeze({ source, runtime });
}

function optionalAtomicRecipe(
  recipes: readonly CapabilityRuntimeCachePreparationRecipe[],
  id: string,
): CapabilityRuntimeCachePreparationRecipe | undefined {
  const matches = recipes.filter((recipe) => recipe.id === id);
  if (matches.length > 1) {
    throw new TypeError(`First-party cache recipe ${id} is not uniquely registered.`);
  }
  const recipe = matches[0];
  if (recipe === undefined) return undefined;
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

/** Read-only Docker inspection; it never pulls, saves, imports, or runs an image. */
async function observeLocalGeometryModuleAssemblyDockerSource(): Promise<boolean> {
  try {
    const output = await new Deno.Command("docker", {
      args: [
        "image",
        "inspect",
        "--format",
        "{{json .}}",
        LOCAL_GEOMETRY_MODULE_ASSEMBLY_DOCKER_SOURCE_IMAGE_REFERENCE,
      ],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!output.success) return false;
    assertExactDockerGeometryModuleAssemblySourceImage(
      parseDockerGeometryModuleAssemblySourceInspection(
        JSON.parse(new TextDecoder().decode(output.stdout)) as unknown,
      ),
    );
    return true;
  } catch {
    return false;
  }
}

function materialKey(
  value: { readonly unitId: string; readonly materialId: string },
): string {
  return `${value.unitId}\u0000${value.materialId}`;
}
