import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA,
  CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
  type CapabilityRuntimeCachePreparationFailed,
  type CapabilityRuntimeCachePreparationIntent,
  type CapabilityRuntimeCachePreparationObserved,
  type CapabilityRuntimeCachePreparationRecipe,
  type CapabilityRuntimeCachePreparationTerminal,
} from "./capability-runtime-cache-preparation-model.ts";
import {
  capabilityRuntimeCachePreparationRecipeReference,
  capabilityRuntimeCachePreparationScopeFingerprint,
  validateCapabilityRuntimeCachePreparationRecipe,
} from "./capability-runtime-cache-preparation-recipe.ts";
import {
  isoDateTime,
  oneOf,
  parseFingerprint,
  parsePredecessor,
  parseRecipeReference,
  validateCapabilityRuntimeCachePreparationScope,
} from "./capability-runtime-cache-preparation-validation.ts";

export function capabilityRuntimeCachePreparationIntentId(input: {
  readonly projectId: string;
  readonly recipe: CapabilityRuntimeCachePreparationRecipe;
  readonly generation: number;
}): Promise<string> {
  const generation = positiveInteger(input.generation, "$cachePreparation.generation");
  if (generation > CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS) {
    throw new TypeError("$cachePreparation.generation exceeds the recovery bound.");
  }
  return cachePreparationLineageFingerprint({
    projectId: input.projectId,
    recipe: input.recipe,
  }).then((fingerprint) => `cache-preparation:${fingerprint.digest}:${generation}`);
}

export async function createCapabilityRuntimeCachePreparationIntent(input: {
  readonly projectId: string;
  readonly recipe: CapabilityRuntimeCachePreparationRecipe;
  readonly generation: number;
  readonly predecessor: CapabilityRuntimeCachePreparationIntent["predecessor"];
  readonly plannedAt: string;
}): Promise<CapabilityRuntimeCachePreparationIntent> {
  const recipe = await validateCapabilityRuntimeCachePreparationRecipe(input.recipe);
  const generation = positiveInteger(
    input.generation,
    "$cachePreparationIntent.generation",
  );
  if (generation > CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS) {
    throw new TypeError(
      "$cachePreparationIntent.generation exceeds the recovery bound.",
    );
  }
  const predecessor = parsePredecessor(
    input.predecessor,
    "$cachePreparationIntent.predecessor",
  );
  if ((generation === 1) !== (predecessor === null)) {
    throw new TypeError(
      "$cachePreparationIntent initial generation and predecessor do not agree.",
    );
  }
  const scope = validateCapabilityRuntimeCachePreparationScope(recipe.scope);
  const scopeFingerprint = await capabilityRuntimeCachePreparationScopeFingerprint(
    scope,
  );
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA,
    id: await capabilityRuntimeCachePreparationIntentId({
      projectId: input.projectId,
      recipe,
      generation,
    }),
    projectId: safeId(input.projectId, "$cachePreparationIntent.projectId"),
    recipe: capabilityRuntimeCachePreparationRecipeReference(recipe),
    scope,
    scopeFingerprint,
    generation,
    predecessor,
    plannedAt: isoDateTime(input.plannedAt, "$cachePreparationIntent.plannedAt"),
  };
  return deepFreeze({ ...body, fingerprint: await sha256Fingerprint(body) });
}

export async function createCapabilityRuntimeCachePreparationObserved(input: {
  readonly intent: CapabilityRuntimeCachePreparationIntent;
  readonly observedAt: string;
}): Promise<CapabilityRuntimeCachePreparationObserved> {
  const intent = await validateCapabilityRuntimeCachePreparationIntent(input.intent);
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA,
    preparationId: intent.id,
    preparationFingerprint: structuredClone(intent.fingerprint),
    scopeFingerprint: structuredClone(intent.scopeFingerprint),
    observedAt: isoDateTime(input.observedAt, "$cachePreparationObserved.observedAt"),
  });
}

export async function createCapabilityRuntimeCachePreparationFailed(input: {
  readonly intent: CapabilityRuntimeCachePreparationIntent;
  readonly failedAt: string;
  readonly reason: CapabilityRuntimeCachePreparationFailed["reason"];
}): Promise<CapabilityRuntimeCachePreparationFailed> {
  const intent = await validateCapabilityRuntimeCachePreparationIntent(input.intent);
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA,
    preparationId: intent.id,
    preparationFingerprint: structuredClone(intent.fingerprint),
    failedAt: isoDateTime(input.failedAt, "$cachePreparationFailed.failedAt"),
    reason: oneOf(
      input.reason,
      [
        "acquisition-failed",
        "observation-failed",
        "not-exact-after-acquisition",
        "authorization-revoked",
      ] as const,
      "$cachePreparationFailed.reason",
    ),
  });
}

