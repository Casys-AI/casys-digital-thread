import { assertEquals } from "@std/assert";
import {
  createCapabilityRuntimeCachePreparationIntent,
  createCapabilityRuntimeCachePreparationRecipe,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import {
  FixedCapabilityRuntimeCachePreparationRecipeRegistry,
  InMemoryCapabilityRuntimeCachePreparationJournal,
} from "../../adapters/control-plane/in-memory-capability-runtime-cache-preparation.ts";
import { CapabilityRuntimeCachePreparationCoordinator } from "./capability-runtime-cache-preparation-coordinator.ts";

const NOW = "2026-08-31T00:00:00.000Z";
const PROJECT = "project:cache-preload";

Deno.test("cache registry partitions CAD and SPICE-like materials into disjoint atomic recipes", async () => {
  const [cad, spice] = await fixtureRecipes();
  const journal = new InMemoryCapabilityRuntimeCachePreparationJournal();
  const exact = new Set<string>();
  const acquisitions: string[] = [];
  const coordinator = coordinatorFor({
    recipes: [cad, spice],
    journal,
    observe: (recipe) => ({ status: exact.has(recipe.id) ? "exact" : "not-exact" }),
    acquire: (recipe) => {
      acquisitions.push(recipe.id);
      exact.add(recipe.id);
    },
  });

  assertEquals(
    (await coordinator.prepare({
      projectId: PROJECT,
      materials: requested(cad, spice),
      guard: authorized,
    })).map((result) => result.status),
    ["observed", "observed"],
  );
  assertEquals(acquisitions, ["cache.recipe.cad", "cache.recipe.spice"]);
  assertEquals(
    (await journal.list()).map((attempt) => attempt.intent.scope.materials.length),
    [
      1,
      1,
    ],
  );
});

Deno.test("cache intent is durable before acquisition and guard revocation during observation prevents acquire", async () => {
  const [cad] = await fixtureRecipes();
  const journal = new InMemoryCapabilityRuntimeCachePreparationJournal();
  let checks = 0;
  let acquisitions = 0;
  const coordinator = coordinatorFor({
    recipes: [cad],
    journal,
    observe: () => ({ status: "not-exact" }),
    acquire: async (_recipe, intent) => {
      acquisitions++;
      assertEquals((await journal.read(intent.id))?.intent, intent);
    },
  });

  assertEquals(
    await coordinator.prepare({
      projectId: PROJECT,
      materials: requested(cad),
      guard: () => Promise.resolve(++checks === 1),
    }),
    [{
      status: "failed",
      preparationId: (await journal.list())[0]?.intent.id,
      reason: "authorization-revoked",
    }],
  );
  assertEquals(acquisitions, 0);
  assertEquals(
    (await journal.list())[0]?.terminal?.schemaVersion,
    "capability-runtime-cache-preparation-failed/1.0",
  );
});

Deno.test("a crash-pending cache intent is observed but never automatically acquired again", async () => {
  const [cad] = await fixtureRecipes();
  const journal = new InMemoryCapabilityRuntimeCachePreparationJournal();
  const intent = await createCapabilityRuntimeCachePreparationIntent({
    projectId: PROJECT,
    recipe: cad,
    generation: 1,
    predecessor: null,
    plannedAt: NOW,
  });
  await journal.appendIntent(intent);
  let acquisitions = 0;
  const coordinator = coordinatorFor({
    recipes: [cad],
    journal,
    observe: () => ({ status: "not-exact" }),
    acquire: () => {
      acquisitions++;
    },
  });

  assertEquals(
    await coordinator.prepare({
      projectId: PROJECT,
      materials: requested(cad),
      guard: authorized,
    }),
    [{
      status: "blocked",
      preparationId: intent.id,
      reason: "pending-intent-not-exact",
    }],
  );
  assertEquals(acquisitions, 0);
});

Deno.test("observed then evicted cache creates one deterministic successor and reacquires", async () => {
  const [cad] = await fixtureRecipes();
  const journal = new InMemoryCapabilityRuntimeCachePreparationJournal();
  let exact = false;
  let acquisitions = 0;
  const coordinator = coordinatorFor({
    recipes: [cad],
    journal,
    observe: () => ({ status: exact ? "exact" : "not-exact" }),
    acquire: () => {
      acquisitions++;
      exact = true;
    },
  });

  await coordinator.prepare({
    projectId: PROJECT,
    materials: requested(cad),
    guard: authorized,
  });
  exact = false;
  const retry = await coordinator.prepare({
    projectId: PROJECT,
    materials: requested(cad),
    guard: authorized,
  });
  const attempts = await journal.list();
  assertEquals(retry.map((result) => result.status), ["observed"]);
  assertEquals(acquisitions, 2);
  assertEquals(attempts.map((attempt) => attempt.intent.generation), [1, 2]);
  assertEquals(attempts[1]?.intent.predecessor, {
    id: attempts[0]?.intent.id,
    fingerprint: attempts[0]?.intent.fingerprint,
  });
});

Deno.test("a failed terminal may create a new successor retry", async () => {
  const [cad] = await fixtureRecipes();
  const journal = new InMemoryCapabilityRuntimeCachePreparationJournal();
  let fail = true;
  let exact = false;
  const coordinator = coordinatorFor({
    recipes: [cad],
    journal,
    observe: () => ({ status: exact ? "exact" : "not-exact" }),
    acquire: () => {
      if (fail) throw new Error("temporary cache failure");
      exact = true;
    },
  });

  assertEquals(
    (await coordinator.prepare({
      projectId: PROJECT,
      materials: requested(cad),
      guard: authorized,
    }))[0]?.status,
    "failed",
  );
  fail = false;
  assertEquals(
    (await coordinator.prepare({
      projectId: PROJECT,
      materials: requested(cad),
      guard: authorized,
    }))[0]?.status,
    "observed",
  );
  assertEquals((await journal.list()).map((attempt) => attempt.intent.generation), [
    1,
    2,
  ]);
});

Deno.test("unknown cache material remains unavailable without a synthetic combined recipe", async () => {
  const [cad, spice] = await fixtureRecipes();
  const coordinator = coordinatorFor({
    recipes: [cad],
    journal: new InMemoryCapabilityRuntimeCachePreparationJournal(),
    observe: () => ({ status: "exact" }),
    acquire: () => undefined,
  });

  const results = await coordinator.prepare({
    projectId: PROJECT,
    materials: requested(cad, spice),
    guard: authorized,
  });
  assertEquals(results.map((result) => result.status), ["observed", "unavailable"]);
  assertEquals(results.at(-1), {
    status: "unavailable",
    reason: "unknown-recipe",
    materialKeys: ["casys.spice\u0000source-image"],
  });
});

function coordinatorFor(input: {
  readonly recipes: readonly Awaited<ReturnType<typeof fixtureRecipes>>[number][];
  readonly journal: InMemoryCapabilityRuntimeCachePreparationJournal;
  readonly observe: (
    recipe: Awaited<ReturnType<typeof fixtureRecipes>>[number],
  ) => { readonly status: "exact" | "not-exact" };
  readonly acquire: (
    recipe: Awaited<ReturnType<typeof fixtureRecipes>>[number],
    intent: { readonly id: string },
  ) => void | Promise<void>;
}) {
  return new CapabilityRuntimeCachePreparationCoordinator({
    lock: { withLock: <T>(operation: () => Promise<T>) => operation() },
    journal: input.journal,
    recipes: new FixedCapabilityRuntimeCachePreparationRecipeRegistry(input.recipes),
    observer: { observe: ({ recipe }) => Promise.resolve(input.observe(recipe)) },
    acquirer: {
      acquire: ({ recipe, intent }) => Promise.resolve(input.acquire(recipe, intent)),
    },
    now: () => NOW,
  });
}

async function fixtureRecipes() {
  return await Promise.all([
    recipe({
      id: "cache.recipe.cad",
      unitId: "casys.cad",
      materialId: "worker-image",
      digest: "a",
      lifecycle: "ephemeral",
    }),
    recipe({
      id: "cache.recipe.spice",
      unitId: "casys.spice",
      materialId: "source-image",
      digest: "b",
      lifecycle: "cache",
    }),
  ]);
}

async function recipe(input: {
  readonly id: string;
  readonly unitId: string;
  readonly materialId: string;
  readonly digest: string;
  readonly lifecycle: "ephemeral" | "cache";
}) {
  return await createCapabilityRuntimeCachePreparationRecipe({
    schemaVersion: "capability-runtime-cache-preparation-recipe/1.0",
    id: input.id,
    version: "1.0.0",
    scope: {
      materials: [{
        material: {
          unitId: input.unitId,
          materialId: input.materialId,
          imageDigest: input.digest.repeat(64),
        },
        imageReference: `example.test/${input.id}@sha256:${input.digest.repeat(64)}`,
        lifecycle: input.lifecycle,
        profile: {
          id: `profile.${input.id}`,
          version: "1.0.0",
          fingerprint: { algorithm: "sha256" as const, digest: "c".repeat(64) },
        },
      }],
    },
  });
}

function requested(
  ...recipes: readonly Awaited<ReturnType<typeof fixtureRecipes>>[number][]
) {
  return recipes.flatMap((recipe) =>
    recipe.scope.materials.map(({ material, imageReference, lifecycle }) => ({
      material,
      imageReference,
      lifecycle,
    }))
  ).toSorted((left, right) =>
    `${left.material.unitId}\u0000${left.material.materialId}`.localeCompare(
      `${right.material.unitId}\u0000${right.material.materialId}`,
    )
  );
}

function authorized(): Promise<boolean> {
  return Promise.resolve(true);
}
