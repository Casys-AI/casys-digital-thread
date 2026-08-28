import { deepFreeze, positiveInteger } from "../../domain/kernel/case-validation.ts";
import { pinnedOciImageReference } from "../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  CAPABILITY_PACK_INSTALLATION_PLAN_SCHEMA_VERSION,
  type CapabilityPackInstallationPlan,
  type CapabilityPackManifest,
  type CapabilityPackPlanningHost,
  type CapabilityRuntimeMaterial,
  type ObservedCapabilityImage,
} from "./read-model/capability-pack.ts";

/**
 * Explain installation material only. This function cannot pull, start, stop, bind,
 * qualify, write a lock, or mutate a project.
 */
export function planCapabilityPackInstallation(
  pack: CapabilityPackManifest,
  host: CapabilityPackPlanningHost,
): CapabilityPackInstallationPlan {
  const observed = observedImages(host.images);
  const orderedMaterials = topologicalMaterials(pack.materials);
  const blockers = orderedMaterials
    .filter((material) => !material.platforms.includes(host.platform))
    .map((material) =>
      `Material ${material.id} does not support host platform ${host.platform}.`
    );

  const groups = new Map<
    string,
    { materials: CapabilityRuntimeMaterial[]; estimate?: number }
  >();
  for (const material of orderedMaterials) {
    const group = groups.get(material.image) ?? { materials: [] };
    group.materials.push(material);
    if (material.estimatedBytes !== undefined) {
      group.estimate = material.estimatedBytes;
    }
    groups.set(material.image, group);
  }

  const images = [...groups.entries()].map(([reference, group]) => {
    const present = observed.has(reference);
    return deepFreeze({
      reference,
      materialIds: group.materials.map((material) => material.id),
      action: present ? "reuse" as const : "acquire" as const,
      estimatedAdditionalBytes: present ? 0 : group.estimate ?? null,
    });
  });
  const unknownSizeImageReferences = images
    .filter((image) =>
      image.action === "acquire" && image.estimatedAdditionalBytes === null
    )
    .map((image) => image.reference);
  const estimatedAdditionalBytes = unknownSizeImageReferences.length > 0
    ? null
    : images.reduce(
      (sum, image) => sum + (image.estimatedAdditionalBytes ?? 0),
      0,
    );
  const status = blockers.length > 0
    ? "blocked" as const
    : images.some((image) => image.action === "acquire")
    ? "changes-required" as const
    : "ready" as const;

  return deepFreeze({
    schemaVersion: CAPABILITY_PACK_INSTALLATION_PLAN_SCHEMA_VERSION,
    mutatesRuntime: false,
    pack: { id: pack.id, version: pack.version },
    platform: host.platform,
    status,
    bindingClaims: pack.bindingClaims.map((claim) => structuredClone(claim)),
    materials: orderedMaterials.map((material) => ({
      id: material.id,
      kind: material.kind,
      image: material.image,
      dependsOn: [...material.dependsOn],
      platformSupported: material.platforms.includes(host.platform),
    })),
    images,
    estimatedAdditionalBytes,
    unknownSizeImageReferences,
    blockers,
  });
}

function observedImages(
  observations: readonly ObservedCapabilityImage[],
): ReadonlyMap<string, ObservedCapabilityImage> {
  const result = new Map<string, ObservedCapabilityImage>();
  for (let index = 0; index < observations.length; index++) {
    const observation = observations[index]!;
    const reference = pinnedOciImageReference(
      observation.reference,
      `$host.images[${index}].reference`,
    );
    if (observation.sizeBytes !== undefined) {
      positiveInteger(observation.sizeBytes, `$host.images[${index}].sizeBytes`);
    }
    const previous = result.get(reference);
    if (
      previous && previous.sizeBytes !== undefined &&
      observation.sizeBytes !== undefined &&
      previous.sizeBytes !== observation.sizeBytes
    ) {
      throw new TypeError(
        `$host.images has conflicting observed sizes for ${reference}.`,
      );
    }
    result.set(reference, deepFreeze({ ...previous, ...observation, reference }));
  }
  return result;
}

function topologicalMaterials(
  materials: readonly CapabilityRuntimeMaterial[],
): CapabilityRuntimeMaterial[] {
  const byId = new Map(materials.map((material) => [material.id, material]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: CapabilityRuntimeMaterial[] = [];
  const visit = (material: CapabilityRuntimeMaterial): void => {
    if (visited.has(material.id)) return;
    if (visiting.has(material.id)) {
      throw new TypeError(
        `Capability pack material dependency cycle contains ${material.id}.`,
      );
    }
    visiting.add(material.id);
    for (const dependency of material.dependsOn) {
      const resolved = byId.get(dependency);
      if (!resolved) {
        throw new TypeError(
          `Capability pack material ${material.id} references unknown dependency ${dependency}.`,
        );
      }
      visit(resolved);
    }
    visiting.delete(material.id);
    visited.add(material.id);
    result.push(material);
  };
  for (const material of materials) visit(material);
  return result;
}
