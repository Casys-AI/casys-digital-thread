import { assertEquals, assertRejects } from "@std/assert";
import { createFirstPartyCapabilityRuntimeCatalog } from "./first-party-capability-binding-catalog.ts";
import { FileCapabilityRuntimeCachePreparationJournal } from "./file-capability-runtime-cache-preparation-journal.ts";
import {
  createLocalCapabilityRuntimeCachePreparationComposition,
} from "./local-capability-runtime-cache-preparation-composition.ts";
import {
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
} from "./first-party-capability-runtime-cache-preparation-registry.ts";
import type { CapabilityRuntimeCachePreparationRequestedMaterial } from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";

const NOW = "2026-08-31T00:00:00.000Z";
const RECIPE_IDS = [
  FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
  FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
  FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
  FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
  FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
] as const;

Deno.test("local cache-preparation composition journals the five target recipes under the host lock", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    let lockCalls = 0;
    const observations = new Map<string, number>();
    const acquisitions = new Map<string, number>();
    const exact = new Set<string>([FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID]);
    const journal = new FileCapabilityRuntimeCachePreparationJournal(directory);
    const composition = await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      lock: {
        withLock: async <T>(operation: () => Promise<T>): Promise<T> => {
          lockCalls++;
          return await operation();
        },
      },
      journal,
      actions: {
        observe: (recipe) => {
          observations.set(recipe.id, (observations.get(recipe.id) ?? 0) + 1);
          return Promise.resolve(exact.has(recipe.id));
        },
        acquire: (recipe) => {
          acquisitions.set(recipe.id, (acquisitions.get(recipe.id) ?? 0) + 1);
          exact.add(recipe.id);
          return Promise.resolve();
        },
      },
      now: () => NOW,
    });

    assertEquals(
      composition.recipes.map((recipe) => recipe.id).toSorted(),
      [...RECIPE_IDS].toSorted(),
    );
    assertEquals(
      (await composition.cachePreparer.prepare({
        projectId: "project:cache-preload",
        materials: requested(composition.recipes),
        guard: () => Promise.resolve(true),
      })).map((result) => result.status),
      ["observed", "observed", "observed", "observed", "observed"],
    );
    assertEquals(lockCalls, 1);
    assertEquals(
      observations,
      new Map([
        [FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID, 2],
        [FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID, 2],
        [FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID, 2],
        [FIRST_PARTY_MODELICA_CACHE_RECIPE_ID, 2],
        [FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID, 1],
      ]),
    );
    assertEquals(
      acquisitions,
      new Map([
        [FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID, 1],
        [FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID, 1],
        [FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID, 1],
        [FIRST_PARTY_MODELICA_CACHE_RECIPE_ID, 1],
      ]),
    );
    assertEquals(
      (await journal.list()).map((attempt) => attempt.intent.recipe.id),
      [
        FIRST_PARTY_BUILD123D_ISOLATED_CACHE_RECIPE_ID,
        FIRST_PARTY_CALCULIX_CACHE_RECIPE_ID,
        FIRST_PARTY_GEOMETRY_MODULE_CACHE_RECIPE_ID,
        FIRST_PARTY_MODELICA_CACHE_RECIPE_ID,
        FIRST_PARTY_NGSPICE_CACHE_RECIPE_ID,
      ],
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("local cache-preparation composition refuses a journal plus journal directory", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    await assertRejects(
      async () =>
        await createLocalCapabilityRuntimeCachePreparationComposition({
          catalog: await createFirstPartyCapabilityRuntimeCatalog(),
          lock: { withLock: <T>(operation: () => Promise<T>) => operation() },
          journal: new FileCapabilityRuntimeCachePreparationJournal(directory),
          journalDirectory: directory,
        }),
      TypeError,
      "journal or a journal directory",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("composing cache registry and actions does not call the local Microsandbox SDK factory", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    let factoryCalls = 0;
    const composition = await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      lock: { withLock: <T>(operation: () => Promise<T>) => operation() },
      journalDirectory: directory,
      createSdk: () => {
        factoryCalls++;
        return Promise.reject(new Error("local Microsandbox SDK must stay idle"));
      },
    });
    assertEquals(factoryCalls, 0);
    assertEquals(
      composition.recipes.map((recipe) => recipe.id).toSorted(),
      [
        ...RECIPE_IDS,
      ].toSorted(),
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("local cache-preparation composition uses its durable file journal by default", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-cache-composition-" });
  try {
    const composition = await createLocalCapabilityRuntimeCachePreparationComposition({
      catalog: await createFirstPartyCapabilityRuntimeCatalog(),
      lock: { withLock: <T>(operation: () => Promise<T>) => operation() },
      journalDirectory: directory,
      actions: {
        observe: () => Promise.resolve(false),
        acquire: () => Promise.resolve(),
      },
    });

    assertEquals(
      composition.journal instanceof FileCapabilityRuntimeCachePreparationJournal,
      true,
    );
    assertEquals(await composition.journal.list(), []);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

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
