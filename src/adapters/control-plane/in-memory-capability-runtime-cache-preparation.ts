/** Test adapters for the isolated cache-preparation lane. */

import {
  planCapabilityRuntimeCachePreparationRecipes,
  resolveCapabilityRuntimeCachePreparations,
  validateCapabilityRuntimeCachePreparationIntent,
  validateCapabilityRuntimeCachePreparationLineages,
  validateCapabilityRuntimeCachePreparationRecipe,
  validateCapabilityRuntimeCachePreparationRequestedMaterials,
  validateCapabilityRuntimeCachePreparationTerminal,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import type {
  CapabilityRuntimeCachePreparation,
  CapabilityRuntimeCachePreparationIntent,
  CapabilityRuntimeCachePreparationRequestedMaterial,
  CapabilityRuntimeCachePreparationTerminal,
} from "../../domain/capability/runtime/capability-runtime-cache-preparation.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  CapabilityRuntimeCachePreparationJournal,
  CapabilityRuntimeCachePreparationRecipeRegistry,
} from "../../application/ports/out/capability/capability-runtime-cache-preparation.ts";

/**
 * Immutable-in-construction registry for unit tests and future code-owned
 * composition. Callers ask by exact material scope, never by a recipe id.
 */
export class FixedCapabilityRuntimeCachePreparationRecipeRegistry
  implements CapabilityRuntimeCachePreparationRecipeRegistry {
  constructor(private readonly values: readonly unknown[]) {}

  async plan(
    input: readonly CapabilityRuntimeCachePreparationRequestedMaterial[],
  ): Promise<
    import("../../domain/capability/runtime/capability-runtime-cache-preparation.ts").CapabilityRuntimeCachePreparationRecipePlan
  > {
    const requested = validateCapabilityRuntimeCachePreparationRequestedMaterials(
      input,
    );
    const recipes = await Promise.all(
      this.values.map((value) =>
        validateCapabilityRuntimeCachePreparationRecipe(structuredClone(value))
      ),
    );
    const identities = recipes.map((recipe) => `${recipe.id}\u0000${recipe.version}`);
    if (new Set(identities).size !== identities.length) {
      throw new TypeError(
        "Cache preparation recipe registry has duplicate recipe identities.",
      );
    }
    return structuredClone(
      planCapabilityRuntimeCachePreparationRecipes({ requested, recipes }),
    );
  }
}

/** Append-only memory journal with the same no-replay pending state as disk. */
export class InMemoryCapabilityRuntimeCachePreparationJournal
  implements CapabilityRuntimeCachePreparationJournal {
  #intents = new Map<string, CapabilityRuntimeCachePreparationIntent>();
  #terminals = new Map<string, CapabilityRuntimeCachePreparationTerminal>();

  async read(id: string): Promise<CapabilityRuntimeCachePreparation | undefined> {
    const intent = this.#intents.get(id);
    if (!intent) return undefined;
    const [resolved] = await resolveCapabilityRuntimeCachePreparations({
      intents: [intent],
      terminals: this.#terminals.has(id) ? [this.#terminals.get(id)!] : [],
    });
    return structuredClone(resolved!);
  }

  async list(): Promise<readonly CapabilityRuntimeCachePreparation[]> {
    const preparations = await resolveCapabilityRuntimeCachePreparations({
      intents: [...this.#intents.values()],
      terminals: [...this.#terminals.values()],
    });
    validateCapabilityRuntimeCachePreparationLineages(preparations);
    return structuredClone(preparations);
  }

  async appendIntent(input: CapabilityRuntimeCachePreparationIntent): Promise<void> {
    const intent = await validateCapabilityRuntimeCachePreparationIntent(input);
    const existing = this.#intents.get(intent.id);
    if (existing) {
      if (deterministicJson(existing) === deterministicJson(intent)) return;
      throw new Error(
        `Cache preparation intent ${intent.id} already exists with different content.`,
      );
    }
    this.#intents.set(intent.id, structuredClone(intent));
  }

  async appendTerminal(
    input: CapabilityRuntimeCachePreparationTerminal,
  ): Promise<void> {
    const terminal = await validateCapabilityRuntimeCachePreparationTerminal(input);
    const intent = this.#intents.get(terminal.preparationId);
    if (!intent) throw new Error("Cache preparation terminal has no durable intent.");
    await resolveCapabilityRuntimeCachePreparations({
      intents: [intent],
      terminals: [terminal],
    });
    const existing = this.#terminals.get(terminal.preparationId);
    if (existing) {
      if (deterministicJson(existing) === deterministicJson(terminal)) return;
      throw new Error(
        `Cache preparation terminal ${terminal.preparationId} already exists with different content.`,
      );
    }
    this.#terminals.set(terminal.preparationId, structuredClone(terminal));
  }
}
