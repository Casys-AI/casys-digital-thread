/**
 * Closed, host-local cache preparation facts.
 *
 * This is deliberately not a launch-group, service, lease, or engineering
 * artifact. A recipe only owns an exact, non-persistent image/cache scope and
 * the exact code-owned profiles required to make that scope usable later.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-material.ts";

export const CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA =
  "capability-runtime-cache-preparation-recipe/1.0" as const;
export const CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA =
  "capability-runtime-cache-preparation-intent/1.0" as const;
export const CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA =
  "capability-runtime-cache-preparation-observed/1.0" as const;
export const CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA =
  "capability-runtime-cache-preparation-failed/1.0" as const;
/** A cache scope retains finite recovery history; a new policy is a new recipe. */
export const CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS = 16;

export interface CapabilityRuntimeCachePreparationProfile {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

/** One exact non-persistent material. No port, service, or group can appear. */
export interface CapabilityRuntimeCachePreparationMaterial {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly imageReference: string;
  readonly lifecycle: "ephemeral" | "cache";
  readonly profile: CapabilityRuntimeCachePreparationProfile;
}

/** Ordered scope is closed: every member is material plus profile together. */
export interface CapabilityRuntimeCachePreparationScope {
  readonly materials: readonly CapabilityRuntimeCachePreparationMaterial[];
}

export interface CapabilityRuntimeCachePreparationRecipe {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA;
  readonly id: string;
  readonly version: string;
  readonly scope: CapabilityRuntimeCachePreparationScope;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeCachePreparationRecipeReference {
  readonly id: string;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
}

/** Deterministic partition of one requested set; unknown members stay literal. */
export interface CapabilityRuntimeCachePreparationRecipePlan {
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
  readonly unavailable: readonly CapabilityRuntimeCachePreparationRequestedMaterial[];
}

/** Scheduler input has no authority to nominate a profile or a recipe. */
export interface CapabilityRuntimeCachePreparationRequestedMaterial {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly imageReference: string;
  readonly lifecycle: "ephemeral" | "cache";
}

/** Durable intent written before a recipe acquirer may mutate the host cache. */
export interface CapabilityRuntimeCachePreparationIntent {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA;
  readonly id: string;
  readonly projectId: string;
  readonly recipe: CapabilityRuntimeCachePreparationRecipeReference;
  readonly scope: CapabilityRuntimeCachePreparationScope;
  /** Exact materials+profiles, independent of a transient cache observation. */
  readonly scopeFingerprint: ContentFingerprint;
  readonly generation: number;
  /** Exact immediately preceding terminal attempt, or the initial generation. */
  readonly predecessor: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  } | null;
  readonly plannedAt: string;
  readonly fingerprint: ContentFingerprint;
}

export interface CapabilityRuntimeCachePreparationObserved {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA;
  readonly preparationId: string;
  readonly preparationFingerprint: ContentFingerprint;
  readonly scopeFingerprint: ContentFingerprint;
  readonly observedAt: string;
}

export interface CapabilityRuntimeCachePreparationFailed {
  readonly schemaVersion: typeof CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA;
  readonly preparationId: string;
  readonly preparationFingerprint: ContentFingerprint;
  readonly failedAt: string;
  readonly reason:
    | "acquisition-failed"
    | "observation-failed"
    | "not-exact-after-acquisition"
    | "authorization-revoked";
}

export type CapabilityRuntimeCachePreparationTerminal =
  | CapabilityRuntimeCachePreparationObserved
  | CapabilityRuntimeCachePreparationFailed;

/** Append-only reconstruction: a missing terminal is a recovery blocker. */
export interface CapabilityRuntimeCachePreparation {
  readonly intent: CapabilityRuntimeCachePreparationIntent;
  readonly terminal: CapabilityRuntimeCachePreparationTerminal | null;
}