export async function validateCapabilityRuntimeCachePreparationIntent(
  value: unknown,
): Promise<CapabilityRuntimeCachePreparationIntent> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "projectId",
    "recipe",
    "scope",
    "scopeFingerprint",
    "generation",
    "predecessor",
    "plannedAt",
    "fingerprint",
  ], "$cachePreparationIntent");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA,
    "$cachePreparationIntent.schemaVersion",
  );
  const recipe = parseRecipeReference(root.recipe, "$cachePreparationIntent.recipe");
  const scope = validateCapabilityRuntimeCachePreparationScope(root.scope);
  const scopeFingerprint = parseFingerprint(
    root.scopeFingerprint,
    "$cachePreparationIntent.scopeFingerprint",
  );
  const expectedScopeFingerprint =
    await capabilityRuntimeCachePreparationScopeFingerprint(scope);
  if (!fingerprintsEqual(scopeFingerprint, expectedScopeFingerprint)) {
    throw new TypeError(
      "$cachePreparationIntent.scopeFingerprint does not match its exact scope.",
    );
  }
  const projectId = safeId(root.projectId, "$cachePreparationIntent.projectId");
  const id = safeId(root.id, "$cachePreparationIntent.id");
  const generation = positiveInteger(
    root.generation,
    "$cachePreparationIntent.generation",
  );
  if (generation > CAPABILITY_RUNTIME_CACHE_PREPARATION_MAX_GENERATIONS) {
    throw new TypeError(
      "$cachePreparationIntent.generation exceeds the recovery bound.",
    );
  }
  const predecessor = parsePredecessor(
    root.predecessor,
    "$cachePreparationIntent.predecessor",
  );
  if ((generation === 1) !== (predecessor === null)) {
    throw new TypeError(
      "$cachePreparationIntent initial generation and predecessor do not agree.",
    );
  }
  const expectedId = await capabilityRuntimeCachePreparationIntentId({
    projectId,
    recipe: {
      schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
      id: recipe.id,
      version: recipe.version,
      scope,
      fingerprint: recipe.fingerprint,
    },
    generation,
  });
  if (id !== expectedId) {
    throw new TypeError("$cachePreparationIntent.id does not bind its exact scope.");
  }
  const body = {
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_INTENT_SCHEMA,
    id,
    projectId,
    recipe,
    scope,
    scopeFingerprint,
    generation,
    predecessor,
    plannedAt: isoDateTime(root.plannedAt, "$cachePreparationIntent.plannedAt"),
  };
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$cachePreparationIntent.fingerprint",
  );
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(
      "$cachePreparationIntent.fingerprint does not match its canonical body.",
    );
  }
  return deepFreeze({ ...body, fingerprint });
}

export function validateCapabilityRuntimeCachePreparationTerminal(
  value: unknown,
): CapabilityRuntimeCachePreparationTerminal {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$cachePreparationTerminal must be an object.");
  }
  const schemaVersion = (value as Record<string, unknown>).schemaVersion;
  if (schemaVersion === CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA) {
    const root = exactRecord(value, [
      "schemaVersion",
      "preparationId",
      "preparationFingerprint",
      "scopeFingerprint",
      "observedAt",
    ], "$cachePreparationObserved");
    return deepFreeze({
      schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_OBSERVED_SCHEMA,
      preparationId: safeId(
        root.preparationId,
        "$cachePreparationObserved.preparationId",
      ),
      preparationFingerprint: parseFingerprint(
        root.preparationFingerprint,
        "$cachePreparationObserved.preparationFingerprint",
      ),
      scopeFingerprint: parseFingerprint(
        root.scopeFingerprint,
        "$cachePreparationObserved.scopeFingerprint",
      ),
      observedAt: isoDateTime(root.observedAt, "$cachePreparationObserved.observedAt"),
    });
  }
  if (schemaVersion === CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA) {
    const root = exactRecord(value, [
      "schemaVersion",
      "preparationId",
      "preparationFingerprint",
      "failedAt",
      "reason",
    ], "$cachePreparationFailed");
    return deepFreeze({
      schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_FAILED_SCHEMA,
      preparationId: safeId(
        root.preparationId,
        "$cachePreparationFailed.preparationId",
      ),
      preparationFingerprint: parseFingerprint(
        root.preparationFingerprint,
        "$cachePreparationFailed.preparationFingerprint",
      ),
      failedAt: isoDateTime(root.failedAt, "$cachePreparationFailed.failedAt"),
      reason: oneOf(
        root.reason,
        [
          "acquisition-failed",
          "observation-failed",
          "not-exact-after-acquisition",
          "authorization-revoked",
        ] as const,
        "$cachePreparationFailed.reason",
      ),
    });
  }
  throw new TypeError("$cachePreparationTerminal.schemaVersion is unsupported.");
}

function cachePreparationLineageFingerprint(input: {
  readonly projectId: string;
  readonly recipe: CapabilityRuntimeCachePreparationRecipe;
}): Promise<ContentFingerprint> {
  return sha256Fingerprint({
    projectId: safeId(input.projectId, "$cachePreparation.projectId"),
    recipe: capabilityRuntimeCachePreparationRecipeReference(input.recipe),
    scope: validateCapabilityRuntimeCachePreparationScope(input.recipe.scope),
  });
}
