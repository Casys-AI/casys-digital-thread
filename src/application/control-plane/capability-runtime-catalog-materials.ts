/**
 * Pure catalogue projection of the materials that can satisfy a demand.
 *
 * It never observes Docker, Microsandbox, or a host. Callers that already
 * know the demanded capabilities pass them here so a later host read can stay
 * inside that closed set.
 */

import {
  engineeringCapabilityRequirementKey,
  type RequiredEngineeringCapability,
} from "../../domain/capability/engineering-capability.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeCatalog } from "../../domain/capability/runtime/capability-runtime-catalog.ts";

export function capabilityRuntimeCatalogMaterialsForRequirements(
  catalog: Pick<CapabilityRuntimeCatalog, "units" | "bindings">,
  requirements: readonly RequiredEngineeringCapability[],
): readonly CapabilityRuntimeMaterialIdentity[] {
  const wanted = new Set(
    requirements.map((requirement) => engineeringCapabilityRequirementKey(requirement)),
  );
  const unitById = new Map(catalog.units.map((unit) => [unit.id, unit]));
  const identities = new Map<string, CapabilityRuntimeMaterialIdentity>();
  for (const binding of catalog.bindings) {
    const requirementKey = engineeringCapabilityRequirementKey({
      id: binding.capability.id,
      version: binding.capability.version,
      use: binding.use,
    });
    if (!wanted.has(requirementKey)) continue;
    for (const unitId of binding.unitIds) {
      const unit = unitById.get(unitId);
      if (!unit) {
        throw new TypeError(
          `Capability catalogue binding ${binding.id} references unknown unit ${unitId}.`,
        );
      }
      for (const material of unit.materials) {
        const identity = {
          unitId: unit.id,
          materialId: material.id,
          imageDigest: ociDigest(material.imageReference),
        };
        const key = capabilityRuntimeMaterialKey(identity);
        const previous = identities.get(key);
        if (previous && previous.imageDigest !== identity.imageDigest) {
          throw new TypeError(
            `Capability catalogue has contradictory digests for ${unit.id}/${material.id}.`,
          );
        }
        identities.set(key, identity);
      }
    }
  }
  return [...identities.values()].toSorted((left, right) =>
    capabilityRuntimeMaterialKey(left).localeCompare(
      capabilityRuntimeMaterialKey(right),
    )
  );
}

function ociDigest(imageReference: string): string {
  const match = /@sha256:([a-f0-9]{64})$/.exec(imageReference);
  if (!match) {
    throw new TypeError(
      `Capability runtime material is not OCI digest-pinned: ${imageReference}.`,
    );
  }
  return match[1]!;
}
