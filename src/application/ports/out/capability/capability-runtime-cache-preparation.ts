/**
 * Host-local ports for atomic non-persistent cache preparation.
 *
 * They intentionally have no Compose, launch-group, port, service, lease,
 * project, Thread, CAS, or provider-envelope surface.
 */

import type {
  CapabilityRuntimeCachePreparation,
  CapabilityRuntimeCachePreparationIntent,
  CapabilityRuntimeCachePreparationRecipe,
  CapabilityRuntimeCachePreparationRecipePlan,
  CapabilityRuntimeCachePreparationRequestedMaterial,
  CapabilityRuntimeCachePreparationTerminal,
} from "../../../../domain/capability/runtime/capability-runtime-cache-preparation.ts";

/** Append-only journal. A pending intent is intentionally readable recovery work. */
export interface CapabilityRuntimeCachePreparationJournal {
  read(id: string): Promise<CapabilityRuntimeCachePreparation | undefined>;
  list(): Promise<readonly CapabilityRuntimeCachePreparation[]>;
  appendIntent(intent: CapabilityRuntimeCachePreparationIntent): Promise<void>;
  appendTerminal(terminal: CapabilityRuntimeCachePreparationTerminal): Promise<void>;
}

/** Code-owned recipes are selected by exact material scope, never caller id. */
export interface CapabilityRuntimeCachePreparationRecipeRegistry {
  plan(
    materials: readonly CapabilityRuntimeCachePreparationRequestedMaterial[],
  ): Promise<CapabilityRuntimeCachePreparationRecipePlan>;
}

/** Fresh observation is exact only when every material+profile in the recipe matches. */
export interface CapabilityRuntimeCachePreparationObserver {
  observe(input: {
    readonly recipe: CapabilityRuntimeCachePreparationRecipe;
  }): Promise<{ readonly status: "exact" | "not-exact" }>;
}

/**
 * The recipe acquirer may perform only cache acquisition for the durable
 * intent supplied here. It must not create a service, allocate a port, or
 * start a runtime.
 */
export interface CapabilityRuntimeCachePreparationAcquirer {
  acquire(input: {
    readonly recipe: CapabilityRuntimeCachePreparationRecipe;
    readonly intent: CapabilityRuntimeCachePreparationIntent;
  }): Promise<void>;
}
