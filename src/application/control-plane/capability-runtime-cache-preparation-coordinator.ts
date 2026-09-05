/**
 * Atomic cache-preparation coordinator for non-persistent materials.
 *
 * This is a deliberately separate recovery lane from H1/Compose: it neither
 * creates launch groups nor lends runtime-start authority. Its only host
 * mutation is one code-owned recipe acquisition after a durable intent.
 */

import {
  CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS,
  createCapabilityRuntimeCachePreparationFailed,
  createCapabilityRuntimeCachePreparationIntent,
  createCapabilityRuntimeCachePreparationObserved,
  validateCapabilityRuntimeCachePreparationRecipePlan,
  validateCapabilityRuntimeCachePreparationRequestedMaterials,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import type {
  CapabilityRuntimeCachePreparationIntent,
  CapabilityRuntimeCachePreparationRecipe,
  CapabilityRuntimeCachePreparationRequestedMaterial,
  CapabilityRuntimeCachePreparationTerminal,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import { safeId } from "../../domain/kernel/case-validation.ts";
import type {
  CapabilityRuntimeCachePreparationAcquirer,
  CapabilityRuntimeCachePreparationJournal,
  CapabilityRuntimeCachePreparationObserver,
  CapabilityRuntimeCachePreparationRecipeRegistry,
} from "../ports/out/capability/capability-runtime-cache-preparation.ts";
import type { CapabilityRuntimeHostMutationLock } from "../ports/out/capability/capability-runtime-supervisor.ts";

export type CapabilityRuntimeCachePreparationResult =
  | { readonly status: "observed"; readonly preparationId: string }
  | {
    readonly status: "failed";
    readonly preparationId: string;
    readonly reason:
      | "acquisition-failed"
      | "observation-failed"
      | "not-exact-after-acquisition"
      | "authorization-revoked";
  }
  | {
    readonly status: "blocked";
    readonly preparationId: string;
    readonly reason:
      | "pending-intent-not-exact"
      | "pending-intent-unobservable"
      | "terminal-unobservable";
  }
  | {
    readonly status: "unavailable";
    readonly reason: "unknown-recipe";
    readonly materialKeys: readonly string[];
  }
  | { readonly status: "not-authorized"; readonly recipeId: string };

export interface CapabilityRuntimeCachePreparationCoordinatorOptions {
  readonly lock: CapabilityRuntimeHostMutationLock;
  readonly journal: CapabilityRuntimeCachePreparationJournal;
  readonly recipes: CapabilityRuntimeCachePreparationRecipeRegistry;
  readonly observer: CapabilityRuntimeCachePreparationObserver;
  readonly acquirer: CapabilityRuntimeCachePreparationAcquirer;
  readonly now?: () => string;
}

/**
 * Serializes resolution, authorization, journal append, observation and cache
 * acquisition under the host mutation mutex. Pending intents are observation
 * recovery only: they never recover by automatically repeating acquisition.
 */
export class CapabilityRuntimeCachePreparationCoordinator {
  readonly #now: () => string;

  constructor(
    private readonly dependencies: CapabilityRuntimeCachePreparationCoordinatorOptions,
  ) {
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async prepare(input: {
    readonly projectId: string;
    readonly materials: readonly unknown[];
    /** Mandatory for every new generation; rechecked immediately before acquire. */
    readonly guard: () => Promise<boolean>;
  }): Promise<readonly CapabilityRuntimeCachePreparationResult[]> {
    const projectId = safeId(input.projectId, "$cachePreparation.projectId");
    const materials = validateCapabilityRuntimeCachePreparationRequestedMaterials(
      input.materials,
    );
    return await this.dependencies.lock.withLock(async () => {
      const plan = await validateCapabilityRuntimeCachePreparationRecipePlan({
        requested: materials,
        plan: await this.dependencies.recipes.plan(materials),
      });
      const results: CapabilityRuntimeCachePreparationResult[] = [];
      for (const recipe of plan.recipes) {
        results.push(await this.#prepareRecipe(projectId, recipe, input.guard));
      }
      if (plan.unavailable.length > 0) {
        results.push({
          status: "unavailable",
          reason: "unknown-recipe",
          materialKeys: plan.unavailable.map(materialKey),
        });
      }
      return results;
    });
  }

  async #prepareRecipe(
    projectId: string,
    recipe: CapabilityRuntimeCachePreparationRecipe,
    guard: () => Promise<boolean>,
  ): Promise<CapabilityRuntimeCachePreparationResult> {
    const history = (await this.dependencies.journal.list()).filter((preparation) =>
      matchesRecipeScope(preparation.intent, projectId, recipe)
    ).toSorted((left, right) => left.intent.generation - right.intent.generation);
    const latest = history.at(-1);
    if (latest?.terminal === null) {
      return await this.#recoverPending(latest.intent, recipe);
    }
    if (latest?.terminal) {
      try {
        if ((await this.dependencies.observer.observe({ recipe })).status === "exact") {
          return { status: "observed", preparationId: latest.intent.id };
        }
      } catch {
        return {
          status: "blocked",
          preparationId: latest.intent.id,
          reason: "terminal-unobservable",
        };
      }
    }
    if (history.length >= CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS) {
      throw new Error("Cache preparation recovery generation bound is exhausted.");
    }
    // No intent is written unless current authorization survives this recheck.
    if (!await guard()) return { status: "not-authorized", recipeId: recipe.id };
    const intent = await createCapabilityRuntimeCachePreparationIntent({
      projectId,
      recipe,
      generation: (latest?.intent.generation ?? 0) + 1,
      predecessor: latest
        ? { id: latest.intent.id, fingerprint: latest.intent.fingerprint }
        : null,
      plannedAt: this.#now(),
    });
    await this.dependencies.journal.appendIntent(intent);
    const durable = await this.dependencies.journal.read(intent.id);
    if (!durable || deterministicJson(durable.intent) !== deterministicJson(intent)) {
      throw new Error(
        "Cache preparation intent was not durably readable before acquire.",
      );
    }
    return await this.#prepareAfterDurableIntent(intent, recipe, guard);
  }

  async #recoverPending(
    intent: CapabilityRuntimeCachePreparationIntent,
    recipe: CapabilityRuntimeCachePreparationRecipe,
  ): Promise<CapabilityRuntimeCachePreparationResult> {
    try {
      if ((await this.dependencies.observer.observe({ recipe })).status === "exact") {
        await this.dependencies.journal.appendTerminal(
          await createCapabilityRuntimeCachePreparationObserved({
            intent,
            observedAt: this.#now(),
          }),
        );
        return { status: "observed", preparationId: intent.id };
      }
      return {
        status: "blocked",
        preparationId: intent.id,
        reason: "pending-intent-not-exact",
      };
    } catch {
      return {
        status: "blocked",
        preparationId: intent.id,
        reason: "pending-intent-unobservable",
      };
    }
  }

  async #prepareAfterDurableIntent(
    intent: CapabilityRuntimeCachePreparationIntent,
    recipe: CapabilityRuntimeCachePreparationRecipe,
    guard: () => Promise<boolean>,
  ): Promise<CapabilityRuntimeCachePreparationResult> {
    try {
      if ((await this.dependencies.observer.observe({ recipe })).status === "exact") {
        await this.dependencies.journal.appendTerminal(
          await createCapabilityRuntimeCachePreparationObserved({
            intent,
            observedAt: this.#now(),
          }),
        );
        return { status: "observed", preparationId: intent.id };
      }
    } catch {
      return await this.#failed(intent, "observation-failed");
    }
    // This second guard is deliberately the last await before host mutation.
    if (!await guard()) return await this.#failed(intent, "authorization-revoked");
    try {
      await this.dependencies.acquirer.acquire({ recipe, intent });
    } catch {
      return await this.#failed(intent, "acquisition-failed");
    }
    try {
      if ((await this.dependencies.observer.observe({ recipe })).status === "exact") {
        await this.dependencies.journal.appendTerminal(
          await createCapabilityRuntimeCachePreparationObserved({
            intent,
            observedAt: this.#now(),
          }),
        );
        return { status: "observed", preparationId: intent.id };
      }
      return await this.#failed(intent, "not-exact-after-acquisition");
    } catch {
      return await this.#failed(intent, "observation-failed");
    }
  }

  async #failed(
    intent: CapabilityRuntimeCachePreparationIntent,
    reason: Extract<
      CapabilityRuntimeCachePreparationResult,
      { status: "failed" }
    >["reason"],
  ): Promise<CapabilityRuntimeCachePreparationResult> {
    await this.dependencies.journal.appendTerminal(
      await createCapabilityRuntimeCachePreparationFailed({
        intent,
        failedAt: this.#now(),
        reason,
      }),
    );
    return { status: "failed", preparationId: intent.id, reason };
  }
}

function matchesRecipeScope(
  intent: CapabilityRuntimeCachePreparationIntent,
  projectId: string,
  recipe: CapabilityRuntimeCachePreparationRecipe,
): boolean {
  return intent.projectId === projectId && intent.recipe.id === recipe.id &&
    intent.recipe.version === recipe.version &&
    intent.recipe.fingerprint.algorithm === recipe.fingerprint.algorithm &&
    intent.recipe.fingerprint.digest === recipe.fingerprint.digest &&
    deterministicJson(intent.scope) === deterministicJson(recipe.scope);
}

function materialKey(
  material: CapabilityRuntimeCachePreparationRequestedMaterial,
): string {
  return `${material.material.unitId}\u0000${material.material.materialId}`;
}

export function cachePreparationTerminalResult(
  terminal: CapabilityRuntimeCachePreparationTerminal,
): CapabilityRuntimeCachePreparationResult {
  if (terminal.schemaVersion !== CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA) {
    return { status: "observed", preparationId: terminal.preparationId };
  }
  return {
    status: "failed",
    preparationId: terminal.preparationId,
    reason: terminal.reason,
  };
}
