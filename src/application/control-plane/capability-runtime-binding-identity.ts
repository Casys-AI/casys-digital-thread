/** Exact binding identities shared by runtime supervision and read-only reviews. */
import type { ProjectCapabilityRuntimeAuthorizedBinding } from "../ports/out/capability/capability-runtime-supervisor.ts";
import type { ResolvedCapabilityRuntimeBinding } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import { capabilityRuntimeMaterialKey } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../domain/capability/runtime/capability-runtime-material.ts";

export function sameAuthorizedBindingIdentity(
  left: ProjectCapabilityRuntimeAuthorizedBinding,
  right: Pick<
    ResolvedCapabilityRuntimeBinding,
    "capability" | "binding" | "adapter" | "profile"
  >,
): boolean {
  return left.capability.id === right.capability.id &&
    left.capability.version === right.capability.version &&
    left.capability.use === right.capability.use &&
    left.binding.id === right.binding.id &&
    left.binding.version === right.binding.version &&
    left.adapter.id === right.adapter.id &&
    left.adapter.version === right.adapter.version &&
    left.adapter.source === right.adapter.source &&
    sameProfile(left.profile, right.profile);
}

function sameProfile(
  left: ProjectCapabilityRuntimeAuthorizedBinding["profile"],
  right: ResolvedCapabilityRuntimeBinding["profile"],
): boolean {
  if (left === null || right === null) return left === right;
  return left.id === right.id && left.version === right.version &&
    ((left.fingerprint === null && right.fingerprint === null) ||
      (left.fingerprint !== null && right.fingerprint !== null &&
        left.fingerprint.algorithm === right.fingerprint.algorithm &&
        left.fingerprint.digest === right.fingerprint.digest));
}

export function sameMaterialSet(
  left: readonly CapabilityRuntimeMaterialIdentity[],
  right: readonly CapabilityRuntimeMaterialIdentity[],
): boolean {
  const materialToken = (material: CapabilityRuntimeMaterialIdentity) =>
    `${capabilityRuntimeMaterialKey(material)}\u0000${material.imageDigest}`;
  const leftTokens = left.map(materialToken).toSorted();
  const rightTokens = right.map(materialToken).toSorted();
  return leftTokens.length === rightTokens.length &&
    leftTokens.every((token, index) => token === rightTokens[index]);
}
