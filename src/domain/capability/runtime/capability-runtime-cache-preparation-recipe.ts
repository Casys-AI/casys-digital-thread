import {
  arrayOf,
  deepFreeze,
  exactRecord,
  literalValue,
} from "../../kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
  type CapabilityRuntimeCachePreparationRecipe,
  type CapabilityRuntimeCachePreparationRecipePlan,
  type CapabilityRuntimeCachePreparationRecipeReference,
  type CapabilityRuntimeCachePreparationRequestedMaterial,
  type CapabilityRuntimeCachePreparationScope,
} from "./capability-runtime-cache-preparation-model.ts";
import {
  compareRecipe,
  parseFingerprint,
  requestedMaterialKey,
  sameRequestedMaterial,
  validateCapabilityRuntimeCachePreparationScope,
  validateRecipeBody,
  validateRequestedMaterials,
} from "./capability-runtime-cache-preparation-validation.ts";

export function capabilityRuntimeCachePreparationRecipeReference(
  recipe: CapabilityRuntimeCachePreparationRecipe,
): CapabilityRuntimeCachePreparationRecipeReference {
  return deepFreeze({
    id: recipe.id,
    version: recipe.version,
    fingerprint: { ...recipe.fingerprint },
  });
}

export function capabilityRuntimeCachePreparationScopeFingerprint(
  scope: CapabilityRuntimeCachePreparationScope,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateCapabilityRuntimeCachePreparationScope(scope));
}

export async function createCapabilityRuntimeCachePreparationRecipe(
  input: Omit<CapabilityRuntimeCachePreparationRecipe, "fingerprint">,
): Promise<CapabilityRuntimeCachePreparationRecipe> {
  const recipe = validateRecipeBody(input);
  return deepFreeze({
    ...recipe,
    fingerprint: await sha256Fingerprint(recipe),
  });
}

export async function validateCapabilityRuntimeCachePreparationRecipe(
  value: unknown,
): Promise<CapabilityRuntimeCachePreparationRecipe> {
  const root = exactRecord(value, [
    "schemaVersion",
    "id",
    "version",
    "scope",
    "fingerprint",
  ], "$cachePreparationRecipe");
  literalValue(
    root.schemaVersion,
    CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
    "$cachePreparationRecipe.schemaVersion",
  );
  const body = validateRecipeBody({
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
    id: root.id as string,
    version: root.version as string,
    scope: root.scope as CapabilityRuntimeCachePreparationScope,
  });
  const fingerprint = parseFingerprint(
    root.fingerprint,
    "$cachePreparationRecipe.fingerprint",
  );
  const expected = await sha256Fingerprint(body);
  if (!fingerprintsEqual(fingerprint, expected)) {
    throw new TypeError(
      "$cachePreparationRecipe.fingerprint does not match its canonical body.",
    );
  }
  return deepFreeze({ ...body, fingerprint });
}

export function validateCapabilityRuntimeCachePreparationRequestedMaterials(
  value: unknown,
): readonly CapabilityRuntimeCachePreparationRequestedMaterial[] {
  return validateRequestedMaterials(
    value,
    "$cachePreparationRequestedMaterials",
    false,
  );
}

/**
 * Produces a deterministic disjoint cover from independently reviewed recipes.
 * A request may contain unknown material; it remains literal in `unavailable`
 * rather than being folded into a synthetic combined recipe.
 */
export function planCapabilityRuntimeCachePreparationRecipes(input: {
  readonly requested: readonly CapabilityRuntimeCachePreparationRequestedMaterial[];
  readonly recipes: readonly CapabilityRuntimeCachePreparationRecipe[];
}): CapabilityRuntimeCachePreparationRecipePlan {
  const requested = validateCapabilityRuntimeCachePreparationRequestedMaterials(
    input.requested,
  );
  const requestedByKey = new Map(
    requested.map((material) => [requestedMaterialKey(material), material]),
  );
  const recipes = input.recipes.filter((recipe) =>
    recipe.scope.materials.every((material) => {
      const requestedMaterial = requestedByKey.get(requestedMaterialKey(material));
      return requestedMaterial !== undefined &&
        requestedMaterial.material.imageDigest === material.material.imageDigest &&
        requestedMaterial.imageReference === material.imageReference &&
        requestedMaterial.lifecycle === material.lifecycle;
    })
  ).toSorted(compareRecipe);
  const covered = new Set<string>();
  for (const recipe of recipes) {
    for (const material of recipe.scope.materials) {
      const key = requestedMaterialKey(material);
      if (covered.has(key)) {
        throw new TypeError(
          "Cache preparation recipe registry has overlapping known recipe scopes.",
        );
      }
      covered.add(key);
    }
  }
  const unavailable = requested.filter((material) =>
    !covered.has(requestedMaterialKey(material))
  );
  return deepFreeze({
    recipes: deepFreeze(recipes),
    unavailable: deepFreeze(unavailable),
  });
}

export async function validateCapabilityRuntimeCachePreparationRecipePlan(input: {
  readonly requested: readonly CapabilityRuntimeCachePreparationRequestedMaterial[];
  readonly plan: CapabilityRuntimeCachePreparationRecipePlan;
}): Promise<CapabilityRuntimeCachePreparationRecipePlan> {
  const requested = validateCapabilityRuntimeCachePreparationRequestedMaterials(
    input.requested,
  );
  const root = exactRecord(
    input.plan,
    ["recipes", "unavailable"],
    "$cachePreparationPlan",
  );
  const recipes = await Promise.all(
    arrayOf(root.recipes, "$cachePreparationPlan.recipes").map((recipe) =>
      validateCapabilityRuntimeCachePreparationRecipe(recipe)
    ),
  );
  const unavailable = validateRequestedMaterials(
    root.unavailable,
    "$cachePreparationPlan.unavailable",
    true,
  );
  const expected = planCapabilityRuntimeCachePreparationRecipes({ requested, recipes });
  if (
    expected.recipes.length !== recipes.length ||
    expected.unavailable.length !== unavailable.length ||
    expected.recipes.some((recipe, index) =>
      recipe.fingerprint.digest !== recipes[index]?.fingerprint.digest ||
      recipe.fingerprint.algorithm !== recipes[index]?.fingerprint.algorithm
    ) ||
    expected.unavailable.some((material, index) =>
      !sameRequestedMaterial(material, unavailable[index]!)
    )
  ) {
    throw new TypeError(
      "$cachePreparationPlan does not exactly partition the requested material set.",
    );
  }
  return deepFreeze({
    recipes: deepFreeze(recipes),
    unavailable: deepFreeze(unavailable),
  });
}
