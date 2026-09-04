import {
  arrayOf,
  deepFreeze,
  exactRecord,
  exactVersionToken,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { pinnedOciImageReference } from "../../compile/isolation/local-isolation-runtime.ts";
import type { CapabilityRuntimeMaterialIdentity } from "./capability-runtime-material.ts";
import {
  CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
  type CapabilityRuntimeCachePreparationIntent,
  type CapabilityRuntimeCachePreparationMaterial,
  type CapabilityRuntimeCachePreparationProfile,
  type CapabilityRuntimeCachePreparationRecipe,
  type CapabilityRuntimeCachePreparationRecipeReference,
  type CapabilityRuntimeCachePreparationRequestedMaterial,
  type CapabilityRuntimeCachePreparationScope,
} from "./capability-runtime-cache-preparation-model.ts";

export function validateCapabilityRuntimeCachePreparationScope(
  value: unknown,
): CapabilityRuntimeCachePreparationScope {
  const root = exactRecord(value, ["materials"], "$cachePreparationScope");
  const materials = arrayOf(root.materials, "$cachePreparationScope.materials").map(
    (entry, index) =>
      parseScopeMaterial(entry, `$cachePreparationScope.materials[${index}]`),
  );
  if (materials.length === 0) {
    throw new TypeError("$cachePreparationScope.materials must not be empty.");
  }
  assertOrderedUniqueMaterialKeys(
    materials.map((entry) => entry.material),
    "$cachePreparationScope.materials",
  );
  return deepFreeze({ materials });
}

export function validateRequestedMaterials(
  value: unknown,
  path: string,
  allowEmpty: boolean,
): readonly CapabilityRuntimeCachePreparationRequestedMaterial[] {
  const materials = arrayOf(value, path).map((entry, index) =>
    parseRequestedMaterial(entry, `${path}[${index}]`)
  );
  if (!allowEmpty && materials.length === 0) {
    throw new TypeError(`${path} must not be empty.`);
  }
  assertOrderedUniqueMaterialKeys(materials.map((entry) => entry.material), path);
  return deepFreeze(materials);
}

export function parseScopeMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeCachePreparationMaterial {
  const root = exactRecord(value, [
    "material",
    "imageReference",
    "lifecycle",
    "profile",
  ], path);
  const material = parseMaterial(root.material, `${path}.material`);
  const imageReference = pinnedImageReference(
    root.imageReference,
    `${path}.imageReference`,
  );
  if (!imageReference.endsWith(`@sha256:${material.imageDigest}`)) {
    throw new TypeError(
      `${path}.imageReference does not attest its exact material digest.`,
    );
  }
  return deepFreeze({
    material,
    imageReference,
    lifecycle: oneOf(
      root.lifecycle,
      ["ephemeral", "cache"] as const,
      `${path}.lifecycle`,
    ),
    profile: parseProfile(root.profile, `${path}.profile`),
  });
}

export function parseRequestedMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeCachePreparationRequestedMaterial {
  const root = exactRecord(value, ["material", "imageReference", "lifecycle"], path);
  const material = parseMaterial(root.material, `${path}.material`);
  const imageReference = pinnedImageReference(
    root.imageReference,
    `${path}.imageReference`,
  );
  if (!imageReference.endsWith(`@sha256:${material.imageDigest}`)) {
    throw new TypeError(
      `${path}.imageReference does not attest its exact material digest.`,
    );
  }
  return deepFreeze({
    material,
    imageReference,
    lifecycle: oneOf(
      root.lifecycle,
      ["ephemeral", "cache"] as const,
      `${path}.lifecycle`,
    ),
  });
}

export function parseMaterial(
  value: unknown,
  path: string,
): CapabilityRuntimeMaterialIdentity {
  const root = exactRecord(value, ["unitId", "materialId", "imageDigest"], path);
  const imageDigest = nonEmptyText(root.imageDigest, `${path}.imageDigest`);
  if (!/^[a-f0-9]{64}$/.test(imageDigest)) {
    throw new TypeError(`${path}.imageDigest must be one SHA-256 digest.`);
  }
  return deepFreeze({
    unitId: safeId(root.unitId, `${path}.unitId`),
    materialId: safeId(root.materialId, `${path}.materialId`),
    imageDigest,
  });
}

export function parseProfile(
  value: unknown,
  path: string,
): CapabilityRuntimeCachePreparationProfile {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

export function parseRecipeReference(
  value: unknown,
  path: string,
): CapabilityRuntimeCachePreparationRecipeReference {
  const root = exactRecord(value, ["id", "version", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    version: exactVersionToken(root.version, `${path}.version`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

export function parsePredecessor(
  value: unknown,
  path: string,
): CapabilityRuntimeCachePreparationIntent["predecessor"] {
  if (value === null) return null;
  const root = exactRecord(value, ["id", "fingerprint"], path);
  return deepFreeze({
    id: safeId(root.id, `${path}.id`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  });
}

export function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(root.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be one SHA-256 digest.`);
  }
  return deepFreeze({ algorithm: "sha256" as const, digest });
}

export function validateRecipeBody(
  value: Omit<CapabilityRuntimeCachePreparationRecipe, "fingerprint">,
): Omit<CapabilityRuntimeCachePreparationRecipe, "fingerprint"> {
  literalValue(
    value.schemaVersion,
    CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
    "$cachePreparationRecipe.schemaVersion",
  );
  return deepFreeze({
    schemaVersion: CAPABILITY_RUNTIME_CACHE_PREPARATION_RECIPE_SCHEMA,
    id: safeId(value.id, "$cachePreparationRecipe.id"),
    version: exactVersionToken(value.version, "$cachePreparationRecipe.version"),
    scope: validateCapabilityRuntimeCachePreparationScope(value.scope),
  });
}

export function assertOrderedUniqueMaterialKeys(
  materials: readonly CapabilityRuntimeMaterialIdentity[],
  path: string,
): void {
  const keys = materials.map((material) =>
    `${material.unitId}\u0000${material.materialId}`
  );
  rejectDuplicates(keys, `${path}.material`);
  if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
    throw new TypeError(`${path} must use one strict lexical material order.`);
  }
}

export function requestedMaterialKey(
  material:
    | CapabilityRuntimeCachePreparationRequestedMaterial
    | CapabilityRuntimeCachePreparationMaterial,
): string {
  return `${material.material.unitId}\u0000${material.material.materialId}`;
}

export function sameRequestedMaterial(
  left: CapabilityRuntimeCachePreparationRequestedMaterial,
  right: CapabilityRuntimeCachePreparationRequestedMaterial,
): boolean {
  return requestedMaterialKey(left) === requestedMaterialKey(right) &&
    left.material.imageDigest === right.material.imageDigest &&
    left.imageReference === right.imageReference && left.lifecycle === right.lifecycle;
}

export function compareRecipe(
  left: CapabilityRuntimeCachePreparationRecipe,
  right: CapabilityRuntimeCachePreparationRecipe,
): number {
  return `${left.id}\u0000${left.version}\u0000${left.fingerprint.digest}`
    .localeCompare(
      `${right.id}\u0000${right.version}\u0000${right.fingerprint.digest}`,
    );
}

export function pinnedImageReference(value: unknown, path: string): string {
  return pinnedOciImageReference(value, path);
}

export function oneOf<T extends readonly string[]>(
  value: unknown,
  accepted: T,
  path: string,
): T[number] {
  if (!accepted.includes(value as T[number])) {
    throw new TypeError(`${path} is unsupported.`);
  }
  return value as T[number];
}

export function isoDateTime(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) {
    throw new TypeError(`${path} must be one canonical ISO-8601 instant.`);
  }
  return text;
}
